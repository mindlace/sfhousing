// The preset list and its sources (finance-levers spec section 4.7): the list, each available
// preset's content, each unavailable reason, rule 2 with an unsourced term, POOL_KIND_DEFAULTS.
import { describe, expect, it, vi } from 'vitest';
import { baselineFixture, FIXTURE_AS_OF, fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { LAST_DAY } from '$lib/sim/levers/finance';
import { dayOf } from '$lib/sim/world/dates';
import { inflowArrivals } from '$lib/sim/world/rules/funding';
import miniCalibrationJson from '$lib/sim/world/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/world/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Inflow, PoolKind } from '$lib/timelapse/types';
import {
  addPreset,
  cityGrant,
  dateMeasure,
  fundingPresets,
  nextAddedId,
  nextCalendar,
  nextFiscal,
  pastItems,
  valueSource,
  yearsAfter
} from './funding-presets';
import {
  BOND_PRINCIPAL,
  CITY_GRANT_SHARE_PROVENANCE,
  CITY_PER_HOME,
  FEDERAL_SUPPORT_AMOUNT_PROVENANCE,
  FEDERAL_SUPPORT_START_PROVENANCE,
  FEDERAL_SUPPORT_TERM_YEARS,
  GENERAL_FUND_FY25,
  GENERAL_FUND_TERM_YEARS,
  NEXT_FISCAL_START_PROVENANCE,
  PLAYER_START_PROVENANCE,
  STATE_DOUBLE_TERM_YEARS,
  POOL_KIND_DEFAULTS,
  type Sourced,
  PROP_C_SCHEDULE,
  PUBLIC_BANK_HOUSING,
  REVOLVING_FUND_SIZE
} from './funding-sources';
import { FINANCE_LIMITS, buildFinance, parseFinanceLevers } from '$lib/sim/levers/finance';
import { DEFAULT_POLICY, parseSimDoc } from './sim-doc';
import type { FinanceLevers } from '$lib/sim/levers/types';
import type { Pool, Programme } from '$lib/timelapse/types';
import type { Effect, Policy } from '$lib/timeline/policy4';

const stub = vi.hoisted(() => ({ unsourced: false }));
vi.mock('$lib/sim/finance', async (orig) => {
  const real = await orig<typeof import('$lib/sim/finance')>();
  return {
    ...real,
    get MARKET_TERMS() {
      return stub.unsourced
        ? {
            ...real.MARKET_TERMS,
            constructionRate: { value: null, reason: 'stubbed for the test' }
          }
        : real.MARKET_TERMS;
    }
  };
});

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  asOf: FIXTURE_AS_OF,
  market: miniMarket(),
  baselineFunding: baselineFixture(FIXTURE_AS_OF).baselineFunding
};
const get = (id: string, c: Calibration = cal) => {
  const p = fundingPresets(c).find((x) => x.id === id);
  if (!p) throw new Error(`no preset ${id}`);
  return p;
};
const jul = (y: number) => dayOf(y, 7, 1);
const ids = [
  'housing-bond',
  'general-revenue',
  'htf-2026',
  'revolving-fund',
  'public-bank',
  'state-bond-2026',
  'state-off',
  'state-double',
  'federal-support',
  'federal-credits-off',
  'regional-bond'
];

const TABLE: Record<string, [label: string, group: string, description: string]> = {
  'housing-bond': [
    'A housing bond',
    'city',
    "A City bond, repaid with interest over 20 years, that shares the City's part of each new affordable home with today's City money, so more homes get built while there are projects waiting for money; it needs a two-thirds vote."
  ],
  'general-revenue': [
    'General revenue, yearly',
    'city',
    "More City general-fund money every year for 30 years, shared with today's City money toward new affordable homes, so more homes get built each year while there are projects waiting for money."
  ],
  'htf-2026': [
    'Housing Trust Fund increase (Proposition C, 2026)',
    'city',
    'The Housing Trust Fund increase voters passed in November 2026, rising to $60 million more a year by 2034-35; it is not offered until the result is certified.'
  ],
  'revolving-fund': [
    'A revolving construction-loan fund',
    'city',
    'A $100 million City fund that lends private builders a tenth of the building cost below the market rate until the building is finished; the saving on each home is small, so it adds only a few private starts, and the loan size is a guess, not from any source.'
  ],
  'public-bank': [
    'The SF public bank, as planned',
    'bank',
    "The planned public bank's lending to affordable housing over its first five years at its planned rate; each loan saves a project little, so it stretches City money only slightly, and the loan size is a guess, not from any source."
  ],
  'state-bond-2026': [
    'State housing bond (Proposition 1, 2026)',
    'state',
    "The state housing bond passed in November 2026; it is not offered because the result is not certified and San Francisco's share is not published, so to try an amount of your own, add a state source yourself."
  ],
  'state-off': [
    'No state money from a date',
    'state',
    'No state money from a date you choose, so new affordable homes are no longer fully paid for and far fewer of them start.'
  ],
  'state-double': [
    'State money doubled from a date',
    'state',
    "Twice today's state money for ten years from a date you choose; on its own this adds no homes while the City's money is the limit, so pair it with more City or federal money."
  ],
  'federal-support': [
    'Federal support from a year',
    'federal',
    "A new yearly federal grant for ten years from a year you choose that pays the City's part of each affordable home while it lasts; no law provides it yet, so the amount is your own."
  ],
  'federal-credits-off': [
    'Federal tax credits withdrawn from a date',
    'federal',
    'Federal tax credits withdrawn from a date you choose, which shows how few affordable homes start when the City and the state cannot cover what the credits paid.'
  ],
  'regional-bond': [
    'A regional bond',
    'state',
    'A Bay Area housing bond; it is not offered until a measure is put to voters.'
  ]
};

