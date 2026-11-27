import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { newId } from '$lib/ids/base58';
import { PLAN_KEY } from '$lib/sharing/storage';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { SIM_KEY } from '$lib/sim-page/sim-doc';
import { SIM_KEY4 } from '$lib/timeline/sim-doc4';
import { POLICY_KEYS, ROUNDS } from './catalogue/rounds';
import { OPEN_LIMITS, limitsOf } from './limits';
import { fitState, takeWin } from './rounds';
import { parseGameState, type GameSave, type SaveEntry } from './save-shape';
import { MAX_SAVES, SAVES_KEY, saveKey } from './saves';
import { NEW_GAME, type GameState } from './state';
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

const WON_AT = '2026-11-01T10:00:00.000Z';

function save(over: Partial<GameSave> = {}): GameSave {
  return {
    v: 2,
    id: newId(),
    name: 'Saved',
    nameIsDefault: false,
    state: { ...structuredClone(NEW_GAME), phase: 'runs', firstWinAt: WON_AT },
    plan: null,
    policy: null,
    savedAt: '2026-10-01T00:00:00.000Z',
    ...over
  };
}

const withState = (over: Partial<GameState>) => save({ state: { ...save().state, ...over } });
/** A save in the opening with nothing done. */
const fresh = (over: Partial<GameSave> = {}) => save({ state: structuredClone(NEW_GAME), ...over });

function entryOf(s: GameSave): SaveEntry {
  return {
    id: s.id,
    name: s.name,
    nameIsDefault: s.nameIsDefault,
    savedAt: s.savedAt,
    phase: s.state.phase,
    round: s.state.round,
    finished: s.state.finished
  };
}

/** Puts values in without logging them. */
function seed(s: LogStorage, values: Record<string, string>): void {
  for (const [k, v] of Object.entries(values)) s.map.set(k, v);
}

/** A valid index naming `current`, with each save stored under its key. */
function seedGames(s: LogStorage, saves: GameSave[], current: string): void {
  for (const g of saves) s.map.set(saveKey(g.id), JSON.stringify(g));
  s.map.set(SAVES_KEY, JSON.stringify({ v: 2, current, saves: saves.map(entryOf) }));
}

const v1Text = (id: string) =>
  JSON.stringify({
    v: 1,
    id,
    name: 'Old',
    nameIsDefault: false,
    progress: { v: 1, level: 3, banked: {}, firstWinAt: null },
    plan: null,
    policy: null,
    savedAt: '2026-10-01T00:00:00.000Z'
  });
const v1Entry = (id: string) => ({
  id,
  name: 'Old',
  nameIsDefault: false,
  savedAt: '2026-10-01T00:00:00.000Z',
  level: 3
});
const corruptKeys = (s: LogStorage) =>
  [...s.map.keys()].filter((k) => k.startsWith('sfhousing:save:corrupt:'));

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe('GameStore construction', () => {
  it('the record key literals match the codecs', () => {
    expect(PLAN_KEY).toBe('sfhousing:plan:v1');
    expect(SIM_KEY4).toBe('sfhousing:sim:v2');
    expect(SIM_KEY).toBe('sfhousing:sim:v1');
  });

  it('empty storage makes one new game and writes the save, then the index', () => {
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
      phase: 'opening',
      round: 0,
      finished: false
    });
    expect(store.state).toEqual(NEW_GAME);
    expect(store.state).not.toBe(NEW_GAME);
    expect(store.state.editable).not.toBe(NEW_GAME.editable);
    expect(s.writes).toEqual(['set sfhousing:save:' + id, 'set sfhousing:saves:v1']);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: id, saves: [entry] });
    expect(stored(s, saveKey(id))).toEqual({
      v: 2,
      id,
      name: 'Game, 22 Nov',
      nameIsDefault: true,
      state: NEW_GAME,
      plan: null,
      policy: null,
      savedAt: clock.toISOString()
    });
    expect(store.open).toBe(false);
    expect(store.limits).toEqual(limitsOf(NEW_GAME));
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
    expect(store.saves[0].phase).toBe('opening');
    expect(store.saves[0].round).toBe(0);
    expect(store.saves[0].name).toBe('Game, 22 Nov');
    expect(store.state).toEqual(NEW_GAME);
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
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: a.id, saves: [entryOf(a)] });
  });

  /** Memory mode with one fresh new game, nothing read into it. */
  function expectFresh(store: GameStore): void {
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0].name).toBe('Game, 22 Nov');
    expect(store.saves[0].phase).toBe('opening');
    expect(store.state).toEqual(NEW_GAME);
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
    expect(store.state).toEqual(NEW_GAME);
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
    const b = fresh({ name: 'Game, 22 Nov (2)' });
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
    const made = store.saves.find((e) => e.id === store.currentId) as SaveEntry;
    expect(made.id).not.toBe(a.id);
    expect(made.id).not.toBe(b.id);
    expect(made.phase).toBe('opening');
    expect(made.name).toBe('Game, 22 Nov (3)');
    expect(store.state).toEqual(NEW_GAME);
    const index = stored(s, SAVES_KEY);
    expect(index.current).toBe(made.id);
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
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: a.id, saves: [entryOf(a)] });
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
    expect(store.state).toEqual(NEW_GAME);
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
      JSON.stringify({ v: 2, current: a.id, saves: [{ ...entryOf(a), name: 'Old' }] })
    );
    const { store } = make(s);
    expect(store.saves[0].name).toBe('New');
    expect(s.writes).toEqual(['set ' + SAVES_KEY]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: a.id, saves: [entryOf(a)] });
  });

  it('a valid, consistent index writes nothing', () => {
    const s = new LogStorage();
    const a = withState({ round: 2 });
    const b = fresh();
    seedGames(s, [a, b], a.id);
    const { store } = make(s);
    expect(s.writes).toEqual([]);
    expect(store.currentId).toBe(a.id);
    expect(store.state).toEqual(a.state);
    expect(store.limits).toEqual(limitsOf(a.state));
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
    expect(store.state).toEqual(NEW_GAME);
    expect(store.saves.map((e) => e.id).sort(byId)).toEqual([id, a.id].sort(byId));
    expect(store.read(id)?.plan).toBe(PLAN);
  });
});

