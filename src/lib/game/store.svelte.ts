import { getContext, setContext } from 'svelte';
import { isValidId, newId } from '$lib/ids/base58';
import { NODES } from './catalogue/nodes';
import { RUNGS, fitGame, takeNext as nextRung } from './ladder';
import { OPEN_LIMITS, limitsOf, type Limits } from './limits';
import { settle as settleRun, type RunResult } from './run-result';
import { parseGameSave, type GameSave, type SaveEntry } from './save-shape';
import { MAX_SAVES, SAVES_KEY, SAVE_NAME_MAX, saveKey } from './saves';
import { NEW_GAME, type GameState, type NodeId } from './state';
import { buy as buyNode, type Bought } from './tree';
import { defaultSaveName } from './words';
import type { SaveSync } from './save-sync.svelte';

export type StoreChange = { ok: true } | { ok: false; reason: 'full' | 'storage' | 'changed' };

/** The plan record (`PLAN_KEY` of `$lib/sharing/storage`). */
const PLAN_RECORD = 'sfhousing:plan:v1';
/** The policy record (`SIM_KEY4` of `$lib/timeline/sim-doc4`). */
const POLICY_RECORD = 'sfhousing:sim:v2';
/** The schema 3 policy record (`SIM_KEY` of `$lib/sim-page/sim-doc`), removed when a change writes the records. */
const OLD_POLICY = 'sfhousing:sim:v1';
/** Where a removed `OLD_POLICY` is copied when `POLICY_RECORD` was absent. */
const OLD_POLICY_ASIDE = 'sfhousing:sim:corrupt:';

const SAVE_PREFIX = 'sfhousing:save:';
const CORRUPT_PREFIX = 'sfhousing:save:corrupt:';

type Write = readonly [key: string, value: string | null];
/** The text of the two record keys. A `GameSave` is one: its stored copies. */
type Records = { plan: string | null; policy: string | null };
type Call = readonly [kind: 'changed' | 'removed', id: string];

const EMPTY: ReadonlySet<string> = new Set();
const OK: StoreChange = Object.freeze({ ok: true });
const FULL: StoreChange = Object.freeze({ ok: false, reason: 'full' });
const CHANGED: StoreChange = Object.freeze({ ok: false, reason: 'changed' });
const REFUSED: StoreChange = Object.freeze({ ok: false, reason: 'storage' });

/**
 * Applies `ops` in order (null is `removeItem`). On a throw it puts back every key it had
 * already written, ignoring throws while it does, and answers whether a read (the old value
 * of a key) or a write threw.
 */
function writeAll(storage: Storage, ops: readonly Write[]): 'ok' | 'read' | 'write' {
  const done: (readonly [string, string | null])[] = [];
  let failed: 'read' | 'write' = 'read';
  try {
    for (const [key, value] of ops) {
      failed = 'read';
      const old = storage.getItem(key);
      failed = 'write';
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      done.push([key, old]);
    }
    return 'ok';
  } catch {
    for (const [key, old] of done.reverse()) {
      try {
        if (old === null) storage.removeItem(key);
        else storage.setItem(key, old);
      } catch {
        // Putting back is best effort.
      }
    }
    return failed;
  }
}

/**
 * `prefix + iso`, one millisecond later until neither storage nor `pending` (keys a write
 * sequence will set before it runs) holds the key.
 */
function freeKey(
  storage: Storage,
  prefix: string,
  at: Date,
  pending: ReadonlySet<string> = EMPTY
): string {
  for (let t = at.getTime(); ; t++) {
    const key = prefix + new Date(t).toISOString();
    if (!pending.has(key) && storage.getItem(key) === null) return key;
  }
}

function recordTime(text: string | null): number {
  if (text === null) return -Infinity;
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json !== 'object' || json === null) return -Infinity;
    const savedAt = (json as { savedAt?: unknown }).savedAt;
    if (typeof savedAt !== 'string') return -Infinity;
    const t = Date.parse(savedAt);
    return Number.isFinite(t) ? t : -Infinity;
  } catch {
    return -Infinity;
  }
}

