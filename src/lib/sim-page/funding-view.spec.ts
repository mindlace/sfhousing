// The Funding tab's view model (funding-ui spec section 6, "funding-view.spec.ts"). Every expected
// coverage or per-home value is computed here with `fundBundle` on the same items, never by hand.
import { describe, expect, it } from 'vitest';
import {
  AVERAGE_DRAWN,
  DRAW_UP_FRONT,
  MARKET_TERMS,
  PROTOTYPES,
  coverage,
  debtService,
  fundBundle,
  grantEquivalentPerHome,
  isCertain,
  oddsShift,
  resolveTerms,
  uncoveredPerHome
} from '$lib/sim/finance';
import { SLOPE_FIXTURE } from '$lib/sim/finance/test/fixtures';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { dayOf } from '$lib/sim/scenario/dates';
import { HORIZON } from '$lib/fzp/time';
import type { Pool, Programme } from '$lib/timelapse/types';
import { addPreset, fundingPresets } from './funding-presets';
import { POOL_KIND_DEFAULTS, BOND_PRINCIPAL } from './funding-sources';
import {
  BOND_POLICY,
  FUND_ASOF,
  TERM_POLICY,
  fundingCalibration,
  policyWith
} from './test/funding';
import {
  COVERAGE_RULE_SENTENCE,
  coverageLineText,
  coverageStepText,
  labelAmountChanged,
  labelScaleApplied,
  sourcedLine
} from './funding-copy';
import {
  baselineGroups,
  bundleOn,
  customValues,
  coverageSizeMixed,
  coverageSteps,
  fieldSource,
  groupOf,
  isOff,
  poolMoneySentence,
  poolPreview,
  priceOn,
  programmePreview,
  programmeSentence,
  scaleLines,
  termRows,
  tiersSource,
  tiersText
} from './funding-view';

const cal = fundingCalibration();
const baseline = cal.baselineFunding!;
const asOf = FUND_ASOF;
const DEFAULT: FinanceLevers = policyWith({}).funding;
const P0 = PROTOTYPES[0];
const U = uncoveredPerHome('affordable', P0);
const TIERS = { veryLow: 0.52, low: 0.31, moderate: 0.17, aboveModerate: 0 };
const D27 = dayOf(2027, 7, 1);
const D28 = dayOf(2028, 7, 1);
const D29 = dayOf(2029, 7, 1);

const kindOf = (f: FinanceLevers, pool: string) =>
  [...baseline.pools, ...f.pools].find((p) => p.id === pool)!.kind;

/** `fundBundle` on these programmes, as the engine prices them. */
function price(f: FinanceLevers, progs: Programme[]) {
  return fundBundle(
    progs.map((g) => ({ instrument: g.instrument, poolKind: kindOf(f, g.pool) })),
    'affordable',
    P0,
    resolveTerms(MARKET_TERMS, f.terms)
  );
}

const without = (...ids: string[]) => baseline.programmes.filter((g) => !ids.includes(g.id));

const grantOn = (id: string, pool: string, share: number, extra: Partial<Programme> = {}) =>
  ({
    id,
    label: id,
    pool,
    reach: 'affordable',
    instrument: { kind: 'grant', share },
    from: asOf,
    to: null,
    minHomes: 20,
    tiers: { ...TIERS },
    ...extra
  }) satisfies Programme;

