import {
  DEFAULT_SIM_NAME,
  LogError,
  LogFormatError,
  LogState,
  NAME_KEY,
  SHAPES_REVISION,
  parseCommitDraft,
  type Commit,
  type CommitDraft
} from '$lib/sim-log';
import { LIMITS, overFrameLimit, utf8Bytes } from '$lib/sim-stream/limits';
import {
  CLOSE_BINARY,
  CLOSE_INTERNAL,
  CLOSE_MALFORMED,
  PING,
  PONG,
  PROTOCOL,
  commitsFrame,
  encodeFrame,
  parseClientFrame,
  type RefusedWhy
} from '$lib/sim-stream/protocol';
import { newId } from '$lib/ids/base58';
import { DS, FakeObject, stamped } from '$lib/sim-store/test/commits';
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
  /**
   * Commits per frame within a resume answer; default all of the answer in one frame. The real
   * object splits an answer into several frames and only the last carries `more`: a test of
   * resume should set this (say to 1 or 2) so the client meets frames without `more`.
   */
  frameSize?: number;
  /** Access for new sockets; default true. */
  write?: boolean;
  /** Appends wait for release(); default false. */
  hold?: boolean;
  /** Sockets for sims not register()ed close 1006; default false. */
  strict?: boolean;
  /**
   * Store the start commit when a socket with write opens a sim with no commits, as the real
   * object does; default true. Turn it off (false) for a test that needs an empty log.
   */
  start?: boolean;
  /** The title the start commit names the sim by; default DEFAULT_SIM_NAME. */
  title?: string;
}

type Listener = (e: SocketEventLike) => void;
type EventType = 'open' | 'message' | 'close' | 'error';

interface Link {
  send(data: string | ArrayBuffer): void;
  close(code: number | undefined, connecting: boolean): void;
}

/**
 * The client's end of a connection to a FakeHub. The hub makes it (`new hub.WebSocket(url)`);
 * a test reads it from `hub.sockets`. readyState starts 0 and becomes 1 when the hub delivers
 * the open event. It behaves as a WebSocket does for what a client can see:
 *  - send() throws a DOMException named InvalidStateError while readyState is 0, and is
 *    silently dropped (and not recorded in `sent`) once it is 2 or 3. A frame the client sends
 *    reaches the hub one step later (see FakeHub.step), in order.
 *  - close(code) with a code that is neither 1000 nor 3000 to 4999 throws a DOMException named
 *    InvalidAccessError. Otherwise it records the code in `closedWith` (null when none given),
 *    sets readyState to 2 (CLOSING) and does nothing else at once. The hub sees the close in
 *    order after the frames sent before it, and one step after that the socket's own `close`
 *    listeners are called, once, with the code a browser reports against the real object, which
 *    replies to a close with the same code, or 1000 when the client gave none; for a socket
 *    still connecting an `error` event comes first and the code is 1006; readyState is then 3.
 *    A reason over 123 UTF-8 bytes throws a DOMException named SyntaxError. Those two
 *    things are what a client that reconnects on its own close event relies on: the event
 *    comes later, never inside close(), and `close()` cannot be followed by another frame.
 *  - After close() was called, no other event is delivered to the socket (a late frame, or a
 *    server close); only emit() can still reach its listeners. A second close() changes
 *    nothing.
 * `resumed` is the hub's mark for this socket: set when the hub produces a resume answer that
 * reaches the tip, cleared when a resume arrives (so not when the client reads the frames).
 * Not modelled: the reason's delivery, binaryType, bufferedAmount, removeEventListener, the Origin
 * check.
 */
export class FakeSocket implements SocketLike {
  readonly url: string;
  readyState = 0;
  /** Every text the client sent that was not dropped, in order. */
  readonly sent: string[] = [];
  resumed = false;
  /** The code the client closed with (1005 when it gave none: the close frame had none). */
  closedWith: number | null = null;
  #listeners: Record<EventType, Listener[]> = { open: [], message: [], close: [], error: [] };
  #link: Link;

