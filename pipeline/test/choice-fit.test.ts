// The choice-spread fit and the affordable rule (building-choice plan, Task 8).
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/lib/generator/seed';
import { choiceCtxOf, choiceRow, pickOption } from '../../src/lib/sim/choice/choose';
import {
  choiceModel,
  heightTime,
  opt,
  shippedPrices,
  table
} from '../../src/lib/sim/choice/test/model';
import type { Option } from '../../src/lib/sim/choice/types';
import { choiceFeatures } from '../../src/lib/sim/choice/choose';
import type { Calibration } from '../../src/lib/timelapse/types';
import {
  affordableRule,
  affordableRuleMeasurable,
  atSearchBound,
  choiceRecords,
  marketRecords,
  measureOverlap,
  SPREAD_RANGE,
  fitChoiceSpread,
  optionsOf,
  type ChoiceRecord
} from '../lib/fzp-cal/choice-fit';
import { choiceOutcomes } from '../lib/fzp-cal/invariants';
import { eraPrices } from '../lib/fzp-cal/era-market';
import { choiceModelOf, choiceSpreadWarning } from '../lib/fzp-cal/calibrate';
import { FIXTURE_CAL, LIVE_CAL } from '../lib/fzp-cal/config';
import type { ShippedStep } from '../lib/fzp-cal/shipped-step';
import { withChoiceFeatures, type PanelSource, type PanelYearRow } from '../lib/fzp-cal/panel';
import type { NormHistory } from '../lib/fzp-cal/types';
import { isoToDay } from '../project-records/multiphase';

/** A lot's options: Type V to 6 stories, Type III 4 to 8 and Type I midrise 8 to 12. */
function lotOptions(k: number): Option[] {
  const out: Option[] = [];
  for (let s = 1; s <= 12; s++) {
    if (s <= 6) out.push(opt('V', 'walkup', s, Math.round(s * k)));
    if (s >= 4 && s <= 8) out.push(opt('III', 'midrise', s, Math.round(s * k * 1.2)));
    if (s >= 8) out.push(opt('I', 'midrise', s, Math.round(s * k * 1.4)));
  }
  return out;
}

/** n records whose stories are drawn from the market choice at `spread` by the run-time code. */
function drawRecords(n: number, spread: number, seed: number): ChoiceRecord[] {
  const rng = mulberry32(seed);
  const rows = Array.from({ length: n }, () => ({
    options: lotOptions(4 + Math.floor(rng() * 12)),
    // values well above break-even, so the spread shapes the draw and the fit can recover it
    locationValue: 1.2 + 1.3 * rng(),
    limit: 4 + Math.floor(rng() * 9)
  }));
  const t = table(rows.map((r) => ({ options: r.options, locationValue: r.locationValue })));
  const ctx = choiceCtxOf(t, choiceModel(spread), heightTime);
  const out = new Float32Array(64);
  return rows.map((r, lot) => {
    const allowed = r.options.filter((o) => o.stories <= r.limit).length;
    if (!choiceRow(ctx, 0, lot, allowed, null, 0, 'market', out)) throw new Error('no option');
    const k = pickOption(out, allowed, rng());
    return { ...r, stories: r.options[k].stories };
  });
}

const time = heightTime.steps[0].value;

describe('fitChoiceSpread', () => {
  it('recovers a known choiceSpread of 0.3 from 200 records within 0.1', () => {
    const records = drawRecords(200, 0.3, 0x5eed);
    const fit = fitChoiceSpread(records, shippedPrices(), time, heightTime.upTo);
    expect(fit.n).toBe(200);
    expect(fit.excludedOver).toBe(0);
    expect(Number.isFinite(fit.logLik)).toBe(true);
    expect(Math.abs(fit.choiceSpread - 0.3)).toBeLessThan(0.1);
  });

  it("prices a record from an earlier year with that year's ratio", () => {
    const [early, late] = drawRecords(2, 0.3, 11);
    const ratio = { value: 0.9, cost: 0.7 };
    const pricesFor = (year: number) =>
      year === 2016 ? eraPrices(shippedPrices(), ratio) : shippedPrices();
    const both = fitChoiceSpread(
      [
        { ...early, year: 2016 },
        { ...late, year: 2026 }
      ],
      shippedPrices(),
      time,
      heightTime.upTo,
      pricesFor
    );
    const earlyAlone = fitChoiceSpread(
      [early],
      eraPrices(shippedPrices(), ratio),
      time,
      heightTime.upTo
    );
    const lateAlone = fitChoiceSpread([late], shippedPrices(), time, heightTime.upTo);
    expect(both.n).toBe(2);
    both.profile.forEach((p, i) => {
      expect(p.logLik).toBeCloseTo(earlyAlone.profile[i].logLik + lateAlone.profile[i].logLik, 9);
    });
    // at the shipped prices the early record scores differently: the ratio was applied
    const shipped = fitChoiceSpread([early], shippedPrices(), time, heightTime.upTo);
    expect(shipped.profile[2].logLik).not.toBeCloseTo(earlyAlone.profile[2].logLik, 6);
  });

  it('excludes a record over its limit and counts it', () => {
    const records = drawRecords(40, 0.3, 7);
    const over = { ...records[0], stories: records[0].limit + 1 };
    const with1 = fitChoiceSpread([...records, over], shippedPrices(), time, heightTime.upTo);
    const without = fitChoiceSpread(records, shippedPrices(), time, heightTime.upTo);
    expect(with1.excludedOver).toBe(1);
    expect(with1.n).toBe(40);
    expect(with1.choiceSpread).toBe(without.choiceSpread);
    expect(with1.logLik).toBe(without.logLik);
  });
});

