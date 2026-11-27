// A game store in a given state for the timeline's tests, read from one save in storage.
import type { GameSave, SaveEntry } from '$lib/game/save-shape';
import { SAVES_KEY, saveKey } from '$lib/game/saves';
import { NEW_GAME, type GameState } from '$lib/game/state';
import { GameStore } from '$lib/game/store.svelte';
import { FakeSync } from '$lib/game/test/fake-sync.svelte';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';

/**
 * The id of the one save `gameWith` writes: fixed, so a failure reproduces, and valid (a UUIDv7 in
 * Base58, `isValidId`), since the store refuses any other.
 */
export const GAME_ID = 'CHi3m3BMkMrVUcmbmLPVS';

const AT = '2026-11-25T00:00:00.000Z';

/**
 * A store whose current game is `{ ...NEW_GAME, ...state }`, with `firstWinAt` set when the phase
 * is 'runs' and none is given. `storage` defaults to a new MemoryStorage.
 */
export function gameWith(
  state: Partial<GameState> = {},
  opts: { storage?: Storage } = {}
): GameStore {
  const storage = opts.storage ?? new MemoryStorage();
  const s: GameState = { ...NEW_GAME, ...state };
  if (s.phase === 'runs' && s.firstWinAt === null) s.firstWinAt = AT;
  const save: GameSave = {
    v: 2,
    id: GAME_ID,
    name: 'Game',
    nameIsDefault: true,
    state: s,
    plan: null,
    policy: null,
    savedAt: AT
  };
  const entry: SaveEntry = {
    id: GAME_ID,
    name: save.name,
    nameIsDefault: true,
    savedAt: AT,
    phase: s.phase,
    round: s.round,
    finished: s.finished
  };
  storage.setItem(saveKey(GAME_ID), JSON.stringify(save));
  storage.setItem(SAVES_KEY, JSON.stringify({ v: 2, current: GAME_ID, saves: [entry] }));
  return new GameStore({ storage, sync: new FakeSync() });
}
