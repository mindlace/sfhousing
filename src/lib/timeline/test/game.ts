// A game store at a given level for the timeline's tests, reached through the store's own API.
import type { Level } from '$lib/game/levels';
import { GameStore } from '$lib/game/store.svelte';
import { FakeSync } from '$lib/game/test/fake-sync.svelte';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import type { Day } from '$lib/timelapse/time';

/**
 * A store at `level`, every banked day `bar`, so levels 3 to 5 have `bar` as their bar.
 * `storage` defaults to a new MemoryStorage. Throws when `level` is 3 or more and `bar` is absent.
 */
export function gameAt(
  level: Level,
  opts: { bar?: Day; datasetVersion?: string; storage?: Storage } = {}
): GameStore {
  const datasetVersion = opts.datasetVersion ?? 'fixture-0';
  if (level >= 3 && opts.bar === undefined) {
    throw new Error(`gameAt(${level}) needs a bar: a level up from 2 banks a reached day`);
  }
  const game = new GameStore({
    storage: opts.storage ?? new MemoryStorage(),
    sync: new FakeSync()
  });
  while (game.progress.level < level) {
    const on = game.progress.level === 1 ? null : opts.bar!;
    game.setOffer({ on, datasetVersion });
    game.levelUp();
  }
  return game;
}
