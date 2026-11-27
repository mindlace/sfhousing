import { describe, expect, it } from 'vitest';
import { lotAtPoint, pointInRings } from './lot-at';

const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0]
];

describe('pointInRings', () => {
  const outer = square(0, 0, 10, 10);
  const hole = square(4, 4, 6, 6);

  it('is in inside a ring and out outside it', () => {
    expect(pointInRings([5, 5], [outer])).toBe(true);
    expect(pointInRings([11, 5], [outer])).toBe(false);
    expect(pointInRings([5, -1], [outer])).toBe(false);
  });

  it('is out inside a hole (the second ring) and in beside it', () => {
    expect(pointInRings([5, 5], [outer, hole])).toBe(false);
    expect(pointInRings([2, 5], [outer, hole])).toBe(true);
  });
});

describe('lotAtPoint', () => {
  const rec = (id: string, x0: number) => ({
    id,
    polygon: [square(x0, 0, x0 + 4, 4)],
    labelPoint: [x0 + 2, 2] as [number, number]
  });
  const records = [rec('a', 0), rec('b', 10)];
  const rings = (r: (typeof records)[number]) => r.polygon;

  it('returns the record whose polygon holds the point, or null', () => {
    expect(lotAtPoint(records, [12, 2], rings)?.id).toBe('b');
    expect(lotAtPoint(records, [1, 3], rings)?.id).toBe('a');
    expect(lotAtPoint(records, [7, 2], rings)).toBeNull();
    expect(lotAtPoint([], [1, 1], rings)).toBeNull();
  });
});