describe('the list', () => {
  it('is the table of section 4.7 in display order', () => {
    const list = fundingPresets(cal);
    expect(list.map((p) => p.id)).toEqual(ids);
    for (const p of list) {
      expect([p.label, p.group, p.description]).toEqual(TABLE[p.id]);
    }
  });

  it('offers what the table offers and gives each other preset its reason', () => {
    const avail = Object.fromEntries(
      fundingPresets(cal).map((p) => [p.id, [p.available, p.reason]])
    );
    expect(avail).toEqual({
      'housing-bond': [true, undefined],
      'general-revenue': [true, undefined],
      'htf-2026': [false, 'Not yet certified (passed November 2026).'],
      'revolving-fund': [true, undefined],
      'public-bank': [true, undefined],
      'state-bond-2026': [false, "Not yet certified, and San Francisco's share is not published."],
      'state-off': [true, undefined],
      'state-double': [true, undefined],
      'federal-support': [true, undefined],
      'federal-credits-off': [true, undefined],
      'regional-bond': [false, 'There is no regional measure yet.']
    });
  });

  it('keeps every label to 1 to 80 characters and starts each programme with its pool', () => {
    for (const p of fundingPresets(cal)) {
      for (const x of [...p.pools, ...p.programmes]) {
        expect(x.label.length).toBeGreaterThanOrEqual(1);
        expect(x.label.length).toBeLessThanOrEqual(80);
      }
      for (const g of p.programmes) {
        const pool = p.pools.find((q) => q.id === g.pool);
        expect(pool).toBeDefined();
        expect(g.from).toBe(inflowArrivals(pool!.inflows[0], 0, LAST_DAY)[0]);
        expect(g.to).toBeNull();
      }
    }
  });

  it('builds presets whose pools carry no uncapped', () => {
    const list = fundingPresets(cal);
    expect(list.some((p) => p.pools.length > 0)).toBe(true);
    for (const p of list) expect(JSON.stringify(p.pools)).not.toContain('"uncapped"');
  });
});

describe('date helpers', () => {
  it('nextFiscal and nextCalendar are in the year after the UTC year', () => {
    expect(nextFiscal(FIXTURE_AS_OF)).toBe(dayOf(2027, 7, 1));
    expect(nextCalendar(FIXTURE_AS_OF)).toBe(dayOf(2027, 1, 1));
    expect(nextFiscal(dayOf(2026, 12, 31))).toBe(dayOf(2027, 7, 1));
  });

  it('cityGrant shares 300,027 over the uncovered cost: 0.348251', () => {
    expect(CITY_PER_HOME.value).toBe(300_027);
    const base = cal.baselineFunding!.programmes[0];
    const g = cityGrant(dayOf(2027, 7, 1), base);
    expect(g.instrument).toEqual({ kind: 'grant', share: 0.348251 });
    expect(g.reach).toBe('affordable');
    expect(g.from).toBe(dayOf(2027, 7, 1));
    expect(g.to).toBeNull();
    expect(g.minHomes).toBe(base.minHomes);
    expect(g.tiers).toEqual(base.tiers);
  });
});

describe('available presets', () => {
  const base = cal.baselineFunding!.programmes[0];

  it('housing-bond', () => {
    const p = get('housing-bond');
    expect(p.baselineScale).toEqual([]);
    expect(p.pools).toEqual([
      {
        id: 'u-housing-bond-1',
        kind: 'goBond',
        label: 'Housing bond',
        inflows: [{ kind: 'once', day: dayOf(2027, 7, 1), dollars: 410_442_573 }],
        debt: { rate: 0.06, termYears: 20 },
        leverage: 1
      }
    ]);
    expect(p.pools[0].debt).toEqual(POOL_KIND_DEFAULTS.goBond.debt!.value);
    expect(p.programmes).toEqual([
      {
        id: 'u-housing-bond-1',
        label: 'Housing bond: grant toward an affordable home',
        pool: 'u-housing-bond-1',
        reach: 'affordable',
        instrument: { kind: 'grant', share: 0.348251 },
        from: dayOf(2027, 7, 1),
        to: null,
        minHomes: base.minHomes,
        tiers: base.tiers
      }
    ]);
    expect(p.provenance.length).toBeGreaterThan(0);
    for (const v of p.provenance) expect([1, 2, 3, 4]).toContain(v.tier);
  });

  it('general-revenue', () => {
    const p = get('general-revenue');
    expect(p.pools).toHaveLength(1);
    expect(p.pools[0]).toMatchObject({
      kind: 'generalRevenue',
      label: 'General revenue for housing',
      inflows: [
        {
          kind: 'yearly',
          from: dayOf(2027, 7, 1),
          to: dayOf(2056, 7, 1),
          dollarsPerYear: 36_700_000
        }
      ],
      debt: null,
      leverage: 1
    });
    expect(p.programmes[0]).toMatchObject({
      label: 'General revenue: grant toward an affordable home',
      instrument: { kind: 'grant', share: 0.348251 }
    });
  });

  it('revolving-fund', () => {
    const p = get('revolving-fund');
    expect(p.pools[0]).toMatchObject({
      kind: 'generalRevenue',
      label: 'Revolving construction-loan fund',
      inflows: [{ kind: 'once', day: dayOf(2027, 7, 1), dollars: 100_000_000 }]
    });
    expect(p.programmes[0]).toMatchObject({
      label: 'Revolving fund: construction loan to private projects',
      reach: 'market',
      instrument: { kind: 'loan', costShare: 0.1, rate: 0.06, requiredReturn: null },
      minHomes: 0,
      tiers: null
    });
    expect(p.provenance.some((v) => v.tier === 4 && /custom, not sourced/.test(v.label))).toBe(
      true
    );
  });

  it('public-bank', () => {
    const p = get('public-bank');
    const dollars = [8_666_667, 11_333_333, 10_000_000, 26_666_667, 13_333_333];
    expect(p.pools[0].kind).toBe('bank');
    expect(p.pools[0].label).toBe('Public bank (housing share)');
    expect(p.pools[0].inflows).toEqual(
      dollars.map((d, k) => ({ kind: 'once', day: jul(2027 + k), dollars: d }))
    );
    expect(dollars.reduce((a, b) => a + b, 0)).toBe(70_000_000);
    expect(p.pools[0].leverage).toBe(0.67);
    expect(p.pools[0].leverage).toBe(POOL_KIND_DEFAULTS.bank.leverage!.value);
    expect(p.programmes[0]).toMatchObject({
      label: 'Public bank: construction loan to affordable projects',
      reach: 'affordable',
      instrument: { kind: 'loan', costShare: 0.1, rate: 0.0613, requiredReturn: null },
      minHomes: base.minHomes,
      tiers: base.tiers
    });
    expect(p.programmes[0].instrument).toMatchObject({
      rate: POOL_KIND_DEFAULTS.bank.loanRate.value
    });
  });

  it('state-off, state-double, federal-credits-off scale a baseline pool', () => {
    expect(get('state-off').baselineScale).toEqual([{ pool: 'state', from: jul(2027), scale: 0 }]);
    expect(get('state-double').baselineScale).toEqual([
      { pool: 'state', from: jul(2027), scale: 2 },
      { pool: 'state', from: jul(2037), scale: 1 }
    ]);
    expect(get('federal-credits-off').baselineScale).toEqual([
      { pool: 'federal', from: dayOf(2027, 1, 1), scale: 0 }
    ]);
    for (const id of ['state-off', 'state-double', 'federal-credits-off']) {
      expect(get(id).pools).toEqual([]);
      expect(get(id).programmes).toEqual([]);
    }
  });

  it('federal-support is the state pool yearly amount from 2028', () => {
    const p = get('federal-support');
    expect(p.pools[0]).toMatchObject({
      kind: 'federal',
      label: 'Federal support',
      inflows: [
        {
          kind: 'yearly',
          from: dayOf(2028, 1, 1),
          to: dayOf(2037, 1, 1),
          dollarsPerYear: 3_000_000
        }
      ]
    });
    expect(p.programmes[0].label).toBe('Federal support: grant toward an affordable home');
    const later = get('federal-support', { ...cal, asOf: dayOf(2030, 5, 1) });
    expect(later.pools[0].inflows[0]).toMatchObject({ from: dayOf(2031, 1, 1) });
  });

  it('htf-2026 builds its content though it is not offered', () => {
    const p = get('htf-2026');
    expect(p.available).toBe(false);
    expect(p.pools[0].inflows).toHaveLength(7);
    expect(p.pools[0].inflows[0]).toEqual({ kind: 'once', day: jul(2028), dollars: 6_000_000 });
    expect(p.pools[0].inflows[5]).toEqual({ kind: 'once', day: jul(2033), dollars: 49_000_000 });
    expect(p.pools[0].inflows[6]).toEqual({
      kind: 'yearly',
      from: jul(2034),
      to: jul(2057),
      dollarsPerYear: 60_000_000
    });
    expect(p.programmes[0].from).toBe(jul(2028));
    expect(p.programmes[0].label).toBe(
      'Housing Trust Fund increase: grant toward an affordable home'
    );
  });

  it('carries a provenance with a tier on every available preset that adds money', () => {
    for (const p of fundingPresets(cal).filter((x) => x.available && x.pools.length > 0)) {
      expect(p.provenance.length).toBeGreaterThan(0);
    }
  });
});

