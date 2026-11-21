import { describe, expect, it } from 'vitest';
import { SLOT_FLAG, type CityDelta, type TimelineUpdate } from '$lib/map/types';
import { ACTIVITY_LIMIT, ActivityIndex, type ActivityEvent } from './activity';

const AS_OF = 20_000;
const N = NaN;

interface M {
  row: number;
  days: [number, number, number];
  homes?: number;
  flags?: number;
  at?: [number, number];
}

/** A delta of markers `ms` (ascending rows) with `rows` rows. */
function delta(rows: number, ms: M[], from?: number): CityDelta {
  const k = ms.length;
  const d: CityDelta = {
    rows,
    row: Int32Array.from(ms.map((m) => m.row)),
    lngLat: new Float32Array(2 * k),
    days: new Float32Array(3 * k),
    homes: Uint16Array.from(ms.map((m) => m.homes ?? 10)),
    flags: Uint8Array.from(ms.map((m) => m.flags ?? 0))
  };
  ms.forEach((m, i) => {
    d.lngLat.set(m.at ?? [-122.42, 37.76], 2 * i);
    d.days.set(m.days, 3 * i);
  });
  if (from !== undefined) d.from = from;
  return d;
}

const update = (revision: number, city?: CityDelta): TimelineUpdate => ({
  revision,
  cells: [],
  removedCells: [],
  demolish: [],
  ...(city ? { city } : {})
});

/** [row, kind, day] of each event, in order. */
const brief = (es: ActivityEvent[]) => es.map((e) => [e.row, e.kind, e.day]);

