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
 * safe. after(0, fn) fires at the next advance (even advance(0)), never at once.
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
 * synchronously, also when the state does not change. Nothing happens on its own.
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
    for (const w of [...this.#watchers]) w(e);
  }
}

interface Waiter {
  name: string;
  run: () => void;
}

/**
 * Web Locks without a scheduler. Exclusive per name, one holder at a time. A request is
 * granted (its callback called with a lock object of its name and mode 'exclusive') at once
 * when the name is free, else queued: waiters are granted in request order as the holder
 * releases. A lock is released when the callback's result settles (resolved or rejected),
 * which frees the name and grants the next waiter before the request's own promise settles.
 * ifAvailable calls callback(null) when the name
 * is held or has waiters. An already-aborted signal rejects at once; an abort while waiting
 * removes the waiter and rejects with a DOMException named AbortError; an abort after the
 * grant does nothing. Only exclusive mode is modelled (options.mode and steal are ignored).
 * No timers: await microtasks() after an action that should hand a lock over. `requested`
 * lists every request's name in order; held() the names now held.
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
      const busy = () => this.#held.has(name) || this.#queue.some((w) => w.name === name);
      const grant = () => {
        this.#held.add(name);
        const lock = { name, mode: 'exclusive' } as Lock;
        let result: Promise<unknown>;
        try {
          result = Promise.resolve(callback(lock));
        } catch (e) {
          result = Promise.reject(e);
        }
        const release = () => {
          this.#held.delete(name);
          this.#next(name);
        };
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
      };
      if (options.ifAvailable) {
        if (busy()) {
          void Promise.resolve()
            .then(() => callback(null))
            .then(resolve, reject);
        } else grant();
        return;
      }
      if (!busy()) {
        grant();
        return;
      }
      const w: Waiter = { name, run: grant };
      this.#queue.push(w);
      signal?.addEventListener(
        'abort',
        () => {
          if (!this.#queue.includes(w)) return;
          this.#queue = this.#queue.filter((x) => x !== w);
          reject(abortError());
        },
        { once: true }
      );
    });
  }

  #next(name: string): void {
    const w = this.#queue.find((x) => x.name === name);
    if (w === undefined) return;
    this.#queue = this.#queue.filter((x) => x !== w);
    w.run();
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
 * nothing. Deliveries are never synchronous: await microtasks().
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
    this.#listeners.push(fn);
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
 * when it is made (body parsed as JSON when it is, else the raw string, null when absent);
 * inFlight counts calls not yet settled, maxInFlight its peak. No timers.
 */
export class FakeFetch {
  handler: (simId: string) => FetchAnswer | Promise<FetchAnswer>;
  readonly calls: { url: string; method: string; contentType: string | null; body: unknown }[] = [];
  inFlight = 0;
  maxInFlight = 0;

  constructor(handler?: (simId: string) => FetchAnswer | Promise<FetchAnswer>) {
    this.handler = handler ?? (() => ({ status: 200 }));
  }

  readonly fetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const contentType = new Headers(init?.headers).get('content-type');
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    this.calls.push({ url, method, contentType, body });
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
            if (a === 'network') reject(new TypeError('Failed to fetch'));
            else {
              resolve(
                new Response(a.body === undefined ? null : JSON.stringify(a.body), {
                  status: a.status,
                  headers: { 'content-type': 'application/json' }
                })
              );
            }
          }),
        (e) => settle(() => reject(e))
      );
    });
  };
}

/** n turns of the microtask queue (default 20). Not a wait: no timer. */
export async function microtasks(n = 20): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}
