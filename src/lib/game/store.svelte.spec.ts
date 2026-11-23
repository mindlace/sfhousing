import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { newId } from '$lib/ids/base58';
import { PLAN_KEY } from '$lib/sharing/storage';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { SIM_KEY } from '$lib/sim-page/sim-doc';
import { SIM_KEY4 } from '$lib/timeline/sim-doc4';
import { ALL_ALLOWED, allowedAt } from './allowed';
import type { Level } from './levels';
import { NEW_GAME, roundComplete, type Banked, type Progress } from './progress';
import { MAX_SAVES, SAVES_KEY, saveKey, type GameSave, type SaveEntry } from './saves';
import { GameStore, openGame, type Offer } from './store.svelte';
import { FakeSync } from './test/fake-sync.svelte';
import StoreHost from './test/StoreHost.svelte';

/** Records every write in order; `failAt` makes the write with that 1-based index throw. */
class LogStorage extends MemoryStorage {
  /** 'set <key>' | 'remove <key>', in order. */
  writes: string[] = [];
  /** The write (setItem or removeItem) with this 1-based index since reset throws. */
  failAt: number | null = null;
  getThrows: string | RegExp | null = null;
  /** `getThrows` applies only once this many writes have been made. */
  getThrowsFrom = 0;

  /** Clears `writes` and the write count. */
  reset(): void {
    this.writes = [];
  }

  override getItem(key: string): string | null {
    const g = this.getThrows;
    if (
      g !== null &&
      this.writes.length >= this.getThrowsFrom &&
      (typeof g === 'string' ? key === g : g.test(key))
    ) {
      throw new DOMException('denied', 'SecurityError');
    }
    return super.getItem(key);
  }

  override setItem(key: string, value: string): void {
    this.#write(`set ${key}`);
    super.setItem(key, value);
  }

  override removeItem(key: string): void {
    this.#write(`remove ${key}`);
    super.removeItem(key);
  }

  #write(entry: string): void {
    this.writes.push(entry);
    if (this.writes.length === this.failAt) throw new DOMException('full', 'QuotaExceededError');
  }
}

const PLAN_RECORD = 'sfhousing:plan:v1';
const POLICY_RECORD = 'sfhousing:sim:v2';
const PLAN = '{"v":1,"savedAt":"2026-12-01T00:00:00.000Z","plan":"p"}';
const POLICY = '{"v":1,"savedAt":"2026-11-01T00:00:00.000Z","plan":"q"}';
/** Local time: default names use the player's day. */
const clock = new Date(2026, 10, 22, 12);
const corrupt = (ms = 0) =>
  `sfhousing:save:corrupt:${new Date(clock.getTime() + ms).toISOString()}`;
const make = (storage: Storage | null, sync = new FakeSync()) => ({
  store: new GameStore({ storage, sync, now: () => clock }),
  sync
});
const stored = (s: Storage, key: string) => JSON.parse(s.getItem(key) as string);

const LEVEL_2: Progress = { v: 1, level: 2, banked: {}, firstWinAt: null };

function save(over: Partial<GameSave> = {}): GameSave {
  return {
    v: 1,
    id: newId(),
    name: 'Saved',
    nameIsDefault: false,
    progress: LEVEL_2,
    plan: null,
    policy: null,
    savedAt: '2026-10-01T00:00:00.000Z',
    ...over
  };
}

function entryOf(s: GameSave): SaveEntry {
  return {
    id: s.id,
    name: s.name,
    nameIsDefault: s.nameIsDefault,
    savedAt: s.savedAt,
    level: s.progress.level
  };
}

/** Puts values in without logging them. */
function seed(s: LogStorage, values: Record<string, string>): void {
  for (const [k, v] of Object.entries(values)) s.map.set(k, v);
}

