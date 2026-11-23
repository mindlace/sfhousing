import type { AccountLine } from '../save-api';
import type { SaveSync, SyncState } from '../save-sync.svelte';
import type { GameStore } from '../store.svelte';

export type SyncCall =
  | { kind: 'changed'; id: string }
  | { kind: 'removed'; id: string }
  | { kind: 'pull' }
  | { kind: 'attach' };

/** A save sync for tests: it records each call, and tests set `state` and `account`. */
export class FakeSync implements SaveSync {
  state: SyncState = $state('local');
  account: AccountLine | null = $state(null);
  readonly calls: SyncCall[] = [];

  changed(id: string): void {
    this.calls.push({ kind: 'changed', id });
  }

  removed(id: string): void {
    this.calls.push({ kind: 'removed', id });
  }

  pull(): Promise<void> {
    this.calls.push({ kind: 'pull' });
    return Promise.resolve();
  }

  attach(store: GameStore): void {
    void store;
    this.calls.push({ kind: 'attach' });
  }
}