describe('baseline groups', () => {
  it('groups by kind; per-home equals the items in fundBundle', () => {
    const groups = baselineGroups(DEFAULT, baseline, asOf);
    expect(groups.map((g) => g.group)).toEqual(['city', 'state', 'federal']);
    expect(groups.map((g) => g.name)).toEqual(['City', 'State', 'Federal tax credits']);
    const priced = priceOn(DEFAULT, baseline, asOf);
    const direct = price(DEFAULT, baseline.programmes);
    for (const g of groups) {
      const sum = (items: { grantEquivalent: number }[], progs: Programme[]) =>
        items.reduce(
          (s, it, i) =>
            groupOf(kindOf(DEFAULT, progs[i].pool)) === g.group ? s + it.grantEquivalent : s,
          0
        );
      expect(g.perHome).toBe(Math.round(sum(priced.funding.items, priced.programmes)));
      expect(g.perHome).toBe(Math.round(sum(direct.items, baseline.programmes)));
      const share = baseline.programmes
        .filter((p) => groupOf(kindOf(DEFAULT, p.pool)) === g.group)
        .reduce((s, p) => s + (p.instrument.kind === 'grant' ? p.instrument.share : 0), 0);
      expect(Math.abs(g.perHome - share * U)).toBeLessThanOrEqual(1);
      expect(g.lentPerHome).toBe(0);
      expect(g.off).toBe(false);
      expect(g.changesFrom).toBeNull();
    }
    expect(groups[0].perYear).toBe(200_000_000);
    expect(groups[1].perYear).toBe(100_000_000);
    expect(groups[2].perYear).toBeNull();
    expect(groups[0].pools.map((p) => p.id)).toEqual(['city-tax', 'city-gf']);
  });

  it("public bank: City figure counts the loan's worth, principal only in lends", () => {
    const bank = fundingPresets(cal).find((p) => p.id === 'public-bank')!;
    expect(bank.available).toBe(true);
    const f = addPreset(DEFAULT, bank);
    const loan = f.programmes[0];
    const day = loan.from;
    const city = baselineGroups(f, baseline, day).find((g) => g.group === 'city')!;
    const progs = [...baseline.programmes, loan];
    const priced = price(f, progs);
    const citySum = priced.items.reduce(
      (s, it, i) => (groupOf(kindOf(f, progs[i].pool)) === 'city' ? s + it.grantEquivalent : s),
      0
    );
    expect(city.perHome).toBe(Math.round(citySum));
    expect(city.lentPerHome).toBe(Math.round(priced.items.at(-1)!.lent));
    // The loan counts at its worth, below its principal; the principal is only in `lentPerHome`.
    const worth = priced.items.at(-1)!.grantEquivalent;
    expect(worth).toBeGreaterThan(0);
    expect(worth).toBeLessThan(city.lentPerHome);
    const granted = priced.items.reduce((s, it) => s + it.granted, 0);
    const cityGranted = granted - priced.items[2].granted - priced.items[3].granted;
    expect(city.perHome).toBe(Math.round(cityGranted + worth));
    expect(city.perHome).not.toBe(Math.round(cityGranted + priced.items.at(-1)!.lent));
  });

  it('a group switched off at the present reads off; a dated change gives changesFrom', () => {
    const f = policyWith({
      baselineScale: [
        { pool: 'state', from: asOf, scale: 0 },
        { pool: 'state', from: D28, scale: 1 }
      ]
    }).funding;
    const state = baselineGroups(f, baseline, asOf).find((g) => g.group === 'state')!;
    expect(state.off).toBe(true);
    expect(state.perHome).toBe(0);
    expect(state.changesFrom).toBe(asOf);
    expect(isOff(f, 'state', asOf)).toBe(true);
    expect(isOff(f, 'state', D28)).toBe(false);
  });
});