const START = dayOf(2029, 3, 15);
type Yearly = Extract<Inflow, { kind: 'yearly' }>;

describe('every preset ends', () => {
  it('every pool a preset builds ends; every scale other than 0 and 1 is followed by a 1', () => {
    for (const list of [fundingPresets(cal), fundingPresets(cal, START)])
      for (const p of list) {
        for (const pool of p.pools)
          for (const f of pool.inflows) expect(f.kind === 'once' || f.to !== null).toBe(true);
        p.baselineScale.forEach((e, i) => {
          if (e.scale === 0 || e.scale === 1) return;
          expect(p.baselineScale.slice(i + 1).some((n) => n.pool === e.pool && n.scale === 1)).toBe(
            true
          );
        });
      }
  });

  it('general-revenue: 30 arrivals of $36,700,000; to = yearsAfter(from, 29); tier 2 term', () => {
    const g = get('general-revenue');
    const f = g.pools[0].inflows[0] as Yearly;
    expect(inflowArrivals(f, cal.asOf, LAST_DAY)).toHaveLength(30);
    expect(f.dollarsPerYear).toBe(36_700_000);
    expect(f.to).toBe(yearsAfter(f.from, 29));
    expect(g.provenance).toContain(GENERAL_FUND_TERM_YEARS.provenance);
    expect(GENERAL_FUND_TERM_YEARS.provenance.tier).toBe(2);
    expect(GENERAL_FUND_TERM_YEARS.value).toBe(30);
  });

  it("federal-support: 10 arrivals of the state pool's first arrival", () => {
    const p = get('federal-support');
    const f = p.pools[0].inflows[0] as Yearly;
    expect(inflowArrivals(f, cal.asOf, LAST_DAY)).toHaveLength(10);
    expect(f.dollarsPerYear).toBe(3_000_000);
    expect(f.to).toBe(yearsAfter(f.from, FEDERAL_SUPPORT_TERM_YEARS.value - 1));
    expect(p.provenance).toContain(FEDERAL_SUPPORT_TERM_YEARS.provenance);
    expect(p.provenance).toContain(FEDERAL_SUPPORT_AMOUNT_PROVENANCE);
  });

  it('state-double: scale 2 from the first date, scale 1 ten years later', () => {
    const p = get('state-double');
    const first = nextFiscal(cal.asOf);
    expect(p.baselineScale.map((e) => [e.from, e.scale])).toEqual([
      [first, 2],
      [yearsAfter(first, 10), 1]
    ]);
    expect(STATE_DOUBLE_TERM_YEARS.value).toBe(10);
    expect(p.provenance).toEqual([STATE_DOUBLE_TERM_YEARS.provenance]);
  });

  it('with start: every first date is start; htf-2026 unchanged; PLAYER_START_PROVENANCE', () => {
    const list = fundingPresets(cal, START);
    const at = (id: string) => list.find((x) => x.id === id)!;
    expect(at('housing-bond').pools[0].inflows).toEqual([
      { kind: 'once', day: START, dollars: 410_442_573 }
    ]);
    expect(at('public-bank').pools[0].inflows.map((f) => (f.kind === 'once' ? f.day : -1))).toEqual(
      [0, 1, 2, 3, 4].map((k) => (k === 0 ? START : yearsAfter(START, k)))
    );
    expect(at('revolving-fund').pools[0].inflows[0]).toMatchObject({ kind: 'once', day: START });
    for (const p of list.filter((x) => x.id !== 'htf-2026')) {
      for (const g of p.programmes) expect(g.from).toBe(START);
      if (p.baselineScale.length > 0) expect(p.baselineScale[0].from).toBe(START);
      expect(p.provenance).not.toContainEqual(NEXT_FISCAL_START_PROVENANCE);
      expect(p.provenance).not.toContainEqual(FEDERAL_SUPPORT_START_PROVENANCE);
    }
    const f = at('general-revenue').pools[0].inflows[0] as Yearly;
    expect(f.from).toBe(START);
    expect(at('federal-support').pools[0].inflows[0]).toMatchObject({ from: START });
    expect(at('state-double').baselineScale[1].from).toBe(yearsAfter(START, 10));
    expect(at('htf-2026')).toEqual(fundingPresets(cal).find((x) => x.id === 'htf-2026'));
    const plain = fundingPresets(cal);
    for (const id of [
      'housing-bond',
      'general-revenue',
      'revolving-fund',
      'public-bank',
      'federal-support'
    ]) {
      expect(plain.find((x) => x.id === id)!.provenance.length).toBe(at(id).provenance.length);
      expect(at(id).provenance).toContainEqual(PLAYER_START_PROVENANCE);
    }
    expect(PLAYER_START_PROVENANCE.tier).toBe(4);
  });

  it("without start: today's default first dates", () => {
    const first = (id: string) => get(id).pools[0].inflows[0];
    const fiscal = nextFiscal(cal.asOf);
    expect(first('housing-bond')).toMatchObject({ day: fiscal });
    expect(first('general-revenue')).toMatchObject({ from: fiscal });
    expect(first('revolving-fund')).toMatchObject({ day: fiscal });
    expect(first('public-bank')).toMatchObject({ day: fiscal });
    expect(get('state-off').baselineScale[0].from).toBe(fiscal);
    expect(get('state-double').baselineScale[0].from).toBe(fiscal);
    expect(get('federal-credits-off').baselineScale[0].from).toBe(nextCalendar(cal.asOf));
    expect(first('federal-support')).toMatchObject({
      from: dayOf(Math.max(2028, 2026 + 1), 1, 1)
    });
    expect(get('housing-bond').provenance).toContainEqual(NEXT_FISCAL_START_PROVENANCE);
    expect(get('federal-support').provenance).toContainEqual(FEDERAL_SUPPORT_START_PROVENANCE);
  });

  it('yearsAfter: same month and day; 29 February 2028 by 1 is 28 February 2029', () => {
    expect(yearsAfter(dayOf(2028, 2, 29), 1)).toBe(dayOf(2029, 2, 28));
    expect(yearsAfter(dayOf(2028, 2, 29), 4)).toBe(dayOf(2032, 2, 29));
    expect(yearsAfter(dayOf(2027, 7, 1), 29)).toBe(dayOf(2056, 7, 1));
  });

  it('dates and descriptions', () => {
    const list = fundingPresets(cal);
    for (const p of list) expect(p.dates).toBe(p.id === 'htf-2026' ? 'fixed' : 'start');
    for (const p of list)
      for (const g of p.programmes) {
        const pool = p.pools.find((q) => q.id === g.pool)!;
        expect(g.from).toBe(
          Math.min(...pool.inflows.flatMap((f) => inflowArrivals(f, 0, LAST_DAY)))
        );
        expect(g.to).toBeNull();
      }
    const text = (id: string) => list.find((x) => x.id === id)!.description;
    expect(text('general-revenue')).toBe(
      "More City general-fund money every year for 30 years, shared with today's City money toward new affordable homes, so more homes get built each year while there are projects waiting for money."
    );
    expect(text('state-double')).toBe(
      "Twice today's state money for ten years from a date you choose; on its own this adds no homes while the City's money is the limit, so pair it with more City or federal money."
    );
    expect(text('federal-support')).toBe(
      "A new yearly federal grant for ten years from a year you choose that pays the City's part of each affordable home while it lasts; no law provides it yet, so the amount is your own."
    );
    expect(list.find((x) => x.id === 'htf-2026')!.reason).toBe(
      'Not yet certified (passed November 2026).'
    );
  });

  it('a measure started on 29 February: general revenue still pays 30 times', () => {
    const leap = dayOf(2028, 2, 29);
    const f = fundingPresets(cal, leap).find((p) => p.id === 'general-revenue')!.pools[0]
      .inflows[0];
    expect(f.kind === 'yearly' && f.to).toBe(dayOf(2057, 2, 28));
    expect(inflowArrivals(f, cal.asOf, LAST_DAY)).toHaveLength(30);
  });
});

