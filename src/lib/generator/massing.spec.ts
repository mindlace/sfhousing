import { describe, expect, it } from 'vitest';
import { baseFootprint, floorTop } from './massing';
import { normaliseSite } from './site';
import { totalArea, project } from './poly';

const rect = (w: number, h: number): [number, number][] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2]
];

describe('floorTop', () => {
  it('uses 3.1 m floors, 4.5 m ground for podium/midrise/tower', () => {
    expect(floorTop('plex', 3)).toBeCloseTo(9.3, 9);
    expect(floorTop('podium', 6)).toBeCloseTo(20.0, 9);
    expect(floorTop('midrise', 10)).toBeCloseTo(32.4, 9);
    expect(floorTop('tower', 30)).toBeCloseTo(94.4, 9);
  });
});

describe('baseFootprint (§4.6)', () => {
  it('slab bisection reaches T within 0.01 m² from below, yard split equally', () => {
    const site = normaliseSite([rect(7.62, 30.48)], 0.4)!;
    const T = 0.6 * site.A;
    const F = baseFootprint(site, T);
    const a = totalArea(F);
    expect(a).toBeLessThanOrEqual(T + 0.02);
    expect(T - a).toBeLessThanOrEqual(0.01 + 0.02);
    const ext = project(F, site.c, site.u);
    expect(ext.max).toBeCloseTo(-ext.min, 1); // equal yards at both ends
    expect(15.24 - ext.max).toBeCloseTo(5.0, 0); // ≈5.0 m from the lot line at each end
  });
  it('returns Q unchanged when Q is already within the target', () => {
    const site = normaliseSite([rect(7.62, 30.48)], 0.4)!;
    expect(baseFootprint(site, 1e6)).toBe(site.Q);
  });
});

describe('baseFootprint coverage bound on wide lots', () => {
  const t = 0.3;
  const cs = (1 - t * t) / (1 + t * t);
  const sn = (2 * t) / (1 + t * t);
  const rot = (r: [number, number][]): [number, number][] =>
    r.map(([x, y]) => [x * cs - y * sn, x * sn + y * cs]);
  for (const [name, ring] of [
    ['60×50', rect(60, 50)],
    ['60×50 rotated', rot(rect(60, 50))]
  ] as const) {
    for (const f of [0.8, 0.75]) {
      it(`${name} at T = ${f}·A stays within T + 0.02`, () => {
        const site = normaliseSite([ring as [number, number][]], 0.4)!;
        const T = f * site.A;
        const a = totalArea(baseFootprint(site, T));
        expect(a).toBeLessThanOrEqual(T + 0.02);
        expect(T - a).toBeLessThanOrEqual(0.01 + 0.02);
      });
    }
  }
});
