import type { AccountLine } from '$lib/game/save-api';
import type { SaveSync } from '$lib/game/save-sync.svelte';
import type { GameSave, SaveEntry } from '$lib/game/save-shape';
import { SAVES_KEY, saveKey } from '$lib/game/saves';
import { NEW_GAME, type GameState } from '$lib/game/state';
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

/**
 * Writes SAVES_KEY ({ v: 2, current, saves }) and one saveKey(id) per game (a v2 GameSave) into a
 * new MemoryStorage, then constructs the store on it. The first game is current with
 * { ...NEW_GAME, ...state }; the others are NEW_GAME.
 */
export function seededGame(
  opts: {
    state?: Partial<GameState>;
    /** Saved games in the list; default 1. */
    saves?: number;
    /** Raw text under 'sfhousing:plan:v1' and 'sfhousing:sim:v2' before construction. */
    plan?: string | null;
    policy?: string | null;
    sync?: SaveSync;
  } = {}
): SeededGame {
  const storage = new MemoryStorage();
  const count = opts.saves ?? 1;
  const games: GameSave[] = [];
  for (let i = 0; i < count; i++) {
    games.push({
      v: 2,
      id: newId(),
      name: i === 0 ? 'Seeded game' : `Seeded game ${i + 1}`,
      nameIsDefault: false,
      state: i === 0 ? { ...NEW_GAME, ...opts.state } : NEW_GAME,
      plan: null,
      policy: null,
      savedAt: new Date(BASE_TIME - i * 60_000).toISOString()
    });
  }
  for (const g of games) storage.setItem(saveKey(g.id), JSON.stringify(g));
  const saves: SaveEntry[] = games.map((g) => ({
    id: g.id,
    name: g.name,
    nameIsDefault: g.nameIsDefault,
    savedAt: g.savedAt,
    phase: g.state.phase,
    rung: g.state.rung
  }));
  storage.setItem(SAVES_KEY, JSON.stringify({ v: 2, current: games[0].id, saves }));
  if (opts.plan != null) storage.setItem('sfhousing:plan:v1', opts.plan);
  if (opts.policy != null) storage.setItem('sfhousing:sim:v2', opts.policy);
  const game = new GameStore({ storage, sync: opts.sync ?? quietSync() });
  return { game, storage };
}