describe('coverageSteps', () => {
  it('default: one step, certain', () => {
    const steps = coverageSteps(DEFAULT, baseline, asOf, HORIZON);
    const expected = price(DEFAULT, baseline.programmes);
    expect(steps).toHaveLength(1);
    expect(steps[0].from).toBe(asOf);
    expect(steps[0].coverage).toBe(expected.coverage);
    expect(steps[0].certain).toBe(isCertain(expected.coverage));
    expect(steps[0].certain).toBe(true);
    expect(steps[0].minHomes).toBe(20);
  });

  it('state off from a date: second step, not certain, equals fundBundle without state', () => {
    const f = policyWith({ baselineScale: [{ pool: 'state', from: D27, scale: 0 }] }).funding;
    const steps = coverageSteps(f, baseline, asOf, HORIZON);
    expect(steps).toHaveLength(2);
    expect(steps[1].from).toBe(D27);
    expect(steps[1].certain).toBe(false);
    expect(steps[1].coverage).toBe(price(f, without('state-grant')).coverage);
  });

  it('City pool at 0.5: no new step', () => {
    const f = policyWith({ baselineScale: [{ pool: 'city-gf', from: D27, scale: 0.5 }] }).funding;
    expect(coverageSteps(f, baseline, asOf, HORIZON)).toHaveLength(1);
  });

  it('City pool at 0: like state', () => {
    const f = policyWith({ baselineScale: [{ pool: 'city-gf', from: D27, scale: 0 }] }).funding;
    const steps = coverageSteps(f, baseline, asOf, HORIZON);
    expect(steps).toHaveLength(2);
    expect(steps[1].certain).toBe(false);
    const expected = price(f, without('city-gf-grant'));
    expect(steps[1].coverage).toBe(expected.coverage);
    expect(steps[1].cityPerHome).toBe(Math.round(expected.items[0].grantEquivalent));
  });

  it('federal off then on: two more steps', () => {
    const f = policyWith({
      baselineScale: [
        { pool: 'federal', from: D27, scale: 0 },
        { pool: 'federal', from: D29, scale: 1 }
      ]
    }).funding;
    const steps = coverageSteps(f, baseline, asOf, HORIZON);
    expect(steps.map((s) => s.from)).toEqual([asOf, D27, D29]);
    expect(steps[1].coverage).toBe(price(f, without('federal-grant')).coverage);
    expect(steps[2].certain).toBe(true);
  });

  it('added bond grant shares the City tier', () => {
    const f = BOND_POLICY.funding;
    const steps = coverageSteps(f, baseline, asOf, HORIZON);
    expect(steps.every((s) => s.certain)).toBe(true);
    expect(steps).toHaveLength(1);
    const bond = f.programmes[0];
    const progs = [...baseline.programmes, bond];
    const expected = price(f, progs);
    expect(expected.coverage).toBeLessThanOrEqual(steps[0].coverage + 1e-9);
    const view = priceOn(f, baseline, D28);
    expect(view.programmes.map((g) => g.id)).toEqual(progs.map((g) => g.id));
    const bondFactor = view.funding.items.at(-1)!.grantEquivalent / (0.35 * U);
    expect(view.funding.items.at(-1)!.grantEquivalent).toBe(expected.items.at(-1)!.grantEquivalent);
    expect(bondFactor).toBeLessThan(1);
    for (const id of ['city-tax-grant', 'city-gf-grant']) {
      const i = progs.findIndex((g) => g.id === id);
      const g = progs[i];
      const share = g.instrument.kind === 'grant' ? g.instrument.share : 0;
      expect(view.funding.items[i].granted / (share * U)).toBeCloseTo(bondFactor, 12);
    }
    const before = baselineGroups(f, baseline, asOf)[0].perHome;
    const after = baselineGroups(f, baseline, D28)[0].perHome;
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
    // With the state off from D29, the City's tier has more to fill.
    const off = { ...f, baselineScale: [{ pool: 'state', from: D29, scale: 0 }] };
    const later = priceOn(off, baseline, D29).funding.items.at(-1)!.grantEquivalent;
    expect(later).toBeGreaterThan(view.funding.items.at(-1)!.grantEquivalent);
    expect(later).toBe(price(off, [...without('state-grant'), bond]).items.at(-1)!.grantEquivalent);
  });

  it('added federal grant lowers cityPerHome by what it pays', () => {
    const f = policyWith({ programmes: [grantOn('u-prog-1', 'federal', 0.1)] }).funding;
    const steps = coverageSteps(f, baseline, asOf, HORIZON);
    const base = coverageSteps(DEFAULT, baseline, asOf, HORIZON);
    expect(steps[0].certain).toBe(true);
    const priced = price(f, [...baseline.programmes, f.programmes[0]]);
    const pays = priced.items.at(-1)!.granted;
    expect(Math.abs(base[0].cityPerHome - steps[0].cityPerHome - pays)).toBeLessThanOrEqual(1);
  });

  it('within the City tier no source pays first', () => {
    const view = priceOn(BOND_POLICY.funding, baseline, D28);
    const factor = (id: string) => {
      const i = view.programmes.findIndex((g) => g.id === id);
      const g = view.programmes[i];
      return view.funding.items[i].granted / ((g.instrument as { share: number }).share * U);
    };
    expect(factor('city-tax-grant')).toBeCloseTo(factor('city-gf-grant'), 12);
    expect(factor('city-tax-grant')).toBeCloseTo(factor('u-prog-1'), 12);
  });

  it("added grant on a baseline pool is priced in that pool's tier", () => {
    const f = policyWith({ programmes: [grantOn('u-prog-1', 'city-tax', 0.1)] }).funding;
    const progs = [...baseline.programmes, f.programmes[0]];
    const expected = price(f, progs);
    const view = priceOn(f, baseline, asOf);
    expect(view.funding.items.map((x) => x.grantEquivalent)).toEqual(
      expected.items.map((x) => x.grantEquivalent)
    );
    const gf = view.funding.items[1].granted / (0.148251 * U);
    expect(view.funding.items.at(-1)!.granted / (0.1 * U)).toBeCloseTo(gf, 12);
    expect(gf).toBeLessThan(1);
  });

  it('different minHomes: step minHomes is the larger', () => {
    const f = policyWith({
      programmes: [grantOn('u-prog-1', 'city-tax', 0.1, { minHomes: 50 })]
    }).funding;
    const steps = coverageSteps(f, baseline, asOf, HORIZON);
    expect(steps[0].minHomes).toBe(50);
    expect(coverageSizeMixed(f, baseline, asOf)).toBe(true);
    expect(coverageSizeMixed(DEFAULT, baseline, asOf)).toBe(false);
  });

  it('guarantee without a typed term is left out; with TERM_POLICY it is in', () => {
    const guarantee: Programme = {
      ...grantOn('u-prog-1', 'city-gf', 0.1),
      instrument: { kind: 'guarantee', costShare: 0.6, reserve: 0.1 }
    };
    const f = policyWith({ programmes: [guarantee] }).funding;
    const out = bundleOn(f, baseline, asOf);
    expect(out.needsTerm).toEqual([{ id: 'u-prog-1', term: 'guaranteeRateCut' }]);
    expect(out.programmes.map((g) => g.id)).not.toContain('u-prog-1');
    const typed = { ...f, terms: TERM_POLICY.funding.terms };
    const inn = bundleOn(typed, baseline, asOf);
    expect(inn.needsTerm).toEqual([]);
    expect(inn.programmes.map((g) => g.id)).toContain('u-prog-1');
    expect(inn.items).toHaveLength(5);
  });
});

