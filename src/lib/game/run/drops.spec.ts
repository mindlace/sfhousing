import { describe, expect, it } from 'vitest';
import { planDrops, type Marker } from './drops';

function m(o: Partial<Marker> = {}): Marker {
  return {
    row: 1,
    lng: -122.4,
    lat: 37.7,
    completed: 150,
    homes: 5,
    existing: 1,
    policy: false,
    ...o
  };
}

describe('planDrops', () => {
  it('keeps a marker completed after asOf and at or before to', () => {
    const drops = planDrops([m({ completed: 101 }), m({ row: 2, completed: 200 })], 100, 200);
    expect(drops.map((d) => d.row)).toEqual([1, 2]);
  });

  it('leaves out a marker on asOf, after to and with NaN', () => {
    const drops = planDrops(
      [m({ completed: 100 }), m({ row: 2, completed: 201 }), m({ row: 3, completed: NaN })],
      100,
      200
    );
    expect(drops).toEqual([]);
  });

  it('worth is homes - existing; leaves out a worth of 0 or below', () => {
    expect(planDrops([m()], 100, 200)[0].worth).toEqual({ home: 4 });
    const none = planDrops(
      [m({ homes: 3, existing: 3 }), m({ row: 2, homes: 2, existing: 4 })],
      100,
      200
    );
    expect(none).toEqual([]);
  });

  it('takes policy from its marker', () => {
    const drops = planDrops([m({ policy: true }), m({ row: 2, policy: false })], 100, 200);
    expect(drops.map((d) => d.policy)).toEqual([true, false]);
  });

  it('orders by day, then by row', () => {
    const drops = planDrops(
      [m({ row: 3, completed: 150 }), m({ row: 1, completed: 150 }), m({ row: 2, completed: 120 })],
      100,
      200
    );
    expect(drops.map((d) => d.row)).toEqual([2, 1, 3]);
  });

  it('keeps the later of two markers with one row', () => {
    const drops = planDrops([m({ homes: 5 }), m({ homes: 9 })], 100, 200);
    expect(drops).toHaveLength(1);
    expect(drops[0].worth).toEqual({ home: 8 });
  });

  it('changes no marker and returns new objects', () => {
    const markers = [m(), m({ row: 2, completed: 120 })];
    for (const k of markers) Object.freeze(k);
    const before = structuredClone(markers);
    const drops = planDrops(markers, 100, 200);
    expect(markers).toEqual(before);
    expect(drops).toHaveLength(2);
    for (const d of drops) expect(markers).not.toContain(d);
  });
});