  constructor(url: string, link: Link) {
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
    if (typeof data === 'string') this.sent.push(data);
    this.#link.send(data);
  }

  close(code?: number, reason?: string): void {
    if (code !== undefined && code !== 1000 && !(code >= 3000 && code <= 4999)) {
      throw new DOMException('The close code must be 1000 or 3000-4999', 'InvalidAccessError');
    }
    if (reason !== undefined && utf8Bytes(reason) > 123) {
      throw new DOMException('The close reason must be at most 123 bytes', 'SyntaxError');
    }
    if (this.readyState >= 2) return;
    const connecting = this.readyState === 0;
    this.closedWith = code ?? 1005;
    this.readyState = 2;
    this.#link.close(code, connecting);
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
  /** The server has closed it, or has seen the client's close. */
  gone: boolean;
  /** A resume is queued or being answered. */
  resuming: boolean;
  /** Raised when the server closes the socket: out events of an older epoch are lost. */
  epoch: number;
}

type Task =
  | { k: 'resume'; s: FakeSocket; after: number }
  | { k: 'append'; s: FakeSocket; text: string; write: boolean };

type Ev =
  | { k: 'in'; s: FakeSocket; data: string | ArrayBuffer }
  | { k: 'in-close'; s: FakeSocket; code: number | undefined; connecting: boolean }
  | { k: 'drain'; sim: string }
  | { k: 'out'; s: FakeSocket; what: 'open' | 'error' }
  | { k: 'out-text'; s: FakeSocket; epoch: number; text: string }
  | { k: 'out-close'; s: FakeSocket; epoch: number; code: number }
  | { k: 'closed'; s: FakeSocket; code: number };

/** The code the object closes with in reply to a peer's close (object-rules.ts closeReply). */
function closeReply(code: number): number {
  return code === 1005 || code === 1006 || code === 1015 ? 1000 : code;
}

/** Where in the real object's order of append checks a queued refusal takes effect. */
const STEP: Record<RefusedWhy, number> = {
  gone: 1,
  'not-writer': 2,
  limit: 3,
  full: 7,
  behind: 8,
  newer: 10,
  invalid: 11
};

const URL_SIM = /\/api\/sims\/([^/?#]+)\/stream(?:[?#]|$)/;

/**
 * A deterministic double of the sim object (one per sim id) and the sockets a client opens to
 * it. It models what the client sees of the real object (docs/dev/sim-object.md), using the
 * real frame encoder and parser (`$lib/sim-stream/protocol`), the real draft parser and limits
 * and the store's FakeObject for the append rules. Nothing happens on its own: no timer, no
 * microtask. Every frame, in both directions, is an event in one queue; the test delivers
 * events with `flush()` or `step()`, and an event is handled in queue order:
 *
 *  - Opening a socket queues `open`, then `hello` (unless `silent`) and `access`; or, when the
 *    sim is unregistered under `strict` or `reject` is set, `error` and `close` 1006 instead.
 *    When the socket has write and the sim has no commits, the start commit is stored at that
 *    moment (option `start`, default on): kind 'system', label 'Start', source 'sim.start',
 *    parent 0, one `set` of the name to the `title` option, the hub's dataset, build and
 *    SHAPES_REVISION; its author is FakeObject's fixed actor, not the opener's identity
 *    (identities are not modelled). It is before any resume is answered, so a writer's first resume on a new
 *    sim returns one commit the client did not make, and the client's own first commit (made
 *    on parent 0) is refused `behind`.
 *  - A frame the client sends takes one step to reach the hub (an `in` event). Resumes and
 *    appends of one sim are then done strictly in arrival order, across sockets, on one chain
 *    that runs one step after the arrival; what they send takes one more step to reach the
 *    client. A `resume` that is not refused `limit` for being outstanding clears the socket's
 *    `resumed` mark on arrival; its answer is the commits after `after`, at most `pageSize`,
 *    in frames of `frameSize` (default one frame), `more` only on the last frame (true when
 *    commits are left); the socket is marked resumed exactly when `more` is false. `after`
 *    past the tip is refused `gone` (id null), the mark staying clear. A second `resume` sent
 *    while one is outstanding is refused `limit` (id null) on arrival, ahead of the answer's
 *    frames. An accepted append goes, as a one-commit frame with no `more`, to every resumed
 *    open socket of the sim, the author's included; the author gets no other ack.
 *  - An append is checked in the real object's order: the sim is gone (only by refuseNext);
 *    the socket (as it was when the frame arrived) has no write: `not-writer`; the rate
 *    (only by refuseNext('limit')); the text's UTF-8 size over LIMITS.frameBytes: `limit`;
 *    the draft does not parse: `invalid`; the id is already stored: counted in `duplicates`
 *    and answered by nothing; the sim is full (only by refuseNext('full')); the parent is not
 *    the tip: `behind`; the stamped commit over LIMITS.commitBytes: `limit`; a stored row the
 *    object cannot fold (see storeRaw): `newer`, or a 1011 close; then the draft's `shapes`
 *    above SHAPES_REVISION: `newer`; then the fold check of the draft on the stored rows:
 *    `invalid` (or `newer`); then closeOnAppend (the insert failing): 1011. A queued `invalid`
 *    takes effect at the fold check, for a draft that parses; one that does not parse is
 *    `invalid` at the parse step. The commit-size check stamps with a 64-character actor and a
 *    13-digit time, the real stamp's largest. refuseNext(why) queues a refusal that takes
 *    effect at the step of that reason in this order, for the first append that reaches that
 *    step: a queued `full` or `behind` leaves a duplicate's silence alone, and a queued `limit`
 *    leaves a reader's `not-writer` alone. Only the head of the queue is looked at: a refusal
 *    whose step no append reaches holds up every refusal queued after it. A refused append
 *    nothing. The id in a refusal is the frame's commit id (null when it has none).
 *  - A text over the real frame limit by length is refused `limit` with id null; a text 'ping'
 *    is answered 'pong'; a text that is not one client frame closes the socket 1008, and a
 *    binary message 1003.
 *  - With `hold`, an append waits at arrival (it is recorded in `appends` then, and its
 *    access captured) until release(); it is then processed even if its socket has closed, as
 *    the real object does once a frame has arrived. A resume is never held and does not wait
 *    behind a held append.
 *  - `mute` makes the connection dead without a close: while set, every client frame, and
 *    every frame or close to a client, is discarded when handled and not counted. The client's
 *    own close() still reaches the hub (it is the browser's, not the network's) and its own
 *    close event is still delivered. A dead connection that comes back has lost frames in the
 *    middle of the stream, which a real one cannot: after a mute, close the socket (or
 *    closeAll) rather than unmute and go on.
 *  - `closeAll(code)` and `closeOnAppend` lose the socket's undelivered frames, then close it
 *    from the server. A socket closed from either side is sent nothing more.
 *
 * Order between sockets: frames for several sockets are delivered in the order the hub made
 * them, and a commit goes to sockets in the order they were opened. The real object's order
 * is not specified: a test must not depend on it.
 *
 * Not modelled: the rate bucket and the `limit` (rate) and `full` refusals as consequences of
 * load (use refuseNext), the resume budgets (use refuseResume), an answer capped by bytes
 * (use pageSize), takeDown (use closeAll(4410)), roles
 * and identities, hibernation and restarts (use closeAll), backpressure, the open handshake's
 * statuses (a refused open is a 1006 close), and the object's close reply to a client's close
 * beyond the client's own close event.
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
  /** The next n appends close their socket 1011 instead of being stored. */
  closeOnAppend = 0;
  /** Appends wait for release() (settable after construction). */
  hold: boolean;
  #o: Required<Omit<HubOptions, 'build' | 'write' | 'hold'>>;
  #sims = new Map<string, FakeObject>();
  /** Why a sim's stored rows no longer fold, once storeRaw put such a row there. */
  #fold = new Map<string, 'newer' | 'broken'>();
  #registered = new Set<string>();
  #conn = new Map<FakeSocket, Conn>();
  #queue: Ev[] = [];
  #chains = new Map<string, Task[]>();
  #draining = new Set<string>();
  #held: { s: FakeSocket; text: string; write: boolean }[] = [];
  #refusals: RefusedWhy[] = [];
  #resumeRefusals: ('limit' | 'gone')[] = [];

  constructor(o: HubOptions = {}) {
    this.#o = {
      dataset: o.dataset === undefined ? DS : o.dataset,
      protocol: o.protocol ?? PROTOCOL,
      pageSize: o.pageSize ?? 1000,
      frameSize: o.frameSize ?? Number.POSITIVE_INFINITY,
      strict: o.strict ?? false,
      start: o.start ?? true,
      title: o.title ?? DEFAULT_SIM_NAME
    };
    this.hold = o.hold ?? false;
    this.build = o.build ?? 'b';
    this.write = o.write ?? true;
    const open = (url: string) => this.#open(url);
    this.WebSocket = function (url: string) {
      return open(url);
    } as unknown as SocketCtor;
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
   * foreign(). Its row is then replayed (without the fold check): a row whose `shapes` is
   * above SHAPES_REVISION, or that does not fold for another reason, makes the sim unable to
   * fold its stored rows, as after a newer build's write. Every later append that passes the
   * `behind` check and the commit size check is then refused `newer` (a newer build's row) or
   * closes its socket 1011 (any other), as the real object does. A row that folds is part of
   * the state later appends are folded on.
   */
  storeRaw(simId: string, c: Commit): void {
    const obj = this.#object(simId);
    if (c.seq !== obj.commits.length + 1) throw new Error('FakeHub.storeRaw: seq is not next');
    obj.commits.push(structuredClone(c));
    if (!this.#fold.has(simId)) {
      const state = LogState.empty();
      try {
        for (const row of obj.commits) state.apply(row);
      } catch (e) {
        if (!(e instanceof LogError)) throw e;
        this.#fold.set(simId, e.code === 'future-shapes' ? 'newer' : 'broken');
      }
    }
    this.#live(simId, obj.commits[obj.commits.length - 1]);
  }

  /**
   * The next appends get these refusals (id: the commit's), each at its place in the real
   * order of checks (see the class comment), instead of the object's answer.
   */
  refuseNext(...why: RefusedWhy[]): void {
    this.#refusals.push(...why);
  }

  /** The next resumes are refused, in order, with id null (when their answer is made). */
  refuseResume(...why: ('limit' | 'gone')[]): void {
    this.#resumeRefusals.push(...why);
  }

  /**
   * Sets `write` for sockets opened from now on, and queues `access` to each open socket
   * whose right differs (the real object sends it only on a change). An append is judged by
   * the right its socket had when the frame arrived.
   */
  setAccess(write: boolean): void {
    this.write = write;
    for (const [s, c] of this.#conn) {
      if (c.gone || c.write === write) continue;
      c.write = write;
      this.#text(s, encodeFrame({ type: 'access', write }));
    }
  }

  /**
   * Processes the held appends in arrival order, those of closed sockets too (the real object
   * stores an append that reached it whatever happens to the socket; nothing is sent to a
   * closed socket). The answers are queued, not delivered.
   */
  release(): void {
    const held = this.#held;
    this.#held = [];
    for (const h of held) this.#append(h.s, this.#conn.get(h.s) as Conn, h.text, h.write);
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
      send: (data) => this.#queue.push({ k: 'in', s, data }),
      close: (code, connecting) => this.#queue.push({ k: 'in-close', s, code, connecting })
    });
    const c: Conn = { sim, write: this.write, gone: false, resuming: false, epoch: 0 };
    this.#conn.set(s, c);
    this.sockets.push(s);
    if (this.reject || (this.#o.strict && !this.#registered.has(sim))) {
      c.gone = true;
      this.#queue.push({ k: 'out', s, what: 'error' });
      this.#queue.push({ k: 'out-close', s, epoch: 0, code: 1006 });
      return s;
    }
    this.#queue.push({ k: 'out', s, what: 'open' });
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
    if (c.write && this.#o.start && this.#object(sim).commits.length === 0) this.#start(sim);
    return s;
  }

  /** The start commit, as log-host.ts builds it. */
  #start(sim: string): void {
    const draft: CommitDraft = {
      id: newId(),
      parent: 0,
      kind: 'system',
      label: 'Start',
      restores: null,
      datasetVersion: this.#o.dataset ?? DS,
      shapes: SHAPES_REVISION,
      build: this.build,
      source: 'sim.start',
      changes: [{ op: 'set', key: NAME_KEY, field: 'name', value: this.#o.title }]
    };
    const out = this.#object(sim).append(draft);
    if (out.kind !== 'accepted') throw new Error(`FakeHub: start commit ${out.kind}`);
    this.#live(sim, out.commit);
  }

  #text(s: FakeSocket, text: string): void {
    const c = this.#conn.get(s) as Conn;
    if (c.gone) return;
    this.#queue.push({ k: 'out-text', s, epoch: c.epoch, text });
  }

  #serverClose(s: FakeSocket, c: Conn, code: number): void {
    if (c.gone) return;
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

  #schedule(sim: string, task: Task): void {
    const chain = this.#chains.get(sim) ?? [];
    chain.push(task);
    this.#chains.set(sim, chain);
    if (!this.#draining.has(sim)) {
      this.#draining.add(sim);
      this.#queue.push({ k: 'drain', sim });
    }
  }

  /** Handles one event; false when it was discarded. */
  #handle(ev: Ev): boolean {
    switch (ev.k) {
      case 'in-close': {
        const c = this.#conn.get(ev.s) as Conn;
        c.gone = true;
        c.resuming = false;
        const code = ev.connecting ? 1006 : closeReply(ev.code ?? 1005);
        this.#queue.push({ k: 'closed', s: ev.s, code });
        return true;
      }
      case 'closed':
        if (ev.s.readyState === 3) return false;
        ev.s.readyState = 3;
        if (ev.code === 1006) ev.s.emit('error');
        ev.s.emit('close', ev.code);
        return true;
      case 'in': {
        const c = this.#conn.get(ev.s) as Conn;
        if (c.gone || this.mute) return false;
        this.#receive(ev.s, c, ev.data);
        return true;
      }
      case 'drain': {
        this.#draining.delete(ev.sim);
        const tasks = this.#chains.get(ev.sim) ?? [];
        this.#chains.delete(ev.sim);
        for (const t of tasks) {
          const c = this.#conn.get(t.s) as Conn;
          if (t.k === 'resume') this.#answer(t.s, c, t.after);
          else this.#append(t.s, c, t.text, t.write);
        }
        return true;
      }
      case 'out-text':
      case 'out-close':
        if (this.mute || ev.s.closedWith !== null || ev.s.readyState === 3) return false;
        if (ev.epoch !== (this.#conn.get(ev.s) as Conn).epoch) return false;
        if (ev.k === 'out-text') {
          ev.s.emit('message', ev.text);
        } else {
          ev.s.readyState = 3;
          ev.s.emit('close', ev.code);
        }
        return true;
      case 'out':
        if (this.mute || ev.s.closedWith !== null) return false;
        if (ev.what === 'open') {
          ev.s.readyState = 1;
          ev.s.emit('open');
        } else {
          ev.s.emit('error');
        }
        return true;
    }
  }

  #receive(s: FakeSocket, c: Conn, data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      this.#serverClose(s, c, CLOSE_BINARY);
      return;
    }
    const text = data;
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
      this.#schedule(c.sim, { k: 'resume', s, after: frame.after });
      return;
    }
    this.appends.push(frame.commit as CommitDraft);
    if (this.hold) this.#held.push({ s, text, write: c.write });
    else this.#schedule(c.sim, { k: 'append', s, text, write: c.write });
  }