describe('unavailable presets', () => {
  it('with no market every preset is unavailable, and says why unless a fixed reason comes first', () => {
    const { market: _m, ...noMarket } = cal;
    const list = fundingPresets(noMarket as Calibration);
    expect(list.every((p) => !p.available)).toBe(true);
    const fixed = ['htf-2026', 'state-bond-2026', 'regional-bond'];
    for (const p of list.filter((x) => !fixed.includes(x.id))) {
      expect(p.reason).toBe('This data has no funding model.');
      expect([p.baselineScale, p.pools, p.programmes]).toEqual([[], [], []]);
    }
  });

  it('with no baseline funding every preset is unavailable', () => {
    const { baselineFunding: _b, ...none } = cal;
    expect(fundingPresets(none as Calibration).every((p) => !p.available)).toBe(true);
  });

  it('state-off says there is no state pool', () => {
    const bf = baselineFixture(FIXTURE_AS_OF).baselineFunding;
    const c = {
      ...cal,
      baselineFunding: { ...bf, pools: bf.pools.filter((p) => p.kind !== 'state') }
    };
    for (const id of ['state-off', 'state-double', 'federal-support']) {
      expect(get(id, c)).toMatchObject({
        available: false,
        reason: 'This data has no state pool.'
      });
    }
    expect(get('federal-credits-off', c).available).toBe(true);
  });

  it('federal-support needs a state arrival from asOf', () => {
    const bf = baselineFixture(FIXTURE_AS_OF).baselineFunding;
    const withState = (inflows: Inflow[]): Calibration => ({
      ...cal,
      baselineFunding: {
        ...bf,
        pools: bf.pools.map((p) => (p.kind === 'state' ? { ...p, inflows } : p))
      }
    });
    expect(get('federal-support', withState([]))).toMatchObject({
      available: false,
      reason: "This data's state pool has no money to start from."
    });
    const past: Inflow = { kind: 'once', day: FIXTURE_AS_OF - 10, dollars: 5 };
    expect(get('federal-support', withState([past])).available).toBe(false);
  });

  it("federal-support is offered on once-only state money, with that payment's dollars", () => {
    const bf = baselineFixture(FIXTURE_AS_OF).baselineFunding;
    const once: Inflow = { kind: 'once', day: FIXTURE_AS_OF + 30, dollars: 7_000_000 };
    const c: Calibration = {
      ...cal,
      baselineFunding: {
        ...bf,
        pools: bf.pools.map((p) => (p.kind === 'state' ? { ...p, inflows: [once] } : p))
      }
    };
    const p = get('federal-support', c);
    expect(p.available).toBe(true);
    expect(p.pools[0].inflows[0]).toMatchObject({ kind: 'yearly', dollarsPerYear: 7_000_000 });
  });

  it('federal-credits-off says there is no federal pool', () => {
    const bf = baselineFixture(FIXTURE_AS_OF).baselineFunding;
    const c = {
      ...cal,
      baselineFunding: { ...bf, pools: bf.pools.filter((p) => p.kind !== 'federal') }
    };
    expect(get('federal-credits-off', c)).toMatchObject({
      available: false,
      reason: 'This data has no federal pool.'
    });
  });

  it('rule 2: an unsourced construction rate makes a loan preset unavailable', () => {
    stub.unsourced = true;
    try {
      const r = get('revolving-fund');
      expect(r.available).toBe(false);
      expect(r.reason).toBe(
        'The market terms this loan is valued against are not sourced: constructionRate'
      );
      expect([r.baselineScale, r.pools, r.programmes]).toEqual([[], [], []]);
      expect(get('public-bank').available).toBe(false);
      expect(get('housing-bond').available).toBe(true);
    } finally {
      stub.unsourced = false;
    }
  });

  it('rule 2 comes before rule 4: with no market and an unsourced term the term reason shows', () => {
    const { market: _m, ...noMarket } = cal;
    stub.unsourced = true;
    try {
      const list = fundingPresets(noMarket as Calibration);
      for (const id of ['revolving-fund', 'public-bank']) {
        expect(list.find((x) => x.id === id)).toMatchObject({
          available: false,
          reason: 'The market terms this loan is valued against are not sourced: constructionRate'
        });
      }
    } finally {
      stub.unsourced = false;
    }
  });
});