describe('affordableRule', () => {
  const cohort = (diff: number, se: number) => ({
    affordable: { mean: 0.9, n: 40, se: 0.03 },
    private: { mean: 0.9 - diff, n: 400, se: 0.01 },
    diff,
    se
  });

  it("is 'market' when the difference is within 2 SE", () => {
    expect(affordableRule(cohort(0.05, 0.04))).toEqual({ rule: 'market', diff: 0.05, se: 0.04 });
  });

  it("is 'market' without a measurable difference, whatever the difference", () => {
    expect(affordableRule(cohort(0.12, 0)).rule).toBe('market');
    expect(affordableRule(cohort(NaN, 0.04)).rule).toBe('market');
    expect(affordableRuleMeasurable({ diff: 0.12, se: 0 })).toBe(false);
  });

  it("is 'most-homes' when affordable projects build closer to the limit beyond 2 SE", () => {
    expect(affordableRule(cohort(0.12, 0.04))).toEqual({
      rule: 'most-homes',
      diff: 0.12,
      se: 0.04
    });
  });
});

// Two panel parcels: A with three options, B with two; panel-options rows 0 and 1.
const panelTable = table([
  {
    options: [opt('V', 'walkup', 3, 12), opt('III', 'podium', 6, 40), opt('I', 'midrise', 10, 80)],
    locationValue: 1.2
  },
  { options: [opt('V', 'walkup', 4, 20), opt('III', 'midrise', 8, 60)], locationValue: 1 }
]);
const feats = (): PanelYearRow['features'] => ({
  potentialRatio: NaN,
  existingUnits: 2,
  lotAreaM2: 400,
  yearBuilt: 1925,
  storiesGap: NaN,
  improvementShare: 0.3,
  rentControlLikely: 0,
  landUseClass: 0,
  choiceMargin: NaN
});
const panelRow = (mapblklot: string, optionRow: number, baseStories: number): PanelYearRow => ({
  mapblklot,
  hostableBase: true,
  imputed: 0,
  features: feats(),
  choice: { optionRow, baseStories, baseCap: null, existingUnits: 2, existingStories: 1 }
});
const panelSrc: PanelSource = {
  years: [2018, 2019],
  async read() {
    return [
      panelRow('A', 0, 6),
      panelRow('B', 1, 8),
      { ...panelRow('C', 0, 6), choice: undefined }
    ];
  }
};

describe('withChoiceFeatures', () => {
  it('fills the three choice features through choiceFeatures and passes other rows through', async () => {
    const ctx = choiceCtxOf(panelTable, choiceModel(0.5), heightTime);
    const rows = await withChoiceFeatures(panelSrc, ctx).read(2018);
    // A: base 6 stories allows its first two options
    expect(rows[0].features).toEqual({ ...feats(), ...choiceFeatures(ctx, 0, 0, 2, null, 2, 1) });
    expect(rows[1].features).toEqual({ ...feats(), ...choiceFeatures(ctx, 0, 1, 2, null, 2, 1) });
    expect(Number.isFinite(rows[0].features.choiceMargin)).toBe(true);
    expect(rows[2].features.choiceMargin).toBeNaN();
  });
});

describe('choiceRecords', () => {
  const hist = (
    id: string,
    parcel: string,
    day: string,
    stories: number,
    base: number,
    affordable = 0
  ) =>
    ({
      id,
      parcelIds: [parcel],
      eff: { filed: isoToDay(day) },
      src: {
        storiesProposed: stories,
        baseStoriesAtFiling: base,
        planningProposed: { units: 20, affordable }
      }
    }) as unknown as NormHistory;

  it("takes each record's panel row of its first record's year, with today's location value", async () => {
    const out = await choiceRecords(
      [
        hist('P1', 'A', '2018-05-01', 6, 6),
        hist('P2', 'B', '2019-02-01', 8, 8, 20),
        hist('P3', 'C', '2019-02-01', 4, 6), // no choice inputs on its row
        hist('P4', 'A', '2012-01-01', 4, 6) // before 2015: not a record
      ],
      panelSrc,
      panelTable,
      () => 100,
      isoToDay('2026-01-01')
    );
    expect(out.measured).toBe(3);
    expect(out.noPanelRow).toBe(1);
    expect(out.records).toEqual([
      {
        options: optionsOf(panelTable, 0),
        locationValue: Math.fround(1.2),
        limit: 6,
        stories: 6,
        existing: 2,
        cap: null,
        cohort: 'private',
        year: 2018
      },
      {
        options: optionsOf(panelTable, 1),
        locationValue: 1,
        limit: 8,
        stories: 8,
        existing: 2,
        cap: null,
        cohort: 'affordable',
        year: 2019
      }
    ]);
  });
});

