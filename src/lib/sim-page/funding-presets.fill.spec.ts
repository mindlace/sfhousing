// The presets' effects under the fill rule (finance-levers spec section 4.7, "What each preset
// does under the fill rule"), at the level of `fundBundle` on the baseline's affordable bundle, no
// engine. These lock the preset descriptions to the rule; the pool dynamics are the engine's tests.
import { describe, expect, it } from 'vitest';
import {
  fundBundle,
  PROTOTYPES,
  resolveTerms,
  uncoveredPerHome,
  type BundleItem
} from '$lib/sim/finance';
import { baselineFixture, FIXTURE_AS_OF } from '$lib/sim/levers/fixtures/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Pool, Programme } from '$lib/timelapse/types';
import { addPreset, fundingPresets } from './funding-presets';

const baseline = baselineFixture(FIXTURE_AS_OF).baselineFunding;
const cal: Calibration = {
  ...parseCalibration(structuredClone(miniCalibrationJson) as unknown),
  asOf: FIXTURE_AS_OF,
  market: miniMarket(),
  baselineFunding: baseline
};
const proto = PROTOTYPES[0];
const terms = resolveTerms();
const U = uncoveredPerHome('affordable', proto);
const empty = (): FinanceLevers => ({ baselineScale: [], pools: [], programmes: [], terms: {} });
const CITY = ['goBond', 'generalRevenue'];

interface Entry {
  id: string;
  item: BundleItem;
}

function entries(
  f: FinanceLevers,
  opts: { dropCityBaseline?: boolean; dropPool?: string } = {}
): Entry[] {
  const pools: Pool[] = [...baseline.pools, ...f.pools];
  const programmes: Programme[] = [...baseline.programmes, ...f.programmes];
  return programmes
    .filter((g) => g.reach === 'affordable')
    .filter((g) => g.pool !== opts.dropPool)
    .map((g): Entry => {
      const p = pools.find((x) => x.id === g.pool)!;
      return { id: g.id, item: { instrument: g.instrument, poolKind: p.kind } };
    })
    .filter(
      (e) => !(opts.dropCityBaseline && CITY.includes(e.item.poolKind) && !e.id.startsWith('u-'))
    );
}

const run = (es: Entry[]) =>
  fundBundle(
    es.map((e) => e.item),
    'affordable',
    proto,
    terms
  );
const withPreset = (id: string): FinanceLevers => {
  const p = fundingPresets(cal).find((x) => x.id === id)!;
  expect(p.available).toBe(true);
  return addPreset(empty(), p);
};
const share = (e: Entry): number =>
  e.item.instrument.kind === 'grant' ? e.item.instrument.share : NaN;
const isCity = (e: Entry): boolean => CITY.includes(e.item.poolKind);

describe('the baseline bundle', () => {
  it('is fully covered and certain', () => {
    const out = run(entries(empty()));
    expect(out.coverage).toBeCloseTo(1, 6);
    expect(out.certain).toBe(true);
  });
});

describe.each(['housing-bond', 'general-revenue'])('%s under the fill rule', (id) => {
  it('pays every City item half its share, coverage 1', () => {
    const es = entries(withPreset(id));
    const out = run(es);
    expect(out.coverage).toBeCloseTo(1, 6);
    es.forEach((e, i) => {
      if (isCity(e)) expect(out.items[i].granted).toBeCloseTo((share(e) * U) / 2, 4);
    });
    expect(es.filter(isCity)).toHaveLength(3);
  });

  it('pays the added item in full when the baseline City items are left out', () => {
    const es = entries(withPreset(id), { dropCityBaseline: true });
    const out = run(es);
    const i = es.findIndex((e) => e.id.startsWith('u-'));
    expect(out.items[i].granted).toBeCloseTo(share(es[i]) * U, 4);
    expect(out.coverage).toBeCloseTo(1, 6);
  });
});

describe('federal-support', () => {
  it('pays both City items nothing', () => {
    const es = entries(withPreset('federal-support'));
    const out = run(es);
    es.forEach((e, i) => {
      if (isCity(e) && e.item.poolKind !== 'federal')
        expect(out.items[i].granted).toBeCloseTo(0, 4);
    });
    expect(es.filter((e) => CITY.includes(e.item.poolKind))).toHaveLength(2);
    expect(out.coverage).toBeCloseTo(1, 6);
  });
});

describe('public-bank', () => {
  it('scales the City items by one common fraction and lowers their total by the loan', () => {
    const base = entries(empty());
    const baseOut = run(base);
    const es = entries(withPreset('public-bank'));
    const out = run(es);
    const loanIdx = es.findIndex((e) => e.item.instrument.kind === 'loan');
    const loan = out.items[loanIdx];
    expect(loan.grantEquivalent).toBeGreaterThan(0);
    const fractions = es.flatMap((e, i) =>
      isCity(e) && e.item.instrument.kind === 'grant' ? [out.items[i].granted / (share(e) * U)] : []
    );
    expect(fractions).toHaveLength(2);
    expect(fractions[0]).toBeCloseTo(fractions[1], 9);
    expect(fractions[0]).toBeLessThan(1);
    const total = (o: typeof out, list: Entry[]) =>
      list.reduce(
        (a, e, i) => a + (isCity(e) && e.item.instrument.kind === 'grant' ? o.items[i].granted : 0),
        0
      );
    expect(total(baseOut, base) - total(out, es)).toBeCloseTo(loan.grantEquivalent, 4);
    expect(out.coverage).toBeCloseTo(1, 6);
  });
});

describe('state-double', () => {
  it('leaves every item as in the baseline', () => {
    const base = run(entries(empty()));
    const out = run(entries(withPreset('state-double')));
    expect(out.items).toEqual(base.items);
  });
});

describe('a pool switched off', () => {
  it('state-off leaves the bundle without the state item', () => {
    const f = withPreset('state-off');
    expect(f.baselineScale[0].scale).toBe(0);
    const out = run(entries(f, { dropPool: f.baselineScale[0].pool }));
    expect(out.coverage).toBeCloseTo(0.862581, 6);
    expect(out.certain).toBe(false);
  });

  it('federal-credits-off leaves the bundle without the federal item', () => {
    const f = withPreset('federal-credits-off');
    expect(f.baselineScale[0].scale).toBe(0);
    const out = run(entries(f, { dropPool: f.baselineScale[0].pool }));
    expect(out.coverage).toBeCloseTo(0.48567, 6);
    expect(out.certain).toBe(false);
  });
});
