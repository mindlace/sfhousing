import { describe, expect, it } from 'vitest';
import {
  CANDIDATE_PAD_M,
  LAT0,
  LNG0,
  M_PER_DEG_LAT,
  M_PER_DEG_LNG,
  boxesIntersect,
  compareIds,
  opBBox,
  opXYBox,
  pathCovers,
  pointInBox,
  project,
  segDist2,
  segmentBoxes
} from './geometry';
import { COVER_CASES } from './fixtures/edge-cases';
import type { PlanOp } from './types';

describe('project', () => {
  it('uses the literal constants', () => {
    expect(LNG0).toBe(-122.4431);
    expect(LAT0).toBe(37.7562);
    expect(M_PER_DEG_LNG).toBe(87913.423594147971);
    expect(M_PER_DEG_LAT).toBe(111195.08023353292);
  });

  it('is (lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT', () => {
    expect(project(LNG0, LAT0)).toEqual([0, 0]);
    for (const [lng, lat] of [
      [-122.4194, 37.7599],
      [-123.1738, 37.604],
      [-122.2818, 37.9298]
    ]) {
      expect(project(lng, lat)).toEqual([
        (lng - -122.4431) * 87913.423594147971,
        (lat - 37.7562) * 111195.08023353292
      ]);
    }
  });

  it('is metre-scale', () => {
    expect(project(LNG0, LAT0 + 0.001)[1]).toBeCloseTo(111.195, 3);
  });
});

describe('segDist2', () => {
  it('matches the perpendicular distance for interior points', () => {
    // segment (0,0)-(30,40): length 50; point (40,-30) is perpendicular to it at A, distance 50
    expect(segDist2([40, -30], [0, 0], [30, 40])).toBeCloseTo(2500, 9);
    // interior point: (15,20) + 10*(0.8,-0.6) = (23,14)
    expect(segDist2([23, 14], [0, 0], [30, 40])).toBeCloseTo(100, 9);
  });

  it('treats a zero-length segment as a point', () => {
    expect(segDist2([3, 4], [0, 0], [0, 0])).toBe(25);
  });
});

describe('pathCovers', () => {
  for (const c of COVER_CASES) {
    it(c.name, () => {
      expect(pathCovers(c.path, c.r * c.r, c.l)).toBe(c.covered);
    });
  }
});

describe('boxes', () => {
  it('segmentBoxes gives one box per segment, or one for a single point', () => {
    expect(segmentBoxes([[0, 0]], 2)).toEqual([[-2, -2, 2, 2]]);
    expect(
      segmentBoxes(
        [
          [0, 0],
          [10, 0],
          [10, 5]
        ],
        1
      )
    ).toEqual([
      [-1, -1, 11, 1],
      [9, -1, 11, 6]
    ]);
  });

  it('intersection and containment are inclusive', () => {
    expect(boxesIntersect([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true);
    expect(boxesIntersect([0, 0, 1, 1], [1.0001, 0, 2, 1])).toBe(false);
    expect(pointInBox([1, 1], [0, 0, 1, 1])).toBe(true);
    expect(pointInBox([1, 1.0001], [0, 0, 1, 1])).toBe(false);
  });
});

describe('opBBox / opXYBox', () => {
  const op: PlanOp = {
    kind: 'paint',
    id: 'a',
    stories: 3,
    radiusM: 100,
    path: [
      [-122.42, 37.76],
      [-122.41, 37.77]
    ]
  };

  it('grows the lng/lat path bbox by radiusM (plus the candidate pad) in degrees', () => {
    const g = 100 + CANDIDATE_PAD_M;
    const [minLng, minLat, maxLng, maxLat] = opBBox(op);
    expect(minLng).toBeCloseTo(-122.42 - g / M_PER_DEG_LNG, 12);
    expect(minLat).toBeCloseTo(37.76 - g / M_PER_DEG_LAT, 12);
    expect(maxLng).toBeCloseTo(-122.41 + g / M_PER_DEG_LNG, 12);
    expect(maxLat).toBeCloseTo(37.77 + g / M_PER_DEG_LAT, 12);
  });

  it('opXYBox is the projected path bbox grown by radiusM plus the pad', () => {
    const [a, b] = [project(-122.42, 37.76), project(-122.41, 37.77)];
    const g = 100 + CANDIDATE_PAD_M;
    expect(opXYBox(op)).toEqual([a[0] - g, a[1] - g, b[0] + g, b[1] + g]);
  });

  it('erase ops work the same way', () => {
    const erase: PlanOp = { kind: 'erase', id: 'e', radiusM: 5, path: [[-122.42, 37.76]] };
    expect(opBBox(erase)[0]).toBeLessThan(-122.42);
  });
});

describe('compareIds', () => {
  it('orders by JS string <, not numerically', () => {
    expect(['100', '99', '3512008A', '3512008'].sort(compareIds)).toEqual([
      '100',
      '3512008',
      '3512008A',
      '99'
    ]);
  });
});
