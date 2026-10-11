import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ParcelRecord } from '../data/parcel';
import { generateDetailed, type Detailed } from './generate';
import { drawVariety, varietyFromUniforms } from './variety';
import { selectTypology } from './select';
import { insideDomain } from './domain';
import { inset } from './poly';
import { fromLngLat } from './geo';
import { COVERAGE } from './constants';
import { lRing, rectRing, ringArea, rotateRing, uRing, type Ring } from './fixtures/geom';
import std from './fixtures/std-25x100.json';
import lot1000 from './fixtures/lot-1000.json';
import lot3000 from './fixtures/lot-3000.json';

const RUNS = { numRuns: 1000 };
const GOLDEN = varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25]);

function parcel(polygon: Ring[], over: Partial<ParcelRecord> = {}): ParcelRecord {
  return {
    id: 'p',
    polygon,
    labelPoint: [-122.4194, 37.7749],
    areaM2: 0,
    existingUnits: 1,
    existingFloorAreaM2: 180,
    existingHeightM: 7,
    landUse: 'RESIDENTIAL',
    eligible: true,
    neighborhood: 'Test',
    ...over
  };
}

const t = fc.double({ min: -1, max: 1, noNaN: true });
const arbSite: fc.Arbitrary<Ring[]> = fc.oneof(
  fc
    .record({
      w: fc.double({ min: 4, max: 90, noNaN: true }),
      h: fc.double({ min: 4, max: 90, noNaN: true }),
      t,
      f: fc.boolean()
    })
    .map(({ w, h, t, f }) => [rotateRing(rectRing(w, h), t, f)]),
  fc
    .record({
      w: fc.double({ min: 10, max: 80, noNaN: true }),
      h: fc.double({ min: 10, max: 80, noNaN: true }),
      a: fc.double({ min: 0.2, max: 0.8, noNaN: true }),
      b: fc.double({ min: 0.2, max: 0.8, noNaN: true }),
      t,
      f: fc.boolean()
    })
    .map(({ w, h, a, b, t, f }) => [rotateRing(lRing(w, h, w * a, h * b), t, f)]),
  fc
    .record({
      w: fc.double({ min: 15, max: 80, noNaN: true }),
      h: fc.double({ min: 15, max: 80, noNaN: true }),
      a: fc.double({ min: 0.2, max: 0.6, noNaN: true }),
      b: fc.double({ min: 0.2, max: 0.8, noNaN: true }),
      t,
      f: fc.boolean()
    })
    .map(({ w, h, a, b, t, f }) => [rotateRing(uRing(w, h, w * a, h * b), t, f)]),
  fc
    .record({
      w: fc.double({ min: 6, max: 60, noNaN: true }),
      h: fc.double({ min: 6, max: 60, noNaN: true }),
      w2: fc.double({ min: 4, max: 70, noNaN: true }),
      h2: fc.double({ min: 4, max: 70, noNaN: true }),
      t,
      f: fc.boolean()
    })
    .map(({ w, h, w2, h2, t, f }) => [
      rotateRing(rectRing(w, h), t, f),
      rotateRing(rectRing(w2, h2, (w + w2) / 2 + 5, 0), t, f)
    ]),
  // star-shaped, 7–16 vertices; rational circle parametrisation only (no sin/cos)
  fc
    .record({
      n: fc.integer({ min: 7, max: 16 }),
      jit: fc.array(fc.double({ min: -0.3, max: 0.3, noNaN: true }), {
        minLength: 16,
        maxLength: 16
      }),
      rad: fc.array(fc.double({ min: 6, max: 40, noNaN: true }), { minLength: 16, maxLength: 16 })
    })
    .map(({ n, jit, rad }): Ring[] => {
      // turn fraction f in [0,1) -> unit-circle point, rational only: each half-turn uses
      // t in [-1,1) with (c,s) = ((1-t²)/(1+t²), 2t/(1+t²)), angles -90°..90°; the second half is negated
      const unit = (f: number): [number, number] => {
        const half = f < 0.5 ? 1 : -1;
        const t = (f < 0.5 ? f : f - 0.5) * 4 - 1;
        const d = 1 + t * t;
        return [(half * (1 - t * t)) / d, (half * 2 * t) / d];
      };
      const ring: Ring = [];
      for (let i = 0; i < n; i++) {
        const f = (i + jit[i] * 0.5 + n) / n;
        const [ux, uy] = unit(f - Math.floor(f));
        ring.push([ux * rad[i], uy * rad[i]]);
      }
      return [ring];
    })
);
const arbCase = fc.record({
  site: arbSite,
  S: fc.integer({ min: 1, max: 80 }),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  units: fc.integer({ min: 0, max: 4 }),
  fa: fc.double({ min: 0, max: 400, noNaN: true })
});
const detailed = (c: { site: Ring[]; S: number; seed: number; units: number; fa: number }) =>
  generateDetailed(
    parcel(c.site, { existingUnits: c.units, existingFloorAreaM2: c.fa }),
    { maxStories: c.S },
    drawVariety(c.seed),
    'max'
  );

