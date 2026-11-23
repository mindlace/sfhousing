import { describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '$lib/sharing/fixtures/memory-storage';
import { createSaveSync } from './save-sync.svelte';
import type { GameStore } from './store.svelte';

describe('createSaveSync stub', () => {
  it('starts local with no account', () => {
    const s = createSaveSync({
      storage: new MemoryStorage(),
      fetchFn: vi.fn<typeof fetch>(),
      signedIn: () => false
    });
    expect(s.state).toBe('local');
    expect(s.account).toBeNull();
  });
  it('does nothing when called', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const signedIn = vi.fn(() => false);
    const storage = new MemoryStorage();
    const s = createSaveSync({ storage, fetchFn, signedIn });
    s.changed('x');
    s.removed('x');
    s.attach({} as GameStore);
    expect(await s.pull()).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(signedIn).not.toHaveBeenCalled();
    expect(storage.length).toBe(0);
    expect(s.state).toBe('local');
  });
});
