import { describe, expect, it } from 'vitest';
import { differenceD, FillRule } from 'clipper2-ts';
import { normaliseSite } from './site';
import { rectRing, uRing } from './fixtures/geom';
import { signedArea } from './poly';
import { domainArea, fitSimpleRegions, insideDomain } from './domain';

const netArea = (paths: { x: number; y: number }[][]) =>
  Math.abs(paths.reduce((sum, ring) => sum + signedArea(ring), 0));
const path = (ring: [number, number][]) => ring.map(([x, y]) => ({ x, y }));

describe('parcel domain', () => {
  it('subtracts holes from usable lot area and does not fill them', () => {
    const site = normaliseSite([rectRing(20, 20), rectRing(4, 4)], 0.4)!;
    expect(site.A).toBeCloseTo(384, 2);
    expect(site.originalDomain).toHaveLength(2);
    expect(netArea(differenceD(site.Q, site.originalDomain, FillRule.NonZero, 4))).toBe(0);
  });
  it('retains exclusions independent of contour order and orientation', () => {
    const rings = [rectRing(20, 20), rectRing(4, 4)];
    const a = normaliseSite(rings, 0.4)!;
    const b = normaliseSite(
      rings.reverse().map((r) => [...r.slice(1), r[0]].reverse()),
      0.4
    )!;
    expect(a).toEqual(b);
  });
  it('never expands a concave original parcel during simplification', () => {
    const ring = uRing(20, 20, 8, 12);
    const site = normaliseSite([ring], 0.4)!;
    expect(netArea(differenceD(site.Q, [path(ring)], FillRule.NonZero, 4))).toBe(0);
  });
  it('selects the largest connected component without adopting another component hole', () => {
    const site = normaliseSite(
      [rectRing(20, 20), rectRing(4, 4), rectRing(8, 8, 40, 0), rectRing(2, 2, 40, 0)],
      0.4
    )!;
    expect(site.A).toBeCloseTo(384, 2);
    expect(site.originalDomain).toHaveLength(2);
  });
});

it('rejects edges across a concave notch and a filled exclusion', () => {
  const domain = [path(uRing(20, 20, 8, 12))];
  expect(insideDomain([path(rectRing(18, 2, 0, 7))], domain)).toBe(false);
  const site = normaliseSite([rectRing(20, 20), rectRing(4, 4)], 0.4)!;
  expect(insideDomain([path(rectRing(8, 8))], site.domain)).toBe(false);
  expect(domainArea(site.originalDomain)).toBe(384);
});
it('fits multiple exclusions without producing filled holes or unbounded fragments', () => {
  const site = normaliseSite([rectRing(40, 40), rectRing(4, 4, -8, 0), rectRing(4, 4, 8, 0)], 0.4)!;
  const regions = fitSimpleRegions(site.Q, site);
  expect(regions.length).toBeGreaterThan(0);
  expect(regions.length).toBeLessThanOrEqual(16);
  expect(insideDomain(regions, site.originalDomain)).toBe(true);
  expect(regions.every((r) => signedArea(r) > 0)).toBe(true);
});
