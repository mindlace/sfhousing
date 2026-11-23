import type { AccountLine } from './save-api';
import type { GameStore } from './store.svelte';

export type SyncState = 'local' | 'saving' | 'saved' | 'offline' | 'sign-in' | 'full';

export interface SaveSync {
  /** Reactive. */
  readonly state: SyncState;
  /** Reactive: the account as the server last answered (S1's `AccountLine`); null until it has. */
  readonly account: AccountLine | null;
  /** The saved game `id` changed. */
  changed(id: string): void;
  /** The saved game `id` was deleted in this browser. */
  removed(id: string): void;
  /** Bring the account's saved games here and send this browser's there. */
  pull(): Promise<void>;
  /** The store saved games are read from and adopted into. Called once by the root layout. */
  attach(store: GameStore): void;
}

export function createSaveSync(opts: {
  storage: Storage | null;
  fetchFn: typeof fetch;
  /** Whether the root layout's `user` is set now. */
  signedIn: () => boolean;
}): SaveSync {
  void opts;
  return {
    state: 'local',
    account: null,
    changed(id) {
      void id;
    },
    removed(id) {
      void id;
    },
    pull: () => Promise.resolve(),
    attach(store) {
      void store;
    }
  };
}
