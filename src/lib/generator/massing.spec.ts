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
    // the slab area is ≤ T (bisection); the final Clipper cm-grid snap may move it by ≤ 0.15
    expect(Math.abs(T - a)).toBeLessThanOrEqual(0.01 + 0.15);
    const ext = project(F, site.c, site.u);
    expect(ext.max).toBeCloseTo(-ext.min, 1); // equal yards at both ends
    expect(15.24 - ext.max).toBeCloseTo(5.0, 0); // ≈5.0 m from the lot line at each end
  });
  it('returns Q unchanged when Q is already within the target', () => {
    const site = normaliseSite([rect(7.62, 30.48)], 0.4)!;
    expect(baseFootprint(site, 1e6)).toBe(site.Q);
  });
});