/** A valid index naming `current`, with each save stored under its key. */
function seedGames(s: LogStorage, saves: GameSave[], current: string): void {
  for (const g of saves) s.map.set(saveKey(g.id), JSON.stringify(g));
  s.map.set(SAVES_KEY, JSON.stringify({ v: 1, current, saves: saves.map(entryOf) }));
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe('GameStore construction', () => {
  it('the record key literals match the codecs', () => {
    expect(PLAN_KEY).toBe('sfhousing:plan:v1');
    expect(SIM_KEY4).toBe('sfhousing:sim:v2');
    expect(SIM_KEY).toBe('sfhousing:sim:v1');
  });

  it('empty storage makes one level 1 game and writes the save, then the index', () => {
    const s = new LogStorage();
    const sync = new FakeSync();
    const { store } = make(s, sync);
    expect(store.saves).toHaveLength(1);
    const [entry] = store.saves;
    const id = store.currentId;
    expect(entry).toEqual({
      id,
      name: 'Game, 22 Nov',
      nameIsDefault: true,
      savedAt: clock.toISOString(),
      level: 1
    });
    expect(store.progress).toEqual(NEW_GAME);
    expect(store.progress).not.toBe(NEW_GAME);
    expect(store.progress.banked).not.toBe(NEW_GAME.banked);
    expect(s.writes).toEqual(['set sfhousing:save:' + id, 'set sfhousing:saves:v1']);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: id, saves: [entry] });
    expect(stored(s, saveKey(id))).toEqual({
      v: 1,
      id,
      name: 'Game, 22 Nov',
      nameIsDefault: true,
      progress: NEW_GAME,
      plan: null,
      policy: null,
      savedAt: clock.toISOString()
    });
    expect(store.open).toBe(false);
    expect(store.offer).toBeNull();
    expect(store.allowed).toBe(allowedAt(1));
    expect(store.sync).toBe(sync);
    expect(sync.calls).toEqual([]);
  });

  it("earlier records become the first game's plan and policy, byte for byte", () => {
    const s = new LogStorage();
    seed(s, { [PLAN_RECORD]: PLAN, [POLICY_RECORD]: POLICY, [SIM_KEY]: 'old v1' });
    const { store } = make(s);
    const id = store.currentId;
    expect(stored(s, saveKey(id)).plan).toBe(PLAN);
    expect(stored(s, saveKey(id)).policy).toBe(POLICY);
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(s.getItem(POLICY_RECORD)).toBe(POLICY);
    expect(s.getItem(SIM_KEY)).toBe('old v1');
    expect(s.writes).toEqual(['set ' + saveKey(id), 'set ' + SAVES_KEY]);
    expect(store.read(id)?.savedAt).toBe('2026-12-01T00:00:00.000Z');
  });

  it('storage null keeps one game in memory', () => {
    const { store } = make(null);
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0].level).toBe(1);
    expect(store.saves[0].name).toBe('Game, 22 Nov');
    expect(store.progress).toEqual(NEW_GAME);
    expect(store.read(store.currentId)?.plan).toBeNull();
  });

  it('a first getItem that throws leaves the records unread', () => {
    const s = new LogStorage();
    seed(s, { [PLAN_RECORD]: PLAN, [POLICY_RECORD]: POLICY });
    s.getThrows = SAVES_KEY;
    const { store } = make(s);
    expect(store.read(store.currentId)?.plan).toBeNull();
    expect(store.read(store.currentId)?.policy).toBeNull();
    expect(s.writes).toEqual([]);
  });

  it('an entry whose save key is absent is left out with no corrupt copy', () => {
    const s = new LogStorage();
    const a = save();
    const b = save();
    seedGames(s, [a, b], a.id);
    s.map.delete(saveKey(b.id));
    const { store } = make(s);
    expect(s.writes).toEqual(['set ' + SAVES_KEY]);
    expect(s.keys().filter((k) => k.startsWith('sfhousing:save:corrupt:'))).toEqual([]);
    expect(store.saves.map((e) => e.id)).toEqual([a.id]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: a.id, saves: [entryOf(a)] });
  });

  /** Memory mode with one fresh level 1 game, nothing read into it. */
  function expectFresh(store: GameStore): void {
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0].name).toBe('Game, 22 Nov');
    expect(store.saves[0].level).toBe(1);
    expect(store.progress).toEqual(NEW_GAME);
    expect(store.read(store.currentId)?.plan).toBeNull();
    expect(store.read(store.currentId)?.policy).toBeNull();
    expect(store.newGame()).toEqual({ ok: false, reason: 'storage' });
  }

  it('a save key read that throws in step 5 gives memory mode with a fresh game', () => {
    const s = new LogStorage();
    const a = save();
    const b = save();
    const c = save();
    seedGames(s, [a, b, c], a.id);
    seed(s, { [saveKey(b.id)]: 'broken', [PLAN_RECORD]: PLAN });
    const before = new Map(s.map);
    s.getThrows = saveKey(c.id);
    const { store } = make(s);
    expect(s.map).toEqual(before);
    expect(s.writes).toEqual([]);
    expectFresh(store);
  });

  it('a read that throws in the step 4 rebuild after the corrupt copy was written puts it back', () => {
    const s = new LogStorage();
    const a = save();
    seed(s, { [SAVES_KEY]: 'not json', [saveKey(a.id)]: JSON.stringify(a), [PLAN_RECORD]: PLAN });
    const before = new Map(s.map);
    s.getThrows = /^sfhousing:save:(?!corrupt:)/;
    s.getThrowsFrom = 1;
    const { store } = make(s);
    expect(s.writes[0]).toBe('set ' + corrupt());
    expect(s.writes.at(-1)).toBe('remove ' + corrupt());
    expect(s.map).toEqual(before);
    expectFresh(store);
  });

  it('a first getItem that throws gives memory mode', () => {
    const s = new LogStorage();
    s.getThrows = /.*/;
    const { store } = make(s);
    expect(store.saves).toHaveLength(1);
    expect(store.progress).toEqual(NEW_GAME);
    expect(s.writes).toEqual([]);
  });

  it('refused first writes give memory mode with the records read', () => {
    const s = new LogStorage();
    seed(s, { [PLAN_RECORD]: PLAN });
    s.failWrites = true;
    const { store } = make(s);
    expect(store.saves).toHaveLength(1);
    expect(store.read(store.currentId)?.plan).toBe(PLAN);
    expect(s.keys()).toEqual([PLAN_RECORD]);
  });

  it('an invalid index is copied aside and its games recovered', () => {
    const s = new LogStorage();
    const a = save({ name: 'Game, 22 Nov' });
    const b = save({ name: 'Game, 22 Nov (2)', progress: NEW_GAME });
    const c = newId();
    seed(s, {
      [SAVES_KEY]: 'not json',
      [saveKey(a.id)]: JSON.stringify(a),
      [saveKey(b.id)]: JSON.stringify(b),
      [saveKey(c)]: 'broken'
    });
    const { store } = make(s);
    expect(s.getItem(corrupt())).toBe('not json');
    expect(s.getItem(corrupt(1))).toBe('broken');
    expect(s.getItem(saveKey(c))).toBeNull();
    const ids = store.saves.map((e) => e.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(c);
    const fresh = store.saves.find((e) => e.id === store.currentId) as SaveEntry;
    expect(fresh.id).not.toBe(a.id);
    expect(fresh.id).not.toBe(b.id);
    expect(fresh.level).toBe(1);
    expect(fresh.name).toBe('Game, 22 Nov (3)');
    expect(store.progress).toEqual(NEW_GAME);
    const index = stored(s, SAVES_KEY);
    expect(index.current).toBe(fresh.id);
    expect(index.saves).toEqual(store.saves);
    expect(stored(s, saveKey(a.id))).toEqual(a);
  });

  it('rebuild moves aside a save whose id differs from its key', () => {
    const s = new LogStorage();
    const x = save();
    const other = newId();
    const raw = JSON.stringify(x);
    seed(s, { [SAVES_KEY]: '{"v":2}', [saveKey(other)]: raw });
    const { store } = make(s);
    expect(s.getItem(corrupt())).toBe('{"v":2}');
    expect(s.getItem(corrupt(1))).toBe(raw);
    expect(s.getItem(saveKey(other))).toBeNull();
    expect(s.getItem(saveKey(x.id))).toBeNull();
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0].id).toBe(store.currentId);
    expect(store.saves[0].id).not.toBe(x.id);
    expect(store.saves[0].id).not.toBe(other);
  });

  it('a save that will not parse is moved aside and dropped', () => {
    const s = new LogStorage();
    const a = save();
    const b = save();
    seedGames(s, [a, b], a.id);
    s.map.set(saveKey(b.id), 'broken');
    const { store } = make(s);
    expect(s.getItem(corrupt())).toBe('broken');
    expect(s.getItem(saveKey(b.id))).toBeNull();
    expect(store.saves.map((e) => e.id)).toEqual([a.id]);
    expect(store.currentId).toBe(a.id);
    expect(s.writes).toEqual(['set ' + corrupt(), 'remove ' + saveKey(b.id), 'set ' + SAVES_KEY]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: a.id, saves: [entryOf(a)] });
  });

  it('a save under an entry that names another id is moved aside', () => {
    const s = new LogStorage();
    const a = save();
    const b = save();
    const wrong = JSON.stringify(save());
    seedGames(s, [a, b], a.id);
    s.map.set(saveKey(b.id), wrong);
    const { store } = make(s);
    expect(s.getItem(corrupt())).toBe(wrong);
    expect(s.getItem(saveKey(b.id))).toBeNull();
    expect(store.saves.map((e) => e.id)).toEqual([a.id]);
    expect(stored(s, SAVES_KEY).saves).toEqual([entryOf(a)]);
  });

  it('a corrupt current save gives a new current game from the records', () => {
    const s = new LogStorage();
    const a = save();
    const b = save();
    seedGames(s, [a, b], a.id);
    seed(s, { [saveKey(a.id)]: 'broken', [PLAN_RECORD]: PLAN });
    const { store } = make(s);
    const id = store.currentId;
    expect(id).not.toBe(a.id);
    expect(id).not.toBe(b.id);
    expect(store.progress).toEqual(NEW_GAME);
    expect(store.read(id)?.plan).toBe(PLAN);
    expect(stored(s, saveKey(id)).plan).toBe(PLAN);
    expect(store.saves.map((e) => e.id).sort(byId)).toEqual([id, b.id].sort(byId));
    expect(s.getItem(saveKey(a.id))).toBeNull();
    expect(s.getItem(corrupt())).toBe('broken');
    expect(stored(s, SAVES_KEY).current).toBe(id);
  });

  it('current naming no entry gives a new current game', () => {
    const s = new LogStorage();
    const b = save();
    seedGames(s, [b], newId());
    const { store } = make(s);
    const id = store.currentId;
    expect(id).not.toBe(b.id);
    expect(store.saves.map((e) => e.id).sort(byId)).toEqual([id, b.id].sort(byId));
    expect(store.saves.find((e) => e.id === id)?.name).toBe('Game, 22 Nov');
    expect(s.writes).toEqual(['set ' + saveKey(id), 'set ' + SAVES_KEY]);
    expect(stored(s, SAVES_KEY).current).toBe(id);
  });

  it('an entry whose name differs from its save is rewritten from the save', () => {
    const s = new LogStorage();
    const a = save({ name: 'New' });
    seedGames(s, [a], a.id);
    s.map.set(
      SAVES_KEY,
      JSON.stringify({ v: 1, current: a.id, saves: [{ ...entryOf(a), name: 'Old' }] })
    );
    const { store } = make(s);
    expect(store.saves[0].name).toBe('New');
    expect(s.writes).toEqual(['set ' + SAVES_KEY]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: a.id, saves: [entryOf(a)] });
  });

  it('a valid, consistent index writes nothing', () => {
    const s = new LogStorage();
    const a = save();
    const b = save({ progress: NEW_GAME });
    seedGames(s, [a, b], a.id);
    const { store } = make(s);
    expect(s.writes).toEqual([]);
    expect(store.currentId).toBe(a.id);
    expect(store.progress).toEqual(a.progress);
    expect(store.allowed).toBe(allowedAt(2));
  });

  it('saves orders by savedAt, the current game by played time, ties by id', () => {
    const s = new LogStorage();
    const a = save({ savedAt: '2026-10-01T00:00:00.000Z' });
    const b = save({ savedAt: '2026-10-05T00:00:00.000Z' });
    const c = save({ savedAt: '2026-10-05T00:00:00.000Z' });
    const d = save({ savedAt: '2026-09-01T00:00:00.000Z' });
    seedGames(s, [c, b, a, d], a.id);
    seed(s, { [PLAN_RECORD]: PLAN });
    const { store } = make(s);
    expect(store.saves.map((e) => e.id)).toEqual([a.id, ...[b.id, c.id].sort(byId), d.id]);
    expect(s.writes).toEqual([]);
  });

  it('a refused write during construction steps 4 to 7 restores storage and enters memory mode with the games it found', () => {
    const s = new LogStorage();
    const a = save();
    const b = save();
    const c = save();
    seedGames(s, [a, b, c], a.id);
    seed(s, { [saveKey(c.id)]: 'broken', [PLAN_RECORD]: PLAN });
    const before = new Map(s.map);
    s.failAt = 3;
    const { store } = make(s);
    expect(s.writes.slice(0, 3)).toEqual([
      'set ' + corrupt(),
      'remove ' + saveKey(c.id),
      'set ' + SAVES_KEY
    ]);
    expect(s.map).toEqual(before);
    expect(store.currentId).toBe(a.id);
    expect(store.saves.map((e) => e.id).sort(byId)).toEqual([a.id, b.id].sort(byId));
    expect(store.read(b.id)).toEqual(b);
    expect(store.read(a.id)?.plan).toBe(PLAN);
  });

  it('a refused write while rebuilding restores storage and keeps the new current game', () => {
    const s = new LogStorage();
    const a = save();
    seed(s, { [SAVES_KEY]: 'not json', [saveKey(a.id)]: JSON.stringify(a), [PLAN_RECORD]: PLAN });
    const before = new Map(s.map);
    s.failAt = 2;
    const { store } = make(s);
    expect(s.map).toEqual(before);
    const id = store.currentId;
    expect(id).not.toBe(a.id);
    expect(store.progress).toEqual(NEW_GAME);
    expect(store.saves.map((e) => e.id).sort(byId)).toEqual([id, a.id].sort(byId));
    expect(store.read(id)?.plan).toBe(PLAN);
  });
});

