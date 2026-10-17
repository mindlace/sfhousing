import { describe, expect, it } from 'vitest';
import { baseFootprint, floorTop, massTypology } from './massing';
import { normaliseSite } from './site';
import { totalArea, project } from './poly';
import { varietyFromUniforms } from './variety';
import std from './fixtures/std-25x100.json';
import lot1000 from './fixtures/lot-1000.json';
import lot3000 from './fixtures/lot-3000.json';

const GOLDEN = varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25]);

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

describe('massTypology opts (§2, §4.4)', () => {
  const siteOf = (parcel: { polygon: number[][][] }) =>
    normaliseSite(parcel.polygon as [number, number][][], GOLDEN.edgeInsetM)!;
  const typologies = ['plex', 'walkup', 'podium', 'midrise', 'tower'] as const;

  it('opts omitted is identical', () => {
    for (const site of [siteOf(std), siteOf(lot1000), siteOf(lot3000)])
      for (const t of typologies)
        for (const s of [3, 6, 12, 20])
          expect(massTypology(site, t, s, GOLDEN)).toStrictEqual(
            massTypology(site, t, s, GOLDEN, {})
          );
  });
  it('coverageScale scales the base footprint', () => {
    const site = siteOf(lot1000);
    const podium = massTypology(site, 'podium', 6, GOLDEN, { coverageScale: 0.5 })!;
    const base = podium.parts.filter((p) => p.baseM === 0).map((p) => p.ring);
    expect(Math.abs(totalArea(base) - 0.5 * 0.8 * site.A)).toBeLessThan(0.01);
    const big = siteOf(lot3000);
    const tower = massTypology(big, 'tower', 20, GOLDEN, { coverageScale: 0.5 })!;
    expect(tower.typology).toBe('tower');
    const plate = totalArea(tower.parts.filter((p) => p.baseM > 0).map((p) => p.ring));
    expect(plate).toBeLessThanOrEqual(0.5 * Math.min(900, 0.35 * big.A) + 0.01);
  });
});