describe('POOL_KIND_DEFAULTS', () => {
  const kinds: PoolKind[] = [
    'goBond',
    'cop',
    'generalRevenue',
    'dedicatedTax',
    'state',
    'federal',
    'bank'
  ];
  it('has every kind, with debt only on goBond and cop and leverage only on bank', () => {
    expect(Object.keys(POOL_KIND_DEFAULTS).sort()).toEqual([...kinds].sort());
    for (const k of kinds) {
      expect(POOL_KIND_DEFAULTS[k].debt !== null).toBe(k === 'goBond' || k === 'cop');
      expect(POOL_KIND_DEFAULTS[k].leverage !== null).toBe(k === 'bank');
    }
  });

  it('has the sourced values and tiers', () => {
    const { goBond, cop, bank } = POOL_KIND_DEFAULTS;
    expect(goBond.debt).toMatchObject({ value: { rate: 0.06, termYears: 20 } });
    expect(goBond.debt!.value).not.toBeNull();
    expect((goBond.debt as { provenance: { tier: number } }).provenance.tier).toBe(2);
    expect(cop.debt).toMatchObject({ value: { rate: 0.065, termYears: 20 } });
    expect((cop.debt as { provenance: { tier: number } }).provenance.tier).toBe(2);
    expect(bank.leverage).toMatchObject({ value: 0.67 });
    expect((bank.leverage as { provenance: { tier: number } }).provenance.tier).toBe(2);
    expect(bank.loanRate).toMatchObject({ value: 0.0613 });
    expect((bank.loanRate as { provenance: { tier: number } }).provenance.tier).toBe(3);
  });

  it('gives every other loan rate the unsourced reason', () => {
    for (const k of kinds.filter((x) => x !== 'bank')) {
      expect(POOL_KIND_DEFAULTS[k].loanRate).toEqual({
        value: null,
        reason:
          'No source gives the rate a public loan programme funded from this kind of money charges in San Francisco; a rate you type is custom, not sourced.'
      });
    }
  });
});

const empty = (): FinanceLevers => ({ baselineScale: [], pools: [], programmes: [], terms: {} });
const ALL = (): ReturnType<typeof fundingPresets> => fundingPresets(cal);

describe('addPreset and nextAddedId', () => {
  it('adds a preset twice with unique ids and a shared n', () => {
    const p = get('housing-bond');
    const f = addPreset(addPreset(empty(), p), p);
    expect(f.pools.map((x) => x.id)).toEqual(['u-housing-bond-1', 'u-housing-bond-2']);
    expect(f.programmes.map((x) => x.id)).toEqual(['u-housing-bond-1', 'u-housing-bond-2']);
    expect(f.programmes.map((x) => x.pool)).toEqual(['u-housing-bond-1', 'u-housing-bond-2']);
  });

  it('replaces a same-day scale entry and keeps baselineScale sorted', () => {
    const off = get('state-off');
    const day = off.baselineScale[0].from;
    const start: FinanceLevers = {
      ...empty(),
      baselineScale: [
        { pool: 'federal', from: day, scale: 3 },
        { pool: 'state', from: day, scale: 5 },
        { pool: 'state', from: day + 100, scale: 2 }
      ]
    };
    const f = addPreset(start, off);
    expect(f.baselineScale).toEqual([
      { pool: 'federal', from: day, scale: 3 },
      { pool: 'state', from: day, scale: 0 },
      { pool: 'state', from: day + 100, scale: 2 }
    ]);
    const g = addPreset(addPreset(empty(), get('state-double')), off);
    expect(g.baselineScale).toEqual([
      { pool: 'state', from: day, scale: 0 },
      { pool: 'state', from: yearsAfter(day, 10), scale: 1 }
    ]);
  });

  it('sorts a new entry into place', () => {
    const f = addPreset(
      { ...empty(), baselineScale: [{ pool: 'state', from: 1, scale: 2 }] },
      get('federal-credits-off')
    );
    expect(f.baselineScale.map((x) => x.pool)).toEqual(['federal', 'state']);
  });

  it('throws a RangeError past a limit', () => {
    const p = get('housing-bond');
    let f = empty();
    for (let i = 0; i < FINANCE_LIMITS.pools; i++) f = addPreset(f, p);
    expect(f.pools).toHaveLength(12);
    expect(() => addPreset(f, p)).toThrow(RangeError);
  });

  it('finds the least free n in both pools and programmes (review focus 5)', () => {
    const p = get('housing-bond');
    let f = addPreset(addPreset(empty(), p), p);
    f = { ...f, pools: f.pools.filter((x) => x.id !== 'u-housing-bond-1') };
    expect(nextAddedId(f, 'housing-bond')).toBe('u-housing-bond-3');
    expect(nextAddedId(empty(), 'state-off')).toBe('u-state-off-1');
  });
});

