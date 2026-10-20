import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { assembleSite } from './assemble';
import { drawComposition } from './composition-variety';
import { generateDistrictForUnits, lotRecord, lotSeed } from './district';
import { layoutDistrict, type DistrictLot } from './district-layout';
import { rect, type Polygon } from './fixtures/district';
import { rectRing } from './fixtures/geom';
import lot1000 from './fixtures/lot-1000.json';
import { generate } from './generate';
import { mulberry32 } from './seed';
import { selectTypology } from './select';
import { normaliseSite } from './site';
import type { GeneratedBuilding } from './types';
import { generateForUnits, generateForUnitsWith, massingApproximate } from './units';
import { drawVariety } from './variety';

const LNG = -122.39;
const parcel = (polygon: Polygon, over: Partial<ParcelRecord> = {}): ParcelRecord => ({
  id: 'D1',
  polygon,
  labelPoint: [LNG, 37.73],
  areaM2: 0,
  existingUnits: 0,
  existingFloorAreaM2: 0,
  existingHeightM: 0,
  landUse: 'X',
  eligible: true,
  neighborhood: 'X',
  ...over
});

const SEED = 11;
const big = parcel(rect(800, 500));
const layout = layoutDistrict(big.polygon, SEED);
/** Area of the lot's normalised site: what the lot-area cap chain sees (R1). */
const lotA = (lot: DistrictLot) =>
  normaliseSite(lot.polygon, drawVariety(lotSeed(SEED, lot.key)).edgeInsetM)!.A;
/** Built stories of a lot massed by `generate` at `S` (R1: the cap chain applies). */
const capped = (S: number, lot: DistrictLot) => selectTypology(S, lotA(lot), 0).stories;

/** Lot `i` of the 40 ha site massed by `generate` at `S`; null when the lot cannot mass. */
function generateLot(i: number, S: number): GeneratedBuilding | null {
  const lot = layout.lots[i];
  return generate(lotRecord(big, lot), { maxStories: S }, lotSeed(SEED, lot.key), 'max');
}

/**
 * Every lot at `S`, in fill order, skipping a lot that masses null at `S` (lot 85 of this site
 * fails as a midrise). The full lots are at the cap chain's stories (R1); the remainder lot is
 * massed by generateForUnitsWith with stated `S`, which keeps `S` uncapped.
 */
function expectLotStories(b: GeneratedBuilding, S: number) {
  const fill = layout.lots.map((_, i) => i).filter((i) => generateLot(i, S));
  const lots = b.lots!;
  const last = lots.length - 1;
  lots.forEach((l, i) => expect(l.stories).toBe(i === last ? S : capped(S, layout.lots[fill[i]])));
}