/** The latest of the save's `savedAt` and each record's finite `savedAt`, as that text. */
function playedTime(save: GameSave, plan: string | null, policy: string | null): string {
  let best = save.savedAt;
  let bestT = Date.parse(save.savedAt);
  for (const text of [plan, policy]) {
    const t = recordTime(text);
    if (t > bestT) {
      bestT = t;
      best = new Date(t).toISOString();
    }
  }
  return best;
}

/** The two record keys' text now, each the save's stored copy without storage or when reading throws. */
function recordsOf(records: Storage | null, save: GameSave): Records {
  return {
    plan: readRecord(records, PLAN_RECORD, save.plan),
    policy: readRecord(records, POLICY_RECORD, save.policy)
  };
}

/** The current game "copied out": `recs` copied in, `savedAt` its played time. */
function copiedOut(save: GameSave, recs: Records): GameSave {
  return {
    ...save,
    plan: recs.plan,
    policy: recs.policy,
    savedAt: playedTime(save, recs.plan, recs.policy)
  };
}

/** Trimmed, cut to `SAVE_NAME_MAX` code points, trimmed at the end again. */
function cutName(name: string): string {
  return Array.from(name.trim()).slice(0, SAVE_NAME_MAX).join('').trimEnd();
}

function entryOf(save: GameSave): SaveEntry {
  return {
    id: save.id,
    name: save.name,
    nameIsDefault: save.nameIsDefault,
    savedAt: save.savedAt,
    phase: save.state.phase,
    rung: save.state.rung
  };
}

function sameEntry(a: SaveEntry, b: SaveEntry): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.nameIsDefault === b.nameIsDefault &&
    a.savedAt === b.savedAt &&
    a.phase === b.phase &&
    a.rung === b.rung
  );
}

function isPlain(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** A JSON object whose `v` is 1: a save or an index of the five-level game (P15). */
function isV1(text: string): boolean {
  try {
    const json: unknown = JSON.parse(text);
    return isPlain(json) && json.v === 1;
  } catch {
    return false;
  }
}

/** A save as the store holds it: parsed, then its state fitted to the catalogue (G6). */
function fitted(json: unknown): GameSave | null {
  const save = parseGameSave(json);
  if (save === null) return null;
  const state = fitGame(save.state);
  return state === save.state ? save : { ...save, state };
}

/** The index when valid (§sec-design-store-layout), else null. */
function parseIndex(text: string): { current: string; saves: SaveEntry[] } | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlain(json) || json.v !== 2 || typeof json.current !== 'string') return null;
  if (!Array.isArray(json.saves)) return null;
  const ids = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  const saves: SaveEntry[] = [];
  for (const e of json.saves as unknown[]) {
    if (!isPlain(e)) return null;
    const { id, name, nameIsDefault, savedAt, phase, rung } = e;
    if (typeof id !== 'string' || ids.has(id)) return null;
    if (typeof name !== 'string' || typeof nameIsDefault !== 'boolean') return null;
    if (typeof savedAt !== 'string') return null;
    if (phase !== 'opening' && phase !== 'runs') return null;
    if (typeof rung !== 'number' || !Number.isSafeInteger(rung) || rung < 0) return null;
    ids.add(id);
    saves.push({ id, name, nameIsDefault, savedAt, phase, rung });
  }
  return { current: json.current, saves };
}

