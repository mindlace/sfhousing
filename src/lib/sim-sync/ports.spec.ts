import { describe, expect, expectTypeOf, it } from 'vitest';
import type { LogStore } from '$lib/sim-store/log-store.svelte';
import type { SyncStore } from './ports';

describe('SyncStore', () => {
  it('is what the log store provides', () => {
    expectTypeOf<LogStore>().toExtend<SyncStore>();
    expect(true).toBe(true);
  });
});