describe('previews', () => {
  const ownPool: Pool = {
    id: 'u-pool-2',
    kind: 'generalRevenue',
    label: 'City general fund, 2027',
    inflows: [{ kind: 'yearly', from: D27, to: null, dollarsPerYear: 60_000_000 }],
    uncapped: false,
    debt: null,
    leverage: 1
  };
  const loan: Programme = {
    id: 'u-prog-2',
    label: 'loan',
    pool: 'u-pool-2',
    reach: 'market',
    instrument: { kind: 'loan', costShare: 0.6, rate: 0.04, requiredReturn: null },
    from: D27,
    to: null,
    minHomes: 10,
    tiers: null
  };

  it('programmePreview: affordable grant exact; private 60% loan at 4% ranges over A-E', () => {
    const f = BOND_POLICY.funding;
    const terms = resolveTerms(MARKET_TERMS, f.terms);
    const bond = f.programmes[0];
    const a = programmePreview(bond, f.pools[0], f, baseline, asOf, SLOPE_FIXTURE);
    const exact = grantEquivalentPerHome(bond.instrument, 'affordable', P0, terms);
    expect(a.kind).toBe('affordable');
    expect(a.perHome).toEqual({ low: exact, high: exact });
    const priced = price(f, [...baseline.programmes, bond]);
    expect(a.inBundle).toBe(Math.round(priced.items.at(-1)!.grantEquivalent));
    expect(a.lentInBundle).toBe(0);
    expect(a.lines[0]).toContain('On its own it pays');
    expect(a.lines.join(' ')).toContain(
      "Federal and state money count first, and the City's sources share what is left"
    );

    const lf = { ...f, pools: [...f.pools, ownPool], programmes: [...f.programmes, loan] };
    const p = programmePreview(loan, ownPool, lf, baseline, asOf, SLOPE_FIXTURE);
    const ge = PROTOTYPES.map((pt) => grantEquivalentPerHome(loan.instrument, 'market', pt, terms));
    const shifts = ge.map((g, i) => oddsShift(g, 'market', PROTOTYPES[i], SLOPE_FIXTURE));
    const covs = ge.map((g, i) => coverage(g, 'market', PROTOTYPES[i]));
    expect(p.kind).toBe('market');
    expect(p.inBundle).toBeNull();
    expect(p.lentInBundle).toBeNull();
    expect(p.perHome).toEqual({ low: Math.min(...ge), high: Math.max(...ge) });
    expect(p.coverage).toEqual({ low: Math.min(...covs), high: Math.max(...covs) });
    expect(p.oddsChange).toEqual({ low: Math.min(...shifts), high: Math.max(...shifts) });
    expect(p.sources).toContain(DRAW_UP_FRONT.provenance);
    expect(p.sources).toContain(AVERAGE_DRAWN.provenance);
    expect(DRAW_UP_FRONT.provenance.tier).toBe(4);
    expect(AVERAGE_DRAWN.provenance.tier).toBe(4);
    expect(p.lines.join(' ')).toContain('no study has measured');

    const big: Programme = { ...loan, instrument: { kind: 'grant', share: 1 } };
    const full = programmePreview(big, ownPool, lf, baseline, asOf, SLOPE_FIXTURE);
    const pt = PROTOTYPES[0];
    expect(full.lines.join(' ')).toContain(
      `fully covers a ${pt.stories}-storey building of ${pt.homes} homes`
    );
  });

  it('poolPreview: $300 million at 6% over 20 years', () => {
    const pool = BOND_POLICY.funding.pools[0];
    const pv = poolPreview(pool, asOf);
    const ds = debtService(300_000_000, { rate: 0.06, termYears: 20 });
    expect(pv.repayment).toEqual({ perYear: ds.annual, total: ds.total });
    expect(pv.once).toBe(300_000_000);
    expect(pv.perYear).toBeNull();
    expect(pv.lendingCap).toBeNull();
    const text = pv.lines.join(' ');
    expect(text).toContain('Brings in $300 million in July 2028.');
    expect(text).toContain('$26.2 million a year');
    expect(text).toContain('$523 million in all');
    expect(text).toContain('not adjusted for inflation');
    expect(text).toContain('A City general-obligation bond needs two-thirds of voters.');
    expect(poolMoneySentence(pool)).toBe('$300 million in July 2028; repaid at 6% over 20 years');
  });

  it('fieldSource', () => {
    const presets = fundingPresets(cal);
    const hb = presets.find((p) => p.id === 'housing-bond')!;
    const f = addPreset(DEFAULT, hb);
    const pool = f.pools[0];
    expect(fieldSource(pool, 'inflows[0].dollars', presets, 'goBond')).toEqual({
      kind: 'sourced',
      provenance: BOND_PRINCIPAL.provenance
    });
    const edited: Pool = {
      ...pool,
      inflows: [{ kind: 'once', day: D28, dollars: 250_000_000 }]
    };
    expect(fieldSource(edited, 'inflows[0].dollars', presets, 'goBond')).toEqual({
      kind: 'custom'
    });

    const bank = addPreset(
      DEFAULT,
      presets.find((p) => p.id === 'public-bank')!
    );
    expect(fieldSource(bank.programmes[0], 'instrument.costShare', presets, 'bank')).toEqual({
      kind: 'custom'
    });

    const hand: Pool = { ...BOND_POLICY.funding.pools[0] };
    expect(fieldSource(hand, 'debt.rate', presets, 'goBond')).toEqual({
      kind: 'sourced',
      provenance: (POOL_KIND_DEFAULTS.goBond.debt as { provenance: unknown }).provenance
    });
    const seven = { ...hand, debt: { rate: 0.07, termYears: 20 } };
    expect(fieldSource(seven, 'debt.rate', presets, 'goBond')).toEqual({ kind: 'custom' });
    expect(fieldSource(hand, 'inflows[0].day', presets, 'goBond')).toEqual({ kind: 'choice' });
    expect(fieldSource(BOND_POLICY.funding.programmes[0], 'from', presets, 'goBond')).toEqual({
      kind: 'choice'
    });
  });

  it('hand-made cop at the goBond rate is custom', () => {
    const presets = fundingPresets(cal);
    const cop: Pool = { ...BOND_POLICY.funding.pools[0], kind: 'cop' };
    expect(fieldSource(cop, 'debt.rate', presets, 'cop')).toEqual({ kind: 'custom' });
    expect(fieldSource(cop, 'debt.termYears', presets, 'cop').kind).toBe('sourced');
  });

  it('a loan rate equal to the bank default is sourced; elsewhere it is custom', () => {
    const presets = fundingPresets(cal);
    const rate = POOL_KIND_DEFAULTS.bank.loanRate.value!;
    const g: Programme = {
      ...loan,
      instrument: { kind: 'loan', costShare: 0.6, rate, requiredReturn: null }
    };
    expect(fieldSource(g, 'instrument.rate', presets, 'bank').kind).toBe('sourced');
    expect(fieldSource(g, 'instrument.rate', presets, 'generalRevenue')).toEqual({
      kind: 'custom'
    });
  });
});

