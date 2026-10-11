import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyHideDiff, MAX_CELLS_PER_SLICE, planSlices, SLICE_IDS, type Slice } from './hide';
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
function update(
  cells: PackedCell[],
  add: string[],
  remove: string[] = [],
  removedCells: string[] = []
): GeneratedUpdate {
  return {
    revision: 1,
    cells: cells.map((c) => ({ settled: c, rising: null })),
    removedCells,
    hide: { add, remove }
  };
}
const range = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i));
const cellIds = (s: Slice) => [...s.cells.map((c) => c.settled.cellId), ...s.removed];
const sliceOf = (slices: Slice[], cellId: string) =>
  slices.findIndex((s) => cellIds(s).includes(cellId));

describe('planSlices', () => {
  it('returns one slice for small diffs', () => {
    const ids = Array.from({ length: 100 }, (_, i) => `a${i}`);
    const u = update([cell('c', ids)], ids);
    const s = planSlices(u);
    expect(s).toHaveLength(1);
    expect(s[0].add).toEqual(ids);
    expect(s[0].cells).toEqual(u.cells);
  });

  it('single-slice fast path needs both ≤ SLICE_IDS ids and ≤ MAX_CELLS_PER_SLICE cells', () => {
    const four = range(MAX_CELLS_PER_SLICE - 1, (i) => `c${i}`).map((id) => cell(id, [`${id}-p`]));
    const u = update(four, [], ['x'], ['gone']);
    const one = planSlices(u);
    expect(one).toHaveLength(1);
    expect(one[0].removed).toEqual(['gone']);
    expect(one[0].remove).toEqual(['x']);
    const five = range(MAX_CELLS_PER_SLICE + 1, (i) => `c${i}`).map((id) => cell(id, []));
    expect(planSlices(update(five, [])).length).toBeGreaterThan(1);
  });

  it('a typology repaint (no hide ids) over many cells closes a slice every 4 cells', () => {
    const cells = range(75, (i) => `c${i}`).map((id) =>
      cell(
        id,
        range(1500, (k) => `${id}-${k}`)
      )
    );
    const s = planSlices(update(cells, []));
    expect(s.map((x) => x.cells.length)).toEqual([
      ...Array(Math.floor(75 / MAX_CELLS_PER_SLICE)).fill(MAX_CELLS_PER_SLICE),
      75 % MAX_CELLS_PER_SLICE
    ]);
    expect(s.flatMap((x) => x.cells)).toEqual(update(cells, []).cells);
  });

  it('each remove rides with the cell that held the parcel before the update', () => {
    const cells = range(6, (i) => `c${i}`).map((id) =>
      cell(
        id,
        range(1000, (k) => `${id}-${k}`)
      )
    );
    const add = cells.flatMap((c) => c.parcelIds);
    // c4 lost parcels old4-*; unknown-* had no generated building we know of.
    const remove = [...range(50, (k) => `old4-${k}`), 'unknown-1'];
    const prev = (id: string) => (id.startsWith('old4-') ? 'c4' : undefined);
    const s = planSlices(update(cells, add, remove), prev);
    const at = sliceOf(s, 'c4');
    expect(at).toBeGreaterThan(0);
    expect(s[at].remove).toEqual(range(50, (k) => `old4-${k}`));
    expect(s[0].remove).toEqual(['unknown-1']);
  });

  it('a whole-city erase: each removed cell travels with its removes, 2 cells per slice', () => {
    const removedCells = range(100, (i) => `c${i}`);
    const remove = removedCells.flatMap((c) => range(1500, (k) => `${c}-${k}`));
    const prev = (id: string) => id.slice(0, id.indexOf('-'));
    const s = planSlices(update([], [], remove, removedCells), prev);
    expect(s).toHaveLength(50);
    for (const x of s) {
      expect(x.removed).toHaveLength(2);
      expect(x.remove.map(prev).every((c) => x.removed.includes(c))).toBe(true);
      expect(x.remove).toHaveLength(3000);
    }
    expect(s.flatMap((x) => x.removed)).toEqual(removedCells);
  });

  it('property: ids exactly once, cells whole and in order, caps respected, ids co-located', () => {
    const arb = fc.record({
      cells: fc.array(fc.integer({ min: 0, max: 1800 }), { maxLength: 12 }),
      removed: fc.array(fc.integer({ min: 0, max: 1800 }), { maxLength: 12 }),
      orphans: fc.integer({ min: 0, max: 50 }),
      unknown: fc.integer({ min: 0, max: 50 }),
      addFrac: fc.double({ min: 0, max: 1, noNaN: true })
    });
    fc.assert(
      fc.property(arb, ({ cells: sizes, removed: rsizes, orphans, unknown, addFrac }) => {
        const prevOf = new Map<string, string>();
        const cellOfAdd = new Map<string, string>();
        const add: string[] = [];
        const remove: string[] = [];
        const cells = sizes.map((n, i) => {
          const id = `c${i}`;
          const ids = range(n, (k) => `${id}-${k}`);
          ids.forEach((p, k) => {
            if (k < n * addFrac) {
              add.push(p);
              cellOfAdd.set(p, id);
            } else {
              remove.push(`${id}-old${k}`);
              prevOf.set(`${id}-old${k}`, id);
            }
          });
          return cell(id, ids);
        });
        const removedCells = rsizes.map((n, i) => {
          const id = `r${i}`;
          for (let k = 0; k < n; k++) {
            remove.push(`${id}-${k}`);
            prevOf.set(`${id}-${k}`, id);
          }
          return id;
        });
        add.push(...range(orphans, (k) => `orphan-${k}`));
        remove.push(...range(unknown, (k) => `unknown-${k}`));
        const u = update(cells, add, remove, removedCells);
        const s = planSlices(u, (id) => prevOf.get(id));

        expect(s.flatMap((x) => x.add).sort()).toEqual([...add].sort());
        expect(s.flatMap((x) => x.remove).sort()).toEqual([...remove].sort());
        expect(s.flatMap((x) => x.cells)).toEqual(u.cells);
        expect(s.flatMap((x) => x.removed)).toEqual(removedCells);
        const n = (x: Slice) => x.cells.length + x.removed.length;
        const ids = (x: Slice) => x.add.length + x.remove.length;
        for (const x of s) expect(n(x)).toBeLessThanOrEqual(MAX_CELLS_PER_SLICE);
        if (s.length === 1) {
          // fast path, or everything fit before a cap closed the slice
        } else {
          for (const x of s.slice(0, -1))
            expect(ids(x) >= SLICE_IDS || n(x) >= MAX_CELLS_PER_SLICE).toBe(true);
          for (const x of s) expect(x.cells.length + x.removed.length + ids(x)).toBeGreaterThan(0);
        }
        s.forEach((x, i) => {
          for (const id of x.add) {
            const c = cellOfAdd.get(id);
            if (c === undefined) expect(i).toBe(0);
            else expect(cellIds(x)).toContain(c);
          }
          for (const id of x.remove) {
            const c = prevOf.get(id);
            if (c === undefined) expect(i).toBe(0);
            else expect(cellIds(x)).toContain(c);
          }
        });
      }),
      { numRuns: 60 }
    );
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