describe('ActivityIndex', () => {
  it('recent: only events after today and at or before the day, newest first, at most the limit', () => {
    const ix = new ActivityIndex();
    ix.apply(
      update(
        0,
        delta(5, [
          { row: 0, days: [AS_OF - 30, AS_OF, AS_OF + 10] },
          { row: 1, days: [AS_OF + 5, N, N] },
          { row: 2, days: [AS_OF + 20, AS_OF + 40, AS_OF + 60] },
          { row: 3, days: [AS_OF + 10, N, N] },
          { row: 4, days: [AS_OF + 1, AS_OF + 2, AS_OF + 3] }
        ])
      )
    );
    // Nothing at or before today, nothing after the day.
    expect(ix.recent(AS_OF, AS_OF)).toEqual([]);
    expect(brief(ix.recent(AS_OF, AS_OF + 10))).toEqual([
      [0, 'completed', AS_OF + 10],
      [3, 'approved', AS_OF + 10],
      [1, 'approved', AS_OF + 5],
      [4, 'completed', AS_OF + 3],
      [4, 'started', AS_OF + 2],
      [4, 'approved', AS_OF + 1]
    ]);
    // A day between event days reads the same as the last event day before it.
    expect(ix.recent(AS_OF, AS_OF + 15)).toEqual(ix.recent(AS_OF, AS_OF + 10));
    expect(brief(ix.recent(AS_OF, AS_OF + 100, 3))).toEqual([
      [2, 'completed', AS_OF + 60],
      [2, 'started', AS_OF + 40],
      [2, 'approved', AS_OF + 20]
    ]);
    expect(ix.recent(AS_OF, AS_OF + 100)).toHaveLength(ACTIVITY_LIMIT);
    expect(ACTIVITY_LIMIT).toBe(6);
    // A fractional playhead day reads the whole days at or before it.
    expect(brief(ix.recent(AS_OF, AS_OF + 2.5))).toEqual([
      [4, 'started', AS_OF + 2],
      [4, 'approved', AS_OF + 1]
    ]);
  });

  it('a row with approved, started and completed days gives three events of its kind', () => {
    const ix = new ActivityIndex();
    ix.apply(
      update(0, delta(1, [{ row: 0, days: [AS_OF + 1, AS_OF + 2, AS_OF + 3], homes: 120 }]))
    );
    const es = ix.recent(AS_OF, AS_OF + 3);
    expect(es.map((e) => e.kind)).toEqual(['completed', 'started', 'approved']);
    expect(es.every((e) => e.row === 0 && e.homes === 120 && e.policy === false)).toBe(true);
    expect(es[0].lngLat[0]).toBeCloseTo(-122.42, 4);
    expect(es[0].lngLat[1]).toBeCloseTo(37.76, 4);
  });

  it('NaN days give no event; flags set policy', () => {
    const ix = new ActivityIndex();
    ix.apply(
      update(
        0,
        delta(3, [
          { row: 0, days: [N, N, N] },
          { row: 1, days: [AS_OF + 1, N, N], flags: SLOT_FLAG.zoning },
          { row: 2, days: [N, AS_OF + 2, N], flags: SLOT_FLAG.money }
        ])
      )
    );
    const es = ix.recent(AS_OF, AS_OF + 100);
    expect(es.map((e) => [e.row, e.kind, e.policy])).toEqual([
      [2, 'started', true],
      [1, 'approved', true]
    ]);
  });

  it('a delta with from forgets rows at or past it; their events leave the list', () => {
    const ix = new ActivityIndex();
    ix.apply(
      update(
        0,
        delta(3, [
          { row: 0, days: [AS_OF + 1, N, N] },
          { row: 1, days: [AS_OF + 2, N, N] },
          { row: 2, days: [AS_OF + 3, N, N] }
        ])
      )
    );
    expect(ix.recent(AS_OF, AS_OF + 10).map((e) => e.row)).toEqual([2, 1, 0]);
    // A rewind from row 1: row 1 is re-created later, row 2 is gone.
    ix.apply(update(1, delta(2, [{ row: 1, days: [AS_OF + 7, N, N] }], 1)));
    expect(brief(ix.recent(AS_OF, AS_OF + 10))).toEqual([
      [1, 'approved', AS_OF + 7],
      [0, 'approved', AS_OF + 1]
    ]);
    // A later revision changes a survivor's day: it moves in the list.
    ix.apply(update(2, delta(2, [{ row: 0, days: [AS_OF + 9, N, N] }])));
    expect(brief(ix.recent(AS_OF, AS_OF + 10))).toEqual([
      [0, 'approved', AS_OF + 9],
      [1, 'approved', AS_OF + 7]
    ]);
    // A later revision without city changes nothing.
    ix.apply(update(3));
    expect(ix.recent(AS_OF, AS_OF + 10).map((e) => e.row)).toEqual([0, 1]);
  });

  it('revision 0 without city clears; revision 0 with city replaces whole', () => {
    const ix = new ActivityIndex();
    ix.apply(
      update(
        0,
        delta(2, [
          { row: 0, days: [AS_OF + 1, N, N] },
          { row: 1, days: [AS_OF + 2, N, N] }
        ])
      )
    );
    expect(ix.recent(AS_OF, AS_OF + 10)).toHaveLength(2);
    ix.apply(update(0, delta(3, [{ row: 2, days: [AS_OF + 3, N, N] }])));
    expect(brief(ix.recent(AS_OF, AS_OF + 10))).toEqual([[2, 'approved', AS_OF + 3]]);
    ix.apply(update(0));
    expect(ix.recent(AS_OF, AS_OF + 10)).toEqual([]);
  });

  it('a read after a read sorts nothing; an apply then a read sorts once', () => {
    const ix = new ActivityIndex();
    expect(ix.sorts).toBe(0);
    ix.apply(
      update(
        0,
        delta(2, [
          { row: 0, days: [AS_OF + 1, AS_OF + 2, N] },
          { row: 1, days: [AS_OF + 3, N, N] }
        ])
      )
    );
    // Lazily: nothing sorts until a read.
    expect(ix.sorts).toBe(0);
    for (let d = AS_OF; d <= AS_OF + 5; d++) ix.recent(AS_OF, d);
    expect(ix.sorts).toBe(1);
    // Two applies before a read: still one sort.
    ix.apply(update(1, delta(2, [{ row: 1, days: [AS_OF + 4, N, N] }])));
    ix.apply(update(2, delta(2, [{ row: 0, days: [AS_OF + 5, N, N] }])));
    expect(ix.sorts).toBe(1);
    ix.recent(AS_OF, AS_OF + 1);
    ix.recent(AS_OF, AS_OF + 9);
    expect(ix.sorts).toBe(2);
    // An update without city leaves the order as it is.
    ix.apply(update(3));
    ix.recent(AS_OF, AS_OF + 9);
    expect(ix.sorts).toBe(2);
  });

  it('beyond the packed keys (many rows) it reads in the same order', () => {
    const rows = 90_000; // 3 × rows > 2^18
    const ms: M[] = [];
    for (let r = 0; r < rows; r += 997) ms.push({ row: r, days: [AS_OF + (r % 13) + 1, N, N] });
    const big = new ActivityIndex();
    big.apply(update(0, delta(rows, ms)));
    const es = big.recent(AS_OF, AS_OF + 100);
    expect(es).toHaveLength(ACTIVITY_LIMIT);
    // Newest first; on one day by row ascending.
    const want = ms
      .map((m) => [m.row, m.days[0]] as const)
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, ACTIVITY_LIMIT)
      .map(([r, d]) => [r, 'approved', d]);
    expect(brief(es)).toEqual(want);
    expect(big.sorts).toBe(1);
  });
});
