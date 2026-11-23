import { getContext, setContext } from 'svelte';
import { newId } from '$lib/ids/base58';
import type { Day } from '$lib/timelapse/time';
import { ALL_ALLOWED, allowedAt, type Allowed } from './allowed';
import { NEW_GAME, type Progress } from './progress';
import {
  SAVES_KEY,
  defaultSaveName,
  parseGameSave,
  saveKey,
  type GameSave,
  type SaveEntry
} from './saves';
import type { SaveSync } from './save-sync.svelte';

export type StoreChange = { ok: true } | { ok: false; reason: 'full' | 'storage' };

/** The win on screen that "Level up" would bank. */
export interface Offer {
  /** The day the seen result reached the goal; null for Paint's win. */
  on: Day | null;
  /** The dataset the result was seen on. */
  datasetVersion: string;
}

/** The plan record (`PLAN_KEY` of `$lib/sharing/storage`). */
const PLAN_RECORD = 'sfhousing:plan:v1';
/** The policy record (`SIM_KEY4` of `$lib/timeline/sim-doc4`). */
const POLICY_RECORD = 'sfhousing:sim:v2';
/** The schema 3 policy record (`SIM_KEY` of `$lib/sim-page/sim-doc`), removed when a change writes the records. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const OLD_POLICY = 'sfhousing:sim:v1';

const SAVE_PREFIX = 'sfhousing:save:';
const CORRUPT_PREFIX = 'sfhousing:save:corrupt:';

type Write = readonly [key: string, value: string | null];

const EMPTY: ReadonlySet<string> = new Set();

/**
 * Applies `ops` in order (null is `removeItem`). On a throw it puts back every key it had
 * already written, ignoring throws while it does, and returns false.
 */
function writeAll(storage: Storage, ops: readonly Write[]): boolean {
  const done: (readonly [string, string | null])[] = [];
  try {
    for (const [key, value] of ops) {
      const old = storage.getItem(key);
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
      done.push([key, old]);
    }
    return true;
  } catch {
    for (const [key, old] of done.reverse()) {
      try {
        if (old === null) storage.removeItem(key);
        else storage.setItem(key, old);
      } catch {
        // Putting back is best effort.
      }
    }
    return false;
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

function entryOf(save: GameSave): SaveEntry {
  return {
    id: save.id,
    name: save.name,
    nameIsDefault: save.nameIsDefault,
    savedAt: save.savedAt,
    level: save.progress.level
  };
}

function sameEntry(a: SaveEntry, b: SaveEntry): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.nameIsDefault === b.nameIsDefault &&
    a.savedAt === b.savedAt &&
    a.level === b.level
  );
}

function isPlain(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** The index when valid (§sec-design-store-layout), else null. */
function parseIndex(text: string): { current: string; saves: SaveEntry[] } | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlain(json) || json.v !== 1 || typeof json.current !== 'string') return null;
  if (!Array.isArray(json.saves)) return null;
  const ids = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
  const saves: SaveEntry[] = [];
  for (const e of json.saves as unknown[]) {
    if (!isPlain(e)) return null;
    const { id, name, nameIsDefault, savedAt, level } = e;
    if (typeof id !== 'string' || ids.has(id)) return null;
    if (typeof name !== 'string' || typeof nameIsDefault !== 'boolean') return null;
    if (typeof savedAt !== 'string') return null;
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > 5) {
      return null;
    }
    ids.add(id);
    saves.push({ id, name, nameIsDefault, savedAt, level: level as SaveEntry['level'] });
  }
  return { current: json.current, saves };
}

