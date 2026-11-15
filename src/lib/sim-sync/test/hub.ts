import { SHAPES_REVISION, parseCommitDraft, type Commit, type CommitDraft } from '$lib/sim-log';
import { overFrameLimit } from '$lib/sim-stream/limits';
import {
  CLOSE_MALFORMED,
  PING,
  PONG,
  PROTOCOL,
  commitsFrame,
  encodeFrame,
  parseClientFrame,
  type RefusedWhy
} from '$lib/sim-stream/protocol';
import { DS, FakeObject } from '$lib/sim-store/test/commits';
import type { SocketCtor, SocketEventLike, SocketLike } from '../ports';
import { microtasks, type FetchAnswer } from './fakes';

export interface HubOptions {
  /** hello's dataset; default DS, null leaves it out. */
  dataset?: string | null;
  /** hello's build; default 'b'. */
  build?: string;
  /** hello's protocol; default PROTOCOL. */
  protocol?: number;
  /** Commits per resume answer; default 1000. */
  pageSize?: number;
  /** Access for new sockets; default true. */
  write?: boolean;
  /** Appends wait for release(); default false. */
  hold?: boolean;
  /** Sockets for sims not register()ed close 1006; default false. */
  strict?: boolean;
}

type Listener = (e: SocketEventLike) => void;
type EventType = 'open' | 'message' | 'close' | 'error';

/**
 * The client's end of a connection to a FakeHub. The hub makes it (`new hub.WebSocket(url)`);
 * a test reads it from `hub.sockets`. readyState starts 0, becomes 1 when the hub delivers the
 * open event and 3 when it delivers a close (or the client calls close()). It behaves as a
 * WebSocket does for what a client can see: send() throws a DOMException named
 * InvalidStateError while readyState is 0, and is silently dropped (and not recorded in
 * `sent`) once it is 2 or 3. Frames the client sends reach the hub one step later (see
 * FakeHub.step), in order. close(code) records the code in `closedWith`, sets readyState 3
 * and queues nothing back to the client (the client detaches before the event would come);
 * the hub sees the close in order after the frames sent before it. Events that the hub would
 * deliver to a socket the client closed are dropped. A second close() changes nothing.
 * `resumed` is the hub's mark for this socket: a resume answer that reached the tip has been
 * produced for it (set when the hub produces the answer, not when the client reads it).
 * Not modelled: close reasons, binaryType, bufferedAmount, the CLOSING state (2), removeEvent
 * Listener, the Origin check, and any frame the client sends before the socket is open.
 */
export class FakeSocket implements SocketLike {
  readonly url: string;
  readyState = 0;
  /** Every text the client sent that was not dropped, in order. */
  readonly sent: string[] = [];
  resumed = false;
  /** The code the client closed with, null while it has not closed. */
  closedWith: number | null = null;
  #listeners: Record<EventType, Listener[]> = { open: [], message: [], close: [], error: [] };
  #link: { send(text: string): void; close(code: number): void };

  constructor(url: string, link: { send(text: string): void; close(code: number): void }) {
    this.url = url;
    this.#link = link;
  }