  #answer(s: FakeSocket, c: Conn, after: number): void {
    c.resuming = false;
    if (c.gone) return;
    const refusal = this.#resumeRefusals.shift();
    const log = this.#object(c.sim).commits;
    const why = refusal ?? (after > log.length ? 'gone' : null);
    if (why) {
      this.#text(s, encodeFrame({ type: 'refused', id: null, why }));
      return;
    }
    const page = log.slice(after, after + this.#o.pageSize);
    const more = after + page.length < log.length;
    const size = Math.max(1, this.#o.frameSize);
    const bodies = page.map((x) => JSON.stringify(x));
    if (bodies.length === 0) this.#text(s, commitsFrame([], more));
    for (let i = 0; i < bodies.length; i += size) {
      const last = i + size >= bodies.length;
      this.#text(s, commitsFrame(bodies.slice(i, i + size), last ? more : undefined));
    }
    s.resumed = !more;
  }

  /** The head of the queued refusals, when it is for this step of the order of checks. */
  #take(step: number): RefusedWhy | null {
    const head = this.#refusals[0];
    if (head === undefined || STEP[head] !== step) return null;
    return this.#refusals.shift() ?? null;
  }

  #append(s: FakeSocket, c: Conn, text: string, write: boolean): void {
    const frame = parseClientFrame(text);
    if (!frame || frame.type !== 'append') return;
    const obj = this.#object(c.sim);
    const refuse = (why: RefusedWhy) =>
      this.#text(s, encodeFrame({ type: 'refused', id: frame.id, why }));
    const taken = (step: number): boolean => {
      const why = this.#take(step);
      if (why) refuse(why);
      return why !== null;
    };
    if (taken(1)) return;
    if (!write) return refuse('not-writer');
    if (taken(2) || taken(3)) return;
    if (utf8Bytes(text) > LIMITS.frameBytes) return refuse('limit');
    let draft: CommitDraft;
    try {
      draft = parseCommitDraft(structuredClone(frame.commit));
    } catch (e) {
      if (e instanceof LogFormatError) return refuse('invalid');
      throw e;
    }
    if (obj.commits.some((x) => x.id === draft.id)) {
      this.duplicates += 1;
      return;
    }
    if (taken(7)) return;
    if (taken(8)) return;
    if (draft.parent !== obj.commits.length) return refuse('behind');
    // The stamp at its real largest: a 64-character identity and a 13-digit time.
    const row = {
      ...stamped(draft, obj.commits.length + 1, 'a'.repeat(64)),
      at: 1_700_000_000_000
    };
    if (utf8Bytes(JSON.stringify(row)) > LIMITS.commitBytes) return refuse('limit');
    const folds = this.#fold.get(c.sim);
    if (folds === 'broken') return this.#serverClose(s, c, CLOSE_INTERNAL);
    if (folds === 'newer' || draft.shapes > SHAPES_REVISION) return refuse('newer');
    if (taken(10) || taken(11)) return;
    const state = LogState.empty();
    try {
      for (const r of obj.commits) state.apply(r);
      state.apply(draft, { check: true });
    } catch (e) {
      if (!(e instanceof LogError)) throw e;
      return refuse(e.code === 'future-shapes' ? 'newer' : 'invalid');
    }
    if (this.closeOnAppend > 0) {
      this.closeOnAppend -= 1;
      return this.#serverClose(s, c, CLOSE_INTERNAL);
    }
    const out = obj.append(frame.commit as CommitDraft);
    if (out.kind === 'accepted') this.#live(c.sim, out.commit);
    else if (out.kind === 'refused') refuse(out.why);
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