describe('sentences', () => {
  const pool: Pool = {
    id: 'u-pool-1',
    kind: 'goBond',
    label: 'City bond, 2027',
    inflows: [{ kind: 'once', day: D27, dollars: 300_000_000 }],
    uncapped: false,
    debt: { rate: 0.06, termYears: 20 },
    leverage: 1
  };

  it('programmeSentence examples of 4.8', () => {
    expect(programmeSentence(grantOn('u-prog-1', 'u-pool-1', 0.35, { from: D28 }), pool)).toBe(
      'Grant to affordable homes of 20 homes or more, from July 2028: 35% of the uncovered cost'
    );
    const loan: Programme = {
      ...grantOn('u-prog-2', 'u-pool-1', 0.35, { from: D27 }),
      reach: 'market',
      minHomes: 10,
      tiers: null,
      instrument: { kind: 'loan', costShare: 0.6, rate: 0.04, requiredReturn: null }
    };
    expect(programmeSentence(loan, pool)).toBe(
      'Loan to private projects of 10 homes or more: 60% of the building cost at 4%'
    );
    const guarantee: Programme = {
      ...loan,
      instrument: { kind: 'guarantee', costShare: 0.6, reserve: 0.1 }
    };
    expect(programmeSentence(guarantee, pool)).toBe(
      'Loan guarantee to private projects of 10 homes or more: 60% of the building cost, 10% reserve'
    );
    expect(programmeSentence({ ...loan, to: dayOf(2030, 6, 1) }, pool)).toBe(
      'Loan to private projects of 10 homes or more until June 2030: 60% of the building cost at 4%'
    );
  });

  it('tiersText', () => {
    expect(tiersText({ veryLow: 0.52, low: 0.31, moderate: 0.17, aboveModerate: 0 })).toBe(
      '52% very low, 31% low, 17% moderate'
    );
    expect(tiersText({ veryLow: 1 / 3, low: 1 / 3, moderate: 1 / 3, aboveModerate: 0 })).toBe(
      '34% very low, 33% low, 33% moderate'
    );
  });

  it('scaleLines: a City-group set collapses to City money', () => {
    const f = policyWith({
      baselineScale: [
        { pool: 'city-gf', from: D27, scale: 2 },
        { pool: 'city-tax', from: D27, scale: 2 },
        { pool: 'city-tax', from: D29, scale: 0 },
        { pool: 'federal', from: D27, scale: 0 },
        { pool: 'federal', from: D29, scale: 1 },
        { pool: 'state', from: D27, scale: 0 },
        { pool: 'state', from: D29, scale: 0.5 }
      ]
    }).funding;
    const city = scaleLines(f, baseline, 'city');
    expect(city.map((l) => [l.name, l.pools, l.text])).toEqual([
      ['City money', ['city-tax', 'city-gf'], "From July 2027: 200% of today's amount"],
      ['city-tax', ['city-tax'], 'From July 2029: switched off']
    ]);
    expect(scaleLines(f, baseline, 'federal').map((l) => l.text)).toEqual([
      'From July 2027: switched off',
      'From July 2029: switched back on'
    ]);
    expect(scaleLines(f, baseline, 'state').map((l) => l.text)).toEqual([
      'From July 2027: switched off',
      "From July 2029: switched back on, 50% of today's amount"
    ]);
  });

  it('termRows: the rate cut is offered for guarantees, and a typed term always shows', () => {
    expect(termRows(DEFAULT, ['grant', 'loan'])).toEqual([]);
    const rows = termRows(DEFAULT, ['grant', 'loan', 'guarantee']);
    expect(rows).toEqual([
      { key: 'guaranteeRateCut', typed: null, sourced: null, sourcedValue: null, inUse: false }
    ]);
    const typed = termRows({ ...DEFAULT, terms: { constructionRate: 0.07 } }, []);
    expect(typed).toEqual([
      {
        key: 'constructionRate',
        typed: 0.07,
        sourced: MARKET_TERMS.constructionRate.value === null ? null : expect.anything(),
        sourcedValue: MARKET_TERMS.constructionRate.value,
        inUse: false
      }
    ]);
  });

  it('coverage copy', () => {
    const [today] = coverageSteps(DEFAULT, baseline, asOf, HORIZON);
    expect(coverageLineText(today)).toBe('Affordable homes: fully funded today');
    const f = policyWith({ baselineScale: [{ pool: 'state', from: D27, scale: 0 }] }).funding;
    const steps = coverageSteps(f, baseline, asOf, HORIZON);
    expect(coverageStepText(steps[1])).toMatch(
      /^From July 2027: \d+%, not fully funded; the City pays \$[\d,]+ of each home$/
    );
    expect(coverageLineText({ ...steps[1], from: asOf })).toMatch(
      /^Affordable homes: \d+% of the cost is covered today; they start only by chance$/
    );
    expect(coverageStepText(today, true)).toContain('for projects of 20 homes or more');
    expect(COVERAGE_RULE_SENTENCE).toBe(
      "Federal and state money count first. The City's sources share what is left."
    );
    expect(labelAmountChanged('City bond, 2028', 1, 250_000_000)).toBe(
      'Changed amount: City bond, 2028, row 1, $250 million'
    );
    expect(labelScaleApplied('State', D27, 0, false)).toBe(
      "Today's funding: State switched off from July 2027"
    );
  });
});

