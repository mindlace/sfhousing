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
        const own = putOf('own');
        await db.write(simId, batch('tab1', { put: [own] }));
        const before = await db.read(simId);
        const w = await db.write(
          simId,
          batch('tab1', { confirmed: [commitAt(1)], put: [putOf('b')], remove: [own.id] }),
          { marker: { key: 'm', value: 'x', expect: 'other' } }
        );
        expect(w).toEqual({ applied: false, n: {}, lost: [] });
        expect(await db.read(simId)).toEqual(before);
        expect(await db.getMeta(nKey(simId))).toBe(1);
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

    it('keeps the stored n for a put with n, and moves a put without n to the end', () =>
      withDb(async (db) => {
        const simId = newId();
        const [a, b, c] = [putOf('a'), putOf('b'), putOf('c')];
        await db.write(simId, batch('tab1', { put: [a, b, c] }));
        const order = async () =>
          (await db.read(simId)).pending.map((r) => [r.id, r.n] as [string, number]);

        // a given n is ignored: the stored one stays, whatever the caller thinks it is
        const changed = pendingOf('a2');
        const same = await db.write(
          simId,
          batch('tab1', { put: [{ id: a.id, pending: changed, n: 1 }] })
        );
        expect(same.n).toEqual({ [a.id]: 1 });
        const stale = await db.write(
          simId,
          batch('tab1', { put: [{ id: a.id, pending: pendingOf('a3'), n: 2 }] })
        );
        expect(stale.n).toEqual({ [a.id]: 1 });
        const above = await db.write(
          simId,
          batch('tab1', { put: [{ id: b.id, pending: b.pending, n: 99 }] })
        );
        expect(above.n).toEqual({ [b.id]: 2 });
        expect(await order()).toEqual([
          [a.id, 1],
          [b.id, 2],
          [c.id, 3]
        ]);
        expect((await db.read(simId)).pending[0].pending.draft.label).toBe('a3');

        // the counter was not set from a caller's n: the next new record gets 4
        const d = putOf('d');
        expect((await db.write(simId, batch('tab1', { put: [d] }))).n).toEqual({ [d.id]: 4 });
        expect(await db.getMeta(nKey(simId))).toBe(4);

        // without n: a new n at the tail, and the rest of the record replaced
        const moved = await db.write(
          simId,
          batch('tab1', { put: [{ id: a.id, pending: changed }] })
        );
        expect(moved.n).toEqual({ [a.id]: 5 });
        const read = await db.read(simId);
        expect(read.pending.map((r) => [r.id, r.n])).toEqual([
          [b.id, 2],
          [c.id, 3],
          [d.id, 4],
          [a.id, 5]
        ]);
        expect(read.pending[3]).toEqual({
          simId,
          id: a.id,
          n: 5,
          owner: 'tab1',
          pending: changed
        });
      }));

    it('an id both put and removed in one batch ends removed', () =>
      withDb(async (db) => {
        const simId = newId();
        const [a, b] = [putOf('a'), putOf('b')];
        await db.write(simId, batch('tab1', { put: [a] }));
        await db.write(simId, batch('tab1', { put: [b], remove: [b.id, a.id] }));
        expect((await db.read(simId)).pending).toEqual([]);
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

    it('an aborted createSim writes nothing: no sim, current, marker, row or counter', async () => {
      let abort = false;
      await using({ abortWrites: () => abort }, async (db) => {
        const s = sim();
        const a = putOf('a');
        abort = true;
        await expect(
          db.createSim(s, {
            current: true,
            marker: { key: 'm', value: 1, expect: undefined },
            batch: batch('tab1', { confirmed: [commitAt(1)], put: [a] })
          })
        ).rejects.toThrow();
        abort = false;
        expect(await db.read(s.simId)).toEqual({ sim: null, confirmed: [], pending: [] });
        expect(await db.getMeta(CURRENT_KEY)).toBeUndefined();
        expect(await db.getMeta('m')).toBeUndefined();
        expect(await db.getMeta(nKey(s.simId))).toBeUndefined();
        // and the same call, once it may, behaves as on a fresh database
        const r = await db.createSim(s, {
          current: true,
          batch: batch('tab1', { put: [a] })
        });
        expect(r.outcome).toBe('created');
        expect(r.n).toEqual({ [a.id]: 1 });
      });
    });

    it('a write, claim, registration or meta write that aborts rejects and changes nothing', async () => {
      let abort = false;
      await using({ abortWrites: () => abort }, async (db) => {
        const s = sim();
        const a = putOf('a');
        await db.createSim(s, {
          current: true,
          batch: batch('tab1', { confirmed: [commitAt(1)], put: [a] })
        });
        await db.setMeta('k0', 'kept');
        const snapshot = async () => ({
          read: await db.read(s.simId),
          current: await db.getMeta(CURRENT_KEY),
          counter: await db.getMeta(nKey(s.simId)),
          k0: await db.getMeta('k0'),
          m: await db.getMeta('m'),
          k: await db.getMeta('k')
        });
        const before = await snapshot();
        abort = true;

        const b = putOf('b');
        await expect(
          db.write(s.simId, batch('tab1', { confirmed: [commitAt(2)], put: [b], remove: [a.id] }), {
            marker: { key: 'm', value: 1, expect: undefined }
          })
        ).rejects.toThrow();
        abort = false;
        expect(await snapshot()).toEqual(before);
        abort = true;

        await expect(db.claimPending(s.simId, ['tab1'], 'tab2')).rejects.toThrow();
        await expect(db.setRegistered(s.simId)).rejects.toThrow();
        await expect(db.setMeta('k', 1)).rejects.toThrow();
        await expect(
          db.createSim(sim(), { marker: { key: 'm', value: 1, expect: undefined } })
        ).rejects.toThrow();
        abort = false;
        expect(await snapshot()).toEqual(before);

        // no n was spent by the aborted batch
        const c = putOf('c');
        expect((await db.write(s.simId, batch('tab1', { put: [c] }))).n).toEqual({ [c.id]: 2 });
      });
    });

    it('createSim on a known sim keeps its record and still applies the batch', () =>
      withDb(async (db) => {
        const s = sim(newId(), { createdAt: 5 });
        await db.createSim(s);
        await db.setRegistered(s.simId);
        const a = putOf('a');
        const r = await db.createSim(
          { ...s, createdAt: 99, registered: false },
          { current: true, batch: batch('tab1', { put: [a] }) }
        );
        expect(r).toEqual({
          outcome: 'created',
          applied: true,
          n: { [a.id]: 1 },
          lost: [],
          current: s.simId
        });
        const read = await db.read(s.simId);
        expect(read.sim).toEqual({ ...s, registered: true });
        expect(read.pending.map((p) => p.id)).toEqual([a.id]);
      }));

    it('keys of the store are reserved: setMeta and a marker on them reject without writing', () =>
      withDb(async (db) => {
        const s = sim();
        await db.createSim(s, { current: true });
        const a = putOf('a');
        await db.write(s.simId, batch('tab1', { put: [a] }));
        for (const key of [CURRENT_KEY, nKey(s.simId), 'n:anything']) {
          await expect(db.setMeta(key, 'x')).rejects.toThrow();
          const marker = { key, value: 'x', expect: await db.getMeta(key) };
          const w = batch('tab1', { put: [putOf('b')] });
          await expect(db.write(s.simId, w, { marker })).rejects.toThrow();
          await expect(db.createSim(sim(), { marker, batch: w })).rejects.toThrow();
        }
        expect(await db.getMeta(CURRENT_KEY)).toBe(s.simId);
        expect(await db.getMeta(nKey(s.simId))).toBe(1);
        expect((await db.read(s.simId)).pending.map((p) => p.id)).toEqual([a.id]);
      }));

    it('overlapping claims give each record to exactly one claimer', () =>
      withDb(async (db) => {
        const simId = newId();
        const puts = [putOf('a'), putOf('b'), putOf('c')];
        await db.write(simId, batch('tab1', { put: puts }));
        const [x, y] = await Promise.all([
          db.claimPending(simId, ['tab1'], 'tab2'),
          db.claimPending(simId, ['tab1'], 'tab3')
        ]);
        expect(x.length + y.length).toBe(3);
        expect([...x, ...y].map((r) => r.id).sort()).toEqual(puts.map((p) => p.id).sort());
        expect(new Set([...x, ...y].map((r) => r.owner)).size).toBe(1);
        const read = await db.read(simId);
        expect(new Set(read.pending.map((r) => r.owner)).size).toBe(1);
      }));

    it('overlapping createSim calls asking for current: exactly one becomes current', () =>
      withDb(async (db) => {
        const [s1, s2] = [sim(), sim()];
        const [r1, r2] = await Promise.all([
          db.createSim(s1, { current: true }),
          db.createSim(s2, { current: true })
        ]);
        expect([r1.outcome, r2.outcome].sort()).toEqual(['created', 'current-taken']);
        const winner = r1.outcome === 'created' ? s1 : s2;
        const loser = winner === s1 ? s2 : s1;
        expect(await db.getMeta(CURRENT_KEY)).toBe(winner.simId);
        expect(r1.current).toBe(winner.simId);
        expect(r2.current).toBe(winner.simId);
        expect((await db.read(loser.simId)).sim).toBeNull();
      }));

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

        // what write is given, what claimPending returns, a marker's value
        const w = putOf('w');
        const wb = batch('tab1', { put: [w] });
        const value = { v: 1 };
        await db.write(s.simId, wb, { marker: { key: 'mk', value, expect: undefined } });
        w.pending.draft.label = 'changed';
        value.v = 2;
        expect(await db.getMeta('mk')).toEqual({ v: 1 });
        const claimed = await db.claimPending(s.simId, ['tab1'], 'tab2');
        for (const r of claimed) r.pending.draft.label = 'claimed';
        const third = await db.read(s.simId);
        expect(third.pending.map((r) => r.pending.draft.label)).toEqual(['a', 'w']);

        const meta = { x: 1 };
        await db.setMeta('k', meta);
        meta.x = 2;
        const got = (await db.getMeta('k')) as { x: number };
        got.x = 3;
        expect(await db.getMeta('k')).toEqual({ x: 1 });
      }));
  });
}