describe('GameStore.read', () => {
  it('read', () => {
    const s = new LogStorage();
    const a = save({ plan: 'old plan', policy: 'old policy' });
    const b = save({ plan: 'b plan', progress: NEW_GAME });
    seedGames(s, [a, b], a.id);
    seed(s, { [PLAN_RECORD]: PLAN, [POLICY_RECORD]: POLICY });
    const { store } = make(s);

    expect(store.read(newId())).toBeNull();

    const other = store.read(b.id) as GameSave;
    expect(other).toEqual(b);
    other.name = 'changed';
    other.progress.level = 5;
    expect(store.read(b.id)).toEqual(b);

    expect(store.read(a.id)).toEqual({
      ...a,
      plan: PLAN,
      policy: POLICY,
      savedAt: '2026-12-01T00:00:00.000Z'
    });

    s.getThrows = PLAN_RECORD;
    expect(store.read(a.id)?.plan).toBe('old plan');
    expect(store.read(a.id)?.policy).toBe(POLICY);
  });

  it("the current entry in saves carries its played time; the stored index the save's own", () => {
    const s = new LogStorage();
    const a = save({ savedAt: '2026-10-01T00:00:00.000Z' });
    const b = save({ savedAt: '2026-11-15T00:00:00.000Z' });
    seedGames(s, [a, b], a.id);
    seed(s, { [PLAN_RECORD]: PLAN, [POLICY_RECORD]: POLICY });
    s.map.set(saveKey(b.id), 'broken');
    const { store } = make(s);
    expect(store.saves).toEqual([{ ...entryOf(a), savedAt: '2026-12-01T00:00:00.000Z' }]);
    expect(store.saves[0].savedAt).toBe(store.read(a.id)?.savedAt);
    expect(stored(s, SAVES_KEY).saves).toEqual([entryOf(a)]);
    expect(stored(s, saveKey(a.id)).savedAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it('played time ignores record text without a finite savedAt', () => {
    const s = new LogStorage();
    const a = save();
    seedGames(s, [a], a.id);
    seed(s, { [PLAN_RECORD]: 'not json', [POLICY_RECORD]: '{"savedAt":"soon"}' });
    const { store } = make(s);
    const r = store.read(a.id) as GameSave;
    expect(r.plan).toBe('not json');
    expect(r.policy).toBe('{"savedAt":"soon"}');
    expect(r.savedAt).toBe(a.savedAt);
  });
});

describe('the open game and its context', () => {
  it('openGame is level 5, open, with every control', () => {
    const store = openGame();
    expect(store.progress).toEqual({ v: 1, level: 5, banked: {}, firstWinAt: null });
    expect(store.open).toBe(true);
    expect(store.allowed).toBe(ALL_ALLOWED);
    expect(store.sync.state).toBe('local');
    expect(store.sync.account).toBeNull();
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0].name).toBe('Game');
    expect(store.saves[0].level).toBe(5);
    expect(store.offer).toBeNull();
    expect(openGame()).not.toBe(store);
  });

  it('useGame inside a provider is the provided store', () => {
    const { store } = make(null);
    let used: GameStore | null = null;
    render(StoreHost, {
      store,
      show: 'none',
      onuse: (g) => {
        used = g;
      }
    });
    expect(used).toBe(store);
  });

  it('useGame outside a provider is a new open game', () => {
    const used: GameStore[] = [];
    const onuse = (g: GameStore) => {
      used.push(g);
    };
    render(StoreHost, { show: 'none', onuse });
    render(StoreHost, { show: 'none', onuse });
    expect(used).toHaveLength(2);
    expect(used[0].open).toBe(true);
    expect(used[1].open).toBe(true);
    expect(used[0]).not.toBe(used[1]);
  });
});

const OLD_POLICY = 'sfhousing:sim:v1';
const NOW = clock.toISOString();
/** PLAN's savedAt: the played time of a current game whose plan record is PLAN. */
const PLAN_TIME = '2026-12-01T00:00:00.000Z';
const RECORDS = { [PLAN_RECORD]: PLAN, [POLICY_RECORD]: POLICY };
const offer = (on: number | null): Offer => ({ on, datasetVersion: 'fixture-0' });
const earned = (on: number): Banked => ({
  on,
  datasetVersion: 'fixture-0',
  at: '2026-10-01T00:00:00.000Z'
});

/** The current game's entry in `saves`: its played time (PLAN's, by default) as `savedAt`. */
const playing = (e: SaveEntry, at = PLAN_TIME): SaveEntry => ({ ...e, savedAt: at });

/** A valid progress at `level`, banked below it; `complete` banks level 5 too. */
function progressAt(level: Level, complete = false): Progress {
  const banked: Progress['banked'] = {};
  for (let n = 2; n < level; n++) banked[n as 2 | 3 | 4] = earned(30000 + n);
  if (complete) banked[5] = earned(39000);
  return { v: 1, level, banked, firstWinAt: null };
}

/** A store over `games` (the first one current) and `values`, its construction writes cleared. */
function over(games: GameSave[], values: Record<string, string> = RECORDS, now = () => clock) {
  const s = new LogStorage();
  seedGames(s, games, games[0].id);
  seed(s, values);
  const sync = new FakeSync();
  const store = new GameStore({ storage: s, sync, now });
  s.reset();
  return { s, store, sync };
}

/** `count` saves with distinct names and times, the first one latest. */
function many(count: number): GameSave[] {
  return Array.from({ length: count }, (_, i) =>
    save({ name: `Game ${i}`, savedAt: new Date(Date.UTC(2026, 9, 30 - i)).toISOString() })
  );
}

describe('GameStore.levelUp and the offer', () => {
  /** The current game was written with the records copied in, at `progress`. */
  function expectSaved(
    s: LogStorage,
    store: GameStore,
    sync: FakeSync,
    g: GameSave,
    progress: Progress
  ): void {
    expect(store.progress).toEqual(progress);
    expect(store.allowed).toBe(allowedAt(progress.level));
    expect(store.offer).toBeNull();
    expect(store.currentId).toBe(g.id);
    expect(s.writes).toEqual(['set ' + saveKey(g.id), 'set ' + SAVES_KEY]);
    expect(stored(s, saveKey(g.id))).toEqual({
      ...g,
      progress,
      plan: PLAN,
      policy: POLICY,
      savedAt: NOW
    });
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(s.getItem(POLICY_RECORD)).toBe(POLICY);
    const entry = { ...entryOf(g), savedAt: NOW, level: progress.level };
    expect(store.saves).toEqual([playing(entry)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: g.id, saves: [entry] });
    expect(sync.calls).toEqual([{ kind: 'changed', id: g.id }]);
  }

  /** Nothing was written or called, and progress is `progress`. */
  function expectUnchanged(s: LogStorage, store: GameStore, sync: FakeSync, progress: Progress) {
    expect(store.progress).toEqual(progress);
    expect(store.offer).toBeNull();
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
  }

  it('a null offer changes nothing', () => {
    const g = save({ progress: progressAt(3) });
    const { s, store, sync } = over([g]);
    store.levelUp();
    expectUnchanged(s, store, sync, progressAt(3));
    expect(store.saves).toEqual([playing(entryOf(g))]);
  });

  it.each([null, 35000])('level 1 with on %s goes to level 2 banking nothing', (on) => {
    const g = save({ progress: NEW_GAME });
    const { s, store, sync } = over([g]);
    store.setOffer(offer(on));
    store.levelUp();
    expectSaved(s, store, sync, g, { v: 1, level: 2, banked: {}, firstWinAt: null });
  });

  it.each([2, 3, 4] as const)('level %i with a day banks it and rises', (level) => {
    const g = save({ progress: progressAt(level) });
    const { s, store, sync } = over([g]);
    store.setOffer(offer(35000));
    store.levelUp();
    const banked = { on: 35000, datasetVersion: 'fixture-0', at: NOW };
    expect(store.progress.banked[level]).toEqual(banked);
    expectSaved(s, store, sync, g, {
      ...progressAt(level),
      level: (level + 1) as Level,
      banked: { ...progressAt(level).banked, [level]: banked }
    });
  });

  it.each([2, 3, 4] as const)('level %i with on null leaves progress and storage', (level) => {
    const g = save({ progress: progressAt(level) });
    const { s, store, sync } = over([g]);
    store.setOffer(offer(null));
    store.levelUp();
    expectUnchanged(s, store, sync, progressAt(level));
  });

  it('level 5 with a day completes the round', () => {
    const g = save({ progress: progressAt(5) });
    const { s, store, sync } = over([g]);
    store.setOffer(offer(35000));
    store.levelUp();
    expect(roundComplete(store.progress)).toBe(true);
    expectSaved(s, store, sync, g, {
      ...progressAt(5),
      banked: { ...progressAt(5).banked, 5: { on: 35000, datasetVersion: 'fixture-0', at: NOW } }
    });
  });

  it.each([null, 35000])('a complete round is unchanged by on %s', (on) => {
    const g = save({ progress: progressAt(5, true) });
    const { s, store, sync } = over([g]);
    store.setOffer(offer(on));
    store.levelUp();
    expectUnchanged(s, store, sync, progressAt(5, true));
  });

  it('a level up never changes the stored progress it started from', () => {
    const g = save({ progress: NEW_GAME });
    const { store } = over([g]);
    const before = store.progress;
    store.setOffer(offer(null));
    store.levelUp();
    store.setOffer(offer(35000));
    store.levelUp();
    expect(before).toEqual(NEW_GAME);
    expect(store.progress.level).toBe(3);
    expect(store.progress.banked).not.toBe(before.banked);
  });

  it('setOffer writes nothing and calls nothing', () => {
    const g = save();
    const { s, store, sync } = over([g]);
    store.setOffer(offer(35000));
    expect(store.offer).toEqual(offer(35000));
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
    expect(store.progress).toEqual(g.progress);
  });

  it('a refused level up keeps memory and calls nothing', () => {
    const g = save({ progress: progressAt(3) });
    const { s, store, sync } = over([g]);
    const before = new Map(s.map);
    store.setOffer(offer(35000));
    s.failAt = 2;
    store.levelUp();
    expect(s.map).toEqual(before);
    expect(store.progress).toEqual(progressAt(3));
    expect(store.saves).toEqual([playing(entryOf(g))]);
    expect(store.offer).toEqual(offer(35000));
    expect(sync.calls).toEqual([]);
  });

  describe('the offer is cleared by', () => {
    it('setOffer(null)', () => {
      const { store } = over([save()]);
      store.setOffer(offer(1));
      store.setOffer(null);
      expect(store.offer).toBeNull();
    });
    it('newGame', () => {
      const { store } = over([save()]);
      store.setOffer(offer(1));
      expect(store.newGame()).toEqual({ ok: true });
      expect(store.offer).toBeNull();
    });
    it('switchTo of another game', () => {
      const b = save();
      const { store } = over([save(), b]);
      store.setOffer(offer(1));
      expect(store.switchTo(b.id)).toEqual({ ok: true });
      expect(store.offer).toBeNull();
    });
    it('remix', () => {
      const { store } = over([save()]);
      store.setOffer(offer(1));
      expect(store.remix({ kind: 'plan', record: 'r', title: 't' })).toEqual({ ok: true });
      expect(store.offer).toBeNull();
    });
    it('remove of the current game', () => {
      const a = save();
      const { store } = over([a, save()]);
      store.setOffer(offer(1));
      expect(store.remove(a.id)).toEqual({ ok: true });
      expect(store.offer).toBeNull();
    });
    it('adopt of the current id', () => {
      const a = save();
      const { store } = over([a]);
      store.setOffer(offer(1));
      expect(store.adopt([{ ...a, progress: progressAt(3) }])).toEqual({ ok: true });
      expect(store.offer).toBeNull();
    });
  });

  describe('the offer is kept by', () => {
    it('switchTo of the current game', () => {
      const a = save();
      const { store } = over([a]);
      store.setOffer(offer(1));
      expect(store.switchTo(a.id)).toEqual({ ok: true });
      expect(store.offer).toEqual(offer(1));
    });
    it('remove of another game', () => {
      const b = save();
      const { store } = over([save(), b]);
      store.setOffer(offer(1));
      expect(store.remove(b.id)).toEqual({ ok: true });
      expect(store.offer).toEqual(offer(1));
    });
    it('a newGame refused as full', () => {
      const { store } = over(many(MAX_SAVES));
      store.setOffer(offer(1));
      expect(store.newGame()).toEqual({ ok: false, reason: 'full' });
      expect(store.offer).toEqual(offer(1));
    });
  });
});

describe('GameStore.won and touched', () => {
  it('won twice writes once', () => {
    const g = save();
    const { s, store, sync } = over([g]);
    store.won();
    const progress = { ...g.progress, firstWinAt: NOW };
    expect(store.progress).toEqual(progress);
    expect(s.writes).toEqual(['set ' + saveKey(g.id), 'set ' + SAVES_KEY]);
    expect(stored(s, saveKey(g.id))).toEqual({
      ...g,
      progress,
      plan: PLAN,
      policy: POLICY,
      savedAt: NOW
    });
    const entry = { ...entryOf(g), savedAt: NOW };
    expect(store.saves).toEqual([playing(entry)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: g.id, saves: [entry] });
    expect(sync.calls).toEqual([{ kind: 'changed', id: g.id }]);
    store.won();
    expect(s.writes).toHaveLength(2);
    expect(sync.calls).toHaveLength(1);
    expect(store.progress.firstWinAt).toBe(NOW);
  });

  it('touched writes and calls every time', () => {
    const g = save();
    let t = clock;
    const { s, store, sync } = over([g], RECORDS, () => t);
    store.touched();
    expect(s.writes).toEqual(['set ' + saveKey(g.id), 'set ' + SAVES_KEY]);
    expect(stored(s, saveKey(g.id))).toEqual({ ...g, plan: PLAN, policy: POLICY, savedAt: NOW });
    const later = new Date(2026, 10, 22, 13);
    const plan2 = '{"v":1,"plan":"later"}';
    t = later;
    s.map.set(PLAN_RECORD, plan2);
    store.touched();
    expect(s.writes).toEqual([
      'set ' + saveKey(g.id),
      'set ' + SAVES_KEY,
      'set ' + saveKey(g.id),
      'set ' + SAVES_KEY
    ]);
    expect(stored(s, saveKey(g.id))).toEqual({
      ...g,
      plan: plan2,
      policy: POLICY,
      savedAt: later.toISOString()
    });
    expect(store.saves).toEqual([{ ...entryOf(g), savedAt: later.toISOString() }]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: g.id, saves: store.saves });
    expect(store.currentId).toBe(g.id);
    expect(store.progress).toEqual(g.progress);
    expect(sync.calls).toEqual([
      { kind: 'changed', id: g.id },
      { kind: 'changed', id: g.id }
    ]);
  });
});

