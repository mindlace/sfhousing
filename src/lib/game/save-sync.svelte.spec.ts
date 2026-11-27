// The save sync: sending, keep both, removal, pull and state.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { newId } from '$lib/ids/base58';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import {
  SAVE_REVS_KEY,
  createSaveSync,
  syncReload,
  type SaveSync,
  type SyncRecord
} from './save-sync.svelte';
import type { GameSave, SaveEntry } from './save-shape';
import { NEW_GAME } from './state';
import type { GameStore, StoreChange } from './store.svelte';

const WON = '2026-11-01T10:00:00.000Z';
const T0 = Date.parse('2026-11-22T12:00:00.000Z');

function mk(name: string, won: boolean, savedAt = '2026-11-20T10:00:00.000Z'): GameSave {
  return {
    v: 2,
    id: newId(),
    name,
    nameIsDefault: false,
    state: {
      ...structuredClone(NEW_GAME),
      phase: won ? 'runs' : 'opening',
      firstWinAt: won ? WON : null
    },
    plan: null,
    policy: null,
    savedAt
  };
}

/** A store holding saves by id that calls the sync back as `GameStore` does. */
class FakeStore {
  games = new Map<string, GameSave>();
  currentId = '';
  sync: SaveSync;
  adoptAnswer: StoreChange | null = null;
  rekeyAnswer: StoreChange | null = null;
  switchTo = vi.fn();
  clock = T0;
  /** The harness's requests and the store's adopts, in the order they were made. */
  log: string[];
  /** `beforeLeave`'s functions, called by an adopt of the current game as the store does. */
  leaving: (() => void)[] = [];

  constructor(sync: SaveSync, saves: GameSave[], log: string[] = []) {
    this.sync = sync;
    this.log = log;
    for (const s of saves) this.games.set(s.id, structuredClone(s));
    this.currentId = saves[0]?.id ?? '';
  }

  #stamp(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  get saves(): readonly SaveEntry[] {
    return [...this.games.values()]
      .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))
      .map((g) => ({
        id: g.id,
        name: g.name,
        nameIsDefault: g.nameIsDefault,
        savedAt: g.savedAt,
        phase: g.state.phase,
        round: g.state.round,
        finished: g.state.finished
      }));
  }

  read(id: string): GameSave | null {
    const g = this.games.get(id);
    return g ? structuredClone(g) : null;
  }

  /** A change the player made: stored, then `changed` as the store's `#write` calls it. */
  edit(id: string, patch: Partial<GameSave> = {}): void {
    const g = this.games.get(id) as GameSave;
    this.games.set(id, { ...g, ...patch, savedAt: this.#stamp() });
    this.sync.changed(id);
  }

  rename(id: string, name: string): void {
    const g = this.games.get(id);
    if (!g) return;
    this.games.set(id, { ...g, name, nameIsDefault: false, savedAt: this.#stamp() });
    this.sync.changed(id);
  }

  rekey(id: string, to: string): StoreChange {
    if (this.rekeyAnswer) return this.rekeyAnswer;
    const g = this.games.get(id);
    if (!g || this.games.has(to)) return { ok: false, reason: 'storage' };
    this.games.delete(id);
    this.games.set(to, { ...g, id: to });
    if (this.currentId === id) this.currentId = to;
    return { ok: true };
  }

  beforeLeave(fn: () => void): () => void {
    this.leaving.push(fn);
    return () => {
      this.leaving = this.leaving.filter((f) => f !== fn);
    };
  }

  /** As `GameStore.adopt`: saves holding the current id run the flushes; one that wrote answers changed. */
  adopt(saves: readonly GameSave[]): StoreChange {
    if (this.adoptAnswer) return this.adoptAnswer;
    if (saves.some((s) => s.id === this.currentId)) {
      const before = this.read(this.currentId)?.savedAt;
      for (const fn of [...this.leaving]) fn();
      if (this.read(this.currentId)?.savedAt !== before) return { ok: false, reason: 'changed' };
    }
    for (const s of saves) this.games.set(s.id, structuredClone(s));
    this.log.push(`adopt ${saves.map((s) => s.id).join(' ')}`);
    return { ok: true };
  }

  remove(id: string): StoreChange {
    if (!this.games.has(id)) return { ok: true };
    this.games.delete(id);
    this.sync.removed(id);
    return { ok: true };
  }
}

interface Req {
  method: string;
  url: string;
  body: { baseRev: number | null; save: GameSave } | null;
  /** The request's content-type header, null when none. */
  type: string | null;
  /** The body as sent. */
  raw: string | null;
}

type Answer = Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  const res = new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
  // Read in a microtask: a stream read can take tasks, which a timer advance may not reach.
  res.json = () => Promise.resolve(structuredClone(body));
  return res;
}

/** `res` with a body that reads in microtasks. */
function quick(res: Response): Response {
  if (!Object.hasOwn(res, 'json') && res.body === null) {
    res.json = () => Promise.reject(new SyntaxError('no body'));
  }
  return res;
}

const line = (rev: number, handle = 'sunny-otter') => ({ handle, handleClaimed: false, rev });

function held(): { promise: Promise<Response>; resolve: (r: Response) => void } {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((res) => (resolve = res));
  return { promise, resolve };
}

function harness(
  o: { saves?: GameSave[]; signedIn?: boolean; storage?: Storage | null; attach?: boolean } = {}
) {
  let signed = $state(o.signedIn ?? false);
  const reqs: Req[] = [];
  const log: string[] = [];
  let rev = 0;
  // A GET answers 404 unless a test answers it: the pull at attach signed in then changes nothing,
  // so the tests about sending see only their own requests.
  let answer: (r: Req) => Answer = (r) =>
    r.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : r.method === 'GET'
        ? new Response(null, { status: 404 })
        : json(200, line(++rev));
  // The root layout passes the global `fetch`, which throws when called on another receiver.
  const fetchFn = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    const raw = typeof init?.body === 'string' ? init.body : null;
    const r: Req = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: raw === null ? null : JSON.parse(raw),
      type: new Headers(init?.headers).get('content-type'),
      raw
    };
    reqs.push(r);
    log.push(`${r.method} ${r.url}`);
    // As the routes' same-origin JSON check: a write not sent as JSON is 415.
    if (r.method !== 'GET' && r.type !== 'application/json') {
      return quick(new Response(null, { status: 415 }));
    }
    return quick(await answer(r));
  } as typeof fetch;
  const storage = o.storage === undefined ? new MemoryStorage() : o.storage;
  const sync = createSaveSync({ storage, fetchFn, signedIn: () => signed });
  const store = new FakeStore(sync, o.saves ?? [], log);
  if (o.attach !== false) sync.attach(store as unknown as GameStore);
  return {
    sync,
    store,
    reqs,
    log,
    storage,
    puts: () => reqs.filter((r) => r.method === 'PUT'),
    answer(fn: (r: Req) => Answer) {
      answer = fn;
    },
    setSignedIn(v: boolean) {
      signed = v;
    },
    record(): SyncRecord {
      return JSON.parse((storage as Storage).getItem(SAVE_REVS_KEY) as string);
    }
  };
}

