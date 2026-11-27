import { describe, expect, it } from 'vitest';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/world/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/world/fixtures/mini-market';
import { monthFirstDay } from '$lib/sim/world/months';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import { parsePolicy4 } from '$lib/timeline/parse4';
import { DEFAULT_POLICY4 } from '$lib/timeline/policy4';
import { catalogueDoc, offerThrough, onKeys } from './offer';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const calNoFunding: Calibration = { ...miniCal, market: undefined, baselineFunding: undefined };

describe('offerThrough', () => {
  it('round 1 adds the three policies off', () => {
    const doc = offerThrough(DEFAULT_POLICY4, 1, cal);
    expect(doc.kinds.zoning).toEqual([
      {
        id: 'transit-rail',
        label: 'Taller near BART and Caltrain',
        preset: null,
        on: false,
        where: { tag: 'transit', stopTypes: ['regionalRail'] },
        spans: [
          {
            from: monthFirstDay(cal.asOf, 1),
            to: null,
            what: {
              tag: 'bands',
              bands: [
                { maxM: 402, stories: 7 },
                { maxM: 805, stories: 6 }
              ]
            }
          }
        ]
      }
    ]);
    expect(doc.kinds.permitting).toHaveLength(1);
    expect(doc.kinds.permitting[0]).toMatchObject({
      preset: 'sb423Clock',
      on: false,
      label: 'SB 423 clock'
    });
    expect(doc.kinds.money.length).toBeGreaterThanOrEqual(1);
    for (const p of doc.kinds.money)
      expect(p).toMatchObject({ preset: 'housing-bond', on: false, label: 'Housing bond' });
    expect(parsePolicy4(structuredClone(doc), { asOf: cal.asOf })).toBeTruthy();
  });

  it('a second call returns the same object', () => {
    const doc = offerThrough(DEFAULT_POLICY4, 1, cal);
    expect(offerThrough(doc, 1, cal)).toBe(doc);
  });

  it('`also` adds only the named keys past the round', () => {
    const doc = offerThrough(DEFAULT_POLICY4, 0, cal, ['no-discretionary']);
    expect(doc.kinds.zoning).toEqual([]);
    expect(doc.kinds.money).toEqual([]);
    expect(doc.kinds.permitting.map((p) => p.preset)).toEqual(['noDiscretionary']);
  });

  it('without funding data round 1 adds no money policy and does not throw', () => {
    const doc = offerThrough(DEFAULT_POLICY4, 1, calNoFunding);
    expect(doc.kinds.money).toEqual([]);
    expect(doc.kinds.zoning).toHaveLength(1);
  });
});

describe('catalogueDoc and onKeys', () => {
  it('adds the keys on, in catalogue order', () => {
    const doc = catalogueDoc(cal, ['housing-bond', 'transit-rail']);
    expect(doc.kinds.zoning.every((p) => p.on)).toBe(true);
    expect(doc.kinds.money.every((p) => p.on)).toBe(true);
    expect(onKeys(doc)).toEqual(new Set(['transit-rail', 'housing-bond']));
  });

  it('onKeys skips policies that are off', () => {
    expect(onKeys(offerThrough(DEFAULT_POLICY4, 1, cal))).toEqual(new Set());
  });
});