describe('choiceOutcomes (V25)', () => {
  const good = (): Pick<Calibration, 'asOf' | 'choice' | 'heightTime'> => ({
    asOf: 100,
    choice: { ...choiceModel(0.4, [{ from: 100, value: shippedPrices() }]) },
    heightTime: { ...heightTime, steps: [{ from: 100, value: time }] }
  });

  it('passes a well-formed choice and height-time', () => {
    expect(choiceOutcomes(good())).toEqual([]);
  });

  it('names each problem', () => {
    const c = good();
    c.choice!.choiceSpread = 0;
    c.heightTime!.steps = [{ from: 99, value: time }];
    c.choice!.provenance = {
      ...c.choice!.provenance,
      choiceSpread: { ...c.choice!.provenance.choiceSpread, label: 'made up' }
    };
    expect(choiceOutcomes(c)).toEqual([
      'heightTime.steps is not one step from asOf 100',
      'choice.choiceSpread 0 is not above 0',
      'choice.provenance.choiceSpread is tier 4 and its label does not say invented'
    ]);
    expect(choiceOutcomes({ asOf: 1 })).toEqual(['no choice', 'no heightTime']);
  });
});

describe('marketRecords', () => {
  const rec = (cohort?: ChoiceRecord['cohort']): ChoiceRecord => ({
    options: lotOptions(4),
    locationValue: 1,
    limit: 6,
    stories: 6,
    cohort
  });
  const all = [rec('private'), rec('affordable'), rec(), rec('affordable'), rec('noRecord')];

  it("leaves affordable-cohort records out under 'most-homes' and counts them", () => {
    const out = marketRecords(all, 'most-homes');
    expect(out.affordable).toBe(2);
    expect(out.records.map((r) => r.cohort)).toEqual(['private', undefined, 'noRecord']);
  });

  it("keeps every record under 'market'", () => {
    expect(marketRecords(all, 'market')).toEqual({ records: all, affordable: 0 });
  });
});

describe('a spread fitted at a search bound', () => {
  const prov = heightTime.provenance;
  const step: ShippedStep = {
    prices: shippedPrices(),
    heightTime,
    aboveTop: { ratio: 1.21, n: [10, 30], provenance: prov },
    filedToIssued: [],
    provenance: { anchors: prov, carrying: prov }
  };
  const cohort = {
    affordable: { mean: 1, n: 40, se: 0.05 },
    private: { mean: 0.95, n: 400, se: 0.02 },
    diff: 0.05,
    se: 0.054
  };
  const fit = (choiceSpread: number) => ({
    choiceSpread,
    logLik: -800,
    n: 500,
    excludedOver: 0,
    noOption: 0,
    profile: []
  });
  const model = (s: number) =>
    choiceModelOf(step, fit(s), affordableRule(cohort), cohort, prov, LIVE_CAL, 100, {
      affordableLeftOut: 3
    });

  it('ships the bound as tier 4, labelled invented (fit at search bound)', () => {
    for (const bound of SPREAD_RANGE) {
      expect(atSearchBound({ choiceSpread: bound * 0.9999 })).toBe(true);
      const m = model(bound * 0.9999);
      expect(m.choiceSpread).toBeCloseTo(bound * 0.9999, 12);
      expect(m.provenance.choiceSpread.tier).toBe(4);
      expect(m.provenance.choiceSpread.label).toBe('Choice spread: invented (fit at search bound)');
    }
    const inside = model(0.4).provenance.choiceSpread;
    expect(inside.tier).toBe(2);
    expect(inside.method).toContain('3 in the affordable cohort left out');
  });

  it('warns at a bound, and not inside it or under too few records', () => {
    expect(choiceSpreadWarning(fit(99.99), LIVE_CAL)).toMatch(
      /^choice: choiceSpread 99\.99 sits at the search bound .* shipped as tier 4 \(invented\)$/
    );
    expect(choiceSpreadWarning(fit(0.4), LIVE_CAL)).toBeNull();
    expect(choiceSpreadWarning({ ...fit(100), n: 1 }, FIXTURE_CAL)).toBeNull();
  });
});

describe('measureOverlap', () => {
  it('reads every year once and counts the hostable rows with choice inputs', async () => {
    const ctx = choiceCtxOf(panelTable, choiceModel(0.5), heightTime);
    const reads: number[] = [];
    const src: PanelSource = {
      years: panelSrc.years,
      async read(y) {
        reads.push(y);
        return panelSrc.read(y);
      }
    };
    const out = await measureOverlap(src, ctx);
    expect(reads).toEqual([2018, 2019]);
    // rows A and B each year; C has no choice inputs
    expect(out.n).toBe(4);
  });
});