let reload: MockInstance<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  reload = vi.spyOn(syncReload, 'reload').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sending', () => {
  it('signed out, an unwon save sends nothing; a won one is PUT after 2 s, read then', async () => {
    const plain = mk('Plain', false);
    const won = mk('Won', true);
    const storage = new MemoryStorage();
    const rec: SyncRecord = {
      v: 1,
      seen: { [won.id]: { rev: 1, savedAt: won.savedAt } },
      deleting: []
    };
    storage.setItem(SAVE_REVS_KEY, JSON.stringify(rec));
    const h = harness({ saves: [plain, won], storage });
    h.store.edit(plain.id);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.reqs).toEqual([]);
    expect(h.sync.state).toBe('local');
    h.store.edit(won.id);
    h.store.games.set(won.id, { ...(h.store.read(won.id) as GameSave), name: 'Later' });
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.puts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    // Its 200 made the session, and the others went after it.
    expect(h.puts()[0].url).toBe(`/api/game/${won.id}`);
    expect(h.puts().filter((r) => r.url === `/api/game/${won.id}`)).toHaveLength(1);
    expect(h.puts()[0].body?.save.name).toBe('Later');
    expect(h.puts()[0].body?.baseRev).toBe(1);
  });

  it('three changes inside 2 s make one PUT; two saves make two', async () => {
    const a = mk('A', true);
    const b = mk('B', false);
    const h = harness({ saves: [a, b], signedIn: true });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(500);
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(500);
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(1);
    h.store.edit(a.id);
    h.store.edit(b.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(3);
    expect(h.puts().map((r) => r.url)).toEqual([
      `/api/game/${a.id}`,
      `/api/game/${a.id}`,
      `/api/game/${b.id}`
    ]);
    expect(h.puts()[1].body?.baseRev).toBe(1);
  });

  it('a 200 with no session sets account and saved, then sends the others without a pull', async () => {
    const won = mk('Won', true);
    const other = mk('Other', false);
    const h = harness({ saves: [won, other] });
    expect(h.sync.account).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.account).toEqual({ handle: 'sunny-otter', handleClaimed: false });
    expect(h.puts().map((r) => r.url)).toEqual([`/api/game/${won.id}`, `/api/game/${other.id}`]);
    expect(h.reqs.some((r) => r.method === 'GET')).toBe(false);
    expect(h.sync.state).toBe('saved');
    h.store.edit(other.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(3);
  });

  it('every PUT 200 sets account from its line', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true });
    h.answer(() => json(200, { handle: 'first', handleClaimed: false, rev: 1 }));
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.account).toEqual({ handle: 'first', handleClaimed: false });
    h.answer(() => json(200, { handle: 'chosen', handleClaimed: true, rev: 2 }));
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.account).toEqual({ handle: 'chosen', handleClaimed: true });
  });

  it('after signedIn() turns false, a change of an unwon save sends nothing', async () => {
    const plain = mk('Plain', false);
    const h = harness({ saves: [plain], signedIn: true });
    h.store.edit(plain.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(1);
    h.setSignedIn(false);
    h.store.edit(plain.id);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(1);
  });

  it('at attach signed out, a won save never sent goes after 2 s; others do not', async () => {
    const won = mk('Won', true);
    const plain = mk('Plain', false);
    const sent = mk('Sent', true);
    const storage = new MemoryStorage();
    const rec: SyncRecord = {
      v: 1,
      seen: { [sent.id]: { rev: 3, savedAt: sent.savedAt } },
      deleting: []
    };
    storage.setItem(SAVE_REVS_KEY, JSON.stringify(rec));
    // No 200: the account is not made, so nothing else is marked.
    const h = harness({ saves: [won, plain, sent], storage, attach: false });
    h.answer(() => json(422, { error: 'no_win' }));
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.puts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts().map((r) => r.url)).toEqual([`/api/game/${won.id}`]);
  });

  it('calls made before attach are acted on at attach', async () => {
    const a = mk('A', false);
    const h = harness({ saves: [a], signedIn: true, attach: false });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(0);
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts().map((r) => r.url)).toEqual([`/api/game/${a.id}`]);
  });

  it('two won unsent saves at attach with no session: one PUT until it answers', async () => {
    const a = mk('A', true, '2026-11-20T10:00:00.000Z');
    const b = mk('B', true, '2026-11-20T09:00:00.000Z');
    const first = held();
    const h = harness({ saves: [a, b], attach: false });
    let n = 0;
    h.answer(() => (++n === 1 ? first.promise : json(200, line(1))));
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.puts()).toHaveLength(1);
    first.resolve(json(200, line(1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts()).toHaveLength(2);
    expect(new Set(h.puts().map((r) => r.url))).toEqual(
      new Set([`/api/game/${a.id}`, `/api/game/${b.id}`])
    );
  });

  it('a held send of a save whose firstWinAt is null is dropped with no PUT', async () => {
    const a = mk('A', true, '2026-11-20T10:00:00.000Z');
    const b = mk('B', true, '2026-11-20T09:00:00.000Z');
    const first = held();
    const h = harness({ saves: [a, b], attach: false });
    h.answer(() => first.promise);
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(1);
    // The save held behind the PUT in flight no longer has a win when its turn comes.
    const sentId = h.puts()[0].url.slice('/api/game/'.length);
    const heldId = sentId === a.id ? b.id : a.id;
    const heldSave = h.store.read(heldId) as GameSave;
    h.store.games.set(heldId, { ...heldSave, state: { ...heldSave.state, firstWinAt: null } });
    // No session is made: the 422 answers without one, so the next held save is tried.
    first.resolve(json(422, { error: 'no_win' }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.puts()).toHaveLength(1);
    expect(h.puts().map((r) => r.url)).toEqual([`/api/game/${sentId}`]);
  });

  it('one request per save: a change during a PUT sends again 2 s after it ends', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true });
    const first = held();
    let n = 0;
    h.answer(() => (++n === 1 ? first.promise : json(200, line(2))));
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(1);
    h.store.edit(a.id, { name: 'Edited' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(1);
    expect(h.sync.state).toBe('saving');
    first.resolve(json(200, line(1)));
    await vi.advanceTimersByTimeAsync(1999);
    expect(h.puts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.puts()).toHaveLength(2);
    expect(h.puts()[1].body).toMatchObject({ baseRev: 1, save: { name: 'Edited' } });
  });

  it('records the rev and savedAt after a 200; a corrupt record is replaced', async () => {
    const a = mk('A', true);
    const storage = new MemoryStorage();
    storage.setItem(SAVE_REVS_KEY, '{nope');
    const h = harness({ saves: [a], signedIn: true, storage });
    expect(h.record()).toEqual({ v: 1, seen: {}, deleting: [] });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    const sent = h.puts()[0].body?.save as GameSave;
    expect(h.record()).toEqual({
      v: 1,
      seen: { [a.id]: { rev: 1, savedAt: sent.savedAt } },
      deleting: []
    });
  });

  it('with storage null the record lives in memory and sends still work', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true, storage: null });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts().map((r) => r.body?.baseRev)).toEqual([null, 1]);
    expect(h.sync.state).toBe('saved');
  });
});

