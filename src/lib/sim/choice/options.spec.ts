import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../../data/parcel';
import { rect } from '../../generator/fixtures/district';
import { rectRing } from '../../generator/fixtures/geom';
import { fnv1a32 } from '../../generator/seed';
import { PROTOTYPES } from '../finance/prototypes';
import {
  candidatesOf,
  costSeriesOf,
  eCrossings,
  lotConstants,
  pruneByCost,
  pruneOptions
} from './options';
import type { BuildingForm, BuildingType, HeightTimeStep, Option, PriceStep } from './types';

const opt = (type: BuildingType, form: BuildingForm, stories: number, homes: number): Option => ({
  type,
  form,
  stories,
  homes,
  plates: form === 'tower' ? 1 : 0
});
const anchors = Object.fromEntries(
  PROTOTYPES.map((p) => [
    p.id,
    {
      stories: p.stories,
      homes: p.homes,
      costPerHome: p.costPerHome,
      valuePerHome: p.costPerHome - p.shortfallPerHome
    }
  ])
) as PriceStep['anchors'];
const prices: PriceStep = {
  anchors,
  aboveTopCostRatio: 1.39,
  carrying: { rate: 0.085, drawn: 0.55 }
};
const upTo = [4, 7, 12, 20, 999];
const time: HeightTimeStep = {
  permitIssued: [1, 1, 1, 1, 1],
  construction: [1, 1, 1, 1, 1],
  constructionMonths: [26.2, 29.3, 28.6, 27.4, 34.7]
};
/** The most homes of any option at or below `stories`. */
const maxHomes = (os: readonly Option[], stories: number) =>
  os.reduce((m, o) => (o.stories <= stories && o.homes > m ? o.homes : m), 0);

const parcel = (
  polygon: ParcelRecord['polygon'],
  over: Partial<ParcelRecord> = {}
): ParcelRecord => ({
  id: 'F1',
  polygon,
  labelPoint: [-122.39, 37.73],
  areaM2: 0,
  existingUnits: 0,
  existingFloorAreaM2: 0,
  existingHeightM: 0,
  landUse: 'X',
  eligible: true,
  neighborhood: 'X',
  ...over
});
/** 120 × 130 m, the size of lot 2455001. */
const bigRec = parcel(rect(120, 130));
/** A standard 25 × 100 ft lot. */
const smallRec = parcel([rectRing(7.62, 30.48)]);
const seed = fnv1a32(bigRec.id);

describe('pruneOptions', () => {
  it('drops a taller option of the same type and form with fewer homes', () => {
    const c = [opt('I', 'block', 12, 1663), opt('I', 'block', 13, 797)];
    expect(pruneOptions(c).map((o) => o.stories)).toEqual([12]);
  });
  it('never drops an option because of cost', () => {
    // Type III at 5 stories and 24 homes beats a 20-home Type V at 5 stories on homes and
    // stories, but different types are never compared
    const c = [opt('III', 'podium', 5, 24), opt('V', 'walkup', 5, 20)];
    expect(pruneOptions(c)).toHaveLength(2);
    // a different form of the same type with fewer homes stays too
    expect(pruneOptions([opt('I', 'block', 13, 300), opt('I', 'tower', 13, 200)])).toHaveLength(2);
    // and cost-based pruning would have dropped one of them, which only the report sees
    expect(pruneByCost(c, prices, time, upTo).length).toBeLessThan(2);
  });
  it('never prunes across the Type V 25-home line', () => {
    // same type and form, fewer stories and more homes, but E-priced against A-priced: both survive
    const c = [opt('V', 'walkup', 4, 30), opt('V', 'walkup', 5, 24)];
    expect(pruneOptions(c)).toHaveLength(2);
    expect(costSeriesOf(c[0])).toBe('V');
    expect(costSeriesOf(c[1])).toBe('E');
    expect(eCrossings(c)).toBe(1);
  });
  it('keeps the lower index of two equal options, and the input order', () => {
    const a = opt('I', 'midrise', 6, 40);
    const b = opt('I', 'midrise', 6, 40);
    const c = [opt('V', 'plex', 2, 4), a, b, opt('I', 'midrise', 7, 40)];
    const p = pruneOptions(c);
    expect(p).toEqual([c[0], a]);
    expect(p[1]).toBe(a);
  });
  it('drops an option of equal stories and fewer homes, not one of more stories and more homes', () => {
    const c = [
      opt('III', 'midrise', 6, 50),
      opt('III', 'midrise', 6, 60),
      opt('III', 'midrise', 7, 70)
    ];
    expect(pruneOptions(c).map((o) => o.homes)).toEqual([60, 70]);
    expect(eCrossings(c)).toBe(0);
  });
});

