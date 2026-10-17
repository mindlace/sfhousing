import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { generate, generateWith } from './generate';
import { drawComposition } from './composition-variety';
import { varietyFromUniforms } from './variety';
import { fnv1a32 } from './seed';
import { normaliseSite } from './site';
import {
  generateForUnits,
  generateForUnitsWith,
  massedUnits,
  massingApproximate,
  massingCandidates,
  unitsTolerance
} from './units';
import std from './fixtures/std-25x100.json';
import lot1000 from './fixtures/lot-1000.json';
import lot3000 from './fixtures/lot-3000.json';
import overApt from './fixtures/std-over-apartment.json';
import towerFallback from './fixtures/tower-fallback.json';
import tiny from './fixtures/tiny.json';
import sliver from './fixtures/sliver.json';

/** Same golden draws as golden.spec.ts: deterministic, independent of the seed hash. */
const GOLDEN = varietyFromUniforms([0.5, 0.5, 0.5, 0.5, 0, 0.25]);
const SIMPLE = { ...drawComposition(1), familyOrder: ['simple' as const], capEnabled: false };
const P = (j: unknown) => j as ParcelRecord;

describe('massing helpers', () => {
  it('unitsTolerance is max(1, round(10%))', () => {
    expect(unitsTolerance(0)).toBe(1);
    expect(unitsTolerance(1)).toBe(1);
    expect(unitsTolerance(9)).toBe(1);
    expect(unitsTolerance(15)).toBe(2);
    expect(unitsTolerance(20)).toBe(2);
    expect(unitsTolerance(100)).toBe(10);
  });

  const b = generateWith(std as ParcelRecord, { maxStories: 5 }, GOLDEN, 'max', SIMPLE)!;

  it('a user building is not approximate and masses to its own units', () => {
    expect(b.typology).toBe('walkup');
    expect(Math.abs(b.floorAreaM2 - 812.9)).toBeLessThanOrEqual(2); // golden.spec.ts:56
    expect(massedUnits(b)).toBe(b.units);
    expect(massingApproximate(b)).toBe(false);
  });

  it('flags a unit count far from what the floor area supports', () => {
    expect(massedUnits({ ...b, units: 20 })).toBe(9);
    expect(massingApproximate({ ...b, units: 20 })).toBe(true);
    expect(massingApproximate({ ...b, units: 10 })).toBe(false);
  });
});

