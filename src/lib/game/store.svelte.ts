import type { Day } from '$lib/timelapse/time';
import type { Allowed } from './allowed';
import type { Progress } from './progress';
import type { GameSave, SaveEntry } from './saves';
import type { SaveSync } from './save-sync.svelte';

export type StoreChange = { ok: true } | { ok: false; reason: 'full' | 'storage' };

/** The win on screen that "Level up" would bank. */
export interface Offer {
  /** The day the seen result reached the goal; null for Paint's win. */
  on: Day | null;
  /** The dataset the result was seen on. */
  datasetVersion: string;
}

export class GameStore {
  constructor(opts: { storage: Storage | null; sync: SaveSync; now?: () => Date }) {
    void opts;
    throw new Error('not implemented');
  }
  /** Reactive: the current game's progress. */
  get progress(): Progress {
    throw new Error('not implemented');
  }
  /** Reactive: what the current game may use (G3). */
  get allowed(): Allowed {
    throw new Error('not implemented');
  }
  /** True only for `openGame()`: every control and no game parts. */
  get open(): boolean {
    throw new Error('not implemented');
  }
  /** Reactive: every saved game, most recently changed first. */
  get saves(): readonly SaveEntry[] {
    throw new Error('not implemented');
  }
  /** Reactive. */
  get currentId(): string {
    throw new Error('not implemented');
  }
  /** Reactive: the win "Level up" would bank now; null when there is none. */
  get offer(): Offer | null {
    throw new Error('not implemented');
  }
  /** The save sync given at construction. */
  get sync(): SaveSync {
    throw new Error('not implemented');
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
    void id;
    throw new Error('not implemented');
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

/** A store with `open` true: one game at level 5, nothing banked, no storage, `allowed` equal to `ALL_ALLOWED`. */
export function openGame(): GameStore {
  throw new Error('not implemented');
}

export function provideGame(store: GameStore): void {
  void store;
  throw new Error('not implemented');
}

export function useGame(): GameStore {
  throw new Error('not implemented');
}
