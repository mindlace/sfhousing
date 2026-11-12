// The preset list and its sources (finance-levers spec section 4.7): the list, each available
// preset's content, each unavailable reason, rule 2 with an unsourced term, POOL_KIND_DEFAULTS.
import { describe, expect, it, vi } from 'vitest';
import { baselineFixture, FIXTURE_AS_OF } from '$lib/sim/levers/fixtures/finance';
import { LAST_DAY } from '$lib/sim/levers/finance';
import { dayOf } from '$lib/sim/scenario/dates';
import { inflowArrivals } from '$lib/sim/scenario/funding';
import miniCalibrationJson from '$lib/sim/scenario/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, PoolKind } from '$lib/timelapse/types';
import { fundingPresets, cityGrant, nextCalendar, nextFiscal } from './funding-presets';
import { CITY_PER_HOME, POOL_KIND_DEFAULTS } from './funding-sources';

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
    "More City general-fund money every year, shared with today's City money toward new affordable homes, so more homes get built each year while there are projects waiting for money."
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
    "Twice today's state money from a date you choose; on its own this adds no homes while the City's money is the limit, so pair it with more City or federal money."
  ],
  'federal-support': [
    'Federal support from a year',
    'federal',
    "A new yearly federal grant from a year you choose that pays the City's part of each affordable home while it lasts; no law provides it yet, so the amount is your own."
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
      'htf-2026': [false, 'Not yet certified (passed on early counts, November 2026).'],
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
        uncapped: false,
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
      inflows: [{ kind: 'yearly', from: dayOf(2027, 7, 1), to: null, dollarsPerYear: 36_700_000 }],
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
      { pool: 'state', from: jul(2027), scale: 2 }
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
      inflows: [{ kind: 'yearly', from: dayOf(2028, 1, 1), to: null, dollarsPerYear: 3_000_000 }]
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

  it('federal-support needs a yearly state amount', () => {
    const bf = baselineFixture(FIXTURE_AS_OF).baselineFunding;
    const c = {
      ...cal,
      baselineFunding: {
        ...bf,
        pools: bf.pools.map((p) => (p.kind === 'state' ? { ...p, inflows: [] } : p))
      }
    };
    expect(get('federal-support', c)).toMatchObject({
      available: false,
      reason: "This data's state pool has no yearly amount to start from."
    });
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