describe('GameStore.newGame and switchTo', () => {
  it('newGame', () => {
    const g = save({ name: 'Game, 22 Nov' });
    const { s, store, sync } = over([g]);
    expect(store.newGame()).toEqual({ ok: true });
    const id = store.currentId;
    expect(id).not.toBe(g.id);
    expect(s.writes).toEqual([
      'set ' + saveKey(g.id),
      'set ' + saveKey(id),
      'remove ' + PLAN_RECORD,
      'remove ' + POLICY_RECORD,
      'set ' + SAVES_KEY
    ]);
    const old = { ...g, plan: PLAN, policy: POLICY, savedAt: PLAN_TIME };
    const made: GameSave = {
      v: 1,
      id,
      name: 'Game, 22 Nov (2)',
      nameIsDefault: true,
      progress: NEW_GAME,
      plan: null,
      policy: null,
      savedAt: NOW
    };
    expect(stored(s, saveKey(g.id))).toEqual(old);
    expect(stored(s, saveKey(id))).toEqual(made);
    expect(s.getItem(PLAN_RECORD)).toBeNull();
    expect(s.getItem(POLICY_RECORD)).toBeNull();
    expect(store.progress).toEqual(NEW_GAME);
    expect(store.progress).not.toBe(NEW_GAME);
    expect(store.allowed).toBe(allowedAt(1));
    expect(store.saves).toEqual([entryOf(old), entryOf(made)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: id, saves: store.saves });
    expect(sync.calls).toEqual([
      { kind: 'changed', id: g.id },
      { kind: 'changed', id }
    ]);
  });

  it('switchTo another game writes its records and leaves its savedAt', () => {
    const a = save();
    const b = save({
      plan: 'b plan',
      policy: 'b policy',
      progress: progressAt(3),
      savedAt: '2026-10-05T00:00:00.000Z'
    });
    const { s, store, sync } = over([a, b]);
    expect(store.switchTo(b.id)).toEqual({ ok: true });
    expect(s.writes).toEqual([
      'set ' + saveKey(a.id),
      'set ' + PLAN_RECORD,
      'set ' + POLICY_RECORD,
      'set ' + SAVES_KEY
    ]);
    const old = { ...a, plan: PLAN, policy: POLICY, savedAt: PLAN_TIME };
    expect(stored(s, saveKey(a.id))).toEqual(old);
    expect(stored(s, saveKey(b.id))).toEqual(b);
    expect(s.getItem(PLAN_RECORD)).toBe('b plan');
    expect(s.getItem(POLICY_RECORD)).toBe('b policy');
    expect(store.currentId).toBe(b.id);
    expect(store.progress).toEqual(progressAt(3));
    expect(store.saves).toEqual([entryOf(old), entryOf(b)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: b.id, saves: store.saves });
    expect(sync.calls).toEqual([{ kind: 'changed', id: a.id }]);
  });

  it('switching to a game with no records removes both record keys', () => {
    const a = save();
    const b = save();
    const { s, store, sync } = over([a, b]);
    expect(store.switchTo(b.id)).toEqual({ ok: true });
    expect(s.writes).toEqual([
      'set ' + saveKey(a.id),
      'remove ' + PLAN_RECORD,
      'remove ' + POLICY_RECORD,
      'set ' + SAVES_KEY
    ]);
    expect(s.getItem(PLAN_RECORD)).toBeNull();
    expect(s.getItem(POLICY_RECORD)).toBeNull();
    expect(store.currentId).toBe(b.id);
    expect(sync.calls).toEqual([{ kind: 'changed', id: a.id }]);
  });

  it('switchTo the current game is ok and changes nothing', () => {
    const a = save();
    const { s, store, sync } = over([a, save()]);
    const saves = store.saves;
    expect(store.switchTo(a.id)).toEqual({ ok: true });
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
    expect(store.currentId).toBe(a.id);
    expect(store.saves).toBe(saves);
  });

  it('switchTo an unknown id answers storage', () => {
    const a = save();
    const { s, store, sync } = over([a]);
    expect(store.switchTo(newId())).toEqual({ ok: false, reason: 'storage' });
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
    expect(store.currentId).toBe(a.id);
  });

  it('sfhousing:sim:v1 is removed when a game becomes current, and copied aside when v2 was absent', () => {
    const a = save({ name: 'Game, 22 Nov' });
    const one = over([a], { ...RECORDS, [OLD_POLICY]: 'v1 text' });
    expect(one.store.newGame()).toEqual({ ok: true });
    expect(one.s.writes).toEqual([
      'set ' + saveKey(a.id),
      'set ' + saveKey(one.store.currentId),
      'remove ' + PLAN_RECORD,
      'remove ' + POLICY_RECORD,
      'remove ' + OLD_POLICY,
      'set ' + SAVES_KEY
    ]);
    expect(one.s.getItem(OLD_POLICY)).toBeNull();
    expect(one.s.keys().filter((k) => k.startsWith('sfhousing:sim:corrupt:'))).toEqual([]);

    const two = over([a], { [PLAN_RECORD]: PLAN, [OLD_POLICY]: 'v1 text' });
    expect(two.store.newGame()).toEqual({ ok: true });
    const aside = 'sfhousing:sim:corrupt:' + NOW;
    expect(two.s.writes).toEqual([
      'set ' + saveKey(a.id),
      'set ' + aside,
      'set ' + saveKey(two.store.currentId),
      'remove ' + PLAN_RECORD,
      'remove ' + POLICY_RECORD,
      'remove ' + OLD_POLICY,
      'set ' + SAVES_KEY
    ]);
    expect(two.s.getItem(aside)).toBe('v1 text');
    expect(two.s.getItem(OLD_POLICY)).toBeNull();
  });

  it('a write refused mid-change puts back every key', () => {
    const a = save();
    const b = save({ plan: 'b plan' });
    for (const [failAt, failWrites, change] of [
      [2, false, 'newGame'],
      [2, false, 'switchTo'],
      [null, true, 'switchTo']
    ] as const) {
      const { s, store, sync } = over([a, b], { ...RECORDS, [OLD_POLICY]: 'v1' });
      const before = new Map(s.map);
      const saves = store.saves;
      const progress = store.progress;
      s.failAt = failAt;
      s.failWrites = failWrites;
      const answer = change === 'newGame' ? store.newGame() : store.switchTo(b.id);
      expect(answer).toEqual({ ok: false, reason: 'storage' });
      expect(s.map).toEqual(before);
      expect(store.currentId).toBe(a.id);
      expect(store.saves).toBe(saves);
      expect(store.progress).toBe(progress);
      expect(sync.calls).toEqual([]);
    }
  });

  it('a write refused after the v1 copy was written puts the keys back and removes the copy', () => {
    const a = save();
    const { s, store, sync } = over([a], { [PLAN_RECORD]: PLAN, [OLD_POLICY]: 'v1 text' });
    const before = new Map(s.map);
    const saves = store.saves;
    const progress = store.progress;
    s.failAt = 3;
    expect(store.newGame()).toEqual({ ok: false, reason: 'storage' });
    expect(s.writes.slice(0, 2)).toEqual([
      'set ' + saveKey(a.id),
      'set sfhousing:sim:corrupt:' + NOW
    ]);
    expect(s.getItem('sfhousing:sim:corrupt:' + NOW)).toBeNull();
    expect(s.map).toEqual(before);
    expect(store.currentId).toBe(a.id);
    expect(store.saves).toBe(saves);
    expect(store.progress).toBe(progress);
    expect(sync.calls).toEqual([]);
  });

  it('a newGame refused mid-change keeps the offer', () => {
    const a = save();
    const { s, store } = over([a]);
    store.setOffer(offer(1));
    s.failAt = 2;
    expect(store.newGame()).toEqual({ ok: false, reason: 'storage' });
    expect(store.offer).toEqual(offer(1));
  });
});