describe('generateForUnits', () => {
  const run = (j: unknown, U: number, maxS: number, stories?: number, cd = SIMPLE) =>
    generateForUnitsWith(P(j), U, maxS, GOLDEN, cd, stories);
  const siteOf = (j: unknown) => normaliseSite(P(j).polygon, GOLDEN.edgeInsetM)!;

  it('G1: std, U 9, stories 5 → walkup 5, FA 812.9, not approximate', () => {
    const b = run(std, 9, 80, 5)!;
    expect(b).toMatchObject({ typology: 'walkup', stories: 5, units: 9 });
    expect(Math.abs(b.floorAreaM2 - 812.9)).toBeLessThanOrEqual(2);
    expect(massingApproximate(b)).toBe(false);
  });

  it('G2: lot-1000, U 59, stories 6 → podium, FA 4800', () => {
    const b = run(lot1000, 59, 80, 6)!;
    expect(b).toMatchObject({ typology: 'podium', stories: 6, units: 59 });
    expect(Math.abs(b.floorAreaM2 - 4800)).toBeLessThanOrEqual(2);
  });

  it('G3: std-over-apartment, U 3, stories 3 → plex 3 where generate returns null (no I8)', () => {
    const b = run(overApt, 3, 80, 3)!;
    expect(b).toMatchObject({ typology: 'plex', stories: 3, units: 3, replacesExisting: true });
    expect(Math.abs(b.floorAreaM2 - 418.1)).toBeLessThanOrEqual(2);
    expect(generate(P(overApt), { maxStories: 3 }, fnv1a32(P(overApt).id), 'max')).toBeNull();
  });

  it('G4: std, U 20, no stories → undershoot walkup 5 holding 9', () => {
    const b = run(std, 20, 80)!;
    expect(b).toMatchObject({ typology: 'walkup', stories: 5, units: 20 });
    expect(massedUnits(b)).toBe(9);
    expect(massingApproximate(b)).toBe(true);
  });

  it('G6: std, U 5, stories 3 → plex promoted to walkup 3', () => {
    const b = run(std, 5, 80, 3)!;
    expect(b).toMatchObject({ typology: 'walkup', stories: 3, units: 5 });
    expect(massedUnits(b)).toBe(5);
  });

  it('G7: std, U 17, stories 8 → midrise 8 (uncapped stories)', () => {
    expect(run(std, 17, 80, 8)).toMatchObject({ typology: 'midrise', stories: 8 });
  });

  it('G8: tower-fallback, stories 20 → midrise 20', () => {
    const [c] = massingCandidates(siteOf(towerFallback), 1, GOLDEN, { stories: 20 });
    expect(c.ref).toMatchObject({ typology: 'midrise', stories: 20 });
    const b = run(towerFallback, c.cap, 80, 20)!;
    expect(b).toMatchObject({ typology: 'midrise', stories: 20, units: c.cap });
    expect(massingApproximate(b)).toBe(false);
  });

  it('G9: lot-3000, U 754, stories 65 → tower 65, top 202.9 m + parapet', () => {
    const b = run(lot3000, 754, 80, 65)!;
    expect(b).toMatchObject({ typology: 'tower', stories: 65, units: 754 });
    const occupied = b.parts.filter((p) => p.role === 'occupied');
    expect(Math.max(...occupied.map((p) => p.topM))).toBe(202.9); // 4.5 + 64 × 3.1
    const capped = run(lot3000, 754, 80, 65, { ...SIMPLE, capEnabled: true })!;
    const roofs = capped.parts.filter((p) => p.role === 'roof');
    expect(roofs.length).toBeGreaterThan(0);
    for (const r of roofs) expect(r.topM).toBe(Math.round((202.9 + GOLDEN.parapetM) * 100) / 100);
  });

  it('returns null for unusable units, parcels, sites and story bounds', () => {
    for (const u of [NaN, 0, 0.9, Infinity]) expect(run(std, u, 80, 5)).toBeNull();
    expect(generateForUnitsWith([], 9, 80, GOLDEN, SIMPLE, 5)).toBeNull();
    const bad = [
      { ...P(std), labelPoint: [NaN, 37.7] },
      { ...P(lot1000), labelPoint: [-122.4] }
    ] as ParcelRecord[];
    expect(generateForUnitsWith(bad, 9, 80, GOLDEN, SIMPLE, 5)).toBeNull();
    for (const j of [tiny, sliver]) {
      expect(run(j, 1, 80)).toBeNull();
      expect(run(j, 1, 80, 3)).toBeNull();
    }
    expect(run(std, 9, 0)).toBeNull();
  });

  it('treats stories 920 as absent', () => {
    const b = run(lot3000, 754, 80, 920)!;
    expect(b.stories).toBeLessThanOrEqual(80);
    expect(b).toStrictEqual(run(lot3000, 754, 80));
  });

  it('ignores eligible and existing development', () => {
    const p = { ...P(std), eligible: false, existingUnits: 50 };
    expect(run(p, 9, 80, 5)).toMatchObject({ typology: 'walkup', stories: 5, units: 9 });
  });

  it('stamps pipeline source, floors units and never draws an adu', () => {
    const b = run(std, 12.7, 80)!;
    expect(b.source).toBe('pipeline');
    expect(b.units).toBe(12);
    expect(b.parcelId).toBe(P(std).id);
    const one = run(std, 1, 80, 1)!;
    expect(one).toMatchObject({ typology: 'plex', stories: 1, replacesExisting: true });
  });

  it('normalises the seed with >>> 0 and never throws on it', () => {
    for (const s of [-1, 1.5, 2 ** 32 + 7]) {
      expect(generateForUnits(P(std), 9, 80, s, 5)).toStrictEqual(
        generateForUnits(P(std), 9, 80, s >>> 0, 5)
      );
    }
  });

  it('requires a finite maxStories when stories are absent, and caps it at 80', () => {
    expect(run(std, 9, Infinity)).toBeNull();
    expect(run(std, 9, NaN)).toBeNull();
    expect(run(lot3000, 2000, 500)!.stories).toBeLessThanOrEqual(80);
  });

  it('treats invalid stories as absent and floors valid ones', () => {
    const absent = run(lot1000, 59, 80);
    expect(absent).toMatchObject({ typology: 'podium', stories: 6 });
    for (const s of [0.5, -3, NaN, 81]) expect(run(lot1000, 59, 80, s)).toStrictEqual(absent);
    expect(run(std, 9, 80, 5.7)!.stories).toBe(5);
  });

  it('drops a record with a bad label point', () => {
    const extra = { ...P(std), id: 'x', labelPoint: [NaN, 0] } as ParcelRecord;
    expect(generateForUnitsWith([P(std), extra], 9, 80, GOLDEN, SIMPLE, 5)).toStrictEqual(
      run(std, 9, 80, 5)
    );
  });

  it('a huge undershoot on std is fast and approximate', () => {
    const t0 = performance.now();
    const b = generateForUnits(P(std), 1e9, 80, fnv1a32(P(std).id))!;
    const ms = performance.now() - t0;
    expect(b).not.toBeNull();
    expect(b.units).toBe(1e9);
    expect(massingApproximate(b)).toBe(true);
    expect(ms).toBeLessThan(50);
  });
});
