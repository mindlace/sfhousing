import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { PathsD } from 'clipper2-ts';
import type { ParcelRecord } from '../data/parcel';
import { generate } from './generate';
import { drawVariety } from './variety';
import { insideDomain } from './domain';
import { inset } from './poly';
import { fromLngLat } from './geo';
import { fnv1a32 } from './seed';
import { normaliseSite } from './site';
import {
  generateForUnits,
  massedUnits,
  massingApproximate,
  massingCandidates,
  unitsTolerance,
  type MassingCandidate
} from './units';
import { lRing, rectRing, rotateRing, uRing, type Ring } from './fixtures/geom';
import pair from './fixtures/assembly-pair.json';
import row from './fixtures/assembly-row.json';
import street from './fixtures/assembly-street.json';
import courtyard from './fixtures/assembly-courtyard.json';

const RUNS = { numRuns: 1000 };
// P1-P3 build 80-story candidate lists per run, so shrinking a failure takes minutes: report the
// first counterexample unshrunk.
const QUICK_FAIL = { ...RUNS, endOnFailure: true };

// parcel() and arbSite are copied unchanged from generator.property.spec.ts:20-80.
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

const arbSeed = fc.integer({ min: 0, max: 0xffffffff });
const arbF = fc.double({ min: 0, max: 1, noNaN: true });
const arbStories = fc.option(fc.integer({ min: 1, max: 80 }), { nil: undefined });

const vacant = (polygon: Ring[]) => parcel(polygon, { existingUnits: 0, existingFloorAreaM2: 0 });

/** The §4.3 candidates `generateForUnits` builds for this site, seed, U and bound. */
function candidates(
  polygon: Ring[],
  seed: number,
  U: number,
  bound: { stories: number } | { maxStories: number }
): MassingCandidate[] {
  const draws = drawVariety(seed);
  const site = normaliseSite(polygon, draws.edgeInsetM);
  return site ? massingCandidates(site, U, draws, bound) : [];
}

const capRange = (cs: readonly MassingCandidate[]): [min: number, max: number] => [
  Math.min(...cs.map((c) => c.cap)),
  Math.max(...cs.map((c) => c.cap))
];

const toPaths = (rings: Ring[]): PathsD => rings.map((r) => r.map(([x, y]) => ({ x, y })));