describe('answers', () => {
  it('413 and 422 invalid drop the save and log the id and status', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = mk('A', true);
    const b = mk('B', true);
    const h = harness({ saves: [a, b], signedIn: true });
    h.answer((r) =>
      r.url.endsWith(a.id) ? new Response(null, { status: 413 }) : json(422, { error: 'invalid' })
    );
    h.store.edit(a.id);
    h.store.edit(b.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(err).toHaveBeenCalledWith(expect.any(String), a.id, 413);
    expect(err).toHaveBeenCalledWith(expect.any(String), b.id, 422);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(2);
    expect(h.sync.state).toBe('saved');
  });

  it('422 no_win leaves the save unsent until its next change', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], attach: false });
    h.answer(() => json(422, { error: 'no_win' }));
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(1);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(1);
    expect(h.sync.state).toBe('local');
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(2);
  });

  it('a thrown fetch, a 429 and a 5xx set offline; online resends', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true });
    for (const fail of [
      () => {
        throw new TypeError('Failed to fetch');
      },
      () => new Response(null, { status: 429 }),
      () => new Response(null, { status: 503 })
    ]) {
      h.answer(fail);
      h.store.edit(a.id);
      await vi.advanceTimersByTimeAsync(2000);
      expect(h.sync.state).toBe('offline');
    }
    expect(h.puts()).toHaveLength(3);
    h.answer(() => json(200, line(1)));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts()).toHaveLength(4);
    expect(h.sync.state).toBe('saved');
  });

  it('the next change of any save resends the waiting ones', async () => {
    const a = mk('A', true);
    const b = mk('B', true);
    const h = harness({ saves: [a, b], signedIn: true });
    h.answer(() => {
      throw new TypeError('Failed to fetch');
    });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('offline');
    h.answer(() => json(200, line(1)));
    h.store.edit(b.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.puts().map((r) => r.url)).toEqual([`/api/game/${a.id}`, `/api/game/${a.id}`]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.puts()).toHaveLength(3);
    expect(h.sync.state).toBe('saved');
  });

  it('a 401 sign_in sets sign-in and later changes send nothing', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true });
    h.answer(() => json(401, { error: 'sign_in' }));
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('sign-in');
    h.answer(() => json(200, line(1)));
    h.store.edit(a.id);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(1);
    expect(h.sync.state).toBe('sign-in');
  });

  it('a 422 too_many and a full adopt set full; a removed call clears it', async () => {
    const a = mk('A', true);
    const b = mk('B', true);
    const h = harness({ saves: [a, b], signedIn: true });
    h.answer(() => json(422, { error: 'too_many' }));
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('full');
    h.answer(() => json(200, line(1)));
    h.store.remove(b.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sync.state).toBe('saved');
    // The waiting save went with the removed call.
    expect(h.puts().map((r) => r.url)).toEqual([`/api/game/${a.id}`, `/api/game/${a.id}`]);

    const theirs = { ...(h.store.read(a.id) as GameSave), name: 'Theirs' };
    h.store.adoptAnswer = { ok: false, reason: 'full' };
    h.answer((r) =>
      r.url.endsWith(a.id) ? json(409, { rev: 5, save: theirs }) : json(200, line(1))
    );
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('full');
    expect(h.record().seen[a.id]).toBeUndefined();
  });
});