describe('fix round 1', () => {
  it('a grant that fits in full gets no reduction line, whatever its rounding', () => {
    const share = [0.13, 0.12, 0.11, 0.1, 0.09, 0.08, 0.07].find((s) => {
      const frac = (s * U) % 1;
      return frac > 0 && frac < 0.5;
    })!;
    expect(share).toBeDefined();
    const g = grantOn('u-prog-1', 'federal', share);
    const f = policyWith({ programmes: [g] }).funding;
    const fed = baseline.pools.find((p) => p.id === 'federal')!;
    const pv = programmePreview(g, fed, f, baseline, asOf, SLOPE_FIXTURE);
    const priced = price(f, [...baseline.programmes, g]);
    expect(priced.items.at(-1)!.granted).toBe(share * U);
    const text = pv.lines.join(' ');
    expect(text).not.toContain('Its tier covers more than is left');
    expect(text).not.toContain('share what is left');
  });

  it('pool preview continues the list with "and {n} more"', () => {
    const pool: Pool = {
      ...BOND_POLICY.funding.pools[0],
      inflows: [2028, 2029, 2030, 2031, 2032].map((y) => ({
        kind: 'once' as const,
        day: dayOf(y, 7, 1),
        dollars: 10_000_000
      }))
    };
    const lines = poolPreview(pool, asOf).lines;
    expect(lines[2]).toBe('Brings in $10 million in July 2030, and 2 more.');
    expect(lines.some((l) => l.startsWith('And '))).toBe(false);
  });

  it("a tier 3 source line says it is a consultant's projection", () => {
    expect(sourcedLine('Bank lending', 3)).toBe(
      "From Bank lending (tier 3: a consultant's projection, not San Francisco records)"
    );
    expect(sourcedLine('Bond interest rate and term', 2)).toBe(
      'From Bond interest rate and term (tier 2)'
    );
  });
});