describe('five-level records (P15)', () => {
  it('a v1 index and v1 saves: keys removed unread, no corrupt key, one new game', () => {
    const s = new LogStorage();
    const a = newId();
    const b = newId();
    seed(s, {
      [PLAN_RECORD]: PLAN,
      [POLICY_RECORD]: POLICY,
      [saveKey(a)]: v1Text(a),
      [saveKey(b)]: v1Text(b),
      [SAVES_KEY]: JSON.stringify({ v: 1, current: a, saves: [v1Entry(a), v1Entry(b)] })
    });
    const { store } = make(s);
    expect(s.getItem(saveKey(a))).toBeNull();
    expect(s.getItem(saveKey(b))).toBeNull();
    expect(corruptKeys(s)).toEqual([]);
    expect(store.saves).toHaveLength(1);
    expect(store.state).toEqual(NEW_GAME);
    expect(stored(s, saveKey(store.currentId))).toMatchObject({ v: 2, plan: PLAN, policy: POLICY });
    expect(stored(s, SAVES_KEY)).toMatchObject({ v: 2, current: store.currentId });
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(s.getItem(POLICY_RECORD)).toBe(POLICY);
  });

  it('a v2 index whose entry save is v1: that key removed, not moved aside; others stay', () => {
    const s = new LogStorage();
    const keep = save();
    const oldId = newId();
    seedGames(s, [keep], keep.id);
    seed(s, {
      [saveKey(oldId)]: v1Text(oldId),
      [SAVES_KEY]: JSON.stringify({
        v: 2,
        current: keep.id,
        saves: [entryOf(keep), { ...entryOf(keep), id: oldId, name: 'Old' }]
      })
    });
    const { store } = make(s);
    expect(s.writes).toContain(`remove ${saveKey(oldId)}`);
    expect(corruptKeys(s)).toEqual([]);
    expect(store.saves.map((e) => e.id)).toEqual([keep.id]);
    expect(store.currentId).toBe(keep.id);
    expect(s.getItem(saveKey(keep.id))).toBe(JSON.stringify(keep));
  });

  it('a v1 save that was current: a new game from the records is current, the others stay', () => {
    const s = new LogStorage();
    const keep = save();
    const oldId = newId();
    seedGames(s, [keep], keep.id);
    seed(s, {
      [saveKey(oldId)]: v1Text(oldId),
      [SAVES_KEY]: JSON.stringify({
        v: 2,
        current: oldId,
        saves: [entryOf(keep), { ...entryOf(keep), id: oldId, name: 'Old' }]
      })
    });
    const { store } = make(s);
    expect(store.currentId).not.toBe(oldId);
    expect(store.currentId).not.toBe(keep.id);
    expect(store.saves.map((e) => e.id).sort(byId)).toEqual([keep.id, store.currentId].sort(byId));
    expect(corruptKeys(s)).toEqual([]);
    expect(s.getItem(saveKey(oldId))).toBeNull();
  });

  it('a save neither v1 nor valid still goes to a corrupt key', () => {
    const s = new LogStorage();
    const keep = save();
    const badId = newId();
    const raw = '{"v":2,"id":"nope"}';
    seedGames(s, [keep], keep.id);
    seed(s, {
      [saveKey(badId)]: raw,
      [SAVES_KEY]: JSON.stringify({
        v: 2,
        current: keep.id,
        saves: [entryOf(keep), { ...entryOf(save()), id: badId }]
      })
    });
    make(s);
    expect(s.getItem(corrupt())).toBe(raw);
    expect(s.getItem(saveKey(badId))).toBeNull();
  });
});