describe('keep both', () => {
  it('a 409 on the current game keeps a "(this device)" copy current and adopts theirs', async () => {
    const a = mk('Home', true);
    const other = mk('Other', false);
    const h = harness({ saves: [a, other], signedIn: true });
    const theirs: GameSave = { ...a, name: 'Home', plan: 'their plan', savedAt: WON };
    h.answer((r) =>
      r.url.endsWith(a.id) ? json(409, { rev: 4, save: theirs }) : json(200, line(1))
    );
    h.store.edit(a.id, { plan: 'my plan' });
    await vi.advanceTimersByTimeAsync(2000);
    const copyId = h.store.currentId;
    expect(copyId).not.toBe(a.id);
    expect(h.store.read(copyId)).toMatchObject({ name: 'Home (this device)', plan: 'my plan' });
    expect(h.store.read(a.id)).toEqual(theirs);
    expect(h.store.switchTo).not.toHaveBeenCalled();
    expect(h.record().seen[a.id]).toEqual({ rev: 4, savedAt: WON });
    expect(h.puts().map((r) => [r.url, r.body?.baseRev])).toEqual([
      [`/api/game/${a.id}`, null],
      [`/api/game/${copyId}`, null]
    ]);
    // The rename's echo is not sent again.
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(2);
    expect(h.sync.state).toBe('saved');
  });

  it('a 409 on another game keeps the current one current', async () => {
    const cur = mk('Current', false);
    const a = mk('Away', true);
    const h = harness({ saves: [cur, a], signedIn: true });
    const theirs: GameSave = { ...a, savedAt: WON };
    h.answer((r) =>
      r.url.endsWith(a.id) ? json(409, { rev: 2, save: theirs }) : json(200, line(1))
    );
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.store.currentId).toBe(cur.id);
    const names = h.store.saves.map((s) => s.name).sort();
    expect(names).toEqual(['Away', 'Away (this device)', 'Current']);
  });

  it("a 409 on a 60-code-point name names the copy with a suffix, not the account copy's name", async () => {
    const long = 'x'.repeat(60);
    const a = mk(long, true);
    const h = harness({ saves: [a], signedIn: true });
    const theirs: GameSave = { ...a, plan: 'their plan', savedAt: WON };
    h.answer((r) =>
      r.url.endsWith(a.id) ? json(409, { rev: 2, save: theirs }) : json(200, line(1))
    );
    h.store.edit(a.id, { plan: 'my plan' });
    await vi.advanceTimersByTimeAsync(2000);
    const copyId = h.store.currentId;
    expect(copyId).not.toBe(a.id);
    expect(h.store.read(copyId)).toMatchObject({ name: 'x'.repeat(56) + ' (2)', plan: 'my plan' });
    expect(h.store.read(a.id)?.name).toBe(long);
  });

  it('a 409 whose account copy was renamed elsewhere to the suffixed name takes the next suffix', async () => {
    const long = 'x'.repeat(60);
    const a = mk(long, true);
    const h = harness({ saves: [a], signedIn: true });
    // Renamed on another device to the name the browser's copy would otherwise take.
    const theirs: GameSave = { ...a, name: 'x'.repeat(56) + ' (2)', savedAt: WON };
    h.answer((r) =>
      r.url.endsWith(a.id) ? json(409, { rev: 2, save: theirs }) : json(200, line(1))
    );
    h.store.edit(a.id, { plan: 'my plan' });
    await vi.advanceTimersByTimeAsync(2000);
    const copyId = h.store.currentId;
    expect(h.store.read(copyId)?.name).toBe('x'.repeat(56) + ' (3)');
    expect(h.store.read(a.id)?.name).toBe('x'.repeat(56) + ' (2)');
    const names = h.store.saves.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('a store refusing the rekey sets offline and leaves the save waiting', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true });
    h.store.rekeyAnswer = { ok: false, reason: 'storage' };
    h.answer(() => json(409, { rev: 2, save: { ...a, savedAt: WON } }));
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('offline');
    expect(h.store.read(a.id)?.name).toBe('A');
    expect(h.puts()).toHaveLength(1);
  });
});

describe('removal', () => {
  it('a 410 keeps the current game and another under new ids and sends them fresh', async () => {
    const cur = mk('Current', true);
    const other = mk('Other', true);
    const h = harness({ saves: [cur, other], signedIn: true });
    const gone = new Set([cur.id, other.id]);
    h.answer((r) =>
      gone.has(r.url.slice('/api/game/'.length))
        ? new Response(null, { status: 410 })
        : json(200, line(1))
    );
    h.store.edit(cur.id);
    h.store.edit(other.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.store.read(cur.id)).toBeNull();
    expect(h.store.read(other.id)).toBeNull();
    const ids = h.store.saves.map((s) => s.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(h.store.currentId);
    expect(h.store.read(h.store.currentId)?.name).toBe('Current');
    const fresh = h.puts().filter((r) => !gone.has(r.body?.save.id as string));
    expect(fresh.map((r) => r.body?.baseRev)).toEqual([null, null]);
    expect(new Set(fresh.map((r) => r.body?.save.id))).toEqual(new Set(ids));
    expect(Object.keys(h.record().seen).sort()).toEqual([...ids].sort());
  });

  it('a removed save is deleted on the account; one never sent is not', async () => {
    const a = mk('A', true);
    const b = mk('B', true);
    const c = mk('C', true);
    const h = harness({ saves: [a, b, c], signedIn: true });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    h.store.remove(a.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.reqs.at(-1)).toMatchObject({ method: 'DELETE', url: `/api/game/${a.id}` });
    expect(h.record()).toEqual({ v: 1, seen: {}, deleting: [] });
    h.store.remove(b.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.reqs.filter((r) => r.method === 'DELETE')).toHaveLength(1);
  });

  it('a DELETE is sent as JSON with the body {}', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    h.store.remove(a.id);
    await vi.advanceTimersByTimeAsync(0);
    const del = h.reqs.filter((r) => r.method === 'DELETE');
    expect(del).toHaveLength(1);
    expect(del[0]).toMatchObject({ type: 'application/json', raw: '{}' });
    expect(h.record().deleting).toEqual([]);
  });

  it.each([415, 403, 500])(
    'a DELETE answering %i sets offline and keeps the id in deleting',
    async (status) => {
      const a = mk('A', true);
      const h = harness({ saves: [a], signedIn: true });
      h.store.edit(a.id);
      await vi.advanceTimersByTimeAsync(2000);
      h.answer((r) =>
        r.method === 'DELETE' ? new Response(null, { status }) : json(200, line(1))
      );
      h.store.remove(a.id);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.sync.state).toBe('offline');
      expect(h.record().deleting).toEqual([a.id]);
    }
  );

  it('a DELETE that failed stays in deleting and goes again with the waiting saves', async () => {
    const a = mk('A', true);
    const b = mk('B', true);
    const h = harness({ saves: [a, b], signedIn: true });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    h.answer(() => {
      throw new TypeError('Failed to fetch');
    });
    h.store.remove(a.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.record().deleting).toEqual([a.id]);
    expect(h.sync.state).toBe('offline');
    h.answer((r) =>
      r.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, line(1))
    );
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.reqs.filter((r) => r.method === 'DELETE')).toHaveLength(2);
    expect(h.record()).toEqual({ v: 1, seen: {}, deleting: [] });
    expect(h.sync.state).toBe('saved');
  });

  it("the store's echoes of the sync's own adopts and renames are not sent", async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true });
    const adopt = h.store.adopt.bind(h.store);
    h.store.adopt = (saves) => {
      const r = adopt(saves);
      for (const s of saves) h.store.sync.changed(s.id);
      return r;
    };
    h.answer((r) =>
      r.url.endsWith(a.id)
        ? json(409, { rev: 3, save: { ...a, savedAt: WON } })
        : json(200, line(1))
    );
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(2);
  });
});