  addEventListener(type: EventType, fn: Listener): void {
    if (!this.#listeners[type].includes(fn)) this.#listeners[type].push(fn);
  }

  send(data: string): void {
    if (this.readyState === 0) {
      throw new DOMException("Failed to execute 'send' on 'WebSocket'", 'InvalidStateError');
    }
    if (this.readyState >= 2) return;
    this.sent.push(data);
    this.#link.send(data);
  }

  close(code?: number): void {
    if (this.closedWith !== null || this.readyState === 3) return;
    this.closedWith = code ?? 1005;
    this.readyState = 3;
    this.#link.close(this.closedWith);
  }

  /** Dispatches straight to the listeners, whatever the state (late events). */
  emit(type: 'open'): void;
  emit(type: 'message', data: string): void;
  emit(type: 'close', code: number): void;
  emit(type: 'error'): void;
  emit(type: EventType, arg?: string | number): void {
    const e: SocketEventLike =
      type === 'message' ? { data: arg } : type === 'close' ? { code: arg as number } : {};
    for (const l of [...this.#listeners[type]]) l(e);
  }
}

/** What the hub knows of a socket, apart from what the client can see. */
interface Conn {
  sim: string;
  write: boolean;
  /** The server has closed it (closeAll, closeOnAppend), or has seen the client's close. */
  gone: boolean;
  /** A resume is queued or being answered. */
  resuming: boolean;
  /** Raised when the server closes the socket: out events of an older epoch are lost. */
  epoch: number;
}

type Ev =
  | { k: 'in'; s: FakeSocket; text: string }
  | { k: 'in-close'; s: FakeSocket }
  | { k: 'turn'; s: FakeSocket; after: number }
  | { k: 'out'; s: FakeSocket; epoch: number; what: 'open' | 'error' }
  | { k: 'out-text'; s: FakeSocket; epoch: number; text: string }
  | { k: 'out-close'; s: FakeSocket; epoch: number; code: number };

const URL_SIM = /\/api\/sims\/([^/?#]+)\/stream(?:[?#]|$)/;

/**
 * A deterministic double of the sim object (one per sim id) and the sockets a client opens to
 * it. It models what the client sees of the real object (docs/dev/sim-object.md), using the
 * real frame encoder and parser (`$lib/sim-stream/protocol`), the real draft parser
 * (`$lib/sim-log`) and the store's FakeObject for the checked append rules. Nothing happens
 * on its own: no timer, no microtask. Every frame, in both directions, is an event in one
 * queue; the test delivers events with `flush()` or `step()`, and an event is handled in queue
 * order:
 *
 *  - Opening a socket queues `open`, then `hello` (unless `silent`) and `access`; or, when the
 *    sim is unregistered under `strict` or `reject` is set, `error` and `close` 1006 instead.
 *  - A frame the client sends takes one step to reach the server (an `in` event); the answer
 *    (queued out) takes one more step to reach the client. A `resume` that is not refused
 *    `limit` clears the socket's `resumed` mark on arrival and queues its answer as a further
 *    server step (so a second `resume` sent meanwhile is refused `limit`, id null, ahead of
 *    the answer's frame, as the real object does); the answer is one frame of up to
 *    `pageSize` commits after `after`, `more` true when commits are left, and the socket is
 *    marked resumed exactly when `more` is false. `after` past the tip is refused `gone`
 *    (id null), the mark staying clear. An accepted append goes, as a one-commit frame with
 *    no `more`, to every resumed open socket of the sim, the author's included; the author
 *    gets nothing else (no ack).
 *  - Appends are answered as the real object does, in its order: a socket without write gets
 *    `not-writer`; then refuseNext() refusals; then closeOnAppend; then the checked rules
 *    (invalid; a duplicate id is counted and answered by nothing; `behind` when the parent is
 *    not the tip; `newer` when `shapes` is above SHAPES_REVISION). A refused append changes
 *    nothing. With `hold`, an append waits at arrival (it is recorded in `appends` then) until
 *    release(); a held append of a socket closed meanwhile is dropped. A text over the real
 *    frame limit is refused `limit` with id null. A text 'ping' is answered 'pong'. A frame
 *    that is not one client frame closes the socket 1008.
 *  - `mute` makes the connection dead without a close: while set, every event that would be
 *    delivered either way (to the server or to a client, a close included) is discarded when
 *    handled, and not counted. `closeAll` and `closeOnAppend` lose the socket's undelivered
 *    frames, then close it from the server.
 *
 * Not modelled: the rate bucket and the `limit` and `full` refusals (use refuseNext), the
 * resume budgets (use refuseResume), a resume answer split into several frames or capped by
 * bytes, resumes waiting behind held appends (a resume is never held), a stored row that does
 * not fold (1011), takeDown (4410), roles and identities, access frames to sockets whose right
 * did not change, hibernation, backpressure, the open handshake's statuses (a refused open is
 * a 1006 close), and the object's close reply to a client's close.
 */
export class FakeHub {
  readonly WebSocket: SocketCtor;
  /** Every socket made, in order. */
  readonly sockets: FakeSocket[] = [];
  /** Every append frame received (held ones included), in order. */
  readonly appends: CommitDraft[] = [];
  /** Every resume's `after`, in order (one refused `limit` for being outstanding included). */
  readonly resumes: number[] = [];
  /** Appends answered as duplicates, when processed (a held one only after release()). */
  duplicates = 0;
  build: string;
  /** Access given to sockets opened from now on (see setAccess). */
  write: boolean;
  /** New sockets open but get no hello. */
  silent = false;
  /** New sockets close 1006 at once (the route refused). */
  reject = false;
  /** See the class comment: a dead connection. Frames handled while set are lost. */
  mute = false;
  /** The next n appends close their socket 1011 instead of being answered. */
  closeOnAppend = 0;
  #o: Required<Omit<HubOptions, 'build' | 'write'>>;
  #sims = new Map<string, FakeObject>();
  #registered = new Set<string>();
  #conn = new Map<FakeSocket, Conn>();
  #queue: Ev[] = [];
  #held: { s: FakeSocket; text: string }[] = [];
  #refusals: RefusedWhy[] = [];
  #resumeRefusals: ('limit' | 'gone')[] = [];

  constructor(o: HubOptions = {}) {
    this.#o = {
      dataset: o.dataset === undefined ? DS : o.dataset,
      protocol: o.protocol ?? PROTOCOL,
      pageSize: o.pageSize ?? 1000,
      hold: o.hold ?? false,
      strict: o.strict ?? false
    };
    this.build = o.build ?? 'b';
    this.write = o.write ?? true;
    const open = (url: string) => this.#open(url);
    this.WebSocket = function (url: string) {
      return open(url);
    } as unknown as SocketCtor;
  }

  /** The hub keeps `hold` readable and settable after construction. */
  get hold(): boolean {
    return this.#o.hold;
  }

  set hold(v: boolean) {
    this.#o.hold = v;
  }

  /** Makes the sim known: under `strict`, sockets for it open. */
  register(simId: string): void {
    this.#registered.add(simId);
  }

  /** A FakeFetch handler: 201 and register() for a new id, 200 for a registered one. */
  registrar(): (simId: string) => FetchAnswer {
    return (simId) => {
      if (this.#registered.has(simId)) return { status: 200, body: { simId, created: false } };
      this.register(simId);
      return { status: 201, body: { simId, created: true } };
    };
  }

  /** The commits stored for a sim, in order (the hub's own list, not a copy). */
  commits(simId: string): Commit[] {
    return this.#object(simId).commits;
  }

  /**
   * Another writer's commit: appended by the checked rules (it must be accepted, else this
   * throws) and sent now, queued, to every resumed open socket on that sim but `except`.
   */
  foreign(simId: string, d: CommitDraft, o: { except?: FakeSocket } = {}): Commit {
    const out = this.#object(simId).append(d);
    if (out.kind !== 'accepted') {
      throw new Error(`FakeHub.foreign: not accepted (${out.kind})`);
    }
    this.#live(simId, out.commit, o.except);
    return out.commit;
  }

  /**
   * A stored commit taken as it is, unchecked (its seq must be the next), and sent like
   * foreign(): a newer build's commit, or one this build cannot fold. Later appends are
   * checked for id and parent against it, but not folded onto it.
   */
  storeRaw(simId: string, c: Commit): void {
    const obj = this.#object(simId);
    if (c.seq !== obj.commits.length + 1) throw new Error('FakeHub.storeRaw: seq is not next');
    obj.commits.push(structuredClone(c));
    this.#live(simId, obj.commits[obj.commits.length - 1]);
  }

  /** The next appends get these refusals (id: the commit's), instead of the object's answer. */
  refuseNext(...why: RefusedWhy[]): void {
    this.#refusals.push(...why);
  }

  /** The next resumes are refused, in order, with id null (when their answer is made). */
  refuseResume(...why: ('limit' | 'gone')[]): void {
    this.#resumeRefusals.push(...why);
  }

  /**
   * Sets `write` for sockets opened from now on, and queues `access` to each open socket
   * whose right differs (the real object sends it only on a change).
   */
  setAccess(write: boolean): void {
    this.write = write;
    for (const [s, c] of this.#conn) {
      if (c.gone || c.write === write) continue;
      c.write = write;
      this.#text(s, encodeFrame({ type: 'access', write }));
    }
  }

  /** Processes the held appends of open sockets, in order; those of closed sockets are dropped. */
  release(): void {
    const held = this.#held;
    this.#held = [];
    for (const h of held) {
      const c = this.#conn.get(h.s);
      if (c && !c.gone) this.#append(h.s, c, h.text);
    }
  }

  /** Closes every open socket from the server: undelivered frames to it are lost, then close. */
  closeAll(code: number): void {
    for (const [s, c] of this.#conn) {
      if (!c.gone) this.#serverClose(s, c, code);
    }
  }

  /**
   * Handles queued events, those queued meanwhile included, until none is left; returns how many
   * were handled. A listener that sends a frame for every frame it gets, without end, never
   * lets it return: use step() to drive such a client.
   */
  flush(): number {
    let n = 0;
    while (this.#queue.length > 0) n += this.step();
    return n;
  }

  /**
   * Handles only the events queued before the call, in order, and returns how many were
   * handled (discarded events are not counted). What they queue waits for the next call.
   */
  step(): number {
    const batch = this.#queue;
    this.#queue = [];
    let n = 0;
    for (const ev of batch) if (this.#handle(ev)) n++;
    return n;
  }

  #object(simId: string): FakeObject {
    let o = this.#sims.get(simId);
    if (!o) {
      o = new FakeObject();
      this.#sims.set(simId, o);
    }
    return o;
  }

  #open(url: string): FakeSocket {
    const m = URL_SIM.exec(url);
    if (!m) throw new Error('FakeHub: not a sim stream url');
    const sim = m[1];
    const s: FakeSocket = new FakeSocket(url, {
      send: (text) => this.#queue.push({ k: 'in', s, text }),
      close: () => this.#queue.push({ k: 'in-close', s })
    });
    const c: Conn = { sim, write: this.write, gone: false, resuming: false, epoch: 0 };
    this.#conn.set(s, c);
    this.sockets.push(s);
    if (this.reject || (this.#o.strict && !this.#registered.has(sim))) {
      c.gone = true;
      this.#queue.push({ k: 'out', s, epoch: 0, what: 'error' });
      this.#queue.push({ k: 'out-close', s, epoch: 0, code: 1006 });
      return s;
    }
    this.#queue.push({ k: 'out', s, epoch: 0, what: 'open' });
    if (!this.silent) {
      const frame: Parameters<typeof encodeFrame>[0] = {
        type: 'hello',
        build: this.build,
        protocol: this.#o.protocol
      };
      if (this.#o.dataset !== null) frame.dataset = this.#o.dataset;
      this.#text(s, encodeFrame(frame));
    }
    this.#text(s, encodeFrame({ type: 'access', write: c.write }));
    return s;
  }

  #text(s: FakeSocket, text: string): void {
    const c = this.#conn.get(s) as Conn;
    this.#queue.push({ k: 'out-text', s, epoch: c.epoch, text });
  }

  #serverClose(s: FakeSocket, c: Conn, code: number): void {
    c.gone = true;
    c.epoch += 1;
    this.#queue.push({ k: 'out-close', s, epoch: c.epoch, code });
  }

  /** A committed commit, to every resumed open socket of its sim but `except`. */
  #live(simId: string, commit: Commit, except?: FakeSocket): void {
    const frame = commitsFrame([JSON.stringify(commit)]);
    for (const [s, c] of this.#conn) {
      if (c.sim === simId && !c.gone && s.resumed && s !== except) this.#text(s, frame);
    }
  }

  /** Handles one event; false when it was discarded. */
  #handle(ev: Ev): boolean {
    const c = this.#conn.get(ev.s) as Conn;
    switch (ev.k) {
      case 'in-close':
        c.gone = true;
        return true;
      case 'in':
        if (c.gone || this.mute) return false;
        this.#receive(ev.s, c, ev.text);
        return true;
      case 'turn':
        if (c.gone) {
          c.resuming = false;
          return false;
        }
        this.#answer(ev.s, c, ev.after);
        return true;
      default: {
        if (this.mute || ev.s.closedWith !== null) return false;
        if (ev.k === 'out-text' || ev.k === 'out-close') {
          if (ev.epoch !== c.epoch) return false;
        }
        if (ev.k === 'out-text') {
          ev.s.emit('message', ev.text);
        } else if (ev.k === 'out-close') {
          ev.s.readyState = 3;
          ev.s.emit('close', ev.code);
        } else if (ev.what === 'open') {
          ev.s.readyState = 1;
          ev.s.emit('open');
        } else {
          ev.s.emit('error');
        }
        return true;
      }
    }
  }

  #receive(s: FakeSocket, c: Conn, text: string): void {
    if (text === PING) {
      this.#text(s, PONG);
      return;
    }
    if (overFrameLimit(text)) {
      this.#text(s, encodeFrame({ type: 'refused', id: null, why: 'limit' }));
      return;
    }
    const frame = parseClientFrame(text);
    if (!frame) {
      this.#serverClose(s, c, CLOSE_MALFORMED);
      return;
    }
    if (frame.type === 'resume') {
      this.resumes.push(frame.after);
      if (c.resuming) {
        this.#text(s, encodeFrame({ type: 'refused', id: null, why: 'limit' }));
        return;
      }
      c.resuming = true;
      s.resumed = false;
      this.#queue.push({ k: 'turn', s, after: frame.after });
      return;
    }
    this.appends.push(frame.commit as CommitDraft);
    if (this.#o.hold) this.#held.push({ s, text });
    else this.#append(s, c, text);
  }

  #answer(s: FakeSocket, c: Conn, after: number): void {
    c.resuming = false;
    const refusal = this.#resumeRefusals.shift();
    const log = this.#object(c.sim).commits;
    const why = refusal ?? (after > log.length ? 'gone' : null);
    if (why) {
      this.#text(s, encodeFrame({ type: 'refused', id: null, why }));
      return;
    }
    const page = log.slice(after, after + this.#o.pageSize);
    const more = after + page.length < log.length;
    this.#text(
      s,
      commitsFrame(
        page.map((x) => JSON.stringify(x)),
        more
      )
    );
    s.resumed = !more;
  }

  #append(s: FakeSocket, c: Conn, text: string): void {
    const frame = parseClientFrame(text);
    if (!frame || frame.type !== 'append') return;
    const refuse = (why: RefusedWhy) =>
      this.#text(s, encodeFrame({ type: 'refused', id: frame.id, why }));
    if (!c.write) return refuse('not-writer');
    const next = this.#refusals.shift();
    if (next) return refuse(next);
    if (this.closeOnAppend > 0) {
      this.closeOnAppend -= 1;
      this.#serverClose(s, c, 1011);
      return;
    }
    const obj = this.#object(c.sim);
    if (this.#isNewer(obj, frame.commit)) return refuse('newer');
    const out = obj.append(frame.commit as CommitDraft);
    if (out.kind === 'duplicate') this.duplicates += 1;
    else if (out.kind === 'refused') refuse(out.why);
    else this.#live(c.sim, out.commit);
  }

  /** A draft above the known shapes revision that is neither a duplicate nor behind. */
  #isNewer(obj: FakeObject, raw: unknown): boolean {
    let d: CommitDraft;
    try {
      d = parseCommitDraft(structuredClone(raw));
    } catch {
      return false;
    }
    return (
      d.shapes > SHAPES_REVISION &&
      d.parent === obj.commits.length &&
      !obj.commits.some((x) => x.id === d.id)
    );
  }
}

/**
 * Rounds of hub.flush(), every store's written() and microtasks(), until three rounds in a row
 * deliver nothing; throws Error('no quiescence') after 200 rounds. It drives a client and its
 * hub to rest: frames the hub delivers make the client act, the stores finish their writes,
 * and what that makes the client send is delivered next round. It moves no clock: a client
 * waiting on a backoff or a ping timer stays waiting.
 */
export async function settle(
  hub: FakeHub,
  ...stores: { written(): Promise<void> }[]
): Promise<void> {
  let quiet = 0;
  for (let round = 0; round < 200; round++) {
    const n = hub.flush();
    await Promise.all(stores.map((s) => s.written()));
    await microtasks();
    quiet = n === 0 ? quiet + 1 : 0;
    if (quiet >= 3) return;
  }
  throw new Error('no quiescence');
}