describe('valueSource', () => {
  const presets = ALL();
  const made = (id: string) =>
    addPreset(
      empty(),
      presets.find((x) => x.id === id)!
    );
  const poolOf = (id: string): Pool => made(id).pools[0];
  const progOf = (id: string): Programme => made(id).programmes[0];
  const prov = (id: string) => presets.find((x) => x.id === id)!.provenance;

  it('labels the housing-bond fields', () => {
    const pl = poolOf('housing-bond');
    expect(valueSource(pl, 'inflows[0].dollars', presets)).toEqual(BOND_PRINCIPAL.provenance);
    const debt = POOL_KIND_DEFAULTS.goBond.debt as Sourced<unknown>;
    expect(valueSource(pl, 'debt.rate', presets)).toEqual(debt.provenance);
    expect(valueSource(pl, 'debt.termYears', presets)).toEqual(debt.provenance);
    const edited = { ...pl, inflows: [{ kind: 'once' as const, day: jul(2027), dollars: 1 }] };
    expect(valueSource(edited, 'inflows[0].dollars', presets)).toBe('custom');
    expect(valueSource({ ...pl, debt: { rate: 0.07, termYears: 20 } }, 'debt.rate', presets)).toBe(
      'custom'
    );
    expect(valueSource(pl, 'inflows[0].day', presets)).toBe('custom');
  });

  it('labels general-revenue and revolving-fund amounts', () => {
    expect(valueSource(poolOf('general-revenue'), 'inflows[0].dollarsPerYear', presets)).toEqual(
      GENERAL_FUND_FY25.provenance
    );
    expect(valueSource(poolOf('revolving-fund'), 'inflows[0].dollars', presets)).toEqual(
      REVOLVING_FUND_SIZE.provenance
    );
    expect(valueSource(poolOf('general-revenue'), 'inflows[0].from', presets)).toBe('custom');
    expect(valueSource(poolOf('general-revenue'), 'inflows[0].to', presets)).toEqual(
      GENERAL_FUND_TERM_YEARS.provenance
    );
  });

  it("gives general-revenue's to the term's source while it is 29 years after from", () => {
    const pool = structuredClone(poolOf('general-revenue'));
    const f = pool.inflows[0] as Extract<Inflow, { kind: 'yearly' }>;
    f.from = dayOf(2030, 3, 1);
    f.to = yearsAfter(f.from, 29);
    expect(valueSource(pool, 'inflows[0].to', presets)).toBe(GENERAL_FUND_TERM_YEARS.provenance);
    f.to = yearsAfter(f.from, 28);
    expect(valueSource(pool, 'inflows[0].to', presets)).toBe('custom');
    expect(valueSource(pool, 'inflows[0].dollarsPerYear', presets)).toBe(
      GENERAL_FUND_FY25.provenance
    );
    expect(valueSource(pool, 'inflows[0].from', presets)).toBe('custom');
  });

  it('labels the htf-2026 inflows, which are held back but still map', () => {
    const pl = poolOf('htf-2026');
    for (let k = 0; k < 6; k++) {
      expect(valueSource(pl, `inflows[${k}].dollars`, presets)).toEqual(PROP_C_SCHEDULE.provenance);
      expect(valueSource(pl, `inflows[${k}].day`, presets)).toEqual(PROP_C_SCHEDULE.provenance);
    }
    for (const key of ['dollarsPerYear', 'from', 'to'] as const)
      expect(valueSource(pl, `inflows[6].${key}`, presets)).toEqual(PROP_C_SCHEDULE.provenance);
    const moved = structuredClone(pl);
    (moved.inflows[6] as { to: number }).to += 1;
    expect(valueSource(moved, 'inflows[6].to', presets)).toBe('custom');
  });

  it('labels the public bank', () => {
    const pl = poolOf('public-bank');
    for (let k = 0; k < 5; k++)
      expect(valueSource(pl, `inflows[${k}].dollars`, presets)).toEqual(
        PUBLIC_BANK_HOUSING.provenance
      );
    expect(valueSource(pl, 'leverage', presets)).toEqual(
      (POOL_KIND_DEFAULTS.bank.leverage as Sourced<unknown>).provenance
    );
    expect(valueSource({ ...pl, leverage: 1 }, 'leverage', presets)).toBe('custom');
    const pr = progOf('public-bank');
    expect(valueSource(pr, 'instrument.rate', presets)).toEqual(
      (POOL_KIND_DEFAULTS.bank.loanRate as Sourced<unknown>).provenance
    );
    expect(valueSource(pl, 'inflows[0].day', presets)).toBe('custom');
    expect(valueSource(pr, 'instrument.costShare', presets)).toBe('custom');
    expect(valueSource(pr, 'instrument.requiredReturn', presets)).toBe('custom');
    expect(valueSource(pr, 'minHomes', presets)).toEqual(prov('public-bank').at(-1));
    expect(valueSource(pr, 'tiers', presets)).toEqual(prov('public-bank').at(-1));
    expect(valueSource({ ...pr, minHomes: 99 }, 'minHomes', presets)).toBe('custom');
  });

  it('labels the City grant share, minHomes and tiers, and notices an edit key by key', () => {
    for (const id of ['housing-bond', 'general-revenue', 'htf-2026', 'federal-support']) {
      const pr = progOf(id);
      expect(valueSource(pr, 'instrument.share', presets)).toEqual(CITY_GRANT_SHARE_PROVENANCE);
      expect(valueSource(pr, 'minHomes', presets)).toEqual(prov(id).at(-1));
      expect(valueSource(pr, 'tiers', presets)).toEqual(prov(id).at(-1));
      expect(
        valueSource(
          { ...pr, instrument: { kind: 'grant', share: 0.3 } },
          'instrument.share',
          presets
        )
      ).toBe('custom');
      expect(valueSource({ ...pr, tiers: { ...pr.tiers!, low: 0.4 } }, 'tiers', presets)).toBe(
        'custom'
      );
      expect(valueSource({ ...pr, tiers: null }, 'tiers', presets)).toBe('custom');
    }
  });

  it('is custom from the start for dates, open ends, the federal amount and loan choices', () => {
    for (const id of ['housing-bond', 'general-revenue', 'federal-support']) {
      expect(valueSource(progOf(id), 'from', presets)).toBe('custom');
      expect(valueSource(progOf(id), 'to', presets)).toBe('custom');
    }
    expect(valueSource(poolOf('federal-support'), 'inflows[0].dollarsPerYear', presets)).toBe(
      'custom'
    );
    expect(valueSource(poolOf('federal-support'), 'inflows[0].from', presets)).toBe('custom');
    expect(valueSource(poolOf('federal-support'), 'inflows[0].to', presets)).toBe('custom');
    const rv = progOf('revolving-fund');
    for (const f of ['instrument.costShare', 'instrument.rate', 'minHomes', 'tiers'] as const)
      expect(valueSource(rv, f, presets)).toBe('custom');
    expect(valueSource(rv, 'instrument.requiredReturn', presets)).toBe('custom');
  });

  it('is custom for hand-made items, unknown presets and a pool read as a programme field', () => {
    const f = fundingOnly();
    expect(valueSource(f.pools[0], 'leverage', presets)).toBe('custom');
    expect(valueSource(f.programmes[0], 'minHomes', presets)).toBe('custom');
    const pl = poolOf('housing-bond');
    expect(
      valueSource(
        pl,
        'inflows[0].dollars',
        presets.filter((x) => x.id !== 'housing-bond')
      )
    ).toBe('custom');
    expect(valueSource(pl, 'minHomes', presets)).toBe('custom');
    expect(valueSource({ ...pl, id: 'u-housing-bond-x' }, 'inflows[0].dollars', presets)).toBe(
      'custom'
    );
  });

  it('matches hyphenated preset ids', () => {
    const f = addPreset(
      addPreset(addPreset(empty(), get('federal-credits-off')), get('housing-bond')),
      get('housing-bond')
    );
    const third = addPreset(addPreset(f, get('housing-bond')), get('housing-bond'));
    const pl = third.pools[3];
    expect(pl.id).toBe('u-housing-bond-4');
    expect(valueSource(pl, 'inflows[0].dollars', presets)).toEqual(BOND_PRINCIPAL.provenance);
    const odd = { ...poolOf('federal-support'), id: 'u-federal-credits-off-3' };
    expect(valueSource(odd, 'inflows[0].dollarsPerYear', presets)).toBe('custom');
  });
});

