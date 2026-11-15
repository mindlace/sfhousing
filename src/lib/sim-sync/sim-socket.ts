// One sim's socket to its sim object: the connection's life (hello, backoff, offline and online,
// hidden and visible, pings and the liveness deadline, halts) and, in turn, its resume and its
// sends. The state table in the sim log sync plan (rows C and A) is the contract. Every wait is
// the injected clock's; nothing here touches a browser API but the ports it is given.
import type { Commit } from '$lib/sim-log';
import {
  CLOSE_GONE,
  PING,
  PONG,
  PROTOCOL,
  encodeFrame,
  type RefusedWhy,
  type ServerFrame
} from '$lib/sim-stream/protocol';
import { backoffDelay } from './backoff';
import {
  errorName,
  type Clock,
  type NetEvent,
  type NetSignals,
  type SocketCtor,
  type SocketLike,
  type SyncStore
} from './ports';

/**
 * No hello within this after connecting, or no frame within this after a ping: the connection
 * is dead.
 */
export const HELLO_TIMEOUT_MS = 10_000;
export const PING_MS = 30_000;

export type SocketPhase =
  'off' | 'connecting' | 'catching-up' | 'live' | 'offline' | 'waiting' | 'halted';
/** Why a socket will not reconnect. 'broken': the store could not take a stored commit (Task 9). */
export type Halt = 'gone' | 'diverged' | 'protocol' | 'broken';
/** Why it holds its sends while connected. */
export type Hold = 'not-writer' | 'limit' | 'full' | 'newer';

export interface SocketView {
  phase: SocketPhase;
  halt: Halt | null;
  hold: Hold | null;
  /** The last access frame on this connection; null before one. */
  write: boolean | null;
  /** The last hello's build; null before one. */
  serverBuild: string | null;
  /** The id of the append awaiting its answer. */
  inFlight: string | null;
}

export const OFF_VIEW: SocketView = Object.freeze({
  phase: 'off',
  halt: null,
  hold: null,
  write: null,
  serverBuild: null,
  inFlight: null
});

export interface SimSocketOptions {
  store: SyncStore;
  /** The sim this socket belongs to, for its life. */
  simId: string;
  /** location.origin: http becomes ws, https becomes wss. */
  origin: string;
  WebSocket: SocketCtor;
  clock: Clock;
  random: () => number;
  net: NetSignals;
  /** Called after every change of `view`. */
  onChange: (v: SocketView) => void;
}

const REFUSED_WHY: ReadonlySet<string> = new Set<RefusedWhy>([
  'behind',
  'invalid',
  'newer',
  'not-writer',
  'limit',
  'full',
  'gone'
]);

/** A server frame, or null for a text that is not one of the known frames (C19). */
function frameOf(text: string): ServerFrame | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const f = v as Record<string, unknown>;
  switch (f.type) {
    case 'hello': {
      const { build, protocol, dataset } = f;
      if (typeof build !== 'string' || typeof protocol !== 'number') return null;
      if (dataset !== undefined && typeof dataset !== 'string') return null;
      return dataset === undefined
        ? { type: 'hello', build, protocol }
        : { type: 'hello', build, protocol, dataset };
    }
    case 'access':
      return typeof f.write === 'boolean' ? { type: 'access', write: f.write } : null;
    case 'commits': {
      const { commits, more } = f;
      if (!Array.isArray(commits)) return null;
      if (more !== undefined && typeof more !== 'boolean') return null;
      return more === undefined
        ? { type: 'commits', commits: commits as Commit[] }
        : { type: 'commits', commits: commits as Commit[], more };
    }
    case 'refused': {
      const { id, why } = f;
      if (id !== null && typeof id !== 'string') return null;
      if (typeof why !== 'string' || !REFUSED_WHY.has(why)) return null;
      return { type: 'refused', id, why: why as RefusedWhy };
    }
    default:
      return null;
  }
}