describe('parseIndex v2', () => {
  it.each([
    ['a bad phase', { phase: 'won' }],
    ['a negative round', { round: -1 }],
    ['a fractional round', { round: 1.5 }]
  ])('refuses %s: the index text goes to a corrupt key', (_name, bad) => {
    const s = new LogStorage();
    const g = save();
    const indexText = JSON.stringify({
      v: 2,
      current: g.id,
      saves: [{ ...entryOf(g), ...bad }]
    });
    seed(s, { [saveKey(g.id)]: JSON.stringify(g), [SAVES_KEY]: indexText });
    make(s);
    expect(s.getItem(corrupt())).toBe(indexText);
    expect(stored(s, SAVES_KEY).v).toBe(2);
  });

  it('refuses v 3 like any bad index; v 1 is rebuilt without a corrupt copy', () => {
    const g = save();
    const three = new LogStorage();
    const threeText = JSON.stringify({ v: 3, current: g.id, saves: [entryOf(g)] });
    seed(three, { [saveKey(g.id)]: JSON.stringify(g), [SAVES_KEY]: threeText });
    make(three);
    expect(three.getItem(corrupt())).toBe(threeText);
    expect(stored(three, SAVES_KEY).v).toBe(2);

    const one = new LogStorage();
    const oneText = JSON.stringify({ v: 1, current: g.id, saves: [v1Entry(g.id)] });
    seed(one, { [saveKey(g.id)]: JSON.stringify(g), [SAVES_KEY]: oneText });
    make(one);
    expect(corruptKeys(one)).toEqual([]);
    expect(stored(one, SAVES_KEY).v).toBe(2);
  });

  it('an entry that differs from its save in phase or round is rewritten from the save', () => {
    const s = new LogStorage();
    const g = save();
    seedGames(s, [g], g.id);
    s.map.set(
      SAVES_KEY,
      JSON.stringify({
        v: 2,
        current: g.id,
        saves: [{ ...entryOf(g), phase: 'opening', round: 1 }]
      })
    );
    make(s);
    expect(stored(s, SAVES_KEY).saves[0]).toEqual(entryOf(g));
  });

  it('an index the old build wrote (entries with rung) loads and is rewritten with round', () => {
    const s = new LogStorage();
    const g = withState({ round: 2 });
    seedGames(s, [g], g.id);
    const { round, ...rest } = entryOf(g);
    expect(round).toBe(2);
    const oldIndex = JSON.stringify({ v: 2, current: g.id, saves: [{ ...rest, rung: 1 }] });
    s.map.set(SAVES_KEY, oldIndex);
    const { store } = make(s);
    expect(corruptKeys(s)).toEqual([]);
    expect(store.saves).toEqual([entryOf(g)]);
    expect(stored(s, SAVES_KEY).saves).toEqual([entryOf(g)]);
    expect(stored(s, SAVES_KEY).saves[0]).not.toHaveProperty('rung');
  });

  it("a finished game's entry says so; an index written before `finished` reads it from the save", () => {
    const s = new LogStorage();
    const g = withState({ round: 4, finished: true });
    seedGames(s, [g], g.id);
    const { finished, ...rest } = entryOf(g);
    expect(finished).toBe(true);
    s.map.set(SAVES_KEY, JSON.stringify({ v: 2, current: g.id, saves: [rest] }));
    const { store } = make(s);
    expect(corruptKeys(s)).toEqual([]);
    expect(store.saves).toEqual([entryOf(g)]);
    expect(stored(s, SAVES_KEY).saves).toEqual([entryOf(g)]);
  });

  it('an old index entry with neither round nor rung is refused', () => {
    const s = new LogStorage();
    const g = save();
    seedGames(s, [g], g.id);
    const rest: Record<string, unknown> = { ...entryOf(g) };
    delete rest.round;
    const bad = JSON.stringify({ v: 2, current: g.id, saves: [rest] });
    s.map.set(SAVES_KEY, bad);
    make(s);
    expect(s.getItem(corrupt())).toBe(bad);
  });
});

/** A version 2 save as the old build wrote it, with a run played and rung 0 met. */
function v2Save(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 2,
    id: newId(),
    name: 'Old game',
    nameIsDefault: false,
    state: {
      v: 2,
      phase: 'runs',
      firstWinAt: WON_AT,
      bought: { 'sb423-clock': 1, 'stop-rail': 1 },
      units: { home: 40 },
      rung: 1,
      met: [{ rung: 0, reachedOn: 33000, datasetVersion: 'fixture-0', at: WON_AT }],
      side: {},
      runs: 2,
      last: null
    },
    plan: null,
    policy: '{"schema":4}',
    savedAt: '2026-10-01T00:00:00.000Z',
    ...over
  };
}

describe("the old run's switches", () => {
  it('loading removes sfhousing:run:collect and sfhousing:run:muted', () => {
    const s = new LogStorage();
    const g = save();
    seedGames(s, [g], g.id);
    seed(s, { 'sfhousing:run:collect': 'true', 'sfhousing:run:muted': 'false' });
    make(s);
    expect(s.writes).toEqual(['remove sfhousing:run:collect', 'remove sfhousing:run:muted']);
    expect(s.getItem('sfhousing:run:collect')).toBeNull();
    expect(s.getItem('sfhousing:run:muted')).toBeNull();
  });
});

describe('version 2 saves', () => {
  it('a stored version 2 save loads as version 3 and is never moved aside', () => {
    const s = new LogStorage();
    const old = v2Save();
    const id = old.id as string;
    s.map.set(saveKey(id), JSON.stringify(old));
    s.map.set(
      SAVES_KEY,
      JSON.stringify({
        v: 2,
        current: id,
        saves: [
          {
            id,
            name: 'Old game',
            nameIsDefault: false,
            savedAt: old.savedAt,
            phase: 'runs',
            rung: 1
          }
        ]
      })
    );
    const { store } = make(s);
    expect(corruptKeys(s)).toEqual([]);
    expect(store.currentId).toBe(id);
    expect(store.state).toMatchObject({
      v: 3,
      round: 2,
      editable: ['sb423-clock'],
      own: true
    });
    expect(store.saves[0]).toMatchObject({ id, round: 2 });
    expect(stored(s, SAVES_KEY).saves[0]).toMatchObject({ id, round: 2 });
    expect(s.getItem(saveKey(id))).toBe(JSON.stringify(old));
    store.touched();
    expect(stored(s, saveKey(id)).state.v).toBe(3);
  });

  it('a version 2 save found without an index is recovered as version 3', () => {
    const s = new LogStorage();
    const old = v2Save();
    s.map.set(saveKey(old.id as string), JSON.stringify(old));
    s.map.set(SAVES_KEY, 'not json');
    const { store } = make(s);
    expect(corruptKeys(s)).toEqual([corrupt()]);
    expect(store.read(old.id as string)?.state.v).toBe(3);
  });

  it('adopt upgrades a version 2 save from the account', () => {
    const { store } = over([save()]);
    const old = v2Save();
    expect(store.adopt([old as unknown as GameSave])).toEqual({ ok: true });
    expect(store.read(old.id as string)?.state).toMatchObject({ v: 3, round: 2 });
  });
});

