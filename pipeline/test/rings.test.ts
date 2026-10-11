import { describe, expect, it } from 'vitest';
import { cellIdFor, pointStrictlyInside, toLocalRings } from '../lib/rings';

const sq = (x: number, y: number, s: number, cw = false) => {
  const r = [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
    [x, y]
  ];
  return cw ? r.reverse() : r;
};

describe('toLocalRings', () => {
  it('opens rings, quantises to cm, makes outer CCW and holes CW', () => {
    const rings = toLocalRings(
      { type: 'Polygon', coordinates: [sq(100, 200, 10, true), sq(102.001, 202.004, 2)] },
      105,
      205
    );
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveLength(4);
    expect(rings[0][0]).toEqual([-5, -5]);
    const signed = (r: [number, number][]) =>
      r.reduce((s, [x1, y1], i) => {
        const [x2, y2] = r[(i + 1) % r.length];
        return s + x1 * y2 - x2 * y1;
      }, 0);
    expect(signed(rings[0])).toBeGreaterThan(0);
    expect(signed(rings[1])).toBeLessThan(0);
    expect(rings[1][0]).toEqual([-3, -3]);
  });
  it('orders multipolygon parts by area descending', () => {
    const rings = toLocalRings(
      { type: 'MultiPolygon', coordinates: [[sq(0, 0, 2)], [sq(10, 10, 5)]] },
      0,
      0
    );
    expect(rings[0][0]).toEqual([10, 10]);
  });
  it('drops consecutive duplicates and rings that collapse below 3 vertices', () => {
    const sliver = [
      [0, 0],
      [0.001, 0],
      [0.002, 0.001],
      [0, 0]
    ];
    expect(toLocalRings({ type: 'Polygon', coordinates: [sliver] }, 0, 0)).toEqual([]);
    const dup = [
      [0, 0],
      [0, 0.001],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0]
    ];
    expect(toLocalRings({ type: 'Polygon', coordinates: [dup] }, 0, 0)[0]).toHaveLength(4);
  });
  it('never emits negative zero', () => {
    const rings = toLocalRings({ type: 'Polygon', coordinates: [sq(-0.001, -0.001, 5)] }, 0, 0);
    expect(Object.is(rings[0][0][0], 0)).toBe(true);
  });
  it('drops a collapsed outer ring together with its holes', () => {
    const tiny = sq(0, 0, 0.001);
    expect(toLocalRings({ type: 'Polygon', coordinates: [tiny, sq(0, 0, 0.0004)] }, 0, 0)).toEqual(
      []
    );
  });
});

describe('pointStrictlyInside', () => {
  it('is false in a hole and on an edge', () => {
    const outer: [number, number][] = [
      [-5, -5],
      [5, -5],
      [5, 5],
      [-5, 5]
    ];
    const hole: [number, number][] = [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1]
    ];
    expect(pointStrictlyInside([3, 3], [outer, hole])).toBe(true);
    expect(pointStrictlyInside([0, 0], [outer, hole])).toBe(false);
    expect(pointStrictlyInside([5, 0], [outer])).toBe(false);
    expect(pointStrictlyInside([0, 0], [])).toBe(false);
  });
});

describe('cellIdFor', () => {
  it('floors, including exact boundaries and negatives', () => {
    expect(cellIdFor(48999.99, 24000)).toBe('48_24');
    expect(cellIdFor(49000, 23999.99)).toBe('49_23');
    expect(cellIdFor(-0.01, -1000)).toBe('-1_-1');
    expect(cellIdFor(-1000, 0)).toBe('-1_0');
    expect(cellIdFor(1500, 2500, 500)).toBe('3_5');
  });
});
