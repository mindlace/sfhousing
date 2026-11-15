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
  /** A resume was sent on this connection and its answer has not ended (Task 9 extends). */
  #resuming = false;
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
    this.#cancelHello = this.#cancelRetry = this.#cancelPing = this.#cancelDeadline = null;
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
        this.#onRefused(f.id, f.why);
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
    this.#resume(s);
    if (this.#o.net.visible()) this.#armPing();
  }

  /**
   * Seam for Task 9. Today: a resume from tipSeq when the store is ready on this sim; else
   * nothing is sent and the socket stays catching-up (Task 9 owes the resume and sends it once
   * the store is ready on this sim, C10).
   */
  #resume(s: SocketLike): void {
    const store = this.#o.store;
    if (!store.ready || store.simId !== this.#o.simId) return;
    this.#resuming = true;
    s.send(encodeFrame({ type: 'resume', after: store.tipSeq }));
  }

  /**
   * Every commits frame goes to the store with this socket's sim. Seam for Task 9: today only
   * `more: false` ending this connection's resume is acted on (caught up: live, and with nothing
   * pending or held the backoff resets, C12 as ruled in fix round 1); `more: true`, a gap and the
   * store's other answers are Task 9's (C7 to C9, C29, C30), and so is a throw from receive (C30).
   */
  #onCommits(s: SocketLike, commits: Commit[], more: boolean | undefined): void {
    const store = this.#o.store;
    store.receive(this.#o.simId, commits);
    if (!this.#current(s)) return;
    if (more === false && this.#resuming) {
      this.#resuming = false;
      if (store.pendingCount === 0 && store.heldCount === 0) this.#attempt = 0;
      this.#set({ phase: 'live' });
      if (!this.#current(s)) return;
    }
    this.#trySend();
  }

  /** Seam for Tasks 9 and 10 (C20, C21, A3 to A9, A16, A17): ignored today. */
  #onRefused(id: string | null, why: RefusedWhy): void {
    void id;
    void why;
  }

  /** Clears what one connection's resume knew (C11). Task 9 adds its own fields here. */
  #resetResume(): void {
    this.#resuming = false;
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

  #onStore(): void {
    if (!this.#running()) return;
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