describe('pastItems', () => {
  const asOf = FIXTURE_AS_OF;
  const mkPool = (id: string, inflows: Pool['inflows']): Pool => ({
    id,
    kind: 'generalRevenue',
    label: id,
    inflows,
    debt: null,
    leverage: 1
  });
  const mkProg = (id: string, to: number | null): Programme => ({
    id,
    label: id,
    pool: 'u-pool-1',
    reach: 'affordable',
    instrument: { kind: 'grant', share: 0.1 },
    from: asOf - 500,
    to,
    minHomes: 0,
    tiers: null
  });

  it('lists past pools, programmes and inflows in document order', () => {
    const f: FinanceLevers = {
      ...empty(),
      pools: [
        mkPool('u-pool-1', [{ kind: 'once', day: asOf - 10, dollars: 5 }]),
        mkPool('u-pool-2', [{ kind: 'once', day: asOf + 10, dollars: 5 }]),
        mkPool('u-pool-3', [
          { kind: 'once', day: asOf - 20, dollars: 5 },
          { kind: 'once', day: asOf + 20, dollars: 5 }
        ]),
        mkPool('u-pool-4', [
          { kind: 'yearly', from: asOf - 900, to: asOf - 400, dollarsPerYear: 1 }
        ])
      ],
      programmes: [mkProg('u-prog-1', asOf - 1), mkProg('u-prog-2', asOf), mkProg('u-prog-3', null)]
    };
    expect(pastItems(f, asOf)).toEqual({
      pools: ['u-pool-1', 'u-pool-4'],
      programmes: ['u-prog-1'],
      inflows: [
        { pool: 'u-pool-1', index: 0 },
        { pool: 'u-pool-3', index: 0 },
        { pool: 'u-pool-4', index: 0 }
      ]
    });
  });

  it('is empty for no funding', () => {
    expect(pastItems(empty(), asOf)).toEqual({ pools: [], programmes: [], inflows: [] });
  });
});

describe('presets through the lever parser, the policy document and buildFinance', () => {
  const availableIds = fundingPresets(cal)
    .filter((p) => p.available)
    .map((p) => p.id);
  const base = baselineFixture(FIXTURE_AS_OF).finance;
  const starts: [string, () => FinanceLevers][] = [
    ['empty', empty],
    ['on top of fundingOnly', fundingOnly]
  ];

  it('has available presets to cover', () => {
    expect(availableIds.length).toBeGreaterThan(0);
  });

  for (const id of availableIds) {
    for (const [name, start] of starts) {
      for (const times of [1, 2]) {
        it(`${id} added ${times} time(s) ${name}`, () => {
          let f = start();
          for (let i = 0; i < times; i++) f = addPreset(f, get(id));
          expect(parseFinanceLevers(structuredClone(f), 'finance')).toEqual(f);
          const text = JSON.stringify({
            schema: 3,
            kind: 'sim',
            datasetVersion: 'fixture-0',
            policy: { ...DEFAULT_POLICY, funding: f }
          });
          const r = parseSimDoc(text, 'strict');
          expect(r.ok).toBe(true);
          expect(() => buildFinance(base, f, FIXTURE_AS_OF)).not.toThrow();
        });
      }
    }
  }
});

type FundEffect = Extract<Effect, { tag: 'fund' }>;
type Scales = Extract<Effect, { tag: 'scales' }>;