describe('district massing in generateForUnits (spec §4.3 pipeline, §4.4)', () => {
  const noEvidence = generateForUnits(big, 3454, 40, SEED, undefined, { storyLimit: 12 })!;

  it('no evidence: heights drawn in [3, L]', () => {
    expect(noEvidence.units).toBe(3454);
    expect(massingApproximate(noEvidence)).toBe(false);
    const lots = noEvidence.lots!;
    expect(lots.length).toBeGreaterThan(1);
    expect(lots.length).toBeLessThan(layout.lots.length);
    for (const l of lots) {
      expect(l.stories).toBeGreaterThanOrEqual(3);
      expect(l.stories).toBeLessThanOrEqual(12);
    }
    expect(new Set(lots.map((l) => l.stories)).size).toBeGreaterThan(1);
    expect(noEvidence.stories).toBe(Math.max(...lots.map((l) => l.stories)));
    expect(noEvidence.source).toBe('pipeline');
    expect(noEvidence.parcelId).toBe('D1');
  });

  it('same seed, same district', () => {
    expect(generateForUnits(big, 3454, 40, SEED, undefined, { storyLimit: 12 })).toStrictEqual(
      noEvidence
    );
    expect(generateForUnits(big, 3454, 40, 12, undefined, { storyLimit: 12 })).not.toStrictEqual(
      noEvidence
    );
  });

  it('curated height: every lot at 8', () => {
    const b = generateForUnits(big, 3454, 40, SEED, undefined, {
      curatedStories: 8,
      storyLimit: 12
    })!;
    expect(b.units).toBe(3454);
    expect(massingApproximate(b)).toBe(false);
    expectLotStories(b, 8);
  });

  it('stated stories win', () => {
    const b = generateForUnits(big, 3454, 40, SEED, 5, { curatedStories: 8, storyLimit: 12 })!;
    expect(b.units).toBe(3454);
    expectLotStories(b, 5);
    // a stated tier-0 count is never raised by the run-out
    const short = generateForUnits(big, 200_000, 40, SEED, 5, { storyLimit: 12 })!;
    expect(short.units).toBe(200_000);
    expect(short.lots).toHaveLength(layout.lots.length);
    for (const l of short.lots!) expect(l.stories).toBeLessThanOrEqual(5);
    expect(massingApproximate(short)).toBe(true);
  });

  it('few units leave lots empty', () => {
    const b = generateForUnits(big, 300, 40, SEED, undefined, { storyLimit: 12 })!;
    expect(b.units).toBe(300);
    expect(b.lots!.length).toBeLessThan(layout.lots.length / 4);
  });

  it('tiny U', () => {
    for (const U of [1, 3]) {
      const b = generateForUnits(big, U, 40, SEED, undefined, { storyLimit: 12 });
      expect(b).not.toBeNull();
      expect(b!.units).toBe(U);
      expect(b!.lots).toHaveLength(1);
    }
  });

  it('units is always Math.floor(units)', () => {
    const b = generateForUnits(big, 3454.7, 40, SEED, undefined, { storyLimit: 12 })!;
    expect(b).toStrictEqual(noEvidence);
    expect(generateForUnits(big, 0.5, 40, SEED)).toBeNull();
    expect(generateForUnits(big, NaN, 40, SEED)).toBeNull();
  });

  it('run-out raises to L', () => {
    const b = generateForUnits(big, 200_000, 40, SEED, undefined, { storyLimit: 12 })!;
    expect(b.units).toBe(200_000);
    expect(massingApproximate(b)).toBe(true);
    expect(b.lots).toHaveLength(layout.lots.length);
    // a lot that cannot mass at L (lot 85 fails as a midrise) keeps its drawn height
    b.lots!.forEach((l, i) => {
      if (generateLot(i, 12)) expect(l.stories).toBe(capped(12, layout.lots[i]));
      else expect(l.stories).toBeLessThan(8);
    });
    expect(layout.lots.filter((_, i) => !generateLot(i, 12))).toHaveLength(1);
  });

  it('run-out stops at the lot that reaches U', () => {
    // the drawn heights (L 12) hold fewer units than every lot at L; U sits between the two
    const drawnS = layout.lots.map((l) => 3 + Math.floor(mulberry32(lotSeed(SEED, l.key))() * 10));
    const sum = (S: (i: number) => number) =>
      layout.lots.reduce(
        (s, _, i) => s + (generateLot(i, S(i)) ?? generateLot(i, drawnS[i]))!.units,
        0
      );
    const U = Math.floor((sum((i) => drawnS[i]) + sum(() => 12)) / 2);
    const b = generateForUnits(big, U, 40, SEED, undefined, { storyLimit: 12 })!;
    expect(b.units).toBe(U);
    expect(massingApproximate(b)).toBe(false);
    expect(b.lots).toHaveLength(layout.lots.length);
    const last = layout.lots.length - 1;
    expect(b.lots![0].stories).toBe(capped(12, layout.lots[0]));
    expect(b.lots![last].stories).toBe(capped(drawnS[last], layout.lots[last]));
  });

  it('opts ignored below the threshold', () => {
    const p = lot1000 as unknown as ParcelRecord;
    const plain = generateForUnits(p, 50, 10, SEED);
    expect(plain).not.toBeNull();
    expect(generateForUnits(p, 50, 10, SEED, undefined, { curatedStories: 9 })).toStrictEqual(
      plain
    );
    expect(plain).toStrictEqual(
      generateForUnitsWith(p, 50, 10, drawVariety(SEED), drawComposition(SEED))
    );
  });

  it('L clamps', () => {
    const low = generateForUnits(big, 300, 40, SEED, undefined, { storyLimit: 1 })!;
    for (const l of low.lots!) expect(l.stories).toBe(3);
    expect(low).toStrictEqual(generateForUnits(big, 300, 40, SEED, undefined, { storyLimit: 3 }));
    // absent or NaN: DISTRICT_FALLBACK_LIMIT (8)
    const fallback = generateForUnits(big, 300, 40, SEED, undefined, { storyLimit: 8 });
    expect(generateForUnits(big, 300, 40, SEED)).toStrictEqual(fallback);
    expect(generateForUnits(big, 300, 40, SEED, undefined, { storyLimit: NaN })).toStrictEqual(
      fallback
    );
    const high = generateForUnits(big, 1e7, 40, SEED, undefined, { storyLimit: 500 })!;
    expect(high.stories).toBe(80);
    expect(high).toStrictEqual(generateForUnits(big, 1e7, 40, SEED, undefined, { storyLimit: 80 }));
  });

  it('multi-parcel assembly of 2 ha or more uses every piece', () => {
    // two 120 × 100 m parcels in one frame, 40 m apart: 2.4 ha in two pieces. Each piece is one
    // block, so the default 15% open space would take a whole piece; a curated share of 0 keeps both.
    const a = parcel([rectRing(120, 100, -80, 0)], { id: 'A', areaM2: 12_000 });
    const c = parcel([rectRing(120, 100, 80, 0)], { id: 'B', areaM2: 12_000 });
    const opts = { openSpaceShare: 0 };
    const one = generateForUnits([a, c], 1, 40, SEED, 5, opts)!;
    expect(one.lots).toHaveLength(1);
    // U is the first piece's capacity at 5 stories and 20 more, so the fill crosses into the second
    const assembled = assembleSite([a, c])!;
    const lots = layoutDistrict(assembled.polygon, SEED, 0).lots;
    expect(layoutDistrict(assembled.polygon, SEED).openSpace).toHaveLength(1);
    const first = lots[0].key.split(':')[0];
    const cap = lots
      .filter((l) => l.key.split(':')[0] === first)
      .map((l) => generate(lotRecord(a, l), { maxStories: 5 }, lotSeed(SEED, l.key), 'max'))
      .reduce((t, x) => t + (x?.units ?? 0), 0);
    const b = generateForUnits([a, c], cap + 20, 40, SEED, 5, opts)!;
    expect(b.units).toBe(cap + 20);
    expect(massingApproximate(b)).toBe(false);
    expect(b.lots!.length).toBeGreaterThan(
      lots.filter((l) => l.key.split(':')[0] === first).length
    );
    const sides = new Set(b.parts.map((p) => p.footprint.every(([lng]) => lng < LNG)));
    expect(sides).toStrictEqual(new Set([true, false]));
  });

  it('generateDistrictForUnits is not-district when the layout has no lots', () => {
    const pier = parcel([rectRing(4100, 5)]);
    const assembled = { anchor: pier, records: [pier], polygon: pier.polygon };
    expect(generateDistrictForUnits(assembled, 100, SEED, null, {})).toBe('not-district');
    expect(generateForUnits(pier, 100, 6, SEED)).toStrictEqual(
      generateForUnitsWith(pier, 100, 6, drawVariety(SEED), drawComposition(SEED))
    );
  });
});