describe('GameStore.remix', () => {
  const RECORD = '{ "v":1 ,  "plan": "remixed" }';

  it('remix of a plan', () => {
    const a = save({ name: 'Mine', progress: progressAt(3) });
    const { s, store, sync } = over([a]);
    expect(store.remix({ kind: 'plan', record: RECORD, title: 'Transit first' })).toEqual({
      ok: true
    });
    const id = store.currentId;
    expect(id).not.toBe(a.id);
    expect(s.writes).toEqual([
      'set ' + saveKey(a.id),
      'set ' + saveKey(id),
      'set ' + PLAN_RECORD,
      'set ' + POLICY_RECORD,
      'set ' + SAVES_KEY
    ]);
    const old = { ...a, plan: PLAN, policy: POLICY, savedAt: PLAN_TIME };
    const made: GameSave = {
      v: 1,
      id,
      name: 'Remix of Transit first',
      nameIsDefault: true,
      progress: progressAt(3),
      plan: RECORD,
      policy: POLICY,
      savedAt: NOW
    };
    expect(stored(s, saveKey(a.id))).toEqual(old);
    expect(stored(s, saveKey(id))).toEqual(made);
    expect(s.getItem(PLAN_RECORD)).toBe(RECORD);
    expect(s.getItem(POLICY_RECORD)).toBe(POLICY);
    expect(store.progress).toEqual(progressAt(3));
    expect(store.saves).toEqual([entryOf(old), entryOf(made)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: id, saves: store.saves });
    expect(sync.calls).toEqual([
      { kind: 'changed', id: a.id },
      { kind: 'changed', id }
    ]);

    store.setOffer(offer(35000));
    store.levelUp();
    expect(store.progress.level).toBe(4);
    expect(store.read(a.id)?.progress).toEqual(progressAt(3));
    expect(stored(s, saveKey(a.id)).progress).toEqual(progressAt(3));
  });

  it('remix of a policy', () => {
    const a = save({ name: 'Mine' });
    const { s, store } = over([a]);
    expect(store.remix({ kind: 'sim', record: RECORD, title: 'Transit first' })).toEqual({
      ok: true
    });
    const id = store.currentId;
    expect(stored(s, saveKey(id)).plan).toBe(PLAN);
    expect(stored(s, saveKey(id)).policy).toBe(RECORD);
    expect(stored(s, saveKey(id)).name).toBe('Remix of Transit first');
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(s.getItem(POLICY_RECORD)).toBe(RECORD);
  });
});