describe('generateForUnits properties (§6)', () => {
  // Spec §6 says P1 is never approximate. §4.4 measures a candidate's cap on the reference bands
  // but massed units on the serialised area (1e-7° rounding, repair insets; P7 pins the latter),
  // so a cap at a unit boundary can serialise one unit short and fall just outside tolerance
  // (units.spec.ts pins one such case). Restated (controller ruling): within tolerance + 1.
  it(
    'P1: unknown stories, U in [max(1, c_min), c_max] → within tolerance (+1 drift)',
    { timeout: 30_000 },
    () => {
      expect(() =>
        fc.assert(
          fc.property(arbSite, arbSeed, arbF, (site, seed, f) => {
            // U0 = 5 fixes promotion: every U below is ≥ 5
            const c0 = candidates(site, seed, 5, { maxStories: 80 });
            fc.pre(c0.length > 0);
            const [cMin, cMax] = capRange(c0);
            fc.pre(cMax >= 5);
            const lo = Math.max(5, cMin);
            const U = Math.round(lo + f * (cMax - lo));
            const cU = candidates(site, seed, U, { maxStories: 80 });
            fc.pre(cU.length > 0);
            const [minU, maxU] = capRange(cU);
            fc.pre(U >= Math.max(1, minU) && U <= maxU);
            const b = generateForUnits(vacant(site), U, 80, seed);
            // exclusion: a candidate none of whose compositions serialise gives null, exactly as
            // `generate` does on that site (e.g. every midrise on a narrow star lot)
            fc.pre(b !== null);
            expect(
              !massingApproximate(b!) || Math.abs(massedUnits(b!) - U) <= unitsTolerance(U) + 1
            ).toBe(true);
            return true;
          }),
          QUICK_FAIL
        )
      ).not.toThrow();
    }
  );

  // Spec §6 says P2 is never approximate (a prototype on the pipeline-synth mix). That does not
  // hold on these arbitraries: §4.4 footprint scaling stops at hard floors (pieces under 10 m² or
  // 1.5 m wide go null, a tower plate under MIN_TOWER_PLATE_M2 falls back to midrise, a plex is
  // capped at PLEX_MAX_UNITS), so a small U on a tall or tiny site stays above U + tolerance.
  // Restated (controller ruling): stories always match; an approximate result overshoots (at
  // the scaling floor) unless it is a midrise; and it stays rare (≤ 3% of non-null runs).
  // The midrise exception: massing.ts puts midrise upper floors on F inset by the stepback, or
  // on F itself when that inset is under 0.4·F, so massed units are non-monotone in k and the
  // §4.4 bisection can land below U (units.spec.ts pins one such case).
  it(
    'P2: known stories S, U in [0.4, 1.0]·cap(S) → stories === S, rarely approximate',
    { timeout: 30_000 },
    () => {
      let built = 0;
      let approximate = 0;
      expect(() =>
        fc.assert(
          fc.property(
            arbSite,
            arbSeed,
            fc.integer({ min: 1, max: 40 }),
            arbF,
            (site, seed, S, f) => {
              const c0 = candidates(site, seed, 1, { stories: S });
              fc.pre(c0.length > 0 && c0[0].cap >= 1);
              const U = Math.max(1, Math.round((0.4 + 0.6 * f) * c0[0].cap));
              // promotion can switch plex → walkup at U > 4; keep the case the cap was taken from
              const cU = candidates(site, seed, U, { stories: S });
              fc.pre(cU.length > 0 && cU[0].ref.typology === c0[0].ref.typology);
              const b = generateForUnits(vacant(site), U, 80, seed, S);
              // exclusion: a candidate none of whose compositions serialise gives null, exactly as
              // `generate` does on that site (e.g. every midrise on a narrow star lot)
              fc.pre(b !== null);
              expect(b!.stories).toBe(S);
              built++;
              if (massingApproximate(b!)) {
                approximate++;
                expect(massedUnits(b!) > U || b!.typology === 'midrise').toBe(true);
              }
              return true;
            }
          ),
          QUICK_FAIL
        )
      ).not.toThrow();
      expect(approximate).toBeLessThanOrEqual(0.03 * built);
    }
  );

  // Spec §6 states P3 as "U > c_max → approximate, massedUnits === c_max". Restated (controller
  // ruling) because three §4.4 rules contradict the literal form:
  // - case 1 tests |cap − U| ≤ unitsTolerance(U), so the margin is on U, not on c_max;
  // - massed units come from the serialised area (1e-7° rounding, repair insets), which can sit
  //   one unit either side of cap = unitsFor(round1(occupiedArea(ref.bands)));
  // - the composition walk may pick a non-simple family that masses more than the reference
  //   (within tolerance it is accepted, so it need not be approximate, and may mass above U).
  it(
    'P3: undershoot (U − c_max > tol(U) + 1) → largest candidate, massed ≥ c_max − 1',
    { timeout: 30_000 },
    () => {
      expect(() =>
        fc.assert(
          fc.property(arbSite, arbSeed, fc.integer({ min: 0, max: 50 }), (site, seed, d) => {
            // U ≥ 5 here, so the U0 = 5 candidates normally equal the ones at U
            const c0 = candidates(site, seed, 5, { maxStories: 80 });
            fc.pre(c0.length > 0);
            const c0Max = capRange(c0)[1];
            const U = c0Max + 2 * unitsTolerance(c0Max) + 2 + d;
            const cU = candidates(site, seed, U, { maxStories: 80 });
            fc.pre(cU.length > 0);
            const cMax = capRange(cU)[1];
            fc.pre(U - cMax > unitsTolerance(U) + 1);
            // candidates are in ascending stories, so the first at c_max is the tie-break winner
            const top = cU.find((c) => c.cap === cMax)!;
            const b = generateForUnits(vacant(site), U, 80, seed);
            // exclusion: a chosen candidate none of whose compositions serialise gives null, exactly
            // as `generate` does on that site (e.g. every midrise on a narrow star lot)
            fc.pre(b !== null);
            expect({ typology: b!.typology, stories: b!.stories }).toStrictEqual({
              typology: top.ref.typology,
              stories: top.ref.stories
            });
            expect(massedUnits(b!)).toBeGreaterThanOrEqual(cMax - 1);
            // the closest family is never farther from U than the largest candidate itself (±1)
            expect(Math.abs(massedUnits(b!) - U)).toBeLessThanOrEqual(U - cMax + 1);
            expect(massingApproximate(b!) || b!.composition !== 'simple').toBe(true);
            return true;
          }),
          QUICK_FAIL
        )
      ).not.toThrow();
    }
  );

  it('P4: permuting or duplicating assembly parcels does not change the output', () => {
    type Fixture = { parcels: ParcelRecord[]; excluded?: ParcelRecord };
    const fixtures: [string, Fixture][] = [
      ['assembly-pair', pair as Fixture],
      ['assembly-row', row as Fixture],
      ['assembly-street', street as Fixture],
      ['assembly-courtyard', courtyard as Fixture]
    ];
    const permutations = <T>(xs: readonly T[]): T[][] =>
      xs.length <= 1
        ? [[...xs]]
        : xs.flatMap((x, i) =>
            permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])
          );
    for (const [name, { parcels }] of fixtures) {
      const seed = fnv1a32(name);
      const sorted = [...parcels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const perms = permutations(parcels);
      expect(perms.length).toBeLessThanOrEqual(24);
      for (const U of [5, 20, 60]) {
        const expected = generateForUnits(sorted, U, 80, seed);
        expect(expected, `${name} U ${U}`).not.toBeNull();
        for (const perm of perms) {
          expect(generateForUnits(perm, U, 80, seed), `${name} U ${U}`).toStrictEqual(expected);
          const dup = [...perm, structuredClone(perm[0])];
          expect(generateForUnits(dup, U, 80, seed), `${name} U ${U} dup`).toStrictEqual(expected);
        }
      }
    }
  });

  it('P5: determinism; seeds s and s + 2³² give the same output', () => {
    expect(() =>
      fc.assert(
        fc.property(
          arbSite,
          arbSeed,
          fc.integer({ min: 1, max: 300 }),
          arbStories,
          (site, seed, U, S) => {
            const p = vacant(site);
            const a = generateForUnits(p, U, 80, seed, S);
            expect(generateForUnits(p, U, 80, seed, S)).toStrictEqual(a);
            expect(generateForUnits(p, U, 80, seed + 2 ** 32, S)).toStrictEqual(a);
            return true;
          }
        ),
        RUNS
      )
    ).not.toThrow();
  });

  it('P6: open rings ≥ 3 vertices; upper parts supported; every part inside the site', () => {
    expect(() =>
      fc.assert(
        fc.property(
          arbSite,
          arbSeed,
          fc.integer({ min: 1, max: 300 }),
          arbStories,
          (site, seed, U, S) => {
            const p = vacant(site);
            const b = generateForUnits(p, U, 80, seed, S);
            if (!b) return true;
            for (const part of b.parts) {
              const fp = part.footprint;
              expect(fp.length).toBeGreaterThanOrEqual(3);
              const [first, last] = [fp[0], fp[fp.length - 1]];
              expect(first[0] === last[0] && first[1] === last[1]).toBe(false);
              fp.forEach((q, k) => {
                const nx = fp[(k + 1) % fp.length];
                expect(q[0] === nx[0] && q[1] === nx[1]).toBe(false);
              });
            }
            const local = b.parts.map((part) => fromLngLat(part.footprint, p.labelPoint));
            b.parts.forEach((up, i) => {
              if (up.role !== 'occupied' || up.baseM === 0) return;
              const below = b.parts.flatMap((lo, j) =>
                lo.role === 'occupied' && lo.topM === up.baseM ? [local[j]] : []
              );
              expect(insideDomain(toPaths([local[i]]), inset(toPaths(below), -0.02))).toBe(true);
            });
            const s = normaliseSite(p.polygon, drawVariety(seed).edgeInsetM)!;
            const domain = inset(s.originalDomain, -0.02);
            for (const ring of local) expect(insideDomain(toPaths([ring]), domain)).toBe(true);
            return true;
          }
        ),
        RUNS
      )
    ).not.toThrow();
  });

  it('P7: on a vacant parcel, the editor building round-trips through generateForUnits', () => {
    expect(() =>
      fc.assert(
        fc.property(arbSite, fc.integer({ min: 1, max: 80 }), arbSeed, (site, S, seed) => {
          const p = vacant(site);
          const b = generate(p, { maxStories: S }, seed, 'max');
          fc.pre(b !== null);
          expect(generateForUnits(p, b!.units, 80, seed, b!.stories)).toStrictEqual({
            ...b,
            source: 'pipeline'
          });
          return true;
        }),
        RUNS
      )
    ).not.toThrow();
  });
});