/** The stream URL of a sim on an origin: http becomes ws, https becomes wss. */
function streamUrl(origin: string, simId: string): string {
  const base = origin.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${base}/api/sims/${encodeURIComponent(simId)}/stream`;
}

/**
 * The socket of one sim. start() connects (or waits for online); the view says where it is.
 * A socket this class closes itself (stop, a timeout, offline, a halt, reconnect) is detached
 * at once: its later events are ignored like those of any socket that is not the current one.
 */
export class SimSocket {
  readonly #o: SimSocketOptions;
  #view: SocketView = OFF_VIEW;
  #started = false;
  #stopped = false;
  /** The current connection; null while there is none. Only its events are heard. */
  #sock: SocketLike | null = null;
  /** The current connection has had its hello. */
  #helloed = false;
  /** Failed connections since the last progress (decision 13). */
  #attempt = 0;
  /** A resume was sent on this connection and its answer's last frame (with `more`) has not come. */
  #resuming = false;
  /**
   * A resume is due but cannot be sent yet: the store is not ready or not on this sim, a resume
   * is outstanding, or a `limit` backoff runs. It counts as outstanding: nothing is sent (S1).
   */
  #owed = false;
  /** The `after` of the last resume sent on this connection. */
  #lastAfter = 0;
  /**
   * An answer said `more: true` and the store's tip did not move past `lastAfter` (a page it
   * cannot apply, decision 22): no further resume on this connection.
   */
  #stalled = false;
  /** An answer on this connection reached the tip and nothing is outstanding, owed or stalled. */
  #caughtUp = false;
  /** `limit` refusals of a resume in a row; reset when an answer reaches `more: false`. */
  #limitAttempt = 0;
  /** The `limit` backoff that sends the owed resume (C21). */
  #cancelLimit: (() => void) | null = null;
  /** The store was ready on this sim at its last notification (C10: turning ready owes one). */
  #here = false;
  /** A socket constructor has thrown once already: logged. */
  #loggedFail = false;
  #cancelHello: (() => void) | null = null;
  #cancelRetry: (() => void) | null = null;
  #cancelPing: (() => void) | null = null;
  /** The liveness deadline after a ping (C24). */
  #cancelDeadline: (() => void) | null = null;
  #unsubscribe: (() => void)[] = [];

  constructor(o: SimSocketOptions) {
    this.#o = o;
  }

  get view(): SocketView {
    return this.#view;
  }

  /** Connects (or waits for online). Subscribes to the store and the network. Once only. */
  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    this.#here = this.#storeHere();
    this.#unsubscribe = [
      this.#o.store.subscribe(() => this.#onStore()),
      this.#o.net.watch((e) => this.#onNet(e))
    ];
    if (this.#o.net.online()) this.#connect();
    else this.#set({ phase: 'offline' });
  }

  /** Closes with 1000, cancels every timer, unsubscribes: final. */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#detach();
    this.#clearTimers();
    for (const u of this.#unsubscribe) u();
    this.#unsubscribe = [];
    this.#set({ ...OFF_VIEW });
  }

  /**
   * Closes the current connection (1000) and connects now; nothing when halted or stopped, nor
   * before start() or while offline (online connects then). The attempt count is kept.
   */
  reconnect(): void {
    if (!this.#running()) return;
    const p = this.#view.phase;
    if (p === 'halted' || p === 'offline') return;
    this.#detach();
    this.#clearTimers();
    this.#connect();
  }

  // ---- the connection ----

  #running(): boolean {
    return this.#started && !this.#stopped;
  }

  /**
   * Still running on socket s. Checked after every call out to code this class does not own (a
   * store method, which notifies its subscribers synchronously, and onChange): such code may
   * have stopped or reconnected this socket, and then the rest of the handler must not run.
   */
  #current(s: SocketLike): boolean {
    return this.#running() && this.#sock === s;
  }

  /** A new connection (C1); a constructor that throws is a failed attempt. */
  #connect(): void {
    this.#helloed = false;
    this.#resetResume();
    let s: SocketLike;
    try {
      s = new this.#o.WebSocket(streamUrl(this.#o.origin, this.#o.simId));
    } catch (e) {
      // Backed off (it may be transient), logged once per SimSocket.
      if (!this.#loggedFail) {
        this.#loggedFail = true;
        console.error('[sim-sync] socket failed', errorName(e));
      }
      this.#retry();
      return;
    }
    this.#sock = s;
    s.addEventListener('message', (e) => {
      if (this.#current(s)) this.#onMessage(s, e.data);
    });
    s.addEventListener('close', (e) => {
      if (this.#current(s)) this.#onClose(e.code);
    });
    // 'error' is always followed by 'close' (C23); 'open' needs nothing: hello says it all.
    this.#cancelHello = this.#o.clock.after(HELLO_TIMEOUT_MS, () => {
      this.#cancelHello = null;
      if (this.#current(s)) this.#dead();
    });
    this.#set({ phase: 'connecting', write: null, inFlight: null });
  }

  /** Lets go of the current socket: closed 1000, its later events unheard (C17). */
  #detach(): void {
    const s = this.#sock;
    this.#sock = null;
    this.#helloed = false;
    this.#resetResume();
    s?.close(1000);
  }

  /** A connection judged dead by a timer (no hello, C6; no frame after a ping, C24). */
  #dead(): void {
    this.#detach();
    this.#retry();
  }

  /** Waits backoffDelay(attempt++) and connects again (C6, C11). */
  #retry(): void {
    this.#clearTimers();
    const delay = backoffDelay(this.#attempt++, this.#o.random);
    this.#cancelRetry = this.#o.clock.after(delay, () => {
      this.#cancelRetry = null;
      this.#connect();
    });
    this.#set({ phase: 'waiting', write: null, inFlight: null });
  }

  /** Never reconnects (C5, C13; Task 9 adds diverged and broken). */
  #halt(why: Halt): void {
    this.#detach();
    this.#clearTimers();
    this.#set({ phase: 'halted', halt: why, write: null, inFlight: null });
  }

  /** The current socket closed from its far side (C11, C13). */
  #onClose(code: number | undefined): void {
    this.#sock = null;
    this.#helloed = false;
    this.#resetResume();
    if (code === CLOSE_GONE) this.#halt('gone');
    else this.#retry();
  }

  #clearTimers(): void {
    this.#cancelHello?.();
    this.#cancelRetry?.();
    this.#cancelPing?.();
    this.#cancelDeadline?.();
    this.#cancelLimit?.();
    this.#cancelHello = this.#cancelRetry = this.#cancelPing = this.#cancelDeadline = null;
    this.#cancelLimit = null;
  }

  // ---- frames ----

  #onMessage(s: SocketLike, data: unknown): void {
    if (typeof data !== 'string') return;
    // Any frame at all, a pong included, shows the connection is alive (C16, C24).
    this.#cancelDeadline?.();
    this.#cancelDeadline = null;
    if (data === PONG) return;
    const f = frameOf(data);
    if (f === null) return; // C19
    if (!this.#helloed) {
      if (f.type === 'hello') this.#onHello(s, f); // C27: nothing else before it
      return;
    }
    switch (f.type) {
      case 'hello':
        return; // C26
      case 'access':
        this.#set({ write: f.write });
        if (this.#current(s)) this.#trySend();
        return;
      case 'commits':
        this.#onCommits(s, f.commits, f.more);
        return;
      case 'refused':
        this.#onRefused(s, f.id, f.why);
        return;
    }
  }

  /** C3, C4, C5. */
  #onHello(s: SocketLike, f: Extract<ServerFrame, { type: 'hello' }>): void {
    this.#cancelHello?.();
    this.#cancelHello = null;
    if (f.protocol !== PROTOCOL) {
      this.#halt('protocol');
      return;
    }
    this.#helloed = true;
    // Before anything is sent (store I11): head() stays null until the dataset is known.
    if (f.dataset !== undefined) this.#o.store.setServerDataset(f.dataset);
    if (!this.#current(s)) return;
    this.#set({ phase: 'catching-up', serverBuild: f.build });
    if (!this.#current(s)) return;
    if (!this.#resume(s)) return;
    if (this.#o.net.visible()) this.#armPing();
  }

  // ---- resume ----

  /** The store is ready and has this socket's sim open. */
  #storeHere(): boolean {
    const store = this.#o.store;
    return store.ready && store.simId === this.#o.simId;
  }

  /**
   * A resume from the store's tip: sent now when the store is here, none is outstanding and no
   * `limit` backoff runs; otherwise owed (C10, C21). Nothing once stalled (C29). Shows the phase;
   * false when socket s is no longer current afterwards.
   */
  #resume(s: SocketLike): boolean {
    this.#caughtUp = false;
    if (this.#stalled) {
      this.#owed = false;
    } else if (this.#resuming || this.#cancelLimit !== null || !this.#storeHere()) {
      this.#owed = true;
    } else {
      this.#owed = false;
      this.#resuming = true;
      this.#lastAfter = this.#o.store.tipSeq;
      s.send(encodeFrame({ type: 'resume', after: this.#lastAfter }));
    }
    return this.#show(s);
  }

  /** Sends an owed resume once it can be (C10: one resume, not two); else shows the phase. */
  #flushOwed(s: SocketLike): boolean {
    const can =
      this.#owed &&
      this.#helloed &&
      !this.#resuming &&
      this.#cancelLimit === null &&
      this.#storeHere();
    return can ? this.#resume(s) : this.#show(s);
  }

  /**
   * The phase of an open connection from its resume state: live only when caught up (nothing
   * outstanding, owed or stalled). False when socket s is no longer current afterwards.
   */
  #show(s: SocketLike): boolean {
    const p = this.#view.phase;
    if (p === 'catching-up' || p === 'live') {
      this.#set({ phase: this.#caughtUp ? 'live' : 'catching-up' });
    }
    return this.#current(s);
  }

  /**
   * Every commits frame goes to the store with this socket's sim (C18: a frame for another sim
   * applies nothing and asks nothing). A frame with `more` ends the outstanding answer: `true`
   * resumes from the tip if it moved past `lastAfter`, else stalls (C7, C29); `false` is caught
   * up unless something is owed (C7, C12). A gap resumes only when nothing is outstanding or
   * owed (C8, C9). A frame the store was not ready for owes a resume (C10). A throw halts
   * `broken` (C30).
   */
  #onCommits(s: SocketLike, commits: Commit[], more: boolean | undefined): void {
    const store = this.#o.store;
    const end = more !== undefined && this.#resuming;
    let r: ReturnType<SyncStore['receive']>;
    try {
      r = store.receive(this.#o.simId, commits);
    } catch (e) {
      console.error('[sim-sync] receive failed', errorName(e));
      if (this.#current(s)) this.#halt('broken');
      return;
    }
    if (!this.#current(s)) return;
    if (end) this.#resuming = false;
    const stale = r.kind === 'stale' && 'why' in r ? r.why : null;
    if (stale === 'not-ready') {
      this.#owed = true;
      this.#caughtUp = false;
    } else if (stale === 'other-sim') {
      // Nothing applied; no resume with another sim's tip (C18).
    } else if (end && more === true) {
      if (store.tipSeq > this.#lastAfter) {
        if (!this.#resume(s)) return;
      } else {
        this.#stalled = true;
        this.#caughtUp = false;
      }
    } else if (r.kind === 'gap' && !this.#resuming && !this.#owed) {
      if (!this.#resume(s)) return;
    }
    if (end && more === false && stale === null && !this.#resuming && !this.#owed) {
      this.#caughtUp = true;
      this.#limitAttempt = 0;
      if (store.pendingCount === 0 && store.heldCount === 0) this.#attempt = 0;
    }
    if (!this.#show(s)) return;
    if (!this.#flushOwed(s)) return;
    this.#trySend();
  }

  /**
   * A refusal with no id is the resume's (decision 24): `gone` halts `diverged` (C20); any
   * other reason owes the resume and sends it after `backoffDelay(limitAttempt++)` (C21). A
   * refusal naming an append is Task 10's (A3 to A9, A16, A17).
   */
  #onRefused(s: SocketLike, id: string | null, why: RefusedWhy): void {
    if (id !== null) return;
    if (why === 'gone') {
      this.#halt('diverged');
      return;
    }
    this.#resuming = false;
    this.#owed = true;
    this.#caughtUp = false;
    this.#cancelLimit?.();
    const delay = backoffDelay(this.#limitAttempt++, this.#o.random);
    this.#cancelLimit = this.#o.clock.after(delay, () => {
      this.#cancelLimit = null;
      if (this.#current(s) && this.#flushOwed(s)) this.#trySend();
    });
    if (!this.#show(s)) return;
    this.#trySend();
  }

  /** Clears what one connection's resume knew (C11, C22); `limitAttempt` is kept. */
  #resetResume(): void {
    this.#resuming = false;
    this.#owed = false;
    this.#stalled = false;
    this.#caughtUp = false;
    this.#lastAfter = 0;
    this.#cancelLimit?.();
    this.#cancelLimit = null;
  }

  /** Seam for Task 10 (rows A): sends nothing today. */
  #trySend(): void {}

  // ---- liveness ----

  /** The ping timer: a ping every PING_MS while visible (C16). */
  #armPing(): void {
    const s = this.#sock;
    this.#cancelPing?.();
    this.#cancelPing = null;
    if (s === null) return;
    this.#cancelPing = this.#o.clock.after(PING_MS, () => {
      this.#cancelPing = null;
      // Re-armed only while this socket is still the current one.
      if (!this.#current(s)) return;
      this.#ping();
      this.#armPing();
    });
  }

  /**
   * Sends a ping and starts the liveness deadline (C24) unless one is already running: a ping
   * sent while waiting for an answer to the last one does not push the deadline back.
   */
  #ping(): void {
    const s = this.#sock;
    if (s === null) return;
    s.send(PING);
    if (this.#cancelDeadline !== null) return;
    this.#cancelDeadline = this.#o.clock.after(HELLO_TIMEOUT_MS, () => {
      this.#cancelDeadline = null;
      if (this.#current(s)) this.#dead();
    });
  }

  // ---- signals ----

  /**
   * The store's subscriber, called synchronously inside the store's mutating calls (receive
   * included). The store turning ready on this sim owes a resume (C10); an owed resume is sent
   * once it can be, before any send (A18).
   */
  #onStore(): void {
    if (!this.#running()) return;
    const here = this.#storeHere();
    const was = this.#here;
    this.#here = here;
    const s = this.#sock;
    if (s !== null && this.#helloed) {
      if (here && !was && !this.#stalled) {
        this.#owed = true;
        this.#caughtUp = false;
      }
      if (!this.#flushOwed(s)) return;
    }
    this.#trySend();
  }

  #onNet(e: NetEvent): void {
    if (!this.#running()) return;
    const p = this.#view.phase;
    if (p === 'halted') return;
    const open = p === 'catching-up' || p === 'live';
    switch (e) {
      case 'offline': // C14
        if (p === 'offline') return;
        this.#detach();
        this.#clearTimers();
        this.#set({ phase: 'offline', write: null, inFlight: null });
        return;
      case 'online': // C14b; C28 ignores it otherwise
        if (p === 'offline' || p === 'waiting') {
          this.#clearTimers();
          this.#connect();
        }
        return;
      case 'visible':
        if (p === 'waiting') {
          // C15
          this.#clearTimers();
          this.#connect();
        } else if (open) {
          // C25
          this.#ping();
          this.#armPing();
        }
        return;
      case 'hidden': // C16: the pings stop; a deadline already running does not
        this.#cancelPing?.();
        this.#cancelPing = null;
        return;
    }
  }

  // ---- the view ----

  #set(patch: Partial<SocketView>): void {
    const next = { ...this.#view, ...patch };
    const keys = Object.keys(next) as (keyof SocketView)[];
    if (keys.every((k) => next[k] === this.#view[k])) return;
    this.#view = next;
    this.#o.onChange(next);
  }
}