function parseSaveText(text: string): GameSave | null {
  try {
    return parseGameSave(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Set while `openGame` constructs its store: the module's private constructor path. */
let opening = false;

const OPEN_PROGRESS: Progress = { v: 1, level: 5, banked: {}, firstWinAt: null };

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
  // eslint-disable-next-line no-unused-private-class-members -- the change methods write through it
  #storage: Storage | null = null;
  /** Where the two record keys are read; null when storage could not be read at all. */
  #records: Storage | null = null;
  /** Every saved game as stored, by id: plain, since `saves` and `progress` carry the reactivity. */
  #games: ReadonlyMap<string, GameSave> = new Map(); // eslint-disable-line svelte/prefer-svelte-reactivity

  #progress = $state.raw<Progress>(NEW_GAME);
  #currentId = $state.raw('');
  #offer = $state.raw<Offer | null>(null);
  #saves = $state.raw<readonly SaveEntry[]>([]);
  #allowed = $derived(this.#open ? ALL_ALLOWED : allowedAt(this.#progress.level));

  constructor(opts: { storage: Storage | null; sync: SaveSync; now?: () => Date }) {
    this.#sync = opts.sync;
    this.#now = opts.now ?? (() => new Date()); // eslint-disable-line svelte/prefer-svelte-reactivity
    if (this.#open) {
      this.#memoryGame('Game', structuredClone(OPEN_PROGRESS));
      return;
    }
    this.#construct(opts.storage);
  }

  /** Step 1: memory mode, one game, nothing read. */
  #memoryGame(name: string | null, progress: Progress): void {
    const at = this.#now();
    const save: GameSave = {
      v: 1,
      id: newId(),
      name: name ?? defaultSaveName({ kind: 'new', at }, []),
      nameIsDefault: true,
      progress,
      plan: null,
      policy: null,
      savedAt: at.toISOString()
    };
    this.#storage = null;
    this.#records = null;
    this.#settle([save], save.id);
  }

  /** A level 1 game with the two record keys' text as its plan and policy (step 2). */
  #fromRecords(storage: Storage, taken: readonly string[]): GameSave {
    const at = this.#now();
    return {
      v: 1,
      id: newId(),
      name: defaultSaveName({ kind: 'new', at }, taken),
      nameIsDefault: true,
      progress: structuredClone(NEW_GAME),
      plan: storage.getItem(PLAN_RECORD),
      policy: storage.getItem(POLICY_RECORD),
      savedAt: at.toISOString()
    };
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
      if (indexText === null) {
        const first = this.#fromRecords(storage, []);
        games = [first];
        current = first.id;
        ops.push([saveKey(first.id), JSON.stringify(first)]);
        ops.push([SAVES_KEY, this.#indexText(games, current, storage)]);
      } else {
        ({ games, current } = this.#recover(storage, indexText, ops));
      }
    } catch {
      // A read after the first one threw: storage cannot be trusted.
      this.#memoryGame(null, structuredClone(NEW_GAME));
      return;
    }
    this.#records = storage;
    this.#storage = ops.length === 0 || writeAll(storage, ops) ? storage : null;
    this.#settle(games, current);
  }

  /** Steps 4 to 7: the games an index (valid or not) leads to, and the writes they need. */
  #recover(
    storage: Storage,
    indexText: string,
    ops: Write[]
  ): { games: GameSave[]; current: string } {
    const at = this.#now();
    const pending = new Set<string>(); // eslint-disable-line svelte/prefer-svelte-reactivity
    const moveAside = (key: string, raw: string): void => {
      const aside = freeKey(storage, CORRUPT_PREFIX, at, pending);
      pending.add(aside);
      ops.push([aside, raw], [key, null]);
    };
    const index = parseIndex(indexText);
    const games: GameSave[] = [];
    let changed = false;
    let current: string | null = null;

    if (index === null) {
      const aside = freeKey(storage, CORRUPT_PREFIX, at, pending);
      pending.add(aside);
      ops.push([aside, indexText]);
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
        else moveAside(key, raw);
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
          if (raw !== null) moveAside(key, raw);
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
    if (changed) ops.push([SAVES_KEY, this.#indexText(games, current, storage)]);
    return { games, current };
  }

  #indexText(games: readonly GameSave[], current: string, records: Storage | null): string {
    return JSON.stringify({ v: 1, current, saves: this.#ordered(games, current, records) });
  }

  /** One entry per game: latest first, the current game by played time, ties by id. */
  #ordered(games: readonly GameSave[], current: string, records: Storage | null): SaveEntry[] {
    const keyed = games.map((g) => {
      let when = g.savedAt;
      if (g.id === current) {
        const plan = readRecord(records, PLAN_RECORD, g.plan);
        const policy = readRecord(records, POLICY_RECORD, g.policy);
        when = playedTime(g, plan, policy);
      }
      return { entry: entryOf(g), t: Date.parse(when) };
    });
    keyed.sort((a, b) =>
      a.t !== b.t ? b.t - a.t : a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
    );
    return keyed.map((k) => k.entry);
  }

  /** Puts `games` in memory with `current` as the current game, and recomputes the reactive state. */
  #settle(games: readonly GameSave[], current: string): void {
    this.#games = new Map(games.map((g) => [g.id, g])); // eslint-disable-line svelte/prefer-svelte-reactivity
    this.#currentId = current;
    this.#progress = (this.#games.get(current) as GameSave).progress;
    this.#saves = this.#ordered(games, current, this.#records);
  }

  /** Reactive: the current game's progress. */
  get progress(): Progress {
    return this.#progress;
  }
  /** Reactive: what the current game may use (G3). */
  get allowed(): Allowed {
    return this.#allowed;
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
  /** Reactive: the win "Level up" would bank now; null when there is none. */
  get offer(): Offer | null {
    return this.#offer;
  }
  /** The save sync given at construction. */
  get sync(): SaveSync {
    return this.#sync;
  }
  /** A win was seen. Sets `firstWinAt` the first time; later calls change nothing. */
  won(): void {
    throw new Error('not implemented');
  }
  /** The page sets the offer while its seen result wins the level, and clears it with null. */
  setOffer(offer: Offer | null): void {
    void offer;
    throw new Error('not implemented');
  }
  /** Banks the offer and raises the level. Does nothing while `offer` is null. */
  levelUp(): void {
    throw new Error('not implemented');
  }
  /** The page's autosave wrote the current game's plan or policy record. */
  touched(): void {
    throw new Error('not implemented');
  }
  newGame(): StoreChange {
    throw new Error('not implemented');
  }
  switchTo(id: string): StoreChange {
    void id;
    throw new Error('not implemented');
  }
  remix(doc: { kind: 'plan' | 'sim'; record: string; title: string }): StoreChange {
    void doc;
    throw new Error('not implemented');
  }
  rename(id: string, name: string): void {
    void id;
    void name;
    throw new Error('not implemented');
  }
  remove(id: string): StoreChange {
    void id;
    throw new Error('not implemented');
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
    void saves;
    throw new Error('not implemented');
  }
  /** Give the saved game `id` the id `newId`, keeping everything else about it. */
  rekey(id: string, newId: string): StoreChange {
    void id;
    void newId;
    throw new Error('not implemented');
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

/** A store with `open` true: one game at level 5, nothing banked, no storage, `allowed` equal to `ALL_ALLOWED`. */
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