describe('fitting saves to the catalogue', () => {
  const unfit = () =>
    withState({
      editable: ['no-such-key', 'sb423-clock', 'sb423-clock'],
      round: 9
    });

  it('loads fitted; the key keeps the unfitted text until the next touched()', () => {
    const s = new LogStorage();
    const g = unfit();
    seedGames(s, [g], g.id);
    const { store } = make(s);
    expect(store.state).toEqual(fitState(g.state));
    expect(store.state).toMatchObject({ round: ROUNDS, editable: ['sb423-clock'] });
    expect(s.getItem(saveKey(g.id))).toBe(JSON.stringify(g));
    store.touched();
    expect(stored(s, saveKey(g.id)).state).toEqual(fitState(g.state));
  });

  it('keeps savedAt and calls no sync method at construction', () => {
    const s = new LogStorage();
    const g = unfit();
    seedGames(s, [g], g.id);
    const { store, sync } = make(s);
    expect(store.saves[0].savedAt).toBe(g.savedAt);
    expect(sync.calls).toEqual([]);
  });

  it('the index entry carries the fitted round', () => {
    const s = new LogStorage();
    const g = unfit();
    seedGames(s, [g], g.id);
    make(s);
    expect(stored(s, SAVES_KEY).saves[0].round).toBe(ROUNDS);
    expect(s.getItem(saveKey(g.id))).toBe(JSON.stringify(g));
  });

  it('a save that needs no fitting makes no write at construction', () => {
    const s = new LogStorage();
    const g = save();
    seedGames(s, [g], g.id);
    make(s);
    expect(s.writes).toEqual([]);
  });

  it('adopt of a save with a key the catalogue lacks stores and shows the fitted state', () => {
    const a = save();
    const g = unfit();
    const { s, store } = over([a]);
    expect(store.adopt([g])).toEqual({ ok: true });
    expect(stored(s, saveKey(g.id)).state).toEqual(fitState(g.state));
    expect(store.read(g.id)?.state).toEqual(fitState(g.state));
  });

  it('adopt of the current id shows the fitted state', () => {
    const a = save();
    const { store } = over([a]);
    const g = { ...unfit(), id: a.id };
    expect(store.adopt([g])).toEqual({ ok: true });
    expect(store.state).toEqual(fitState(g.state));
    expect(store.saves[0].round).toBe(ROUNDS);
  });

  it('adopt skips a v1 save', () => {
    const { store } = over([save()]);
    expect(store.adopt([JSON.parse(v1Text(newId())) as GameSave])).toEqual({ ok: true });
    expect(store.saves).toHaveLength(1);
  });
});