/** A given measure the way addPreset of the timeline builds it: ids `u-<id>-1`, default dates. */
function measure(presetId: string, spans: { from: number; to: number | null }[]): Policy {
  const p = get(presetId);
  const label = p.label;
  if (p.pools.length === 1) {
    const pool = p.pools[0];
    return {
      id: 'm1',
      label,
      preset: presetId,
      on: true,
      where: { tag: 'fund', pool: pool.id },
      spans: spans.map((s) => ({
        ...s,
        what: {
          tag: 'fund',
          pool: structuredClone(pool),
          programmes: structuredClone(p.programmes)
        } satisfies FundEffect
      }))
    };
  }
  return {
    id: 'm1',
    label,
    preset: presetId,
    on: true,
    where: { tag: 'baseline' },
    spans: spans.map((s) => ({
      ...s,
      what: { tag: 'scales', entries: structuredClone(p.baselineScale) } satisfies Scales
    }))
  };
}
const fundOf = (p: Policy, i = 0): FundEffect => p.spans[i].what as FundEffect;

describe('dateMeasure', () => {
  const S = dayOf(2029, 3, 11);
  const at = (id: string) => fundingPresets(cal, S).find((x) => x.id === id)!;

  it('re-dates a bond from its first span, keeping pool and programme ids', () => {
    const p = measure('housing-bond', [{ from: S, to: null }]);
    const d = dateMeasure(p, cal);
    const w = fundOf(d);
    expect(w.pool!.inflows).toEqual([{ kind: 'once', day: S, dollars: BOND_PRINCIPAL.value }]);
    expect(w.pool!.id).toBe(fundOf(p).pool!.id);
    expect(w.programmes.map((g) => [g.id, g.from])).toEqual([[fundOf(p).programmes[0].id, S]]);
  });

  it('re-dates general revenue: from S, to yearsAfter(S, 29)', () => {
    const d = dateMeasure(measure('general-revenue', [{ from: S, to: null }]), cal);
    expect(fundOf(d).pool!.inflows).toEqual([
      {
        kind: 'yearly',
        from: S,
        to: yearsAfter(S, GENERAL_FUND_TERM_YEARS.value - 1),
        dollarsPerYear: GENERAL_FUND_FY25.value
      }
    ]);
  });

  it('re-dates every span of a two-span state-double from the first span', () => {
    const p = measure('state-double', [
      { from: S, to: S + 400 },
      { from: S + 500, to: null }
    ]);
    const d = dateMeasure(p, cal);
    const entries = [
      { pool: at('state-double').baselineScale[0].pool, from: S, scale: 2 },
      {
        pool: at('state-double').baselineScale[0].pool,
        from: yearsAfter(S, STATE_DOUBLE_TERM_YEARS.value),
        scale: 1
      }
    ];
    expect(d.spans.map((s) => [s.from, s.to])).toEqual([
      [S, S + 400],
      [S + 500, null]
    ]);
    for (const s of d.spans) expect((s.what as Scales).entries).toEqual(entries);
  });

  it('dates every available preset the way fundingPresets(cal, S) builds it', () => {
    for (const { id, available } of fundingPresets(cal)) {
      if (!available) continue;
      const want = at(id);
      const d = dateMeasure(measure(id, [{ from: S, to: null }]), cal);
      if (want.pools.length === 1) {
        expect(fundOf(d).pool).toEqual(want.pools[0]);
        expect(fundOf(d).programmes).toEqual(want.programmes);
      } else {
        expect((d.spans[0].what as Scales).entries).toEqual(want.baselineScale);
      }
    }
  });

  it('keeps the span own ids and labels, and points programmes at the span pool', () => {
    const p = measure('housing-bond', [{ from: S, to: null }]);
    const w = fundOf(p);
    const renamed: Policy = {
      ...p,
      where: { tag: 'fund', pool: 'mine' },
      spans: [
        {
          ...p.spans[0],
          what: {
            ...w,
            pool: { ...w.pool!, id: 'mine', label: 'My pool' },
            programmes: [{ ...w.programmes[0], id: 'g9', label: 'My grant', pool: 'mine' }]
          }
        }
      ]
    };
    const d = fundOf(dateMeasure(renamed, cal));
    expect(d.pool!.id).toBe('mine');
    expect(d.pool!.label).toBe('My pool');
    expect(d.pool!.inflows).toEqual([{ kind: 'once', day: S, dollars: BOND_PRINCIPAL.value }]);
    expect(d.programmes[0]).toMatchObject({ id: 'g9', label: 'My grant', pool: 'mine', from: S });
  });

  it('returns the same object when nothing moves or the policy is not a dated measure', () => {
    const bond = measure('housing-bond', [{ from: S, to: null }]);
    const p0 = { ...bond, preset: null };
    expect(dateMeasure(p0, cal)).toBe(p0);
    const unknown = { ...bond, preset: 'no-such-preset' };
    expect(dateMeasure(unknown, cal)).toBe(unknown);
    const painted: Policy = { ...bond, where: { tag: 'painted' } };
    expect(dateMeasure(painted, cal)).toBe(painted);
    const none = { ...bond, spans: [] };
    expect(dateMeasure(none, cal)).toBe(none);
    const w = fundOf(bond);
    const edited: Policy = {
      ...bond,
      spans: [
        {
          ...bond.spans[0],
          what: {
            ...w,
            pool: {
              ...w.pool!,
              inflows: [{ kind: 'once', day: S, dollars: BOND_PRINCIPAL.value + 1 }]
            }
          }
        }
      ]
    };
    expect(dateMeasure(edited, cal)).toBe(edited);
    const once = dateMeasure(bond, cal);
    expect(once).not.toBe(bond);
    expect(dateMeasure(once, cal)).toBe(once);
  });

  it('returns the same object when the preset is not on offer (htf-2026)', () => {
    const htf = fundingPresets(cal).find((x) => x.id === 'htf-2026')!;
    expect(htf.available).toBe(false);
    const bond = measure('housing-bond', [{ from: S, to: null }]);
    const p = { ...bond, preset: 'htf-2026' };
    expect(dateMeasure(p, cal)).toBe(p);
  });

  it('Review Focus 1: a preset id on the wrong kind of policy returns the same object', () => {
    const fund = { ...measure('housing-bond', [{ from: S, to: null }]), preset: 'state-double' };
    expect(dateMeasure(fund, cal)).toBe(fund);
    const scales = { ...measure('state-double', [{ from: S, to: null }]), preset: 'housing-bond' };
    expect(dateMeasure(scales, cal)).toBe(scales);
    const mixed = { ...measure('state-double', [{ from: S, to: null }]), preset: 'public-bank' };
    expect(() => dateMeasure(mixed, cal)).not.toThrow();
    expect(dateMeasure(mixed, cal)).toBe(mixed);
  });
});
