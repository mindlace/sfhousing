import { describe, expect, expectTypeOf, it } from 'vitest';
import { LogStore } from '$lib/sim-store/log-store.svelte';
import { memorySimDb } from '$lib/sim-store/sim-db';
import type { SyncStore } from './ports';

const GETTERS = [
  'ready',
  'simId',
  'tipSeq',
  'pendingCount',
  'heldCount',
  'stopped',
  'local',
  'registration'
] as const;
const METHODS = [
  'head',
  'receive',
  'setServerDataset',
  'dropPending',
  'markRegistered',
  'subscribe',
  'open',
  'claim'
] as const;

describe('SyncStore', () => {
  it('is what a real log store provides', async () => {
    expectTypeOf<LogStore>().toExtend<SyncStore>();
    const store = new LogStore({
      db: memorySimDb(),
      tabId: 'a',
      stamp: () => ({ datasetVersion: 'fixture-0', build: 'test' })
    });
    await store.open(null);
    const port: SyncStore = store;
    for (const g of GETTERS) expect(g in port && port[g] !== undefined).toBe(true);
    for (const m of METHODS) expect(typeof port[m]).toBe('function');
    expect(port.ready).toBe(true);
  });
});