describe('GameStore.read', () => {
  it('read', () => {
    const s = new LogStorage();
    const a = save({ plan: 'old plan', policy: 'old policy' });
    const b = fresh({ plan: 'b plan' });
    seedGames(s, [a, b], a.id);
    seed(s, { [PLAN_RECORD]: PLAN, [POLICY_RECORD]: POLICY });
    const { store } = make(s);

    expect(store.read(newId())).toBeNull();

    const other = store.read(b.id) as GameSave;
    expect(other).toEqual(b);
    other.name = 'changed';
    other.state.round = 3;
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

describe('what the store shows', () => {
  it('state is the current save state; limits is limitsOf(state)', () => {
    const g = withState({ round: 2, editable: ['sb423-clock'] });
    const { store } = over([g]);
    expect(store.state).toEqual(g.state);
    expect(store.limits).toEqual(limitsOf(g.state));
  });

  it('has no five-level member', () => {
    const { store } = make(null);
    const members = store as unknown as Record<string, unknown>;
    for (const name of ['progress', 'allowed', 'offer', 'setOffer', 'levelUp', 'remix']) {
      expect(members[name]).toBeUndefined();
    }
    // @ts-expect-error removed (G7)
    expect(store.progress).toBeUndefined();
    // @ts-expect-error removed (G7)
    expect(store.levelUp).toBeUndefined();
  });
});

describe('the open game and its context', () => {
  it('openGame: the last round, finished, every key editable, own', () => {
    const store = openGame();
    expect(store.state).toEqual({
      ...NEW_GAME,
      phase: 'runs',
      firstWinAt: '1970-01-01T00:00:00.000Z',
      round: ROUNDS,
      finished: true,
      editable: [...POLICY_KEYS],
      own: true
    });
    expect(parseGameState(JSON.parse(JSON.stringify(store.state)))).toEqual(store.state);
    expect(store.limits).toBe(OPEN_LIMITS);
    expect(store.open).toBe(true);
    expect(store.sync.state).toBe('local');
    expect(store.sync.account).toBeNull();
    expect(store.saves).toHaveLength(1);
    expect(store.saves[0].name).toBe('Game');
    expect(store.saves[0]).toMatchObject({ phase: 'runs', round: ROUNDS });
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

/** The current game's entry in `saves`: its played time (PLAN's, by default) as `savedAt`. */
const playing = (e: SaveEntry, at = PLAN_TIME): SaveEntry => ({ ...e, savedAt: at });

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

describe('GameStore.won and touched', () => {
  it('won sets firstWinAt once, writes, and calls changed once', () => {
    const g = withState({ phase: 'opening', firstWinAt: null });
    const { s, store, sync } = over([g]);
    store.won();
    expect(store.state.firstWinAt).toBe(clock.toISOString());
    expect(s.writes).toEqual(['set ' + saveKey(g.id), 'set ' + SAVES_KEY]);
    expect(stored(s, saveKey(g.id))).toEqual({
      ...g,
      state: { ...g.state, firstWinAt: NOW },
      plan: PLAN,
      policy: POLICY,
      savedAt: NOW
    });
    expect(stored(s, saveKey(g.id)).state.firstWinAt).toBe(clock.toISOString());
    const entry = { ...entryOf(g), savedAt: NOW };
    expect(store.saves).toEqual([playing(entry)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: g.id, saves: [entry] });
    expect(sync.calls).toEqual([{ kind: 'changed', id: g.id }]);
    s.reset();
    store.won();
    expect(s.writes).toEqual([]);
    expect(sync.calls).toHaveLength(1);
  });

  it('a refused write leaves firstWinAt null and calls nothing', () => {
    const g = withState({ phase: 'opening', firstWinAt: null });
    const { s, store, sync } = over([g]);
    const before = [...s.map.entries()];
    s.failAt = 1;
    store.won();
    expect(store.state.firstWinAt).toBeNull();
    expect(sync.calls).toEqual([]);
    expect([...s.map.entries()]).toEqual(before);
    s.failAt = null;
    s.reset();
    store.won();
    expect(store.state.firstWinAt).toBe(NOW);
    expect(sync.calls).toEqual([{ kind: 'changed', id: g.id }]);
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
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: g.id, saves: store.saves });
    expect(store.currentId).toBe(g.id);
    expect(store.state).toEqual(g.state);
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
      v: 2,
      id,
      name: 'Game, 22 Nov (2)',
      nameIsDefault: true,
      state: NEW_GAME,
      plan: null,
      policy: null,
      savedAt: NOW
    };
    expect(stored(s, saveKey(g.id))).toEqual(old);
    expect(stored(s, saveKey(id))).toEqual(made);
    expect(s.getItem(PLAN_RECORD)).toBeNull();
    expect(s.getItem(POLICY_RECORD)).toBeNull();
    expect(store.state).toEqual(NEW_GAME);
    expect(store.state).not.toBe(NEW_GAME);
    expect(store.limits).toEqual(limitsOf(NEW_GAME));
    expect(store.saves).toEqual([entryOf(old), entryOf(made)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: id, saves: store.saves });
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
      state: { ...save().state, round: 2 },
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
    expect(store.state).toEqual(b.state);
    expect(store.saves).toEqual([entryOf(old), entryOf(b)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: b.id, saves: store.saves });
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
      const state = store.state;
      s.failAt = failAt;
      s.failWrites = failWrites;
      const answer = change === 'newGame' ? store.newGame() : store.switchTo(b.id);
      expect(answer).toEqual({ ok: false, reason: 'storage' });
      expect(s.map).toEqual(before);
      expect(store.currentId).toBe(a.id);
      expect(store.saves).toBe(saves);
      expect(store.state).toBe(state);
      expect(sync.calls).toEqual([]);
    }
  });

  it('a write refused after the v1 copy was written puts the keys back and removes the copy', () => {
    const a = save();
    const { s, store, sync } = over([a], { [PLAN_RECORD]: PLAN, [OLD_POLICY]: 'v1 text' });
    const before = new Map(s.map);
    const saves = store.saves;
    const state = store.state;
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
    expect(store.state).toBe(state);
    expect(sync.calls).toEqual([]);
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
      v: 2,
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
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: a.id, saves: [entryOf(a)] });
    expect(store.currentId).toBe(a.id);
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(sync.calls).toEqual([{ kind: 'removed', id: b.id }]);
  });

  it('remove the current game with others', () => {
    const a = save();
    const b = save({ savedAt: '2026-10-05T00:00:00.000Z' });
    const c = save({
      plan: 'c plan',
      state: { ...save().state, round: 3 },
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
    expect(store.state).toEqual(c.state);
    expect(store.saves).toEqual([entryOf(c), entryOf(b)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: c.id, saves: store.saves });
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
      v: 2,
      id,
      name: 'Game, 22 Nov',
      nameIsDefault: true,
      state: NEW_GAME,
      plan: null,
      policy: null,
      savedAt: NOW
    };
    expect(stored(s, saveKey(id))).toEqual(made);
    expect(store.saves).toEqual([entryOf(made)]);
    expect(stored(s, SAVES_KEY)).toEqual({ v: 2, current: id, saves: store.saves });
    expect(store.state).toEqual(NEW_GAME);
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

describe('GameStore.beforeLeave', () => {
  /** The page's autosave flush: an edit still waiting reaches the plan record. */
  const EDIT = '{"v":1,"savedAt":"2026-12-02T00:00:00.000Z","plan":"edited"}';
  const EDIT_TIME = '2026-12-02T00:00:00.000Z';

  /** Registers a flush that writes EDIT and notes how many writes the store had made by then. */
  function flushing(s: LogStorage, store: GameStore): { seen: number[] } {
    const seen: number[] = [];
    store.beforeLeave(() => {
      seen.push(s.writes.length);
      s.setItem(PLAN_RECORD, EDIT);
    });
    return { seen };
  }

  const leaving = ['newGame', 'switchTo'] as const;

  it.each(leaving)(
    '%s runs the flush first and copies its edit out with the old game',
    (change) => {
      const a = save();
      const b = save({ plan: 'b plan', savedAt: '2026-10-05T00:00:00.000Z' });
      const { s, store } = over([a, b]);
      const { seen } = flushing(s, store);
      const answer = change === 'newGame' ? store.newGame() : store.switchTo(b.id);
      expect(answer).toEqual({ ok: true });
      expect(seen).toEqual([0]);
      expect(s.writes[0]).toBe('set ' + PLAN_RECORD);
      expect(s.writes[1]).toBe('set ' + saveKey(a.id));
      expect(stored(s, saveKey(a.id))).toEqual({
        ...a,
        plan: EDIT,
        policy: POLICY,
        savedAt: EDIT_TIME
      });
      expect(store.currentId).not.toBe(a.id);
    }
  );

  it('remove of the current game runs the flush before its writes', () => {
    const a = save();
    const b = save({ plan: 'b plan', savedAt: '2026-10-05T00:00:00.000Z' });
    const { s, store, sync } = over([a, b]);
    const { seen } = flushing(s, store);
    expect(store.remove(a.id)).toEqual({ ok: true });
    expect(seen).toEqual([0]);
    expect(s.writes).toEqual([
      'set ' + PLAN_RECORD,
      'remove ' + saveKey(a.id),
      'set ' + PLAN_RECORD,
      'remove ' + POLICY_RECORD,
      'set ' + SAVES_KEY
    ]);
    expect(s.getItem(PLAN_RECORD)).toBe('b plan');
    expect(store.currentId).toBe(b.id);
    expect(sync.calls).toEqual([{ kind: 'removed', id: a.id }]);
  });

  it('a flush that calls touched() is stored before the change goes ahead', () => {
    const a = save();
    const b = save();
    const { s, store, sync } = over([a, b]);
    store.beforeLeave(() => {
      s.setItem(PLAN_RECORD, EDIT);
      store.touched();
    });
    expect(store.switchTo(b.id)).toEqual({ ok: true });
    expect(stored(s, saveKey(a.id)).plan).toBe(EDIT);
    expect(store.currentId).toBe(b.id);
    expect(sync.calls).toEqual([
      { kind: 'changed', id: a.id },
      { kind: 'changed', id: a.id }
    ]);
  });

  it('runs every function in the order added; one that throws is skipped', () => {
    const a = save();
    const { s, store } = over([a, save()]);
    const order: string[] = [];
    store.beforeLeave(() => order.push('one'));
    store.beforeLeave(() => {
      order.push('two');
      throw new Error('flush failed');
    });
    store.beforeLeave(() => order.push('three'));
    expect(store.newGame()).toEqual({ ok: true });
    expect(order).toEqual(['one', 'two', 'three']);
    expect(store.currentId).not.toBe(a.id);
    expect(stored(s, SAVES_KEY).current).toBe(store.currentId);
  });

  it('a remover takes out only its own function, and twice does nothing more', () => {
    const { store } = over([save(), save()]);
    const order: string[] = [];
    const fn = () => order.push('shared');
    const offOne = store.beforeLeave(() => order.push('one'));
    const offFirst = store.beforeLeave(fn);
    store.beforeLeave(fn);
    store.beforeLeave(() => order.push('last'));
    offOne();
    offFirst();
    offOne();
    offFirst();
    expect(store.newGame()).toEqual({ ok: true });
    expect(order).toEqual(['shared', 'last']);
  });

  it('a change that refuses before its writes calls none', () => {
    const calls: string[] = [];
    const watch = (store: GameStore) => store.beforeLeave(() => calls.push('flush'));

    const full = over(many(MAX_SAVES));
    watch(full.store);
    expect(full.store.newGame()).toEqual({ ok: false, reason: 'full' });

    const a = save();
    const b = save();
    const two = over([a, b]);
    watch(two.store);
    expect(two.store.switchTo(newId())).toEqual({ ok: false, reason: 'storage' });
    expect(two.store.switchTo(a.id)).toEqual({ ok: true });
    expect(two.store.remove(b.id)).toEqual({ ok: true });
    expect(two.store.remove(newId())).toEqual({ ok: true });
    expect(two.store.currentId).toBe(a.id);

    for (const store of [make(null).store, openGame()]) {
      watch(store);
      expect(store.newGame()).toEqual({ ok: false, reason: 'storage' });
      expect(store.switchTo(newId())).toEqual({ ok: false, reason: 'storage' });
      expect(store.remove(store.currentId)).toEqual({ ok: false, reason: 'storage' });
    }
    expect(calls).toEqual([]);
  });

  it('no other change calls the list', () => {
    const a = save();
    const b = save();
    const { store } = over([a, b]);
    const calls: string[] = [];
    store.beforeLeave(() => calls.push('flush'));
    store.won();
    store.touched();
    store.rename(b.id, 'Other');
    store.rename(a.id, 'Mine');
    expect(store.adopt([{ ...b, name: 'Adopted' }])).toEqual({ ok: true });
    expect(store.rekey(b.id, newId())).toEqual({ ok: true });
    expect(store.rekey(a.id, newId())).toEqual({ ok: true });
    expect(store.read(store.currentId)).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it.each([...leaving, 'remove'] as const)(
    'after %s answers ok, touched() writes nothing and calls no sync',
    (change) => {
      const a = save();
      const b = save();
      const { s, store, sync } = over([a, b]);
      store.touched();
      expect(s.writes).toEqual(['set ' + saveKey(a.id), 'set ' + SAVES_KEY]);
      const answer =
        change === 'newGame'
          ? store.newGame()
          : change === 'switchTo'
            ? store.switchTo(b.id)
            : store.remove(a.id);
      expect(answer).toEqual({ ok: true });
      const writes = [...s.writes];
      const calls = [...sync.calls];
      const saves = store.saves;
      store.touched();
      store.touched();
      expect(s.writes).toEqual(writes);
      expect(sync.calls).toEqual(calls);
      expect(store.saves).toBe(saves);
    }
  );

  it('a refused change does not stop touched()', () => {
    const a = save();
    const b = save();
    const { s, store, sync } = over([a, b]);
    expect(store.switchTo(newId())).toEqual({ ok: false, reason: 'storage' });
    expect(store.switchTo(a.id)).toEqual({ ok: true });
    expect(store.remove(b.id)).toEqual({ ok: true });
    s.reset();
    s.failAt = 2;
    expect(store.newGame()).toEqual({ ok: false, reason: 'storage' });
    s.failAt = null;
    s.reset();
    sync.calls.length = 0;
    store.touched();
    expect(s.writes).toEqual(['set ' + saveKey(a.id), 'set ' + SAVES_KEY]);
    expect(sync.calls).toEqual([{ kind: 'changed', id: a.id }]);

    const full = over(many(MAX_SAVES));
    expect(full.store.newGame()).toEqual({ ok: false, reason: 'full' });
    full.store.touched();
    expect(full.s.writes).toHaveLength(2);
    expect(full.sync.calls).toEqual([{ kind: 'changed', id: full.store.currentId }]);
  });
});

describe('GameStore.adopt and rekey', () => {
  it('full at 12', () => {
    const games = many(MAX_SAVES);
    const { s, store, sync } = over(games);
    const saves = store.saves;
    const state = store.state;
    expect(store.newGame()).toEqual({ ok: false, reason: 'full' });
    expect(store.adopt([save()])).toEqual({ ok: false, reason: 'full' });
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
    expect(store.saves).toBe(saves);
    expect(store.state).toBe(state);
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
      state: { ...b.state, round: 2 },
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
      v: 2,
      current: a.id,
      saves: [entryOf(a), entryOf(b2), entryOf(c)]
    });
    expect(store.currentId).toBe(a.id);
    expect(store.state).toEqual(a.state);
    expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
    expect(s.getItem(POLICY_RECORD)).toBe(POLICY);
    expect(sync.calls).toEqual([]);
  });

  it('adopt of the current id replaces state and writes its records', () => {
    const a = save();
    const { s, store, sync } = over([a], { ...RECORDS, [OLD_POLICY]: 'v1 text' });
    const a2 = { ...a, state: { ...a.state, round: 2 }, plan: 'acct plan', policy: 'acct policy' };
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
    expect(store.state).toEqual(a2.state);
    expect(store.limits).toEqual(limitsOf(a2.state));
    expect(store.saves).toEqual([entryOf(a2)]);
    expect(sync.calls).toEqual([]);
  });

  describe('adopting the current game and beforeLeave', () => {
    const LATER = '{"v":1,"savedAt":"2026-12-02T00:00:00.000Z","policy":"edited"}';

    it('runs the list in order before any record key is written', () => {
      const a = save();
      const { s, store } = over([a]);
      const order: string[] = [];
      const seen: (string | null)[] = [];
      let writesSeen: string[] = [];
      store.beforeLeave(() => {
        order.push('one');
        seen.push(s.getItem(PLAN_RECORD), s.getItem(POLICY_RECORD));
        writesSeen = [...s.writes];
      });
      store.beforeLeave(() => {
        order.push('two');
        throw new Error('flush failed');
      });
      store.beforeLeave(() => order.push('three'));
      const a2 = { ...a, plan: 'acct plan', policy: 'acct policy' };
      expect(store.adopt([a2])).toEqual({ ok: true });
      expect(order).toEqual(['one', 'two', 'three']);
      expect(seen).toEqual([PLAN, POLICY]);
      expect(writesSeen).toEqual([]);
      expect(s.getItem(PLAN_RECORD)).toBe('acct plan');
    });

    it('answers changed when a function wrote a record key, and changes nothing more', () => {
      const a = save();
      const { s, store, sync } = over([a]);
      store.beforeLeave(() => s.setItem(POLICY_RECORD, LATER));
      const state = store.state;
      const saves = store.saves;
      const a2 = {
        ...a,
        state: { ...a.state, round: 2 },
        plan: 'acct plan',
        policy: 'acct policy'
      };
      expect(store.adopt([a2])).toEqual({ ok: false, reason: 'changed' });
      expect(s.writes).toEqual(['set ' + POLICY_RECORD]);
      expect(s.getItem(POLICY_RECORD)).toBe(LATER);
      expect(s.getItem(PLAN_RECORD)).toBe(PLAN);
      expect(stored(s, saveKey(a.id))).toEqual(a);
      expect(store.state).toBe(state);
      expect(store.saves).toBe(saves);
      expect(sync.calls).toEqual([]);
    });

    it('touched() still writes after adopt answers changed', () => {
      const a = save();
      const { s, store, sync } = over([a]);
      store.beforeLeave(() => s.setItem(POLICY_RECORD, LATER));
      expect(store.adopt([{ ...a, plan: 'acct plan' }])).toEqual({
        ok: false,
        reason: 'changed'
      });
      s.reset();
      store.touched();
      expect(s.writes).toEqual(['set ' + saveKey(a.id), 'set ' + SAVES_KEY]);
      expect(sync.calls).toEqual([{ kind: 'changed', id: a.id }]);
    });

    it('answers ok when nothing was written, then touched() does nothing', () => {
      const a = save();
      const { s, store, sync } = over([a]);
      const calls: string[] = [];
      store.beforeLeave(() => calls.push('flush'));
      const a2 = {
        ...a,
        state: { ...a.state, round: 2 },
        plan: 'acct plan',
        policy: 'acct policy'
      };
      expect(store.adopt([a2])).toEqual({ ok: true });
      expect(calls).toEqual(['flush']);
      expect(s.getItem(PLAN_RECORD)).toBe('acct plan');
      const writes = [...s.writes];
      store.touched();
      store.touched();
      expect(s.writes).toEqual(writes);
      expect(sync.calls).toEqual([]);
    });

    it('saves without the current id call no function', () => {
      const a = save();
      const b = save();
      const { store } = over([a]);
      const calls: string[] = [];
      store.beforeLeave(() => calls.push('flush'));
      expect(store.adopt([b])).toEqual({ ok: true });
      expect(calls).toEqual([]);
    });

    it('a refused adopt calls no function', () => {
      const a = save();
      const calls: string[] = [];
      const full = over(many(MAX_SAVES));
      full.store.beforeLeave(() => calls.push('flush'));
      expect(full.store.adopt([save()])).toEqual({ ok: false, reason: 'full' });
      const mem = make(null).store;
      mem.beforeLeave(() => calls.push('flush'));
      expect(mem.adopt([a])).toEqual({ ok: false, reason: 'storage' });
      expect(calls).toEqual([]);
    });
  });

  it('adopt of the current id removes sfhousing:sim:v1, copying it aside when v2 was absent', () => {
    const a = save();
    const { s, store, sync } = over([a], { [PLAN_RECORD]: PLAN, [OLD_POLICY]: 'v1 text' });
    const a2 = { ...a, state: { ...a.state, round: 2 }, plan: 'acct plan', policy: 'acct policy' };
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
      v: 2,
      current: a.id,
      saves: [entryOf(a), { ...entryOf(b), id: n }, entryOf(c)]
    });
    expect(store.currentId).toBe(a.id);
    expect(sync.calls).toEqual([]);
  });

  it('rekey the current game', () => {
    const a = save();
    const { s, store, sync } = over([a, save()]);
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
    expect(store.state).toEqual(a.state);
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
  it('memory mode refuses five changes', () => {
    const { store, sync } = make(null);
    const id = store.currentId;
    const refused = { ok: false, reason: 'storage' };
    expect(store.newGame()).toEqual(refused);
    expect(store.switchTo(newId())).toEqual(refused);
    expect(store.rekey(id, newId())).toEqual(refused);
    expect(store.remove(id)).toEqual(refused);
    expect(store.adopt([save()])).toEqual(refused);
    expect(store.currentId).toBe(id);
    expect(store.saves).toHaveLength(1);
    expect(sync.calls).toEqual([]);

    store.won();
    expect(store.state.firstWinAt).toBe(NOW);
    store.touched();
    store.rename(id, 'Mine');
    expect(store.saves[0].name).toBe('Mine');
    expect(store.read(id)?.name).toBe('Mine');
    expect(sync.calls).toEqual([
      { kind: 'changed', id },
      { kind: 'changed', id },
      { kind: 'changed', id }
    ]);
  });

  it('the open game refuses the five changes', () => {
    const store = openGame();
    const id = store.currentId;
    const refused = { ok: false, reason: 'storage' };
    expect(store.newGame()).toEqual(refused);
    expect(store.switchTo(newId())).toEqual(refused);
    expect(store.rekey(id, newId())).toEqual(refused);
    expect(store.remove(id)).toEqual(refused);
    expect(store.adopt([save()])).toEqual(refused);
    expect(store.limits).toBe(OPEN_LIMITS);
  });
});

const WIN = {
  goalMonth: 33000,
  on: new Set(['transit-rail']),
  datasetVersion: 'fixture-0'
};

describe('GameStore.startRuns', () => {
  it('answers storage and writes nothing while firstWinAt is null', () => {
    const g = withState({ phase: 'opening', firstWinAt: null });
    const { s, store, sync } = over([g]);
    expect(store.startRuns()).toEqual({ ok: false, reason: 'storage' });
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
  });

  it('after a win sets phase runs, writes the save and index, and calls changed', () => {
    const g = withState({ phase: 'opening', firstWinAt: WON_AT });
    const { s, store, sync } = over([g]);
    expect(store.startRuns()).toEqual({ ok: true });
    expect(store.state.phase).toBe('runs');
    expect(stored(s, saveKey(g.id)).state.phase).toBe('runs');
    expect(stored(s, SAVES_KEY).saves[0].phase).toBe('runs');
    expect(sync.calls).toEqual([{ kind: 'changed', id: g.id }]);
  });

  it('already in runs: ok with no write', () => {
    const g = withState({ phase: 'runs', firstWinAt: WON_AT });
    const { s, store, sync } = over([g]);
    expect(store.startRuns()).toEqual({ ok: true });
    expect(s.writes).toEqual([]);
    expect(sync.calls).toEqual([]);
  });

  it('a refused write answers storage with memory unchanged', () => {
    const g = withState({ phase: 'opening', firstWinAt: WON_AT });
    const { s, store, sync } = over([g]);
    s.failAt = 1;
    expect(store.startRuns()).toEqual({ ok: false, reason: 'storage' });
    expect(store.state.phase).toBe('opening');
    expect(sync.calls).toEqual([]);
  });
});

describe('GameStore.takeWin', () => {
  it('writes takeWin of rounds.ts, calls changed, leaves the records', () => {
    const g = withState({ round: 1 });
    const { s, store, sync } = over([g]);
    expect(store.takeWin(WIN)).toEqual({ ok: true });
    const want = takeWin(g.state, { ...WIN, at: NOW });
    expect(store.state).toEqual(want);
    expect(store.state).toMatchObject({ round: 2, target: 33000, editable: ['transit-rail'] });
    expect(stored(s, saveKey(g.id)).state).toEqual(want);
    expect(stored(s, SAVES_KEY).saves[0].round).toBe(2);
    expect(s.writes.filter((w) => w.endsWith(PLAN_RECORD) || w.endsWith(POLICY_RECORD))).toEqual(
      []
    );
    expect(sync.calls).toEqual([{ kind: 'changed', id: g.id }]);
  });

  it('a refused write answers storage with memory unchanged', () => {
    const g = withState({ round: 1 });
    const { s, store, sync } = over([g]);
    s.failAt = 1;
    expect(store.takeWin(WIN)).toEqual({ ok: false, reason: 'storage' });
    expect(store.state).toEqual(g.state);
    expect(sync.calls).toEqual([]);
  });

  it('a refused index write puts the save key back', () => {
    const g = withState({ round: 1 });
    const { s, store } = over([g]);
    const before = s.getItem(saveKey(g.id));
    s.failAt = 2;
    expect(store.takeWin(WIN)).toEqual({ ok: false, reason: 'storage' });
    expect(s.getItem(saveKey(g.id))).toBe(before);
    expect(store.state).toEqual(g.state);
  });

  it('has no tree member', () => {
    const { store } = make(null);
    const members = store as unknown as Record<string, unknown>;
    for (const name of ['buy', 'settle', 'takeNext']) expect(members[name]).toBeUndefined();
  });
});

describe('the open game writes nothing', () => {
  it('its writing methods change nothing and call no sync method', () => {
    const store = openGame();
    const before = store.state;
    const changed = vi.spyOn(store.sync, 'changed');
    store.won();
    store.touched();
    store.rename(store.currentId, 'Mine');
    expect(store.startRuns()).toEqual({ ok: true });
    expect(store.takeWin(WIN)).toEqual({ ok: true });
    expect(store.state).toBe(before);
    expect(store.saves[0].name).toBe('Game');
    expect(changed).not.toHaveBeenCalled();
    const refused = { ok: false, reason: 'storage' };
    for (const r of [
      store.newGame(),
      store.remove(store.currentId),
      store.adopt([save()]),
      store.rekey(store.currentId, newId())
    ]) {
      expect(r).toEqual(refused);
    }
  });
});