interface Listed {
  save: GameSave;
  rev: number;
}

function listBody(listed: readonly Listed[], removed: readonly string[]) {
  return {
    handle: 'listed-otter',
    handleClaimed: true,
    saves: listed.map(({ save, rev }) => ({
      id: save.id,
      name: save.name,
      nameIsDefault: save.nameIsDefault,
      savedAt: save.savedAt,
      phase: save.state.phase,
      round: save.state.round,
      rev
    })),
    removed
  };
}

/** An account holding `listed`, with `removed` removed, answering as the routes do. */
function account(listed: readonly Listed[], removed: readonly string[] = []) {
  return (r: Req): Answer => {
    if (r.method === 'GET' && r.url === '/api/game') return json(200, listBody(listed, removed));
    const id = r.url.slice('/api/game/'.length);
    if (removed.includes(id)) return new Response(null, { status: 410 });
    const hit = listed.find((l) => l.save.id === id);
    if (r.method === 'GET') {
      return hit
        ? json(200, { rev: hit.rev, save: hit.save })
        : new Response(null, { status: 404 });
    }
    if (r.method === 'DELETE') return new Response(null, { status: 204 });
    return json(200, line((hit?.rev ?? 0) + 1));
  };
}

/** Signed in, attached with `seen` and `deleting` recorded, the attach pull awaited. */
async function pulled(o: {
  saves: GameSave[];
  seen?: SyncRecord['seen'];
  deleting?: string[];
  listed?: Listed[];
  removed?: string[];
}) {
  const storage = new MemoryStorage();
  const rec: SyncRecord = { v: 1, seen: o.seen ?? {}, deleting: o.deleting ?? [] };
  storage.setItem(SAVE_REVS_KEY, JSON.stringify(rec));
  const h = harness({ saves: o.saves, signedIn: true, storage, attach: false });
  reload.mockImplementation(() => void h.log.push('reload'));
  h.answer(account(o.listed ?? [], o.removed ?? []));
  h.sync.attach(h.store as unknown as GameStore);
  // The pull attach started: a pull called while one runs is that pull.
  await h.sync.pull();
  return h;
}

const seenOf = (...saves: GameSave[]): SyncRecord['seen'] =>
  Object.fromEntries(saves.map((s) => [s.id, { rev: 1, savedAt: s.savedAt }]));

const calls = (reqs: Req[]) => reqs.map((r) => `${r.method} ${r.url}`);

