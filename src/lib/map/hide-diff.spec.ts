import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyHideDiff, planSlices, SLICE_IDS } from './hide';
import { emptyPack } from './pack';
import type { GeneratedUpdate, PackedCell } from './types';

const POOL = Array.from({ length: 30 }, (_, i) => `p${i}`);

describe('applyHideDiff mirror', () => {
  it('mirror equals the set of ids currently replacing existing', () => {
    const revision = fc.dictionary(
      fc.constantFrom(...POOL),
      fc.constantFrom<boolean | null>(true, false, null)
    );
    fc.assert(
      fc.property(fc.array(revision, { maxLength: 12 }), (revs) => {
        const mirror = new Set<string>();
        let prev = new Set<string>();
        const everTrue = new Set<string>();
        for (const rev of revs) {
          const cur = new Set(Object.keys(rev).filter((k) => rev[k] === true));
          const add = [...cur].filter((id) => !prev.has(id));
          const remove = [...prev].filter((id) => !cur.has(id));
          applyHideDiff(mirror, { add, remove });
          cur.forEach((id) => everTrue.add(id));
          prev = cur;
          expect([...mirror].sort()).toEqual([...cur].sort());
        }
        for (const id of POOL) if (!everTrue.has(id)) expect(mirror.has(id)).toBe(false);
      })
    );
  });

  it('removes first, then adds', () => {
    const m = new Set(['a']);
    applyHideDiff(m, { add: ['a'], remove: ['a'] });
    expect(m.has('a')).toBe(true);
  });
});

function cell(cellId: string, ids: string[]): PackedCell {
  return { ...emptyPack(cellId), parcelIds: ids };
}
function update(cells: PackedCell[], add: string[], remove: string[] = []): GeneratedUpdate {
  return {
    revision: 1,
    cells: cells.map((c) => ({ settled: c, rising: null })),
    removedCells: [],
    hide: { add, remove }
  };
}

describe('planSlices', () => {
  it('returns one slice for small diffs', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const u = update([cell('c', ids)], ids);
    const s = planSlices(u);
    expect(s).toHaveLength(1);
    expect(s[0].add).toEqual(ids);
    expect(s[0].cells).toEqual(u.cells);
  });

  it('partitions 5000 adds over 5 cells in order', () => {
    const cells = Array.from({ length: 5 }, (_, c) =>
      cell(
        `c${c}`,
        Array.from({ length: 1000 }, (_, i) => `c${c}-${i}`)
      )
    );
    const add = cells.flatMap((c) => c.parcelIds);
    const remove = ['r1', 'r2'];
    const u = update(cells, add, remove);
    const s = planSlices(u);
    expect(s.flatMap((x) => x.cells.map((c) => c.settled.cellId))).toEqual(
      cells.map((c) => c.cellId)
    );
    expect(s.flatMap((x) => x.add).sort()).toEqual([...add].sort());
    for (const x of s.slice(0, -1)) expect(x.add.length).toBeGreaterThanOrEqual(SLICE_IDS);
    expect(s[0].remove).toEqual(remove);
    expect(s.slice(1).every((x) => x.remove.length === 0)).toBe(true);
    expect(s.length).toBeGreaterThan(1);
  });

  it('puts adds missing from any cell into slice 0', () => {
    const c = cell(
      'c',
      Array.from({ length: 2500 }, (_, i) => `x${i}`)
    );
    const u = update([c], [...c.parcelIds, 'orphan']);
    const s = planSlices(u);
    expect(s[0].add).toContain('orphan');
    expect(s.flatMap((x) => x.add)).toHaveLength(2501);
  });

  it('puts a remove-only diff of 3000 in slice 0', () => {
    const remove = Array.from({ length: 3000 }, (_, i) => `r${i}`);
    const s = planSlices(update([], [], remove));
    expect(s[0].remove).toEqual(remove);
    expect(s.flatMap((x) => x.remove)).toHaveLength(3000);
  });
});
