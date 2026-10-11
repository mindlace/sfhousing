import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { arbGridOps } from './fixtures/arbitraries';
import {
  GRID_CHUNKS,
  GRID_RECORDS,
  gridId,
  gridIndex,
  gridLngLat,
  gridRecord
} from './fixtures/grid-20x20';
import { bruteForceResolve } from './fixtures/reference';
import { createParcelIndex } from './parcel-index';
import {
  applyOp,
  resolveChunk,
  resolveEnvelopes,
  resolveParcels,
  type EnvelopeMap
} from './resolve';
import type { Plan, PlanOp } from './types';

const FC = { numRuns: 200, seed: 20261010 };
const plan = (ops: PlanOp[]): Plan => ({ schema: 1, datasetVersion: 'fixture-0', ops });
const paint = (id: string, stories: number, radiusM: number, path: [number, number][]): PlanOp => ({
  kind: 'paint',
  id,
  stories,
  radiusM,
  path
});
const erase = (id: string, radiusM: number, path: [number, number][]): PlanOp => ({
  kind: 'erase',
  id,
  radiusM,
  path
});
const entries = (m: EnvelopeMap) =>
  [...m]
    .map(([id, e]) => [id, e.maxStories] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

describe('resolveEnvelopes', () => {
  it('later ops win absolutely (3 over 12 gives 3)', () => {
    const p = gridLngLat(4, 3); // n = 64, eligible
    const m = resolveEnvelopes(plan([paint('a', 12, 5, [p]), paint('b', 3, 5, [p])]), gridIndex());
    expect(m.get(gridId(4, 3))).toEqual({ maxStories: 3 });
  });

  it('erase deletes; erase over nothing is a no-op', () => {
    const p = gridLngLat(4, 3);
    const idx = gridIndex();
    expect(resolveEnvelopes(plan([paint('a', 4, 5, [p]), erase('b', 5, [p])]), idx).size).toBe(0);
    expect(resolveEnvelopes(plan([erase('b', 50, [p])]), idx).size).toBe(0);
  });

  it('ineligible parcels never get an entry', () => {
    const m = resolveEnvelopes(plan([paint('a', 9, 500, [gridLngLat(9, 9)])]), gridIndex());
    expect(m.size).toBe(GRID_RECORDS.filter((r) => r.eligible).length);
    for (const r of GRID_RECORDS) expect(m.has(r.id)).toBe(r.eligible);
  });

  it('empty plan, and a plan over unloaded parcels, resolve to an empty Map', () => {
    expect(resolveEnvelopes(plan([]), gridIndex()).size).toBe(0);
    expect(
      resolveEnvelopes(plan([paint('a', 9, 500, [gridLngLat(9, 9)])]), createParcelIndex()).size
    ).toBe(0);
  });

  it('iterates in ascending id order whatever the chunk order, with frozen fresh envelopes', () => {
    const ops = [paint('a', 9, 60, [gridLngLat(15, 15)]), paint('b', 2, 60, [gridLngLat(4, 4)])];
    const a = resolveEnvelopes(plan(ops), gridIndex([3, 2, 1, 0]));
    const ids = [...a.keys()];
    expect(ids).toEqual([...ids].sort());
    expect([...a]).toEqual([...resolveEnvelopes(plan(ops), gridIndex())]);
    const envs = [...a.values()];
    expect(envs.every((e) => Object.isFrozen(e) && Object.keys(e).join() === 'maxStories')).toBe(
      true
    );
    expect(new Set(envs).size).toBe(envs.length);
  });

  it('agrees with the brute-force reference on random plans', () => {
    const index = gridIndex();
    fc.assert(
      fc.property(arbGridOps(8), (ops) => {
        expect(entries(resolveEnvelopes(plan(ops), index))).toEqual(
          bruteForceResolve(plan(ops), GRID_RECORDS)
        );
      }),
      FC
    );
  });
});

describe('applyOp', () => {
  it('reports coverage split by eligibility, and only real changes, ascending', () => {
    const idx = gridIndex();
    const state: EnvelopeMap = new Map();
    const op = paint('a', 4, 5, [gridLngLat(7, 0)]); // (7,0) is ineligible
    const r1 = applyOp(state, op, idx);
    expect(r1.coverage).toEqual({ eligible: [], ineligible: [gridId(7, 0)] });
    expect(r1.changes).toEqual([]);

    const p = paint('b', 4, 12, [gridLngLat(4, 3)]);
    const r2 = applyOp(state, p, idx);
    expect(r2.changes.length).toBe(r2.coverage.eligible.length);
    expect(r2.changes.every((c) => c.before === null && c.after?.maxStories === 4)).toBe(true);
    expect(r2.changes.map((c) => c.id)).toEqual([...r2.changes.map((c) => c.id)].sort());

    const r3 = applyOp(state, { ...p, id: 'c' }, idx); // same value again
    expect(r3.changes).toEqual([]);

    const r4 = applyOp(state, erase('d', 12, [gridLngLat(4, 3)]), idx);
    expect(r4.changes.every((c) => c.after === null && c.before?.maxStories === 4)).toBe(true);
    expect(state.size).toBe(0);
  });

  it('a stroke only over ineligible parcels yields { eligible: [], ineligible: [...] }', () => {
    const r = applyOp(new Map(), erase('e', 5, [gridLngLat(0, 0)]), gridIndex()); // n = 0
    expect(r.coverage).toEqual({ eligible: [], ineligible: [gridId(0, 0)] });
  });

  it('P1 append: applyOp(resolve(ops[..k]), op) ≡ resolve(ops[..k+1])', () => {
    const index = gridIndex();
    fc.assert(
      fc.property(
        arbGridOps(8).filter((o) => o.length > 0),
        (ops) => {
          const state = resolveEnvelopes(plan(ops.slice(0, -1)), index);
          applyOp(state, ops[ops.length - 1], index);
          expect(entries(state)).toEqual(entries(resolveEnvelopes(plan(ops), index)));
        }
      ),
      FC
    );
  });
});

describe('resolveParcels (undo)', () => {
  it('returns null for unloaded or ineligible ids, ascending, deduplicated', () => {
    const r = resolveParcels([paint('a', 5, 500, [gridLngLat(9, 9)])], gridIndex(), [
      gridId(1, 0),
      'missing',
      gridId(0, 0),
      gridId(1, 0)
    ]);
    expect([...r]).toEqual([
      [gridId(0, 0), null],
      [gridId(1, 0), { maxStories: 5 }],
      ['missing', null]
    ]);
  });

  it('P2 undo: patching resolve(ops) with resolveParcels ≡ resolve(ops[..k-1])', () => {
    const index = gridIndex();
    fc.assert(
      fc.property(
        arbGridOps(8).filter((o) => o.length > 0),
        (ops) => {
          const last = ops[ops.length - 1];
          const prev = ops.slice(0, -1);
          const state = resolveEnvelopes(plan(ops), index);
          const ids = index.covered(last).filter((id) => index.get(id)!.eligible);
          for (const [id, env] of resolveParcels(prev, index, ids)) {
            if (env) state.set(id, env);
            else state.delete(id);
          }
          expect(entries(state)).toEqual(entries(resolveEnvelopes(plan(prev), index)));
        }
      ),
      FC
    );
  });
});

describe('resolveChunk (late chunks)', () => {
  it('returns {} for no added ids', () => {
    expect(resolveChunk(plan([]), gridIndex(), []).size).toBe(0);
  });

  it('P3: chunk order never matters, and late chunk + resolveChunk ≡ full resolve', () => {
    fc.assert(
      fc.property(
        arbGridOps(6),
        fc.shuffledSubarray([0, 1, 2, 3], { minLength: 4, maxLength: 4 }),
        (ops, order) => {
          const full = entries(resolveEnvelopes(plan(ops), gridIndex()));
          expect(entries(resolveEnvelopes(plan(ops), gridIndex(order)))).toEqual(full);

          const index = gridIndex(order.slice(0, 3));
          const state = resolveEnvelopes(plan(ops), index);
          const late = GRID_CHUNKS[order[3]];
          const added = index.addChunk(late.cellId, late.records);
          for (const [id, env] of resolveChunk(plan(ops), index, added))
            if (env) state.set(id, env);
          expect(entries(state)).toEqual(full);
        }
      ),
      FC
    );
  });

  it('ignores ops whose bbox misses the chunk', () => {
    const index = createParcelIndex();
    const rec: ParcelRecord = gridRecord(1, 1);
    const added = index.addChunk('one', [rec]);
    const far = paint('far', 7, 5, [gridLngLat(19, 19)]);
    expect([...resolveChunk(plan([far]), index, added)]).toEqual([[rec.id, null]]);
  });
});
