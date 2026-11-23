import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { newId } from '$lib/ids/base58';
import { PLAN_KEY } from '$lib/sharing/storage';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { SIM_KEY } from '$lib/sim-page/sim-doc';
import { SIM_KEY4 } from '$lib/timeline/sim-doc4';
import { ALL_ALLOWED, allowedAt } from './allowed';
import { NEW_GAME, type Progress } from './progress';
import { SAVES_KEY, saveKey, type GameSave, type SaveEntry } from './saves';
import { GameStore, openGame } from './store.svelte';
import { FakeSync } from './test/fake-sync.svelte';
import StoreHost from './test/StoreHost.svelte';

/** Records every write in order; `failAt` makes the write with that 1-based index throw. */
class LogStorage extends MemoryStorage {
  /** 'set <key>' | 'remove <key>', in order. */
  writes: string[] = [];
  /** The write (setItem or removeItem) with this 1-based index since reset throws. */
  failAt: number | null = null;
  getThrows: string | RegExp | null = null;

  /** Clears `writes` and the write count. */
  reset(): void {
    this.writes = [];
  }

  override getItem(key: string): string | null {
    const g = this.getThrows;
    if (g !== null && (typeof g === 'string' ? key === g : g.test(key))) {
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