describe('GameStore.rename', () => {
  it('rename trims, cuts at 60, ignores empty, accepts a duplicate', () => {
    const a = save({ name: 'A' });
    const b = save({ name: 'B', nameIsDefault: true, savedAt: '2026-09-01T00:00:00.000Z' });
    const { s, store, sync } = over([a, b]);
    store.rename(b.id, '   ');
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);

    store.rename(b.id, '  ' + 'x'.repeat(59) + ' yyy  ');
    const cut = { ...b, name: 'x'.repeat(59), nameIsDefault: false, savedAt: NOW };
    expect(s.writes).toEqual(['set ' + saveKey(b.id), 'set ' + SAVES_KEY]);
    expect(stored(s, saveKey(b.id))).toEqual(cut);
    expect(store.saves).toEqual([playing(entryOf(a)), entryOf(cut)]);
    expect(stored(s, SAVES_KEY)).toEqual({
      v: 1,
      current: a.id,
      saves: [entryOf(a), entryOf(cut)]
    });
    expect(sync.calls).toEqual([{ kind: 'changed', id: b.id }]);

    store.rename(b.id, 'A');
    expect(stored(s, saveKey(b.id)).name).toBe('A');
    expect(store.saves.map((e) => e.name)).toEqual(['A', 'A']);
    expect(store.currentId).toBe(a.id);
  });

  it('rename of the current game copies the records in', () => {
    const a = save({ name: 'A' });
    const { s, store, sync } = over([a]);
    store.rename(a.id, 'Mine');
    expect(stored(s, saveKey(a.id))).toEqual({
      ...a,
      name: 'Mine',
      plan: PLAN,
      policy: POLICY,
      savedAt: NOW
    });
    expect(sync.calls).toEqual([{ kind: 'changed', id: a.id }]);
  });

  it('rename to the same name with nameIsDefault false does nothing', () => {
    const a = save({ name: 'A' });
    const { s, store, sync } = over([a]);
    store.rename(a.id, ' A ');
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
  });

  it('rename to the same name with nameIsDefault true keeps the name as typed', () => {
    const a = save({ name: 'A', nameIsDefault: true });
    const { s, store } = over([a]);
    store.rename(a.id, 'A');
    expect(stored(s, saveKey(a.id)).nameIsDefault).toBe(false);
    expect(store.saves[0].nameIsDefault).toBe(false);
  });

  it('rename of an unknown id does nothing', () => {
    const { s, store, sync } = over([save()]);
    store.rename(newId(), 'Name');
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
  });

  it('rename cuts emoji at 60 code points', () => {
    const a = save();
    const { s, store } = over([a]);
    store.rename(a.id, '🏠'.repeat(61));
    const name = store.saves[0].name;
    expect(Array.from(name).length).toBe(60);
    expect(name).toBe('🏠'.repeat(60));
    expect(stored(s, saveKey(a.id)).name).toBe(name);
  });
});