describe('pull', () => {
  it('adopts a save this browser lacks; one unchanged at the same rev is left alone', async () => {
    const cur = mk('Here', false);
    const x = mk('There', true, '2026-11-21T10:00:00.000Z');
    const h = await pulled({
      saves: [cur],
      seen: seenOf(cur),
      listed: [
        { save: cur, rev: 1 },
        { save: x, rev: 3 }
      ]
    });
    expect(calls(h.reqs)).toEqual(['GET /api/game', `GET /api/game/${x.id}`]);
    expect(h.store.read(x.id)).toEqual(x);
    expect(h.store.currentId).toBe(cur.id);
    expect(h.record().seen[x.id]).toEqual({ rev: 3, savedAt: x.savedAt });
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(0);
    expect(h.sync.state).toBe('saved');
  });

  it('the list sets account', async () => {
    const cur = mk('Here', false);
    const h = await pulled({ saves: [cur], seen: seenOf(cur), listed: [{ save: cur, rev: 1 }] });
    expect(h.reqs).toHaveLength(1);
    expect(h.sync.account).toEqual({ handle: 'listed-otter', handleClaimed: true });
  });

  it('replaces an unchanged save at an older rev', async () => {
    const cur = mk('Here', false);
    const a = mk('A', true);
    const newer: GameSave = { ...a, name: 'Newer', savedAt: '2026-11-21T10:00:00.000Z' };
    const h = await pulled({
      saves: [cur, a],
      seen: seenOf(cur, a),
      listed: [
        { save: cur, rev: 1 },
        { save: newer, rev: 2 }
      ]
    });
    expect(h.store.read(a.id)).toEqual(newer);
    expect(h.record().seen[a.id]).toEqual({ rev: 2, savedAt: newer.savedAt });
    expect(h.puts()).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
  });

  it('sends a save changed here at once with its baseRev', async () => {
    const cur = mk('Here', false);
    const a = mk('A', true);
    const h = await pulled({
      saves: [cur, a],
      seen: { ...seenOf(cur), [a.id]: { rev: 2, savedAt: '2026-11-19T10:00:00.000Z' } },
      listed: [
        { save: cur, rev: 1 },
        { save: a, rev: 2 }
      ]
    });
    expect(calls(h.reqs)).toEqual(['GET /api/game', `PUT /api/game/${a.id}`]);
    expect(h.puts()[0].body?.baseRev).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.record().seen[a.id].rev).toBe(3);
  });

  it('removes an unchanged save listed as removed; keeps a changed or current one', async () => {
    const cur = mk('Here', true);
    const gone = mk('Gone', true);
    const edited = mk('Edited', true);
    const h = await pulled({
      saves: [cur, gone, edited],
      seen: { ...seenOf(cur, gone), [edited.id]: { rev: 1, savedAt: '2026-11-19T10:00:00.000Z' } },
      removed: [cur.id, gone.id, edited.id]
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.read(gone.id)).toBeNull();
    expect(h.store.read(cur.id)).toBeNull();
    expect(h.store.read(edited.id)).toBeNull();
    expect(h.reqs.filter((r) => r.method === 'DELETE')).toHaveLength(0);
    expect(h.store.read(h.store.currentId)?.name).toBe('Here');
    const ids = h.store.saves.map((s) => s.id);
    expect(h.store.saves.map((s) => s.name).sort()).toEqual(['Edited', 'Here']);
    // The changed one went with its baseRev, answered 410, and went again under a new id.
    expect(h.puts()[0].url).toBe(`/api/game/${edited.id}`);
    expect(h.puts()[0].body?.baseRev).toBe(1);
    const fresh = h.puts().filter((r) => ids.includes(r.body?.save.id as string));
    expect(fresh.map((r) => r.body?.baseRev)).toEqual([null, null]);
    expect(new Set(fresh.map((r) => r.body?.save.id))).toEqual(new Set(ids));
    expect(Object.keys(h.record().seen).sort()).toEqual([...ids].sort());
    expect(h.record().deleting).toEqual([]);
  });

  it('sends a save the account lacks with baseRev null, its seen entry dropped first', async () => {
    const cur = mk('Here', false);
    const a = mk('A', true);
    const h = await pulled({
      saves: [cur, a],
      seen: { ...seenOf(cur), [a.id]: { rev: 4, savedAt: a.savedAt } },
      listed: [{ save: cur, rev: 1 }]
    });
    expect(calls(h.reqs)).toEqual(['GET /api/game', `PUT /api/game/${a.id}`]);
    expect(h.puts()[0].body?.baseRev).toBeNull();
  });

  it('sends again a DELETE that failed, and does not fetch the id it deletes', async () => {
    const cur = mk('Here', false);
    const x = mk('Deleted here', true);
    const h = await pulled({
      saves: [cur],
      seen: seenOf(cur, x),
      deleting: [x.id],
      listed: [
        { save: cur, rev: 1 },
        { save: x, rev: 1 }
      ]
    });
    expect(calls(h.reqs)).toEqual(['GET /api/game', `DELETE /api/game/${x.id}`]);
    expect(h.record().deleting).toEqual([]);
    expect(h.record().seen[x.id]).toBeUndefined();
    expect(h.store.read(x.id)).toBeNull();
  });

  it('runs at attach signed in, and not signed out', async () => {
    const won = mk('Won', true);
    const signedIn = harness({ saves: [mk('Here', false)], signedIn: true });
    const signedOut = harness({ saves: [won] });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(signedIn.reqs)).toEqual(['GET /api/game']);
    expect(signedOut.reqs).toEqual([]);
  });

  it('after a 401, signedIn() turning true clears sign-in and runs a pull', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], attach: false });
    h.answer(() => json(401, { error: 'sign_in' }));
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sync.state).toBe('sign-in');
    h.answer(account([]));
    h.setSignedIn(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(h.reqs)).toEqual([
      `PUT /api/game/${a.id}`,
      'GET /api/game',
      `PUT /api/game/${a.id}`
    ]);
    expect(h.sync.state).toBe('saved');
  });

  it('after signedIn() turns false, the session a PUT made is gone', async () => {
    const won = mk('Won', true);
    const plain = mk('Plain', false);
    const h = harness({ saves: [won, plain], attach: false });
    h.answer((r) => (r.method === 'GET' ? json(200, listBody([], [])) : json(200, line(1))));
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('saved');
    h.setSignedIn(true);
    await vi.advanceTimersByTimeAsync(0);
    h.setSignedIn(false);
    await vi.advanceTimersByTimeAsync(0);
    const before = h.puts().length;
    h.store.edit(plain.id);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(before);
    expect(h.sync.state).toBe('local');
  });

  it('reloads once after an adopt replaced the current game; not again at the same rev', async () => {
    const cur = mk('Here', true);
    const theirs: GameSave = { ...cur, plan: 'their plan', savedAt: '2026-11-21T10:00:00.000Z' };
    const h = await pulled({
      saves: [cur],
      seen: seenOf(cur),
      listed: [{ save: theirs, rev: 2 }]
    });
    expect(h.store.read(cur.id)).toEqual(theirs);
    expect(reload).toHaveBeenCalledTimes(1);
    await h.sync.pull();
    expect(h.reqs.filter((r) => r.url === '/api/game')).toHaveLength(2);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('an edit reaching the store during the fetch is sent, not overwritten', async () => {
    const cur = mk('Here', true);
    const theirs: GameSave = { ...cur, plan: 'their plan', savedAt: '2026-11-21T10:00:00.000Z' };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_REVS_KEY, JSON.stringify({ v: 1, seen: seenOf(cur), deleting: [] }));
    const h = harness({ saves: [cur], signedIn: true, storage, attach: false });
    const one = held();
    h.answer((r) => {
      if (r.url === '/api/game') return json(200, listBody([{ save: theirs, rev: 2 }], []));
      if (r.method === 'GET') return one.promise;
      return r.url.endsWith(cur.id) ? json(409, { rev: 2, save: theirs }) : json(200, line(1));
    });
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(h.reqs)).toEqual(['GET /api/game', `GET /api/game/${cur.id}`]);
    h.store.edit(cur.id, { plan: 'my plan' });
    one.resolve(json(200, { rev: 2, save: theirs }));
    await h.sync.pull();
    await vi.advanceTimersByTimeAsync(0);
    const put = h.puts()[0];
    expect(put.url).toBe(`/api/game/${cur.id}`);
    expect(put.body?.baseRev).toBe(1);
    expect(put.body?.save.plan).toBe('my plan');
    // Keep both: the edit lives on, current, as "(this device)"; theirs under the old id.
    expect(h.store.read(h.store.currentId)).toMatchObject({
      name: 'Here (this device)',
      plan: 'my plan'
    });
    expect(h.store.read(cur.id)).toEqual(theirs);
    expect(reload).not.toHaveBeenCalled();
  });

  it('a save absent before the fetch and present after it is sent, not overwritten', async () => {
    const cur = mk('Here', false);
    const x = mk('There', true, '2026-11-21T10:00:00.000Z');
    const mine: GameSave = { ...x, plan: 'my plan' };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_REVS_KEY, JSON.stringify({ v: 1, seen: seenOf(cur), deleting: [] }));
    const h = harness({ saves: [cur], signedIn: true, storage, attach: false });
    const one = held();
    h.answer((r) => {
      if (r.url === '/api/game') {
        return json(
          200,
          listBody(
            [
              { save: cur, rev: 1 },
              { save: x, rev: 3 }
            ],
            []
          )
        );
      }
      if (r.method === 'GET') return one.promise;
      return json(200, line(4));
    });
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(0);
    h.store.games.set(x.id, structuredClone(mine));
    one.resolve(json(200, { rev: 3, save: x }));
    await h.sync.pull();
    expect(h.store.read(x.id)).toEqual(mine);
    expect(calls(h.puts())).toEqual([`PUT /api/game/${x.id}`]);
    expect(h.puts()[0].body?.baseRev).toBeNull();
  });

  it('a per-save GET with an unexpected answer is logged and skipped', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cur = mk('Here', false);
    const x = mk('Odd', true, '2026-11-21T10:00:00.000Z');
    const y = mk('Unreadable', true, '2026-11-21T08:00:00.000Z');
    const gone = mk('Gone', true, '2026-11-21T06:00:00.000Z');
    const storage = new MemoryStorage();
    storage.setItem(SAVE_REVS_KEY, JSON.stringify({ v: 1, seen: seenOf(cur), deleting: [] }));
    const h = harness({ saves: [cur], signedIn: true, storage, attach: false });
    const list = [
      { save: cur, rev: 1 },
      { save: x, rev: 1 },
      { save: y, rev: 1 },
      { save: gone, rev: 1 }
    ];
    h.answer((r) => {
      if (r.url === '/api/game') return json(200, listBody(list, []));
      if (r.url.endsWith(x.id)) return json(418, {});
      if (r.url.endsWith(y.id)) return json(200, { rev: 1, save: { nope: true } });
      return new Response(null, { status: 404 });
    });
    h.sync.attach(h.store as unknown as GameStore);
    await h.sync.pull();
    expect(err).toHaveBeenCalledWith(expect.any(String), x.id, 418);
    expect(err).toHaveBeenCalledWith(expect.any(String), y.id, 200);
    expect(err).toHaveBeenCalledTimes(2);
    expect(h.store.read(x.id)).toBeNull();
    expect(h.store.read(y.id)).toBeNull();
    // Its listeners outlive the test: a later visibility pull must log nothing.
    h.answer(account([{ save: cur, rev: 1 }]));
  });

  it('two pulls made together make one GET, and both resolve', async () => {
    const h = harness({ saves: [mk('Here', false)], signedIn: true, attach: false });
    const list = held();
    h.answer((r) => (r.url === '/api/game' ? list.promise : json(200, line(1))));
    h.sync.attach(h.store as unknown as GameStore);
    const one = h.sync.pull();
    const two = h.sync.pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sync.state).toBe('saving');
    list.resolve(json(200, listBody([], [])));
    await expect(Promise.all([one, two])).resolves.toEqual([undefined, undefined]);
    expect(h.reqs.filter((r) => r.url === '/api/game')).toHaveLength(1);
  });

  it('no send starts while a pull runs; a save due meanwhile goes when it ends', async () => {
    const a = mk('A', true);
    const h = harness({ saves: [a], signedIn: true, attach: false });
    const list = held();
    h.answer((r) => (r.url === '/api/game' ? list.promise : json(200, line(2))));
    h.sync.attach(h.store as unknown as GameStore);
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(0);
    expect(h.sync.state).toBe('saving');
    list.resolve(json(200, listBody([{ save: a, rev: 1 }], [])));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.puts()).toHaveLength(1);
    expect(h.sync.state).toBe('saved');
  });

  it('the first adopt answering full stops later adopts and sets full; sends still go', async () => {
    const cur = mk('Here', false);
    const z = mk('Changed', true);
    const x = mk('Newest', true, '2026-11-21T12:00:00.000Z');
    const y = mk('Older', true, '2026-11-21T08:00:00.000Z');
    const storage = new MemoryStorage();
    const rec: SyncRecord = {
      v: 1,
      seen: { ...seenOf(cur), [z.id]: { rev: 1, savedAt: '2026-11-19T10:00:00.000Z' } },
      deleting: []
    };
    storage.setItem(SAVE_REVS_KEY, JSON.stringify(rec));
    const h = harness({ saves: [cur, z], signedIn: true, storage, attach: false });
    h.store.adoptAnswer = { ok: false, reason: 'full' };
    h.answer(
      account([
        { save: cur, rev: 1 },
        { save: y, rev: 1 },
        { save: x, rev: 1 },
        { save: z, rev: 1 }
      ])
    );
    h.sync.attach(h.store as unknown as GameStore);
    await h.sync.pull();
    expect(calls(h.reqs.filter((r) => r.method === 'GET'))).toEqual([
      'GET /api/game',
      `GET /api/game/${x.id}`
    ]);
    expect(calls(h.puts())).toEqual([`PUT /api/game/${z.id}`]);
    expect(h.sync.state).toBe('full');
    expect(h.record().seen[x.id]).toBeUndefined();
  });

  it('adopts the current game last, after every other step', async () => {
    const cur = mk('Here', true);
    const theirs: GameSave = { ...cur, plan: 'their plan', savedAt: '2026-11-21T10:00:00.000Z' };
    const x = mk('There', true, '2026-11-21T08:00:00.000Z');
    const y = mk('Unsent', true);
    const h = await pulled({
      saves: [cur, y],
      seen: seenOf(cur),
      listed: [
        { save: theirs, rev: 2 },
        { save: x, rev: 3 }
      ]
    });
    expect(h.log).toEqual([
      'GET /api/game',
      `GET /api/game/${cur.id}`,
      `GET /api/game/${x.id}`,
      `adopt ${x.id}`,
      `PUT /api/game/${y.id}`,
      `adopt ${cur.id}`,
      'reload'
    ]);
    expect(h.store.read(cur.id)).toEqual(theirs);
    expect(h.record().seen[cur.id]).toEqual({ rev: 2, savedAt: theirs.savedAt });
  });

  it('the current game changed after its GET answered is sent, never adopted', async () => {
    const cur = mk('Here', true);
    const theirs: GameSave = { ...cur, plan: 'their plan', savedAt: '2026-11-21T10:00:00.000Z' };
    const x = mk('There', true, '2026-11-21T08:00:00.000Z');
    const storage = new MemoryStorage();
    storage.setItem(SAVE_REVS_KEY, JSON.stringify({ v: 1, seen: seenOf(cur), deleting: [] }));
    const h = harness({ saves: [cur], signedIn: true, storage, attach: false });
    const later = held();
    h.answer((r) => {
      if (r.url === '/api/game') {
        return json(
          200,
          listBody(
            [
              { save: theirs, rev: 2 },
              { save: x, rev: 3 }
            ],
            []
          )
        );
      }
      if (r.method === 'GET') {
        return r.url.endsWith(cur.id) ? json(200, { rev: 2, save: theirs }) : later.promise;
      }
      return r.url.endsWith(cur.id) ? json(409, { rev: 2, save: theirs }) : json(200, line(1));
    });
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(h.reqs)).toEqual([
      'GET /api/game',
      `GET /api/game/${cur.id}`,
      `GET /api/game/${x.id}`
    ]);
    h.store.edit(cur.id, { plan: 'my plan' });
    later.resolve(json(200, { rev: 3, save: x }));
    await h.sync.pull();
    await vi.advanceTimersByTimeAsync(0);
    const put = h.puts()[0];
    expect(put.url).toBe(`/api/game/${cur.id}`);
    expect(put.body?.baseRev).toBe(1);
    expect(put.body?.save.plan).toBe('my plan');
    // The only adopt under the old id is keep both's, after the 409.
    const copyId = h.store.currentId;
    expect(h.log.slice(3)).toEqual([
      `adopt ${x.id}`,
      `PUT /api/game/${cur.id}`,
      `adopt ${cur.id}`,
      `PUT /api/game/${copyId}`
    ]);
    expect(h.store.read(copyId)).toMatchObject({ name: 'Here (this device)', plan: 'my plan' });
    expect(h.store.read(cur.id)).toEqual(theirs);
    expect(reload).not.toHaveBeenCalled();
  });

  it('an adopt of the current game answering changed sends it; the 409 keeps both', async () => {
    const cur = mk('Here', true);
    const theirs: GameSave = { ...cur, plan: 'their plan', savedAt: '2026-11-21T10:00:00.000Z' };
    const storage = new MemoryStorage();
    storage.setItem(SAVE_REVS_KEY, JSON.stringify({ v: 1, seen: seenOf(cur), deleting: [] }));
    const h = harness({ saves: [cur], signedIn: true, storage, attach: false });
    // An edit still waiting in the page's autosave, written by the flush the adopt runs.
    let flushed = false;
    h.store.beforeLeave(() => {
      if (flushed) return;
      flushed = true;
      h.store.edit(cur.id, { plan: 'my plan' });
    });
    const put = held();
    h.answer((r) => {
      if (r.url === '/api/game') return json(200, listBody([{ save: theirs, rev: 2 }], []));
      if (r.method === 'GET') return json(200, { rev: 2, save: theirs });
      return r.url.endsWith(cur.id) ? put.promise : json(200, line(1));
    });
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(true);
    expect(calls(h.reqs)).toEqual([
      'GET /api/game',
      `GET /api/game/${cur.id}`,
      `PUT /api/game/${cur.id}`
    ]);
    expect(h.puts()[0].body?.baseRev).toBe(1);
    expect(h.puts()[0].body?.save.plan).toBe('my plan');
    expect(h.record().seen[cur.id]).toEqual({ rev: 1, savedAt: cur.savedAt });
    put.resolve(json(409, { rev: 2, save: theirs }));
    await h.sync.pull();
    await vi.advanceTimersByTimeAsync(0);
    const copyId = h.store.currentId;
    expect(copyId).not.toBe(cur.id);
    expect(h.store.read(copyId)).toMatchObject({ name: 'Here (this device)', plan: 'my plan' });
    expect(h.store.read(cur.id)).toEqual(theirs);
    expect(h.record().seen[cur.id]).toEqual({ rev: 2, savedAt: theirs.savedAt });
    expect(reload).not.toHaveBeenCalled();
  });

  it('an adopt of the current game reloads at once, before any later request', async () => {
    const cur = mk('Here', true);
    const theirs: GameSave = { ...cur, plan: 'their plan', savedAt: '2026-11-21T10:00:00.000Z' };
    const a = mk('A', true, '2026-11-21T12:00:00.000Z');
    const storage = new MemoryStorage();
    storage.setItem(SAVE_REVS_KEY, JSON.stringify({ v: 1, seen: seenOf(cur, a), deleting: [] }));
    const h = harness({ saves: [cur, a], signedIn: true, storage, attach: false });
    reload.mockImplementation(() => void h.log.push('reload'));
    const get = held();
    const listed = [
      { save: a, rev: 1 },
      { save: theirs, rev: 2 }
    ];
    h.answer((r) => {
      if (r.url === '/api/game') return json(200, listBody(listed, []));
      if (r.method === 'GET') return get.promise;
      return json(200, line(2));
    });
    h.sync.attach(h.store as unknown as GameStore);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(h.reqs)).toEqual(['GET /api/game', `GET /api/game/${cur.id}`]);
    // A send that comes due during the pull waits for its end.
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    get.resolve(json(200, { rev: 2, save: theirs }));
    await h.sync.pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.log).toEqual([
      'GET /api/game',
      `GET /api/game/${cur.id}`,
      `adopt ${cur.id}`,
      'reload'
    ]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(h.record().seen[cur.id]).toEqual({ rev: 2, savedAt: theirs.savedAt });
    // The next pull finds the same rev: no adopt, no reload; the waiting send goes.
    await h.sync.pull();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.log.slice(4)).toEqual(['GET /api/game', `PUT /api/game/${a.id}`]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('runs when the page becomes visible with a session, not without', async () => {
    const signedIn = harness({ saves: [mk('Here', false)], signedIn: true });
    const signedOut = harness({ saves: [mk('There', false)] });
    await vi.advanceTimersByTimeAsync(0);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(signedIn.reqs)).toEqual(['GET /api/game', 'GET /api/game']);
    expect(signedOut.reqs).toEqual([]);
  });
});

describe('state', () => {
  it('saving while a timer runs; sign-in over full over offline', async () => {
    const a = mk('A', true);
    const b = mk('B', true);
    const h = harness({ saves: [a, b], signedIn: true });
    // The pull at attach runs first.
    expect(h.sync.state).toBe('saving');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sync.state).toBe('saved');
    h.store.edit(a.id);
    expect(h.sync.state).toBe('saving');
    h.answer(() => {
      throw new TypeError('Failed to fetch');
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('offline');
    h.answer((r) => (r.url.endsWith(b.id) ? json(422, { error: 'too_many' }) : json(200, line(1))));
    h.store.edit(b.id);
    await vi.advanceTimersByTimeAsync(0);
    // a went again with the change of b and succeeded; b's timer is still running.
    expect(h.sync.state).toBe('saving');
    h.answer(() => {
      throw new TypeError('Failed to fetch');
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('offline');
    h.answer(() => json(422, { error: 'too_many' }));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sync.state).toBe('full');
    h.answer(() => {
      throw new TypeError('Failed to fetch');
    });
    h.store.edit(a.id);
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.sync.state).toBe('full');
    h.answer(() => json(401, { error: 'sign_in' }));
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sync.state).toBe('sign-in');
  });
});