function parseSaveText(text: string): GameSave | null {
  try {
    return fitted(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Set while `openGame` constructs its store: the module's private constructor path. */
let opening = false;

const OPEN_AT = '1970-01-01T00:00:00.000Z';

/** The open game's state: the last rung met, every node at its last level, no units (call 9). */
function openState(): GameState {
  return {
    ...structuredClone(NEW_GAME),
    phase: 'runs',
    bought: Object.fromEntries(NODES.map((n) => [n.id, n.levels.length])),
    rung: RUNGS - 1,
    met: Array.from({ length: RUNGS }, (_, rung) => ({
      rung,
      reachedOn: 0,
      datasetVersion: 'open',
      at: OPEN_AT
    }))
  };
}

function openSync(): SaveSync {
  return {
    state: 'local',
    account: null,
    changed() {},
    removed() {},
    pull: () => Promise.resolve(),
    attach() {}
  };
}

export class GameStore {
  /** Fixed for the store's life: only `openGame` constructs with `opening` set. */
  readonly #open: boolean = opening;
  readonly #sync: SaveSync;
  readonly #now: () => Date;
  /** Where changes write; null in memory mode. */
  #storage: Storage | null = null;
  /** Where the two record keys are read; null when storage could not be read at all. */
  #records: Storage | null = null;
  /** Every saved game as held, by id: plain, since `saves` and `state` carry the reactivity. */
  #games: ReadonlyMap<string, GameSave> = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity

  #state = $state.raw<GameState>(NEW_GAME);
  #currentId = $state.raw('');
  #saves = $state.raw<readonly SaveEntry[]>([]);
  #limits = $derived(this.#open ? OPEN_LIMITS : limitsOf(this.#state));
  /** `beforeLeave`'s functions in the order added; each registration is its own entry. */
  readonly #leaving: { fn: () => void }[] = [];
  /** Set once another game has become current: `touched()` does nothing from then on. */
  #left = false;

  constructor(opts: { storage: Storage | null; sync: SaveSync; now?: () => Date }) {
    this.#sync = opts.sync;
    this.#now = opts.now ?? (() => new Date()); // eslint-disable-line svelte/prefer-svelte-reactivity
    if (this.#open) {
      this.#memoryGame('Game', openState());
      return;
    }
    this.#construct(opts.storage);
  }

  /** Step 1: memory mode, one game, nothing read. */
  #memoryGame(name: string | null, state: GameState): void {
    const at = this.#now();
    const save: GameSave = {
      v: 2,
      id: newId(),
      name: name ?? defaultSaveName({ kind: 'new', at }, []),
      nameIsDefault: true,
      state,
      plan: null,
      policy: null,
      savedAt: at.toISOString()
    };
    this.#storage = null;
    this.#records = null;
    this.#settle([save], save.id);
  }

  /** A new game with a new id and the default new name, `taken` taken. */
  #blank(taken: readonly string[], recs: Records): GameSave {
    const at = this.#now();
    return {
      v: 2,
      id: newId(),
      name: defaultSaveName({ kind: 'new', at }, taken),
      nameIsDefault: true,
      state: structuredClone(NEW_GAME),
      plan: recs.plan,
      policy: recs.policy,
      savedAt: at.toISOString()
    };
  }

  /** A new game with the two record keys' text as its plan and policy (step 2). */
  #fromRecords(storage: Storage, taken: readonly string[]): GameSave {
    return this.#blank(taken, {
      plan: storage.getItem(PLAN_RECORD),
      policy: storage.getItem(POLICY_RECORD)
    });
  }

  #construct(storage: Storage | null): void {
    if (storage === null) {
      this.#memoryGame(null, structuredClone(NEW_GAME));
      return;
    }
    let games: GameSave[];
    let current: string;
    const ops: Write[] = [];
    try {
      const indexText = storage.getItem(SAVES_KEY);
      let changed = true;
      if (indexText === null) {
        const first = this.#fromRecords(storage, []);
        games = [first];
        current = first.id;
        ops.push([saveKey(first.id), JSON.stringify(first)]);
      } else {
        ({ games, current, changed } = this.#recover(storage, indexText, ops));
      }
      const recs = { plan: storage.getItem(PLAN_RECORD), policy: storage.getItem(POLICY_RECORD) };
      if (changed) ops.push([SAVES_KEY, this.#indexText(games, current, recs)]);
    } catch {
      // A read threw before anything was written: storage cannot be trusted.
      this.#memoryGame(null, structuredClone(NEW_GAME));
      return;
    }
    const wrote = ops.length === 0 ? 'ok' : writeAll(storage, ops);
    if (wrote === 'read') {
      // A read threw after construction wrote, and writeAll put storage back (step 1).
      this.#memoryGame(null, structuredClone(NEW_GAME));
      return;
    }
    this.#records = storage;
    this.#storage = wrote === 'ok' ? storage : null;
    this.#settle(games, current);
  }

  /**
   * Steps 4 to 6: the games an index (valid or not) leads to, the writes they need before the
   * index, and whether the index needs rewriting (step 7).
   */
  #recover(
    storage: Storage,
    indexText: string,
    ops: Write[]
  ): { games: GameSave[]; current: string; changed: boolean } {
    const at = this.#now();
    const pending = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
    const moveAside = (key: string, raw: string): void => {
      const aside = freeKey(storage, CORRUPT_PREFIX, at, pending);
      pending.add(aside);
      ops.push([aside, raw], [key, null]);
    };
    /** A five-level save is removed unread; any other text that is not a save goes aside. */
    const drop = (key: string, raw: string): void => {
      if (isV1(raw)) ops.push([key, null]);
      else moveAside(key, raw);
    };
    const index = parseIndex(indexText);
    const games: GameSave[] = [];
    let changed = false;
    let current: string | null = null;

    if (index === null) {
      if (!isV1(indexText)) {
        const aside = freeKey(storage, CORRUPT_PREFIX, at, pending);
        pending.add(aside);
        ops.push([aside, indexText]);
      }
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key !== null && key.startsWith(SAVE_PREFIX) && !key.startsWith(CORRUPT_PREFIX)) {
          keys.push(key);
        }
      }
      for (const key of keys) {
        const raw = storage.getItem(key);
        if (raw === null) continue;
        const save = parseSaveText(raw);
        if (save && save.id === key.slice(SAVE_PREFIX.length)) games.push(save);
        else drop(key, raw);
      }
      changed = true;
    } else {
      for (const entry of index.saves) {
        const key = saveKey(entry.id);
        const raw = storage.getItem(key);
        const save = raw === null ? null : parseSaveText(raw);
        if (save && save.id === entry.id) {
          games.push(save);
          if (!sameEntry(entry, entryOf(save))) changed = true;
        } else {
          changed = true;
          if (raw !== null) drop(key, raw);
        }
      }
      if (games.some((g) => g.id === index.current)) current = index.current;
    }

    if (current === null) {
      const made = this.#fromRecords(
        storage,
        games.map((g) => g.name)
      );
      games.push(made);
      current = made.id;
      ops.push([saveKey(made.id), JSON.stringify(made)]);
      changed = true;
    }
    return { games, current, changed };
  }

  /**
   * The index text, in `saves` order, each entry with its save's own `savedAt`. `recs` is what
   * the two record keys hold once the writes are done.
   */
  #indexText(games: readonly GameSave[], current: string, recs: Records): string {
    const saves = this.#ordered(games, current, recs).map((e) => entryOf(e.save));
    return JSON.stringify({ v: 2, current, saves });
  }

  /**
   * One entry per game, latest first, ties by id. The current game's entry carries its played
   * time with `recs` as `savedAt`; every other entry its save's `savedAt`.
   */
  #ordered(
    games: readonly GameSave[],
    current: string,
    recs: Records
  ): { save: GameSave; entry: SaveEntry }[] {
    const keyed = games.map((g) => {
      const savedAt = g.id === current ? playedTime(g, recs.plan, recs.policy) : g.savedAt;
      return { save: g, entry: { ...entryOf(g), savedAt }, t: Date.parse(savedAt) };
    });
    keyed.sort((a, b) =>
      a.t !== b.t ? b.t - a.t : a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
    );
    return keyed;
  }

  /** Puts `games` in memory with `current` as the current game, and recomputes the reactive state. */
  #settle(games: readonly GameSave[], current: string): void {
    this.#games = new Map(games.map((g) => [g.id, g])); // eslint-disable-line svelte/prefer-svelte-reactivity
    this.#currentId = current;
    const now = this.#games.get(current) as GameSave;
    this.#state = now.state;
    this.#saves = this.#ordered(games, current, recordsOf(this.#records, now)).map((k) => k.entry);
  }

  #current(): GameSave {
    return this.#games.get(this.#currentId) as GameSave;
  }

  #names(): string[] {
    return [...this.#games.values()].map((g) => g.name);
  }

  /** Every game with `drop` left out and `put` set over the stored ones by id. */
  #gamesWith(put: readonly GameSave[], drop: readonly string[] = []): GameSave[] {
    const next = new Map(this.#games); // eslint-disable-line svelte/prefer-svelte-reactivity
    for (const id of drop) next.delete(id);
    for (const g of put) next.set(g.id, g);
    return [...next.values()];
  }

  /**
   * Runs `ops` (nothing in memory mode), then puts `games` in memory with `current` current and
   * makes `calls`. False, with memory as it was and no call made, when a write is refused.
   */
  #commit(
    ops: readonly Write[],
    games: readonly GameSave[],
    current: string,
    calls: readonly Call[]
  ): boolean {
    if (this.#storage !== null && writeAll(this.#storage, ops) !== 'ok') return false;
    this.#settle(games, current);
    for (const [kind, id] of calls) {
      if (kind === 'changed') this.#sync.changed(id);
      else this.#sync.removed(id);
    }
    return true;
  }

  /**
   * Writes one changed save (the current one with the records copied in) and the index, then
   * calls `changed`. In memory mode only memory changes.
   */
  #write(next: GameSave): boolean {
    const current = this.#currentId;
    const recs = recordsOf(this.#records, next.id === current ? next : this.#current());
    const save = next.id === current ? { ...next, plan: recs.plan, policy: recs.policy } : next;
    const games = this.#gamesWith([save]);
    const ops: Write[] = [
      [saveKey(save.id), JSON.stringify(save)],
      [SAVES_KEY, this.#indexText(games, current, recs)]
    ];
    return this.#commit(ops, games, current, [['changed', save.id]]);
  }

  /**
   * The `sfhousing:sim:v1` copy aside when due, and the writes of `save`'s two records with the
   * v1 removal after them. Its reads may throw.
   */
  #recordOps(storage: Storage, save: GameSave): { aside: Write[]; records: Write[] } {
    const v1 = storage.getItem(OLD_POLICY);
    const aside: Write[] = [];
    if (v1 !== null && storage.getItem(POLICY_RECORD) === null) {
      aside.push([freeKey(storage, OLD_POLICY_ASIDE, this.#now()), v1]);
    }
    const records: Write[] = [
      [PLAN_RECORD, save.plan],
      [POLICY_RECORD, save.policy]
    ];
    if (v1 !== null) records.push([OLD_POLICY, null]);
    return { aside, records };
  }

  /**
   * Makes `target` current: copies the current game out (or, for `remove`, removes its save),
   * the v1 copy aside, `target`'s save when `made`, its records, the index.
   */
  #makeCurrent(
    target: GameSave,
    made: boolean,
    leave: 'copy' | 'remove',
    calls: readonly Call[]
  ): StoreChange {
    const storage = this.#storage as Storage;
    const old = this.#current();
    const ops: Write[] = [];
    const put: GameSave[] = [];
    if (leave === 'copy') {
      const left = copiedOut(old, recordsOf(this.#records, old));
      ops.push([saveKey(old.id), JSON.stringify(left)]);
      put.push(left);
    } else {
      ops.push([saveKey(old.id), null]);
    }
    let rec: { aside: Write[]; records: Write[] };
    try {
      rec = this.#recordOps(storage, target);
    } catch {
      return REFUSED;
    }
    ops.push(...rec.aside);
    if (made) ops.push([saveKey(target.id), JSON.stringify(target)]);
    ops.push(...rec.records);
    put.push(target);
    const games = this.#gamesWith(put, leave === 'remove' ? [old.id] : []);
    ops.push([SAVES_KEY, this.#indexText(games, target.id, target)]);
    if (!this.#commit(ops, games, target.id, calls)) return REFUSED;
    this.#left = true;
    return OK;
  }

  /** The current game's played time with the record keys' text now. */
  #playedNow(): string {
    const cur = this.#current();
    const recs = recordsOf(this.#records, cur);
    return playedTime(cur, recs.plan, recs.policy);
  }

  /** Calls every `beforeLeave` function in the order added, skipping one that throws. */
  #flush(): void {
    for (const entry of [...this.#leaving]) {
      try {
        entry.fn();
      } catch {
        // A failed flush does not stop the change.
      }
    }
  }

  /** Reactive: the current game's state. */
  get state(): GameState {
    return this.#state;
  }
  /** Reactive: what the current game may use (G4). */
  get limits(): Limits {
    return this.#limits;
  }
  /** True only for `openGame()`: every control and no game parts. */
  get open(): boolean {
    return this.#open;
  }
  /** Reactive: every saved game, most recently changed first. */
  get saves(): readonly SaveEntry[] {
    return this.#saves;
  }
  /** Reactive. */
  get currentId(): string {
    return this.#currentId;
  }
  /** The save sync given at construction. */
  get sync(): SaveSync {
    return this.#sync;
  }
  /**
   * A win was seen. Sets `firstWinAt` the first time; later calls change nothing. A refused
   * write leaves `firstWinAt` null, so the next call tries again.
   */
  won(): void {
    if (this.#open) return;
    const cur = this.#current();
    if (cur.state.firstWinAt !== null) return;
    const at = this.#now().toISOString();
    this.#write({ ...cur, state: { ...cur.state, firstWinAt: at }, savedAt: at });
  }
  /** The page's autosave wrote the current game's plan or policy record. */
  touched(): void {
    if (this.#open || this.#left) return;
    this.#write({ ...this.#current(), savedAt: this.#now().toISOString() });
  }
  /** Writes `state` as the current game's; false (memory as it was) when the write is refused. */
  #put(state: GameState): boolean {
    return this.#write({ ...this.#current(), state, savedAt: this.#now().toISOString() });
  }
  /** Leaves the opening for the runs; storage while no win is held, or a write is refused. */
  startRuns(): StoreChange {
    if (this.#open) return OK;
    const state = this.#state;
    if (state.firstWinAt === null) return REFUSED;
    if (state.phase === 'runs') return OK;
    return this.#put({ ...state, phase: 'runs' }) ? OK : REFUSED;
  }
  /** Buys a node (G3); a refusal passes through unwritten, a refused write answers short. */
  buy(id: NodeId): Bought {
    const bought = buyNode(this.#state, id);
    if (this.#open) return bought.ok ? { ok: false, reason: 'done' } : bought;
    if (!bought.ok) return bought;
    return this.#put(bought.state) ? bought : { ok: false, reason: 'short' };
  }
  /** Settles a finished run once; the same run again writes nothing. */
  settle(r: RunResult): StoreChange {
    if (this.#open) return OK;
    const last = this.#state.last;
    if (last !== null && last.at === r.at && last.rung === r.rung) return OK;
    return this.#put(settleRun(this.#state, r)) ? OK : REFUSED;
  }
  /** Takes the next rung when one is due; writes nothing when it does not move. */
  takeNext(): StoreChange {
    if (this.#open) return OK;
    const next = nextRung(this.#state);
    if (next === this.#state) return OK;
    return this.#put(next) ? OK : REFUSED;
  }
  /** Registers a function the store calls before another game becomes current; returns its remover. */
  beforeLeave(fn: () => void): () => void {
    const entry = { fn };
    this.#leaving.push(entry);
    return () => {
      const at = this.#leaving.indexOf(entry);
      if (at >= 0) this.#leaving.splice(at, 1);
    };
  }
  newGame(): StoreChange {
    if (this.#storage === null) return REFUSED;
    if (this.#games.size >= MAX_SAVES) return FULL;
    this.#flush();
    const old = this.#currentId;
    const made = this.#blank(this.#names(), { plan: null, policy: null });
    return this.#makeCurrent(made, true, 'copy', [
      ['changed', old],
      ['changed', made.id]
    ]);
  }
  switchTo(id: string): StoreChange {
    if (id === this.#currentId) return OK;
    if (this.#storage === null) return REFUSED;
    const other = this.#games.get(id);
    if (!other) return REFUSED;
    this.#flush();
    return this.#makeCurrent(other, false, 'copy', [['changed', this.#currentId]]);
  }
  rename(id: string, name: string): void {
    if (this.#open) return;
    const save = this.#games.get(id);
    if (!save) return;
    const cut = cutName(name);
    if (cut === '' || (cut === save.name && !save.nameIsDefault)) return;
    this.#write({ ...save, name: cut, nameIsDefault: false, savedAt: this.#now().toISOString() });
  }
  remove(id: string): StoreChange {
    if (this.#storage === null) return REFUSED;
    if (!this.#games.has(id)) return OK;
    const current = this.#currentId;
    if (id !== current) {
      const games = this.#gamesWith([], [id]);
      const ops: Write[] = [
        [saveKey(id), null],
        [SAVES_KEY, this.#indexText(games, current, recordsOf(this.#records, this.#current()))]
      ];
      return this.#commit(ops, games, current, [['removed', id]]) ? OK : REFUSED;
    }
    this.#flush();
    let next: GameSave | null = null;
    for (const g of this.#games.values()) {
      if (g.id === id) continue;
      const t = Date.parse(g.savedAt);
      const best = next === null ? -Infinity : Date.parse(next.savedAt);
      if (next === null || t > best || (t === best && g.id < next.id)) next = g;
    }
    if (next !== null) return this.#makeCurrent(next, false, 'remove', [['removed', id]]);
    const made = this.#blank([], { plan: null, policy: null });
    return this.#makeCurrent(made, true, 'remove', [
      ['removed', id],
      ['changed', made.id]
    ]);
  }
  /** The saved game as stored now; the current one with the plan and policy records as they are. */
  read(id: string): GameSave | null {
    const save = this.#games.get(id);
    if (!save) return null;
    const copy = structuredClone(save);
    if (id !== this.#currentId) return copy;
    copy.plan = readRecord(this.#records, PLAN_RECORD, save.plan);
    copy.policy = readRecord(this.#records, POLICY_RECORD, save.policy);
    copy.savedAt = playedTime(save, copy.plan, copy.policy);
    return copy;
  }
  /** Store saved games that came from the account. */
  adopt(saves: readonly GameSave[]): StoreChange {
    const storage = this.#storage;
    if (storage === null) return REFUSED;
    const taken = new Map<string, GameSave>(); // eslint-disable-line svelte/prefer-svelte-reactivity
    for (const s of saves) {
      const parsed = fitted(s);
      if (parsed) taken.set(parsed.id, parsed);
    }
    if (taken.size === 0) return OK;
    let added = 0;
    for (const id of taken.keys()) if (!this.#games.has(id)) added++;
    if (added > 0 && this.#games.size + added > MAX_SAVES) return FULL;
    const current = this.#currentId;
    const adopted = taken.get(current);
    if (adopted) {
      const before = this.#playedNow();
      this.#flush();
      if (this.#playedNow() !== before) return CHANGED;
    }
    const ops: Write[] = [];
    let records: Write[] = [];
    if (adopted) {
      try {
        const rec = this.#recordOps(storage, adopted);
        ops.push(...rec.aside);
        records = rec.records;
      } catch {
        return REFUSED;
      }
    }
    for (const s of taken.values()) ops.push([saveKey(s.id), JSON.stringify(s)]);
    ops.push(...records);
    const games = this.#gamesWith([...taken.values()]);
    const recs = adopted ?? recordsOf(this.#records, this.#current());
    ops.push([SAVES_KEY, this.#indexText(games, current, recs)]);
    if (!this.#commit(ops, games, current, [])) return REFUSED;
    if (adopted) this.#left = true;
    return OK;
  }
  /** Give the saved game `id` the id `newId`, keeping everything else about it. */
  rekey(id: string, newId: string): StoreChange {
    if (this.#storage === null) return REFUSED;
    const save = this.#games.get(id);
    if (!save || newId === id || this.#games.has(newId) || !isValidId(newId)) return REFUSED;
    const isCurrent = id === this.#currentId;
    const recs = recordsOf(this.#records, this.#current());
    const moved = { ...(isCurrent ? copiedOut(save, recs) : save), id: newId };
    const current = isCurrent ? newId : this.#currentId;
    const games = this.#gamesWith([moved], [id]);
    const ops: Write[] = [
      [saveKey(newId), JSON.stringify(moved)],
      [saveKey(id), null],
      [SAVES_KEY, this.#indexText(games, current, recs)]
    ];
    return this.#commit(ops, games, current, []) ? OK : REFUSED;
  }
}

/** A record key's text now; `fallback` (the stored copy) without storage or when reading throws. */
function readRecord(records: Storage | null, key: string, fallback: string | null): string | null {
  if (records === null) return fallback;
  try {
    return records.getItem(key);
  } catch {
    return fallback;
  }
}

/** A store with `open` true: one game in memory with `openState()`, and `limits` equal to `OPEN_LIMITS`. */
export function openGame(): GameStore {
  opening = true;
  try {
    return new GameStore({ storage: null, sync: openSync() });
  } finally {
    opening = false;
  }
}

const GAME = Symbol('game');

export function provideGame(store: GameStore): void {
  setContext(GAME, store);
}

export function useGame(): GameStore {
  return getContext<GameStore | undefined>(GAME) ?? openGame();
}