describe('GameStore.remove', () => {
  it('remove another game', () => {
    const a = save();
    const b = save();
    const { s, store, sync } = over([a, b]);
    expect(store.remove(b.id)).toEqual({ ok: true });
    expect(s.writes).toEqual(['remove ' + saveKey(b.id), 'set ' + SAVES_KEY]);
    expect(s.getItem(saveKey(b.id))).toBeNull();
    expect(store.saves).toEqual([playing(entryOf(a))]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: a.id, saves: [entryOf(a)] });
    expect(store.currentId).toBe(a.id);
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(sync.calls).toEqual([{ kind: 'removed', id: b.id }]);
  });

  it('remove the current game with others', () => {
    const a = save();
    const b = save({ savedAt: '2026-10-05T00:00:00.000Z' });
    const c = save({
      plan: 'c plan',
      progress: progressAt(4),
      savedAt: '2026-10-07T00:00:00.000Z'
    });
    const { s, store, sync } = over([a, b, c]);
    expect(store.remove(a.id)).toEqual({ ok: true });
    expect(s.writes).toEqual([
      'remove ' + saveKey(a.id),
      'set ' + PLAN_RECORD,
      'remove ' + POLICY_RECORD,
      'set ' + SAVES_KEY
    ]);
    expect(s.getItem(saveKey(a.id))).toBeNull();
    expect(s.getItem(PLAN_RECORD)).toBe('c plan');
    expect(s.getItem(POLICY_RECORD)).toBeNull();
    expect(store.currentId).toBe(c.id);
    expect(store.progress).toEqual(progressAt(4));
    expect(store.saves).toEqual([entryOf(c), entryOf(b)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: c.id, saves: store.saves });
    expect(sync.calls).toEqual([{ kind: 'removed', id: a.id }]);
  });

  it('remove the last game', () => {
    const a = save({ name: 'Game, 22 Nov' });
    const { s, store, sync } = over([a]);
    expect(store.remove(a.id)).toEqual({ ok: true });
    const id = store.currentId;
    expect(id).not.toBe(a.id);
    expect(s.writes).toEqual([
      'remove ' + saveKey(a.id),
      'set ' + saveKey(id),
      'remove ' + PLAN_RECORD,
      'remove ' + POLICY_RECORD,
      'set ' + SAVES_KEY
    ]);
    const made: GameSave = {
      v: 1,
      id,
      name: 'Game, 22 Nov',
      nameIsDefault: true,
      progress: NEW_GAME,
      plan: null,
      policy: null,
      savedAt: NOW
    };
    expect(stored(s, saveKey(id))).toEqual(made);
    expect(store.saves).toEqual([entryOf(made)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 1, current: id, saves: store.saves });
    expect(store.progress).toEqual(NEW_GAME);
    expect(sync.calls).toEqual([
      { kind: 'removed', id: a.id },
      { kind: 'changed', id }
    ]);
  });

  it('remove an unknown id is ok and changes nothing', () => {
    const a = save();
    const { s, store, sync } = over([a]);
    expect(store.remove(newId())).toEqual({ ok: true });
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
    expect(store.currentId).toBe(a.id);
  });
});

