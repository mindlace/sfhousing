import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { arbGridOp } from './fixtures/arbitraries';
import {
  GRID_CHUNKS,
  GRID_RECORDS,
  gridId,
  gridIndex,
  gridLngLat,
  gridRecord
} from './fixtures/grid-20x20';
import { bruteForceCovered } from './fixtures/reference';
import { createParcelIndex } from './parcel-index';
import type { PlanOp } from './types';

const FC = { numRuns: 200, seed: 20261010 };
const CENTRE: [number, number] = [-122.418319, 37.760754]; // grid (9.5, 9.5), quantised

function stamp(radiusM: number, at: [number, number] = CENTRE): PlanOp {
  return { kind: 'paint', id: 's', stories: 5, radiusM, path: [at] };
}

describe('addChunk / hasChunk / get / size', () => {
  it('adds a chunk and returns its ids', () => {
    const index = createParcelIndex();
    const ids = index.addChunk('q00', GRID_CHUNKS[0].records);
    expect(ids).toEqual(GRID_CHUNKS[0].records.map((r) => r.id));
    expect(index.hasChunk('q00')).toBe(true);
    expect(index.hasChunk('q10')).toBe(false);
    expect(index.size).toBe(100);
    expect(index.get(gridId(0, 0))).toBe(GRID_CHUNKS[0].records[0]);
    expect(index.get('nope')).toBeUndefined();
  });

  it('re-adding a loaded cellId is a no-op that returns []', () => {
    const index = gridIndex();
    expect(index.addChunk('q00', GRID_CHUNKS[0].records)).toEqual([]);
    expect(index.size).toBe(400);
    expect(index.covered(stamp(25))).toHaveLength(16);
  });

  it('keeps the first copy of an id seen in two chunks when the records are identical', () => {
    const index = createParcelIndex();
    index.addChunk('a', [gridRecord(0, 0), gridRecord(1, 0)]);
    expect(index.addChunk('b', [gridRecord(1, 0), gridRecord(2, 0)])).toEqual([gridId(2, 0)]);
    expect(index.size).toBe(3);
    expect(index.covered(stamp(500))).toEqual([gridId(0, 0), gridId(1, 0), gridId(2, 0)]);
  });

  it('throws in dev builds when a duplicated id carries a different record', () => {
    const index = createParcelIndex();
    index.addChunk('a', [gridRecord(0, 0)]);
    const changed: ParcelRecord = { ...gridRecord(0, 0), existingUnits: 9 };
    expect(() => index.addChunk('b', [changed])).toThrow(/3600000/);
  });

  it('accepts an empty chunk', () => {
    const index = createParcelIndex();
    expect(index.addChunk('empty', [])).toEqual([]);
    expect(index.hasChunk('empty')).toBe(true);
    expect(index.covered(stamp(500))).toEqual([]);
  });
});

describe('covered', () => {
  it('a 25 m stamp at a cell centre covers the 16 nearest label points', () => {
    const ids = gridIndex().covered(stamp(25));
    const expected: string[] = [];
    for (let j = 0; j < 20; j++) {
      for (let i = 0; i < 20; i++) {
        if ((i - 9.5) ** 2 + (j - 9.5) ** 2 <= 6.25) expected.push(gridId(i, j));
      }
    }
    expect(ids).toEqual(expected.sort());
    expect(ids).toHaveLength(16);
  });

  it('includes ineligible parcels', () => {
    const ids = gridIndex().covered(stamp(5, gridLngLat(7, 0)));
    expect(ids).toEqual([gridId(7, 0)]);
    expect(gridRecord(7, 0).eligible).toBe(false);
  });

  it('covers across chunk boundaries along a polyline', () => {
    const op: PlanOp = {
      kind: 'erase',
      id: 'e',
      radiusM: 4,
      path: [gridLngLat(0, 9), gridLngLat(19, 9)]
    };
    expect(gridIndex().covered(op)).toHaveLength(20);
  });

  it('returns ascending ids whatever the chunk load order', () => {
    const op = stamp(60);
    const a = gridIndex([0, 1, 2, 3]).covered(op);
    const b = gridIndex([3, 1, 0, 2]).covered(op);
    expect(b).toEqual(a);
    expect([...a].sort()).toEqual(a);
  });

  it('orders ids of different lengths by JS string <', () => {
    const index = createParcelIndex();
    const mk = (id: string, i: number): ParcelRecord => ({ ...gridRecord(i, 0), id });
    index.addChunk('a', [mk('99', 0), mk('100', 1), mk('3512008A', 2), mk('3512008', 3)]);
    expect(index.covered(stamp(500))).toEqual(['100', '3512008', '3512008A', '99']);
  });

  it('P5: agrees with the brute-force reference', () => {
    const index = gridIndex();
    fc.assert(
      fc.property(arbGridOp, (op) => {
        expect(index.covered(op)).toEqual(bruteForceCovered(op, GRID_RECORDS));
      }),
      FC
    );
  });
});