describe('tiersSource (4.8 income mix)', () => {
  const baseline = fundingCalibration().baselineFunding!;
  const g = BOND_POLICY.funding.programmes[0];

  it("is the baseline's source while the mix equals its tiers, else custom", () => {
    expect(tiersSource(g, baseline, [])).toEqual({
      kind: 'sourced',
      provenance: baseline.provenance.at(-1)
    });
    const mixed = { ...g, tiers: { veryLow: 0.6, low: 0.26, moderate: 0.14, aboveModerate: 0 } };
    expect(tiersSource(mixed, baseline, [])).toEqual({ kind: 'custom' });
    expect(tiersSource({ ...g, reach: 'market', tiers: null }, baseline, [])).toEqual({
      kind: 'choice'
    });
  });
});

describe('customValues (4.10)', () => {
  const baseline = fundingCalibration().baselineFunding!;
  const presets = fundingPresets(fundingCalibration());

  it('lists a preset-made loan share custom from the start, and a hand-made bond rate', () => {
    const fund = presets.find((p) => p.id === 'revolving-fund')!;
    const f = addPreset(BOND_POLICY.funding, fund);
    f.pools[0] = { ...f.pools[0], debt: { rate: 0.05, termYears: 20 } };
    const out = customValues(f, baseline, presets);
    expect(out).toContainEqual({ name: 'City bond, 2028', field: 'interest rate' });
    expect(out).not.toContainEqual({ name: 'City bond, 2028', field: 'years to repay' });
    // A hand-made pool's money-in rows are choice fields: never listed.
    expect(out.some((x) => x.name === 'City bond, 2028' && x.field.startsWith('amount'))).toBe(
      false
    );
    const g = f.programmes.find((x) => x.id.startsWith('u-revolving-fund-'))!;
    const pool = f.pools.find((x) => x.id === g.pool)!;
    expect(out).toContainEqual({
      name: programmeSentence(g, pool),
      field: 'loan, % of the building cost'
    });
  });
});