describe('GameStore.adopt and rekey', () => {
  it('full at 12', () => {
    const games = many(MAX_SAVES);
    const { s, store, sync } = over(games);
    const saves = store.saves;
    const progress = store.progress;
    expect(store.newGame()).toEqual({ ok: false, reason: 'full' });
    expect(store.remix({ kind: 'plan', record: 'r', title: 't' })).toEqual({
      ok: false,
      reason: 'full'
    });
    expect(store.adopt([save()])).toEqual({ ok: false, reason: 'full' });
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
    expect(store.saves).toBe(saves);
    expect(store.progress).toBe(progress);
    expect(store.currentId).toBe(games[0].id);
  });

  it('adopt', () => {
    const a = save();
    const b = save({ name: 'B', savedAt: '2026-10-05T00:00:00.000Z' });
    const { s, store, sync } = over([a, b]);
    const c = save({ name: 'B', savedAt: '2026-09-01T00:00:00.000Z' });
    const b2 = {
      ...b,
      name: 'B renamed',
      progress: progressAt(3),
      savedAt: '2026-10-07T00:00:00.000Z'
    };
    const bad = { ...save(), id: 'not-an-id' };
    expect(store.adopt([c, b2, bad])).toEqual({ ok: true });
    expect(s.writes).toEqual(['set ' + saveKey(c.id), 'set ' + saveKey(b.id), 'set ' + SAVES_KEY]);
    expect(stored(s, saveKey(c.id))).toEqual(c);
    expect(stored(s, saveKey(b.id))).toEqual(b2);
    expect(s.getItem(saveKey('not-an-id'))).toBeNull();
    expect(store.saves).toEqual([playing(entryOf(a)), entryOf(b2), entryOf(c)]);
    expect(stored(s, SAVES_KEY)).toEqual({
      v: 1,
      current: a.id,
      saves: [entryOf(a), entryOf(b2), entryOf(c)]
    });
    expect(store.currentId).toBe(a.id);
    expect(store.progress).toEqual(a.progress);
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(s.getItem(POLICY_RECORD)).toBe(POLICY);
    expect(sync.calls).toEqual([]);
  });

  it('adopt of the current id replaces progress and writes its records', () => {
    const a = save();
    const { s, store, sync } = over([a], { ...RECORDS, [OLD_POLICY]: 'v1 text' });
    const a2 = { ...a, progress: progressAt(4), plan: 'acct plan', policy: 'acct policy' };
    expect(store.adopt([a2])).toEqual({ ok: true });
    expect(s.writes).toEqual([
      'set ' + saveKey(a.id),
      'set ' + PLAN_RECORD,
      'set ' + POLICY_RECORD,
      'remove ' + OLD_POLICY,
      'set ' + SAVES_KEY
    ]);
    expect(stored(s, saveKey(a.id))).toEqual(a2);
    expect(s.getItem(PLAN_RECORD)).toBe('acct plan');
    expect(s.getItem(POLICY_RECORD)).toBe('acct policy');
    expect(s.getItem(OLD_POLICY)).toBeNull();
    expect(store.currentId).toBe(a.id);
    expect(store.progress).toEqual(progressAt(4));
    expect(store.allowed).toBe(allowedAt(4));
    expect(store.saves).toEqual([entryOf(a2)]);
    expect(sync.calls).toEqual([]);
  });

  it('adopt of the current id removes sfhousing:sim:v1, copying it aside when v2 was absent', () => {
    const a = save();
    const { s, store, sync } = over([a], { [PLAN_RECORD]: PLAN, [OLD_POLICY]: 'v1 text' });
    const a2 = { ...a, progress: progressAt(4), plan: 'acct plan', policy: 'acct policy' };
    expect(store.adopt([a2])).toEqual({ ok: true });
    const aside = 'sfhousing:sim:corrupt:' + NOW;
    expect(s.writes).toEqual([
      'set ' + aside,
      'set ' + saveKey(a.id),
      'set ' + PLAN_RECORD,
      'set ' + POLICY_RECORD,
      'remove ' + OLD_POLICY,
      'set ' + SAVES_KEY
    ]);
    expect(s.getItem(aside)).toBe('v1 text');
    expect(s.getItem(OLD_POLICY)).toBeNull();
    expect(s.getItem(POLICY_RECORD)).toBe('acct policy');
    expect(sync.calls).toEqual([]);
  });

  it('rekey another game', () => {
    const a = save();
    const b = save({ savedAt: '2026-10-05T00:00:00.000Z' });
    const c = save({ savedAt: '2026-09-01T00:00:00.000Z' });
    const { s, store, sync } = over([a, b, c]);
    const n = newId();
    expect(store.rekey(b.id, n)).toEqual({ ok: true });
    expect(s.writes).toEqual(['set ' + saveKey(n), 'remove ' + saveKey(b.id), 'set ' + SAVES_KEY]);
    expect(stored(s, saveKey(n))).toEqual({ ...b, id: n });
    expect(s.getItem(saveKey(b.id))).toBeNull();
    expect(store.saves.map((e) => e.id)).toEqual([a.id, n, c.id]);
    expect(stored(s, SAVES_KEY)).toEqual({
      v: 1,
      current: a.id,
      saves: [entryOf(a), { ...entryOf(b), id: n }, entryOf(c)]
    });
    expect(store.currentId).toBe(a.id);
    expect(sync.calls).toEqual([]);
  });

  it('rekey the current game', () => {
    const a = save();
    const { s, store, sync } = over([a, save()]);
    store.setOffer(offer(5));
    const n = newId();
    expect(store.rekey(a.id, n)).toEqual({ ok: true });
    expect(s.writes).toEqual(['set ' + saveKey(n), 'remove ' + saveKey(a.id), 'set ' + SAVES_KEY]);
    expect(stored(s, saveKey(n))).toEqual({
      ...a,
      id: n,
      plan: PLAN,
      policy: POLICY,
      savedAt: PLAN_TIME
    });
    expect(store.currentId).toBe(n);
    expect(stored(s, SAVES_KEY).current).toBe(n);
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(s.getItem(POLICY_RECORD)).toBe(POLICY);
    expect(store.offer).toEqual(offer(5));
    expect(store.progress).toEqual(a.progress);
    expect(sync.calls).toEqual([]);
  });

  it('rekey refuses an unknown id, a listed new id, the same id and a bad id', () => {
    const a = save();
    const b = save();
    const { s, store } = over([a, b]);
    const refused = { ok: false, reason: 'storage' };
    expect(store.rekey(newId(), newId())).toEqual(refused);
    expect(store.rekey(a.id, b.id)).toEqual(refused);
    expect(store.rekey(a.id, a.id)).toEqual(refused);
    expect(store.rekey(a.id, 'not-an-id')).toEqual(refused);
    expect(s.writes).toEqual([]);
    expect(store.currentId).toBe(a.id);
  });
});

describe('memory mode and the open game', () => {
  it('memory mode refuses six changes', () => {
    const { store, sync } = make(null);
    const id = store.currentId;
    const refused = { ok: false, reason: 'storage' };
    expect(store.newGame()).toEqual(refused);
    expect(store.switchTo(newId())).toEqual(refused);
    expect(store.remix({ kind: 'plan', record: 'r', title: 't' })).toEqual(refused);
    expect(store.rekey(id, newId())).toEqual(refused);
    expect(store.remove(id)).toEqual(refused);
    expect(store.adopt([save()])).toEqual(refused);
    expect(store.currentId).toBe(id);
    expect(store.saves).toHaveLength(1);
    expect(sync.calls).toEqual([]);

    store.won();
    expect(store.progress.firstWinAt).toBe(NOW);
    store.setOffer(offer(null));
    store.levelUp();
    expect(store.progress.level).toBe(2);
    expect(store.saves[0].level).toBe(2);
    store.touched();
    store.rename(id, 'Mine');
    expect(store.saves[0].name).toBe('Mine');
    expect(store.read(id)?.name).toBe('Mine');
    expect(sync.calls).toEqual([
      { kind: 'changed', id },
      { kind: 'changed', id },
      { kind: 'changed', id },
      { kind: 'changed', id }
    ]);
  });

  it('the open game refuses the six changes and completes the round', () => {
    const store = openGame();
    const id = store.currentId;
    const refused = { ok: false, reason: 'storage' };
    expect(store.newGame()).toEqual(refused);
    expect(store.switchTo(newId())).toEqual(refused);
    expect(store.remix({ kind: 'sim', record: 'r', title: 't' })).toEqual(refused);
    expect(store.rekey(id, newId())).toEqual(refused);
    expect(store.remove(id)).toEqual(refused);
    expect(store.adopt([save()])).toEqual(refused);
    store.setOffer(offer(35000));
    store.levelUp();
    expect(roundComplete(store.progress)).toBe(true);
    expect(store.progress.banked[5]?.on).toBe(35000);
    expect(store.allowed).toBe(ALL_ALLOWED);
    expect(store.offer).toBeNull();
  });
});
