import type { AccountLine } from '$lib/game/save-api';
import type { SaveSync } from '$lib/game/save-sync.svelte';
import type { Level } from '$lib/game/levels';
import type { Progress } from '$lib/game/progress';
import { SAVES_KEY, saveKey, type GameSave } from '$lib/game/saves';
import { GameStore } from '$lib/game/store.svelte';
import { newId } from '$lib/ids/base58';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';

/** A SaveSync that does nothing: state 'local' (or 'saved' with an account), the given account. */
export function quietSync(account?: AccountLine | null): SaveSync {
  return {
    state: account ? 'saved' : 'local',
    account: account ?? null,
    changed() {},
    removed() {},
    pull: () => Promise.resolve(),
    attach() {}
  };
}

export interface SeededGame {
  game: GameStore;
  storage: MemoryStorage;
}

const BASE_TIME = Date.UTC(2026, 10, 22, 12, 0, 0);

function progressAt(level: Level, roundComplete: boolean, savedAt: string): Progress {
  const banked: Progress['banked'] = {};
  const bank = { on: Date.UTC(2080, 0, 1) / 86_400_000, datasetVersion: 'fixture-0', at: savedAt };
  for (let n = 2; n < level; n++) banked[n as 2 | 3 | 4] = { ...bank };
  if (roundComplete) banked[5] = { ...bank };
  return { v: 1, level, banked, firstWinAt: level > 1 ? savedAt : null };
}

/**
 * Writes SAVES_KEY and one saveKey(id) per game into a new MemoryStorage, then constructs the
 * store on it. The first game is current, at `level`; the others are level 1.
 */
export function seededGame(opts: {
  level: Level;
  /** Saved games in the list; default 1. */
  saves?: number;
  /** Level 5 with banked[5] set. */
  roundComplete?: boolean;
  /** Raw text under 'sfhousing:plan:v1' and 'sfhousing:sim:v2' before construction. */
  plan?: string | null;
  policy?: string | null;
  sync?: SaveSync;
}): SeededGame {
  const storage = new MemoryStorage();
  const count = opts.saves ?? 1;
  const games: GameSave[] = [];
  for (let i = 0; i < count; i++) {
    const savedAt = new Date(BASE_TIME - i * 60_000).toISOString();
    const first = i === 0;
    games.push({
      v: 1,
      id: newId(),
      name: first ? 'Seeded game' : `Seeded game ${i + 1}`,
      nameIsDefault: false,
      progress: first
        ? progressAt(opts.level, opts.roundComplete === true, savedAt)
        : progressAt(1, false, savedAt),
      plan: null,
      policy: null,
      savedAt
    });
  }
  for (const g of games) storage.setItem(saveKey(g.id), JSON.stringify(g));
  const saves = games.map((g) => ({
    id: g.id,
    name: g.name,
    nameIsDefault: g.nameIsDefault,
    savedAt: g.savedAt,
    level: g.progress.level
  }));
  storage.setItem(SAVES_KEY, JSON.stringify({ v: 1, current: games[0].id, saves }));
  if (opts.plan != null) storage.setItem('sfhousing:plan:v1', opts.plan);
  if (opts.policy != null) storage.setItem('sfhousing:sim:v2', opts.policy);
  const game = new GameStore({ storage, sync: opts.sync ?? quietSync() });
  return { game, storage };
}
