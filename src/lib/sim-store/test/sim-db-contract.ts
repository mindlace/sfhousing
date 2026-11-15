/**
 * What every SimDb must do. Runs in Node (memory) and in a browser (IndexedDB): no Node-only APIs,
 * no fake timers, nothing from $lib/server. Each test makes its own database and drops it.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '$lib/ids/base58';
import type { Commit } from '$lib/sim-log';
import {
  CURRENT_KEY,
  nKey,
  type PendingPut,
  type SimDb,
  type SimRecord,
  type WriteBatch
} from '../sim-db';
import type { Pending } from '../types';
import { draftOf, nameChange, stamped } from './commits';

export type MakeSimDb = (opts?: { abortWrites?: () => boolean }) => Promise<SimDb>;

const sim = (simId = newId(), over: Partial<SimRecord> = {}): SimRecord => ({
  simId,
  createdAt: 1000,
  registered: false,
  ...over
});
const pendingOf = (name: string, parent = 0): Pending => ({
  draft: draftOf(parent, [nameChange(name)], { label: name }),
  targetId: null
});
const putOf = (name: string, n?: number): PendingPut => {
  const pending = pendingOf(name);
  return n === undefined ? { id: pending.draft.id, pending } : { id: pending.draft.id, pending, n };
};
const batch = (owner: string, over: Partial<WriteBatch> = {}): WriteBatch => ({
  owner,
  confirmed: [],
  put: [],
  remove: [],
  ...over
});
const commitAt = (seq: number): Commit => stamped(draftOf(seq - 1, [nameChange(`c${seq}`)]), seq);

export function simDbContract(
  make: MakeSimDb,
  drop: (db: SimDb) => Promise<void> = async (db) => db.close()
): void {
  async function using(
    opts: { abortWrites?: () => boolean } | undefined,
    body: (db: SimDb) => Promise<void>
  ): Promise<void> {
    const db = await make(opts);
    try {
      await body(db);
    } finally {
      await drop(db);
    }
  }
  const withDb = (body: (db: SimDb) => Promise<void>) => using(undefined, body);

  describe('SimDb contract', () => {
    it('reads an unknown sim as empty', () =>
      withDb(async (db) => {
        expect(await db.read(newId())).toEqual({ sim: null, confirmed: [], pending: [] });
      }));

    it('creates a sim, sets current and writes its first batch in one call', () =>
      withDb(async (db) => {
        const s = sim();
        const a = putOf('a');
        const c1 = commitAt(1);
        const r = await db.createSim(s, {
          current: true,
          batch: batch('tab1', { confirmed: [c1], put: [a] })
        });
        expect(r).toEqual({
          outcome: 'created',
          applied: true,
          n: { [a.id]: 1 },
          lost: [],
          current: s.simId
        });
        expect(await db.getMeta(CURRENT_KEY)).toBe(s.simId);
        const read = await db.read(s.simId);
        expect(read.sim).toEqual(s);
        expect(read.confirmed).toEqual([c1]);
        expect(read.pending).toEqual([
          { simId: s.simId, id: a.id, n: 1, owner: 'tab1', pending: a.pending }
        ]);
      }));

    it('answers current-taken and writes nothing when current is set', () =>
      withDb(async (db) => {
        const first = sim();
        await db.createSim(first, { current: true });
        const second = sim();
        const r = await db.createSim(second, {
          current: true,
          marker: { key: 'm', value: 1, expect: undefined },
          batch: batch('tab1', { put: [putOf('a')] })
        });
        expect(r.outcome).toBe('current-taken');
        expect(r.applied).toBe(false);
        expect(r.current).toBe(first.simId);
        expect(await db.getMeta(CURRENT_KEY)).toBe(first.simId);
        expect(await db.getMeta('m')).toBeUndefined();
        expect(await db.read(second.simId)).toEqual({ sim: null, confirmed: [], pending: [] });
      }));

    it('answers marker and writes nothing when the marker does not match', () =>
      withDb(async (db) => {
        await db.setMeta('m', 'there');
        const s = sim();
        const r = await db.createSim(s, {
          current: true,
          marker: { key: 'm', value: 'new', expect: undefined },
          batch: batch('tab1', { put: [putOf('a')] })
        });
        expect(r.outcome).toBe('marker');
        expect(r.applied).toBe(false);
        expect(r.current).toBeNull();
        expect(await db.getMeta('m')).toBe('there');
        expect(await db.getMeta(CURRENT_KEY)).toBeUndefined();
        expect(await db.read(s.simId)).toEqual({ sim: null, confirmed: [], pending: [] });

        // the marker is checked before current-taken
        await db.createSim(sim(), { current: true });
        const both = await db.createSim(sim(), {
          current: true,
          marker: { key: 'm', value: 'new', expect: undefined }
        });
        expect(both.outcome).toBe('marker');

        // a write whose marker does not match writes nothing
        const simId = newId();
        const w = await db.write(simId, batch('tab1', { put: [putOf('b')] }), {
          marker: { key: 'm', value: 'x', expect: 'other' }
        });
        expect(w).toEqual({ applied: false, n: {}, lost: [] });
        expect(await db.read(simId)).toEqual({ sim: null, confirmed: [], pending: [] });
        expect(await db.getMeta('m')).toBe('there');
      }));

    it('writes the marker with the batch when it matches, on create and on write', () =>
      withDb(async (db) => {
        const s = sim();
        const a = putOf('a');
        const created = await db.createSim(s, {
          marker: { key: 'import', value: { done: 1 }, expect: undefined },
          batch: batch('tab1', { put: [a] })
        });
        expect(created.outcome).toBe('created');
        expect(await db.getMeta('import')).toEqual({ done: 1 });
        expect((await db.read(s.simId)).pending.map((r) => r.id)).toEqual([a.id]);

        const b = putOf('b');
        const w = await db.write(s.simId, batch('tab1', { put: [b] }), {
          marker: { key: 'import', value: { done: 2 }, expect: { done: 1 } }
        });
        expect(w.applied).toBe(true);
        expect(await db.getMeta('import')).toEqual({ done: 2 });
        expect((await db.read(s.simId)).pending.map((r) => r.id)).toEqual([a.id, b.id]);
      }));

    it('allocates n in put order, across writes, never reusing one', () =>
      withDb(async (db) => {
        const simId = newId();
        const [a, b, c] = [putOf('a'), putOf('b'), putOf('c')];
        const r1 = await db.write(simId, batch('tab1', { put: [a, b] }));
        expect(r1.n).toEqual({ [a.id]: 1, [b.id]: 2 });
        await db.write(simId, batch('tab1', { remove: [b.id] }));
        const r2 = await db.write(simId, batch('tab1', { put: [c] }));
        expect(r2.n).toEqual({ [c.id]: 3 });
        expect(await db.getMeta(nKey(simId))).toBe(3);
        const other = newId();
        const o = putOf('o');
        expect((await db.write(other, batch('tab1', { put: [o] }))).n).toEqual({ [o.id]: 1 });
      }));

    it('keeps a given n and moves a put without n to the end', () =>
      withDb(async (db) => {
        const simId = newId();
        const [a, b, c] = [putOf('a'), putOf('b'), putOf('c')];
        await db.write(simId, batch('tab1', { put: [a, b, c] }));
        const changed = pendingOf('a2');
        const kept = await db.write(
          simId,
          batch('tab1', { put: [{ id: a.id, pending: changed, n: 1 }] })
        );
        expect(kept.n).toEqual({ [a.id]: 1 });
        let read = await db.read(simId);
        expect(read.pending.map((r) => [r.id, r.n])).toEqual([
          [a.id, 1],
          [b.id, 2],
          [c.id, 3]
        ]);
        expect(read.pending[0].pending).toEqual(changed);

        const moved = await db.write(
          simId,
          batch('tab1', { put: [{ id: a.id, pending: a.pending }] })
        );
        expect(moved.n).toEqual({ [a.id]: 4 });
        read = await db.read(simId);
        expect(read.pending.map((r) => [r.id, r.n])).toEqual([
          [b.id, 2],
          [c.id, 3],
          [a.id, 4]
        ]);
      }));

    it('a put of a record another owner holds is lost, not written', () =>
      withDb(async (db) => {
        const simId = newId();
        const a = putOf('a');
        await db.write(simId, batch('tab1', { put: [a] }));
        const mine = putOf('mine');
        const r = await db.write(
          simId,
          batch('tab2', { put: [{ id: a.id, pending: pendingOf('stolen') }, mine] })
        );
        expect(r.lost).toEqual([a.id]);
        expect(r.n).toEqual({ [mine.id]: 2 });
        const read = await db.read(simId);
        expect(read.pending.map((p) => [p.id, p.owner])).toEqual([
          [a.id, 'tab1'],
          [mine.id, 'tab2']
        ]);
        expect(read.pending[0].pending).toEqual(a.pending);

        // with an n as well
        const again = await db.write(
          simId,
          batch('tab2', { put: [{ id: a.id, pending: pendingOf('stolen'), n: 1 }] })
        );
        expect(again.lost).toEqual([a.id]);
        expect((await db.read(simId)).pending[0].pending).toEqual(a.pending);
      }));

    it('a put with n of a record that is gone is lost, not recreated', () =>
      withDb(async (db) => {
        const simId = newId();
        const a = putOf('a');
        await db.write(simId, batch('tab1', { put: [a] }));
        await db.write(simId, batch('tab1', { remove: [a.id] }));
        const r = await db.write(
          simId,
          batch('tab1', { put: [{ id: a.id, pending: a.pending, n: 1 }] })
        );
        expect(r.lost).toEqual([a.id]);
        expect(r.n).toEqual({});
        expect((await db.read(simId)).pending).toEqual([]);
      }));

    it("removes only the owner's pending records, and leaves other sims alone", () =>
      withDb(async (db) => {
        const simId = newId();
        const elsewhere = newId();
        const [a, b] = [putOf('a'), putOf('b')];
        const same = putOf('same');
        await db.write(simId, batch('tab1', { put: [a] }));
        await db.write(simId, batch('tab2', { put: [b] }));
        await db.write(elsewhere, batch('tab1', { put: [same] }));
        await db.write(simId, batch('tab1', { remove: [a.id, b.id, same.id] }));
        expect((await db.read(simId)).pending.map((r) => r.id)).toEqual([b.id]);
        expect((await db.read(elsewhere)).pending.map((r) => r.id)).toEqual([same.id]);
      }));

    it('puts confirmed commits idempotently and reads them in seq order', () =>
      withDb(async (db) => {
        const simId = newId();
        const [c1, c2, c3] = [commitAt(1), commitAt(2), commitAt(3)];
        await db.write(simId, batch('tab1', { confirmed: [c3, c1] }));
        await db.write(simId, batch('tab1', { confirmed: [c1, c2, c3] }));
        const read = await db.read(simId);
        expect(read.confirmed).toEqual([c1, c2, c3]);
        expect((await db.read(newId())).confirmed).toEqual([]);
      }));

    it('claims only the given owners, once (a second claim gets nothing)', () =>
      withDb(async (db) => {
        const simId = newId();
        const [a, b, c] = [putOf('a'), putOf('b'), putOf('c')];
        await db.write(simId, batch('tab1', { put: [a] }));
        await db.write(simId, batch('tab2', { put: [b] }));
        await db.write(simId, batch('tab3', { put: [c] }));
        const claimed = await db.claimPending(simId, ['tab1', 'tab2'], 'tab4');
        expect(claimed.map((r) => [r.id, r.owner])).toEqual([
          [a.id, 'tab4'],
          [b.id, 'tab4']
        ]);
        expect(await db.claimPending(simId, ['tab1', 'tab2'], 'tab5')).toEqual([]);
        expect((await db.read(simId)).pending.map((r) => r.owner)).toEqual([
          'tab4',
          'tab4',
          'tab3'
        ]);
        expect(await db.claimPending(newId(), ['tab1'], 'tab4')).toEqual([]);
      }));

    it('a write whose transaction aborts rejects and writes nothing', async () => {
      let abort = false;
      await using({ abortWrites: () => abort }, async (db) => {
        const s = sim();
        const a = putOf('a');
        await db.createSim(s, { current: true, batch: batch('tab1', { put: [a] }) });
        abort = true;

        const b = putOf('b');
        await expect(
          db.write(s.simId, batch('tab1', { confirmed: [commitAt(1)], put: [b], remove: [a.id] }), {
            marker: { key: 'm', value: 1, expect: undefined }
          })
        ).rejects.toThrow();
        await expect(
          db.createSim(sim(), { marker: { key: 'm', value: 1, expect: undefined } })
        ).rejects.toThrow();
        await expect(db.claimPending(s.simId, ['tab1'], 'tab2')).rejects.toThrow();
        await expect(db.setRegistered(s.simId)).rejects.toThrow();
        await expect(db.setMeta('k', 1)).rejects.toThrow();

        abort = false;
        const read = await db.read(s.simId);
        expect(read.confirmed).toEqual([]);
        expect(read.pending.map((r) => [r.id, r.owner])).toEqual([[a.id, 'tab1']]);
        expect(read.sim?.registered).toBe(false);
        expect(await db.getMeta('m')).toBeUndefined();
        expect(await db.getMeta('k')).toBeUndefined();
        expect(await db.getMeta(CURRENT_KEY)).toBe(s.simId);
        // no n was spent by the aborted batch
        const c = putOf('c');
        expect((await db.write(s.simId, batch('tab1', { put: [c] }))).n).toEqual({ [c.id]: 2 });
      });
    });

    it('marks a sim registered', () =>
      withDb(async (db) => {
        const s = sim();
        await db.createSim(s);
        expect((await db.read(s.simId)).sim?.registered).toBe(false);
        await db.setRegistered(s.simId);
        await db.setRegistered(s.simId);
        expect((await db.read(s.simId)).sim).toEqual({ ...s, registered: true });
        await db.setRegistered(newId());
        expect((await db.read(s.simId)).sim?.registered).toBe(true);
      }));

    it('reads and writes meta, undefined when absent', () =>
      withDb(async (db) => {
        expect(await db.getMeta('nope')).toBeUndefined();
        await db.setMeta('k', { a: [1, 'two', null] });
        expect(await db.getMeta('k')).toEqual({ a: [1, 'two', null] });
        await db.setMeta('k', 'later');
        expect(await db.getMeta('k')).toBe('later');
      }));

    it('returns copies: a change to a read or a written object reaches nothing', () =>
      withDb(async (db) => {
        const s = sim();
        const a = putOf('a');
        const c1 = commitAt(1);
        const b = batch('tab1', { confirmed: [c1], put: [a] });
        await db.createSim(s, { batch: b });
        // a change to what was written
        s.registered = true;
        a.pending.draft.label = 'changed';
        c1.label = 'changed';

        const read = await db.read(s.simId);
        expect(read.sim?.registered).toBe(false);
        expect(read.pending[0].pending.draft.label).toBe('a');
        expect(read.confirmed[0].label).toBe('Edit');

        // a change to what was read
        read.pending[0].pending.draft.label = 'again';
        read.confirmed[0].label = 'again';
        if (read.sim) read.sim.registered = true;
        const second = await db.read(s.simId);
        expect(second.sim?.registered).toBe(false);
        expect(second.pending[0].pending.draft.label).toBe('a');
        expect(second.confirmed[0].label).toBe('Edit');

        const meta = { x: 1 };
        await db.setMeta('k', meta);
        meta.x = 2;
        const got = (await db.getMeta('k')) as { x: number };
        got.x = 3;
        expect(await db.getMeta('k')).toEqual({ x: 1 });
      }));
  });
}
