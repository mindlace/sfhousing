import { describe, expect, it } from 'vitest';
import { newId } from '$lib/ids/base58';
import { SIM_DB_NAME, SIM_DB_VERSION, openSimDb } from './idb';
import type { PendingPut, SimDb, SimRecord, WriteBatch } from './sim-db';
import { simDbContract, type MakeSimDb } from './test/sim-db-contract';
import { draftOf, nameChange } from './test/commits';

const names = new Map<SimDb, string>();
const testName = (): string => `sfh-test-${crypto.randomUUID()}`;

function must(db: SimDb | null): SimDb {
  if (!db) throw new Error('openSimDb returned null');
  return db;
}

function deleteName(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('delete blocked'));
  });
}

const make: MakeSimDb = async (o) => {
  const name = testName();
  const db = must(await openSimDb({ name, ...o }));
  names.set(db, name);
  return db;
};

async function deleteIt(db: SimDb): Promise<void> {
  db.close();
  const name = names.get(db);
  names.delete(db);
  if (name) await deleteName(name);
}

const sim = (): SimRecord => ({ simId: newId(), createdAt: 1000, registered: false });
const putOf = (label: string): PendingPut => {
  const pending = { draft: draftOf(0, [nameChange(label)], { label }), targetId: null };
  return { id: pending.draft.id, pending };
};
const batch = (owner: string, put: PendingPut[]): WriteBatch => ({
  owner,
  confirmed: [],
  put,
  remove: []
});

describe('openSimDb', () => {
  simDbContract(make, deleteIt);

  it('names the database as the brief says', () => {
    expect(SIM_DB_NAME).toBe('sfhousing-sim-log');
    expect(SIM_DB_VERSION).toBe(1);
  });

  it('reopens a database at the current version with its rows', async () => {
    const name = testName();
    try {
      const first = must(await openSimDb({ name }));
      const s = sim();
      const a = putOf('a');
      await first.createSim(s, { current: true, batch: batch('tab1', [a]) });
      first.close();

      const second = must(await openSimDb({ name }));
      const read = await second.read(s.simId);
      expect(read.sim).toEqual(s);
      expect(read.pending.map((r) => [r.id, r.n, r.owner])).toEqual([[a.id, 1, 'tab1']]);
      expect(await second.getMeta('current')).toBe(s.simId);
      second.close();
    } finally {
      await deleteName(name);
    }
  });

  it('closes on a newer version opened elsewhere and tells the caller', async () => {
    const name = testName();
    let told = 0;
    let newer: IDBDatabase | null = null;
    try {
      const db = must(await openSimDb({ name, onVersionChange: () => told++ }));
      await db.setMeta('k', 1);
      newer = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(name, SIM_DB_VERSION + 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('open blocked'));
      });
      expect(told).toBe(1);
      await expect(db.read(newId())).rejects.toThrow();
      await expect(db.setMeta('k', 2)).rejects.toThrow();
      await expect(db.getMeta('k')).rejects.toThrow();
    } finally {
      newer?.close();
      await deleteName(name);
    }
  });

  it('rejects every method after close', async () => {
    const name = testName();
    try {
      const db = must(await openSimDb({ name }));
      db.close();
      await expect(db.read(newId())).rejects.toThrow();
      await expect(db.createSim(sim())).rejects.toThrow();
      await expect(db.write(newId(), batch('tab1', []))).rejects.toThrow();
      await expect(db.claimPending(newId(), ['tab1'], 'tab2')).rejects.toThrow();
      await expect(db.setRegistered(newId())).rejects.toThrow();
      await expect(db.getMeta('k')).rejects.toThrow();
      await expect(db.setMeta('k', 1)).rejects.toThrow();
    } finally {
      await deleteName(name);
    }
  });

  it('settles a write on the transaction, not on its requests: a late abort rejects', async () => {
    const name = testName();
    let abort = false;
    try {
      const db = must(await openSimDb({ name, abortWrites: () => abort }));
      const s = sim();
      await db.createSim(s, { current: true });
      abort = true;
      const a = putOf('a');
      // every request of the batch succeeds before the transaction is aborted
      await expect(
        db.write(s.simId, batch('tab1', [a]), {
          marker: { key: 'm', value: 1, expect: undefined }
        })
      ).rejects.toThrow();
      abort = false;
      expect((await db.read(s.simId)).pending).toEqual([]);
      expect(await db.getMeta('m')).toBeUndefined();
      expect(await db.getMeta(`n:${s.simId}`)).toBeUndefined();
      db.close();
    } finally {
      await deleteName(name);
    }
  });

  it('allocates distinct n from two connections writing at once', async () => {
    const name = testName();
    try {
      const a = must(await openSimDb({ name }));
      const b = must(await openSimDb({ name }));
      const simId = newId();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => [
          a.write(simId, batch('tabA', [putOf(`a${i}`)])),
          b.write(simId, batch('tabB', [putOf(`b${i}`)]))
        ]).flat()
      );
      const ns = results.flatMap((r) => Object.values(r.n));
      expect(ns).toHaveLength(20);
      expect(new Set(ns).size).toBe(20);
      expect([...ns].sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
      expect((await a.read(simId)).pending).toHaveLength(20);
      a.close();
      b.close();
    } finally {
      await deleteName(name);
    }
  });

  it('lets only one of two connections set current', async () => {
    const name = testName();
    try {
      const a = must(await openSimDb({ name }));
      const b = must(await openSimDb({ name }));
      const [ra, rb] = await Promise.all([
        a.createSim(sim(), { current: true }),
        b.createSim(sim(), { current: true })
      ]);
      expect([ra.outcome, rb.outcome].sort()).toEqual(['created', 'current-taken']);
      expect(ra.current).toBe(rb.current);
      a.close();
      b.close();
    } finally {
      await deleteName(name);
    }
  });
});