/** Whole-region support against the union of all occupied solids below. */
function nested(rings: Ring[], d: Detailed, tol: number): boolean {
  return d.local.every((up, i) => {
    if (up.baseM === 0) return true;
    const below = d.local.flatMap((lo, j) =>
      lo.role === 'occupied' && lo.baseM < up.baseM && lo.topM >= up.baseM
        ? [rings[j].map(([x, y]) => ({ x, y }))]
        : []
    );
    return insideDomain([rings[i].map(([x, y]) => ({ x, y }))], inset(below, -tol));
  });
}

describe('generator properties (§6)', () => {
  it('determinism: same input → deep-equal output', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          expect(detailed(c)).toEqual(detailed(c));
          return true;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('nesting (I9): single open rings ≥ 3 vertices; upper parts inside the part below (local and lng/lat)', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d) return true;
          for (const p of d.building.parts) {
            expect(p.footprint.length).toBeGreaterThanOrEqual(3);
            const [a, b] = [p.footprint[0], p.footprint[p.footprint.length - 1]];
            expect(a[0] === b[0] && a[1] === b[1]).toBe(false);
          }
          for (const ring of [
            ...d.local.map((l) => l.ring),
            ...d.building.parts.map((x) => x.footprint)
          ]) {
            expect(ring.length).toBeGreaterThanOrEqual(3);
            ring.forEach((q, k) => {
              const nx = ring[(k + 1) % ring.length];
              expect(q[0] === nx[0] && q[1] === nx[1]).toBe(false);
            });
          }
          expect(
            nested(
              d.local.map((l) => l.ring),
              d,
              0.02
            )
          ).toBe(true);
          const label: [number, number] = [-122.4194, 37.7749]; // parcel() labelPoint
          const ll = d.building.parts.map((p) => fromLngLat(p.footprint, label));
          expect(nested(ll, d, 0.02)).toBe(true);
          return true;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('containment: every footprint vertex lies within P (0.02 m)', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d) return true;
          return d.local.every((l) =>
            insideDomain([l.ring.map(([x, y]) => ({ x, y }))], d.site.originalDomain)
          );
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('coverage: base footprint area ≤ COVERAGE·A + 0.25', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d || d.building.typology === 'adu') return true;
          const base = d.local
            .filter((l) => l.baseM === 0)
            .reduce((s, l) => s + ringArea(l.ring), 0);
          const cov = COVERAGE[d.building.typology];
          return base <= cov * d.site.A + 0.25;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('I8/AC7: ADU never replaces; replacements always beat existing FA and units', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d) return true;
          const b = d.building;
          if (b.typology === 'adu') return b.replacesExisting === false && b.units === 1;
          return b.replacesExisting && b.units > c.units && b.floorAreaM2 > c.fa && b.units >= 1;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('monotonicity: within one typology, raising S never lowers floorAreaM2', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const lo = detailed(c);
          const hi = detailed({ ...c, S: Math.min(80, c.S + 1) });
          if (!lo || !hi || lo.building.typology !== hi.building.typology) return true;
          return hi.building.floorAreaM2 >= lo.building.floorAreaM2;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('rotation invariance on the golden fixtures: units/stories equal, FA within 0.5%', () => {
    const cases: [unknown, number][] = [
      // lshape is excluded: its walkup FA sits at ⌊1050·0.8/70⌋ = 12.0, a unit-count boundary
      [std, 3],
      [std, 5],
      [std, 2],
      [lot1000, 6],
      [lot1000, 10],
      [lot3000, 30]
    ];
    expect(() =>
      fc.assert(
        fc.property(fc.constantFrom(...cases), t, fc.boolean(), ([fx, S], tt, f) => {
          const base = fx as ParcelRecord;
          const rot = { ...base, polygon: base.polygon.map((r) => rotateRing(r, tt, f)) };
          const a = generateDetailed(base, { maxStories: S }, GOLDEN, 'max')!.building;
          const b = generateDetailed(rot, { maxStories: S }, GOLDEN, 'max')!.building;
          expect(b.units).toBe(a.units);
          expect(b.stories).toBe(a.stories);
          expect(Math.abs(b.floorAreaM2 - a.floorAreaM2)).toBeLessThanOrEqual(
            0.005 * a.floorAreaM2
          );
          return true;
        }),
        RUNS
      )
    ).not.toThrow();
  });

  it('selection is consistent with the built result', () => {
    expect(() =>
      fc.assert(
        fc.property(arbCase, (c) => {
          const d = detailed(c);
          if (!d) return true;
          const sel = selectTypology(c.S, d.site.A, c.units);
          // tower may legitimately fall back to midrise 12 (§4.7)
          if (sel.typology === 'tower' && d.building.typology === 'midrise')
            return d.building.stories === 12;
          return sel.typology === d.building.typology && sel.stories === d.building.stories;
        }),
        RUNS
      )
    ).not.toThrow();
  });
});
