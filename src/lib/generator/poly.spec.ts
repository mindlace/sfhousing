import { describe, expect, it } from 'vitest';
import type { PathD } from 'clipper2-ts';
import {
  canonicalRing,
  centroid,
  clipSlab,
  inset,
  intersect,
  keepPieces,
  largest,
  orientedRect,
  principalAxis,
  project,
  signedArea,
  totalArea
} from './poly';

const rect = (w: number, h: number, cx = 0, cy = 0): PathD => [
  { x: cx - w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 },
  { x: cx - w / 2, y: cy + h / 2 }
];
/** Rational rotation (no transcendentals): cos=(1-t²)/(1+t²), sin=2t/(1+t²). */
const rot = (p: PathD, t: number): PathD => {
  const d = 1 + t * t;
  const c = (1 - t * t) / d;
  const s = (2 * t) / d;
  return p.map(({ x, y }) => ({ x: x * c - y * s, y: x * s + y * c }));
};

describe('areas and centroid', () => {
  it('signedArea is positive for CCW and negative for CW', () => {
    expect(signedArea(rect(4, 5))).toBeCloseTo(20, 9);
    expect(signedArea([...rect(4, 5)].reverse())).toBeCloseTo(-20, 9);
    expect(totalArea([rect(4, 5), [...rect(2, 2, 10, 0)].reverse()])).toBeCloseTo(24, 9);
  });
  it('centroid of an offset rectangle and an L', () => {
    const c = centroid(rect(4, 6, 10, -3));
    expect(c.x).toBeCloseTo(10, 9);
    expect(c.y).toBeCloseTo(-3, 9);
    const L: PathD = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 }
    ];
    const cl = centroid(L);
    expect(cl.x).toBeCloseTo(5 / 6, 9);
    expect(cl.y).toBeCloseTo(5 / 6, 9);
  });
});

describe('principalAxis', () => {
  it('is the long axis of rotated rectangles, sign-normalised', () => {
    for (const t of [0, 0.1, 0.4, -0.3, 0.9, -0.95]) {
      const p = rot(rect(8, 30), t);
      const u = principalAxis(p, centroid(p));
      const d = 1 + t * t;
      // long side is the rotated (0,1) axis
      let ex = (-2 * t) / d;
      let ey = (1 - t * t) / d;
      if (ex < 0 || (ex === 0 && ey < 0)) {
        ex = -ex;
        ey = -ey;
      }
      expect(u.x).toBeCloseTo(ex, 6);
      expect(u.y).toBeCloseTo(ey, 6);
      expect(u.x * u.x + u.y * u.y).toBeCloseTo(1, 12);
    }
  });
  it('returns (1,0) for a square (tie) whatever its orientation', () => {
    expect(principalAxis(rect(10, 10), { x: 0, y: 0 })).toEqual({ x: 1, y: 0 });
    const p = rot(rect(10, 10), 0.3);
    expect(principalAxis(p, centroid(p))).toEqual({ x: 1, y: 0 });
  });
  it('ignores ring orientation', () => {
    const p = rot(rect(8, 30), 0.2);
    const q = [...p].reverse();
    expect(principalAxis(q, centroid(q)).x).toBeCloseTo(principalAxis(p, centroid(p)).x, 12);
  });
});

describe('project and clipSlab', () => {
  it('projects extents along an axis', () => {
    expect(project([rect(8, 30)], { x: 0, y: 0 }, { x: 0, y: 1 })).toEqual({ min: -15, max: 15 });
  });
  it('clips a rectangle to a slab across its long axis', () => {
    const s = clipSlab(rect(8, 30), { x: 0, y: 0 }, { x: 0, y: 1 }, 5);
    expect(Math.abs(signedArea(s))).toBeCloseTo(80, 9);
  });
  it('slab wider than the polygon leaves it whole; zero slab leaves nothing', () => {
    expect(
      Math.abs(signedArea(clipSlab(rect(8, 30), { x: 0, y: 0 }, { x: 0, y: 1 }, 100)))
    ).toBeCloseTo(240, 9);
    expect(
      Math.abs(signedArea(clipSlab(rect(8, 30), { x: 0, y: 0 }, { x: 0, y: 1 }, 0)))
    ).toBeCloseTo(0, 9);
  });
});

describe('orientedRect and canonicalRing', () => {
  it('orientedRect is CCW with the requested extents', () => {
    const r = orientedRect({ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, -2, 3, -1, 1);
    expect(signedArea(r)).toBeCloseTo(10, 9);
    expect(project([r], { x: 1, y: 1 }, { x: 1, y: 0 })).toEqual({ min: -2, max: 3 });
  });
  it('canonicalRing orients CCW, drops closing/duplicate vertices, starts at min vertex', () => {
    const ring: PathD = [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 }
    ];
    // input is CCW already? (1,1)->(0,1)->(0,0)->(1,0) is CCW
    expect(canonicalRing(ring)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ]);
    expect(canonicalRing([...ring].reverse())).toEqual(canonicalRing(ring));
  });
});

describe('clipper wrappers', () => {
  it('inset is orientation-independent and collapses slivers', () => {
    expect(totalArea(inset([rect(10, 30)], 1))).toBeCloseTo(8 * 28, 6);
    expect(totalArea(inset([[...rect(10, 30)].reverse()], 1))).toBeCloseTo(8 * 28, 6);
    expect(inset([rect(1.5, 60)], 1.5)).toEqual([]);
  });
  it('width test: a 2.5 m wide strip does not survive a further 1.5 m inset', () => {
    expect(inset([rect(2.5, 40)], 1.5)).toEqual([]);
    expect(inset([rect(3.2, 40)], 1.5).length).toBe(1);
  });
  it('intersect, keepPieces and largest', () => {
    const r = intersect([rect(10, 10)], [rect(10, 10, 5, 0)]);
    expect(totalArea(r)).toBeCloseTo(50, 6);
    expect(keepPieces([rect(3, 3), rect(4, 4)])).toEqual([rect(4, 4)]);
    expect(largest([rect(3, 3), rect(4, 4)])).toEqual(rect(4, 4));
    expect(largest([])).toBeNull();
  });
});
it('clips against every edge of a convex polygon of any vertex count', () => {
  const triangle: PathD = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 }
  ];
  expect(totalArea(intersect([rect(30, 30)], [triangle]))).toBeCloseTo(50, 6);
  const pentagon: PathD = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 12, y: 6 },
    { x: 5, y: 12 },
    { x: 0, y: 7 }
  ];
  expect(totalArea(intersect([rect(40, 40)], [pentagon]))).toBeCloseTo(signedArea(pentagon), 6);
});
