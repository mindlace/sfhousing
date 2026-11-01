import { describe, expect, it } from 'vitest';
import { rectRing, type Ring } from './fixtures/geom';
import {
  lotBuildableStories,
  lotPhysicalMaxStories,
  physicalMaxStories,
  type PhysicalSite
} from './index';
import { normaliseSite } from './site';

const ft = (w: number, d: number) => normaliseSite([rectRing(w * 0.3048, d * 0.3048)], 0)!;

function ringsOf(site: PhysicalSite): Ring[] {
  return [site.P.map((p) => [p.x, p.y] as [number, number])];
}
function rotated(site: PhysicalSite, c: number, s: number): PhysicalSite {
  return normaliseSite(
    ringsOf(site).map((r) => r.map(([x, y]) => [c * x - s * y, s * x + c * y] as [number, number])),
    0
  )!;
}
function reversed(site: PhysicalSite): PhysicalSite {
  return normaliseSite(
    ringsOf(site).map((r) => [...r].reverse()),
    0
  )!;
}

describe('physicalMaxStories', () => {
  it.each([
    [25, 100, 6],
    [25, 120, 7],
    [50, 100, 12],
    [75, 100, 22],
    [100, 100, 40],
    [137.5, 137.5, 67],
    [200, 275, 80]
  ] as const)('spec reference lot %f×%f ft → %i', (w, d, s) => {
    expect(physicalMaxStories(ft(w, d))).toBe(s);
  });

  it('metres round trip: 7.62 × 30.48 m is 6, not 5', () => {
    expect(physicalMaxStories(normaliseSite([rectRing(7.62, 30.48)], 0)!)).toBe(6);
  });

  it('clamps to 5..80', () => {
    expect(physicalMaxStories(ft(12, 60))).toBe(5);
    expect(physicalMaxStories(ft(400, 400))).toBe(80);
  });

  it('rotation and winding do not change it', () => {
    for (const [w, d, s] of [
      [50, 100, 12],
      [75, 100, 22],
      [100, 100, 40],
      [137.5, 137.5, 67]
    ] as const) {
      expect(physicalMaxStories(rotated(ft(w, d), 0.6, 0.8))).toBe(s);
      expect(physicalMaxStories(reversed(ft(w, d)))).toBe(s);
    }
  });

  it('a 100×100 ft square rotated by (0.6, 0.8) is 40', () => {
    expect(physicalMaxStories(rotated(ft(100, 100), 0.6, 0.8))).toBe(40);
  });
});

describe('lot helpers', () => {
  it('lotPhysicalMaxStories reads a parcel polygon; null on a degenerate lot', () => {
    expect(lotPhysicalMaxStories([rectRing(25 * 0.3048, 100 * 0.3048)])).toBe(6);
    expect(
      lotPhysicalMaxStories([
        [
          [0, 0],
          [1, 0],
          [2, 0]
        ]
      ])
    ).toBeNull();
  });

  it('lotBuildableStories applies the physical max, then the typology cascade', () => {
    const p = [rectRing(25 * 0.3048, 100 * 0.3048)];
    expect(lotBuildableStories(p, 40, 1)).toBe(5);
    expect(lotBuildableStories(p, 3, 1)).toBe(3);
    expect(lotBuildableStories(p, 0.5, 1)).toBeNull();
    expect(lotBuildableStories([rectRing(137.5 * 0.3048, 137.5 * 0.3048)], 80, 1)).toBe(67);
  });
});
