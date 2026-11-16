import type { ChannelLike, Clock, LocksLike, NetEvent, NetSignals } from '../ports';

interface Timer {
  at: number;
  n: number;
  fn: () => void;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * A clock that moves only when a test calls advance. now() starts at 0. Timers never fire on
 * their own: advance(ms) runs every timer due by now + ms, earliest first (ties in the order
 * set), including timers set by callbacks while advancing, with now() equal to each timer's
 * due time while it runs; it ends at now + ms. A cancelled timer never runs; cancel twice is
 * safe, and a timer cleared by an earlier callback of the same advance never fires.
 * after(0, fn) fires at the next advance (even advance(0)), never at once. A timer set by a
 * callback fires in the same advance when it is due inside the window. If a callback throws,
 * the error propagates out of advance to the test, now() stays at that timer's due time, and
 * the later timers stay pending (a further advance runs them). Not modelled: setInterval.
 */
export class FakeClock implements Clock {
  #now = 0;
  #seq = 0;
  #timers: Timer[] = [];

  now(): number {
    return this.#now;
  }

  after(ms: number, fn: () => void): () => void {
    const t = { at: this.#now + Math.max(0, ms), n: this.#seq++, fn };
    this.#timers.push(t);
    return () => {
      this.#timers = this.#timers.filter((x) => x !== t);
    };
  }

  advance(ms: number): void {
    const end = this.#now + ms;
    for (;;) {
      let next: Timer | null = null;
      for (const t of this.#timers) {
        if (t.at > end) continue;
        if (next === null || t.at < next.at || (t.at === next.at && t.n < next.n)) next = t;
      }
      if (next === null) break;
      const due = next;
      this.#timers = this.#timers.filter((x) => x !== due);
      this.#now = Math.max(this.#now, due.at);
      due.fn();
    }
    this.#now = end;
  }

  /** ms until the earliest live timer (0 when overdue), or null when there is none. */
  nextDelay(): number | null {
    let at: number | null = null;
    for (const t of this.#timers) if (at === null || t.at < at) at = t.at;
    return at === null ? null : Math.max(0, at - this.#now);
  }
}

/**
 * Network and visibility signals under test control. set(e) records the state ('online' and
 * 'offline' set online(); 'visible' and 'hidden' set visible()) and calls every watcher
 * synchronously in the order they were added, also when the state does not change. As with an
 * EventTarget, a watcher removed by an earlier watcher during the same event is not called,
 * and a watcher added during an event is not called for it. Nothing happens on its own.
 */
export class FakeNet implements NetSignals {
  #online: boolean;
  #visible: boolean;
  #watchers: ((e: NetEvent) => void)[] = [];

  constructor(o: { online?: boolean; visible?: boolean } = {}) {
    this.#online = o.online ?? true;
    this.#visible = o.visible ?? true;
  }

  online(): boolean {
    return this.#online;
  }

  visible(): boolean {
    return this.#visible;
  }

  watch(fn: (e: NetEvent) => void): () => void {
    this.#watchers.push(fn);
    return () => {
      this.#watchers = this.#watchers.filter((w) => w !== fn);
    };
  }

  set(e: NetEvent): void {
    if (e === 'online' || e === 'offline') this.#online = e === 'online';
    else this.#visible = e === 'visible';
    for (const w of [...this.#watchers]) {
      if (this.#watchers.includes(w)) w(e);
    }
  }
}

interface Waiter {
  name: string;
  ifAvailable: boolean;
  grant: () => void;
  refuse: () => void;
  abort: () => void;
}

/**
 * Web Locks without a scheduler, as navigator.locks behaves for a client: a callback is NEVER
 * run inside request(); every grant happens on a later microtask, in every path (free name,
 * queued, ifAvailable), so state a caller assigns after request() returns is seen by the
 * callback. Exclusive per name, one holder at a time; waiters of a name are granted in request
 * order. A lock is released when the callback's result settles (resolved or rejected, or the
 * callback threw), which frees the name and grants the next waiter before the request's own
 * promise settles. A holder that requests its own name again waits (no re-entry). ifAvailable
 * is decided when the request is looked at, on its microtask: it is granted when the name is
 * free and no earlier request waits, else callback(null) runs and the request is dropped. An
 * already-aborted signal rejects at once; an abort while waiting removes the waiter and rejects
 * with a DOMException named AbortError; an abort after the grant does nothing. Only exclusive
 * mode is modelled (options.mode and steal are ignored). No timers: await microtasks() (or the
 * request's own promise) after an action that should hand a lock over. `requested` lists every
 * request's name in order. held() lists the names whose callback has been granted: between
 * request() and its grant the name is not yet held. query() reports held, and as pending every
 * request not yet granted or dropped (a free-name request is pending until its microtask).
 */
export class FakeLocks implements LocksLike {
  readonly requested: string[] = [];
  #held = new Set<string>();
  #queue: Waiter[] = [];

  held(): string[] {
    return [...this.#held];
  }

  request(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => unknown
  ): Promise<unknown> {
    this.requested.push(name);
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        name,
        ifAvailable: options.ifAvailable === true,
        grant: () => {
          this.#held.add(name);
          const lock = { name, mode: 'exclusive' } as Lock;
          const release = () => {
            this.#held.delete(name);
            this.#pump(name);
          };
          let result: Promise<unknown>;
          try {
            result = Promise.resolve(callback(lock));
          } catch (e) {
            result = Promise.reject(e);
          }
          void result.then(
            (v) => {
              release();
              resolve(v);
            },
            (e) => {
              release();
              reject(e);
            }
          );
        },
        refuse: () => {
          try {
            resolve(Promise.resolve(callback(null)));
          } catch (e) {
            reject(e);
          }
        },
        abort: () => reject(abortError())
      };
      this.#queue.push(w);
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.#queue.includes(w)) return;
          this.#queue = this.#queue.filter((x) => x !== w);
          w.abort();
        },
        { once: true }
      );
      queueMicrotask(() => this.#look(w));
    });
  }

  /** A request's own microtask: an ifAvailable one is decided now, any other is pumped. */
  #look(w: Waiter): void {
    const i = this.#queue.indexOf(w);
    if (i < 0) return;
    if (
      w.ifAvailable &&
      (this.#held.has(w.name) || this.#queue.slice(0, i).some((x) => x.name === w.name))
    ) {
      this.#queue = this.#queue.filter((x) => x !== w);
      w.refuse();
      return;
    }
    this.#pump(w.name);
  }

  /** Grants the first waiter of a name when the name is free. */
  #pump(name: string): void {
    if (this.#held.has(name)) return;
    const w = this.#queue.find((x) => x.name === name);
    if (w === undefined) return;
    this.#queue = this.#queue.filter((x) => x !== w);
    w.grant();
  }

  async query(): Promise<LockManagerSnapshot> {
    return {
      held: [...this.#held].map((name) => ({ name, mode: 'exclusive' as const })),
      pending: this.#queue.map((w) => ({ name: w.name, mode: 'exclusive' as const }))
    };
  }
}

/**
 * A BroadcastChannel namespace. channel() opens a channel that hears every other open channel
 * of this bus, never itself. A message is delivered by queueMicrotask, as a MessageEvent whose
 * data is a structuredClone of what was posted, to the listeners the receiver has when it is
 * delivered; a channel closed before delivery hears nothing, and a closed channel posts
 * nothing. Deliveries are never synchronous: await microtasks(). Listeners follow EventTarget:
 * adding the same function twice adds it once, and removing one stops it. Only 'message'.
 */
export class FakeBus {
  #open = new Set<FakeChannel>();

  channel(): ChannelLike {
    const c = new FakeChannel(this.#open);
    this.#open.add(c);
    return c;
  }
}

class FakeChannel implements ChannelLike {
  #listeners: ((e: MessageEvent) => void)[] = [];
  #closed = false;
  #open: Set<FakeChannel>;

  constructor(open: Set<FakeChannel>) {
    this.#open = open;
  }

  postMessage(message: unknown): void {
    if (this.#closed) return;
    for (const other of this.#open) {
      if (other === this) continue;
      const data = structuredClone(message);
      queueMicrotask(() => other.#deliver(data));
    }
  }

  #deliver(data: unknown): void {
    if (this.#closed) return;
    const e = new MessageEvent('message', { data });
    for (const l of [...this.#listeners]) l(e);
  }

  addEventListener(_type: 'message', fn: (e: MessageEvent) => void): void {
    if (!this.#listeners.includes(fn)) this.#listeners.push(fn);
  }

  removeEventListener(_type: 'message', fn: (e: MessageEvent) => void): void {
    this.#listeners = this.#listeners.filter((l) => l !== fn);
  }

  close(): void {
    this.#closed = true;
    this.#open.delete(this);
  }
}

export type FetchAnswer = { status: number; body?: unknown } | 'network';

/**
 * A fetch whose answers a test chooses. `handler` gets the sim id read from the request body's
 * `simId` ('' when it has none) and answers: 'network' rejects with TypeError('Failed to
 * fetch'); { status, body } resolves a Response with the JSON of body; a returned promise is
 * awaited first, so a promise the test holds keeps the call in flight. An init.signal that is
 * aborted already, or aborts while the call is in flight, rejects with a DOMException named
 * AbortError (the handler's late answer is then ignored). Every call is recorded in `calls`
 * when it is made: url, method (default GET), contentType and `headers` (every request header,
 * names lower-cased), and the body (parsed as JSON when it is, else the raw string, null when
 * absent); inFlight counts calls not yet settled, maxInFlight its peak. An answer the Response
 * constructor rejects (a body with status 204, say) rejects the call with that error. Only a
 * string URL with an optional init object is modelled: any other input (Request, URL) throws
 * a TypeError from fetch() itself. No timers; nothing settles unless the handler's answer does.
 */
export class FakeFetch {
  handler: (simId: string) => FetchAnswer | Promise<FetchAnswer>;
  readonly calls: {
    url: string;
    method: string;
    contentType: string | null;
    headers: Record<string, string>;
    body: unknown;
  }[] = [];
  inFlight = 0;
  maxInFlight = 0;

  constructor(handler?: (simId: string) => FetchAnswer | Promise<FetchAnswer>) {
    this.handler = handler ?? (() => ({ status: 200 }));
  }

  readonly fetch: typeof fetch = (input, init) => {
    if (typeof input !== 'string') {
      throw new TypeError('FakeFetch models only a string URL with an init object');
    }
    const url = input;
    const method = init?.method ?? 'GET';
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const contentType = headers['content-type'] ?? null;
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    this.calls.push({ url, method, contentType, headers, body });
    const simId =
      typeof body === 'object' && body !== null && 'simId' in body && typeof body.simId === 'string'
        ? body.simId
        : '';
    const signal = init?.signal ?? null;
    if (signal?.aborted) return Promise.reject(abortError());
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    return new Promise<Response>((resolve, reject) => {
      let done = false;
      const settle = (f: () => void) => {
        if (done) return;
        done = true;
        this.inFlight -= 1;
        f();
      };
      signal?.addEventListener('abort', () => settle(() => reject(abortError())), { once: true });
      let answer: FetchAnswer | Promise<FetchAnswer>;
      try {
        answer = this.handler(simId);
      } catch (e) {
        settle(() => reject(e));
        return;
      }
      void Promise.resolve(answer).then(
        (a) =>
          settle(() => {
            if (a === 'network') {
              reject(new TypeError('Failed to fetch'));
              return;
            }
            try {
              resolve(
                new Response(a.body === undefined ? null : JSON.stringify(a.body), {
                  status: a.status,
                  headers: { 'content-type': 'application/json' }
                })
              );
            } catch (e) {
              reject(e);
            }
          }),
        (e) => settle(() => reject(e))
      );
    });
  };
}

/**
 * Yields n times (default 20) to the microtask queue, so every promise reaction chain of up to
 * about n links that is already unblocked has run when it resolves. Not a wait and no timer: it
 * does not cover work that needs a fake clock to advance or a promise the test still holds.
 */
export async function microtasks(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