describe('candidatesOf', () => {
  const c = candidatesOf(bigRec, seed);
  it('never builds Type V above 6 or Type III above 8', () => {
    expect(c.some((o) => o.type === 'V')).toBe(true);
    expect(c.some((o) => o.type === 'III')).toBe(true);
    for (const o of c) {
      if (o.type === 'V') expect(o.stories).toBeLessThanOrEqual(6);
      if (o.type === 'III') expect(o.stories).toBeGreaterThanOrEqual(4);
      if (o.type === 'III') expect(o.stories).toBeLessThanOrEqual(8);
      if (o.form === 'tower') expect(o.stories).toBeGreaterThanOrEqual(13);
    }
  });
  it('gives one option per (type, form, stories), sorted by stories, type and form', () => {
    const keys = c.map((o) => `${o.type}/${o.form}/${o.stories}`);
    expect(new Set(keys).size).toBe(keys.length);
    const rank = (o: Option) =>
      o.stories * 100 +
      ['V', 'III', 'I'].indexOf(o.type) * 10 +
      ['plex', 'walkup', 'podium', 'midrise', 'block', 'tower'].indexOf(o.form);
    for (let i = 1; i < c.length; i++) expect(rank(c[i])).toBeGreaterThan(rank(c[i - 1]));
    expect(c.every((o) => o.homes > 0)).toBe(true);
    expect(c.some((o) => o.form === 'block' && o.stories > 12)).toBe(true);
    expect(c.some((o) => o.form === 'tower' && o.plates > 1)).toBe(true);
  });
  it('keeps the most-homes option at every cap', () => {
    const p = pruneOptions(c);
    expect(p.length).toBeLessThan(c.length);
    for (let s = 1; s <= 80; s++) expect(maxHomes(p, s)).toBe(maxHomes(c, s));
  });
  it('gives a small lot no tower and nothing for an ineligible lot', () => {
    const small = candidatesOf(smallRec, fnv1a32(smallRec.id));
    expect(small.length).toBeGreaterThan(0);
    expect(small.some((o) => o.form === 'tower')).toBe(false);
    expect(candidatesOf(parcel(rect(120, 130), { eligible: false }), seed)).toEqual([]);
  });
});

describe('lotConstants', () => {
  it('takes breakEvenValue as the least (cost + carry) ÷ value over all options', () => {
    // A at 729,700 ÷ 552,700 = 1.3202; B at 736,700 ÷ 584,700 = 1.2600; neither carries
    const two = [opt('V', 'walkup', 5, 45), opt('III', 'midrise', 8, 130)];
    const k = lotConstants(two, prices, time, upTo);
    expect(k.breakEvenValue).toBeCloseTo(1.2599623738669403, 9);
    expect(k.meanOptionHomes).toBe(87.5);
    expect(k.meanOptionCost).toBe(733_200);
  });
  it('counts the carrying cost of a taller Type I', () => {
    // 22 stories: cost 857,700 + 9/11 × 61,000 = 907,609.09; value 651,700 − 9/11 × 25,000 =
    // 631,245.45; carry 0.085 × 0.55 × 907,609.09 × (34.7 − 27.4) ÷ 12 = 25,812.02
    const k = lotConstants([opt('I', 'midrise', 22, 300)], prices, time, upTo);
    expect(k.breakEvenValue).toBeCloseTo(1.4786975629887524, 9);
    expect(k.meanOptionCost).toBeCloseTo(907_609.0909, 3);
  });
  it('gives an empty row no break-even', () => {
    expect(lotConstants([], prices, time, upTo)).toEqual({
      breakEvenValue: Infinity,
      meanOptionHomes: 0,
      meanOptionCost: 0
    });
  });
});
