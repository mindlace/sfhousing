// Baseline funding: pools, programmes, shares, the MOHCD mix and the homes-a-year check
// (finance-data spec 4.6; section 6, pipeline item 5).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFundingFile, type FundingFile } from '../../enrichment/funding-schema';
import {
  AMI_BANDS,
  MOHCD_PROGRAM,
  anniversary,
  baselineFunding,
  boundInflows,
  boundSentence,
  firstYearDollars,
  fundingWarning,
  mohcdMix,
  nearestRankP10,
  parseMohcdRows,
  type AmiBand
} from '../../lib/fzp-cal/funding';
import { FIXTURE_CAL, LIVE_CAL } from '../../lib/fzp-cal/config';
import { CalibrationError } from '../../lib/fzp-cal/types';
import { MOHCD_RAW } from '../fixtures/mini/projects-raw';
import type { RawRow } from '../../project-records/types';
import { isoOf } from '../../project-records/parse';
import { BASELINE_ID_RE, checkPool, checkProgramme } from '../../../src/lib/timelapse/model';
import { inflowArrivals } from '../../../src/lib/sim/scenario/funding';
import type { Bound } from '../../enrichment/funding-schema';
import type { IncomeTier, Pool } from '../../../src/lib/timelapse/types';

const LIVE_PATH = resolve(__dirname, '../../enrichment/funding.json');
const FIXTURE_PATH = resolve(__dirname, '../fixtures/mini/enrichment/funding.json');
const load = (p: string): FundingFile => parseFundingFile(JSON.parse(readFileSync(p, 'utf8')), p);
const live = load(LIVE_PATH);
const fixture = load(FIXTURE_PATH);

/** 'YYYY-MM-DD' as a UTC day number. */
const day = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const AS_OF = day('2026-11-10');
const UNCOVERED = 861_525;

const cite = {
  label: 'A cite',
  url: 'https://example.org/a',
  page: 'p. 1',
  retrieved: '2026-11-10'
};
const remaining = (dollars: number): Bound => ({
  kind: 'remaining',
  dollars,
  method: 'Left.',
  tier: 2,
  cite
});
const ends = (on: string): Bound => ({ kind: 'ends', on, method: 'Ends.', tier: 2, cite });
const poolOf = (pools: Pool[], id: string): Pool => pools.find((p) => p.id === id)!;

const POOLS: [string, string][] = [
  ['city-debt', 'goBond'],
  ['city-ocoh', 'dedicatedTax'],
  ['city-general-fund', 'generalRevenue'],
  ['city-housing-stability-fund', 'generalRevenue'],
  ['city-impact-fees', 'dedicatedTax'],
  ['city-housing-trust-fund', 'generalRevenue'],
  ['city-redevelopment', 'dedicatedTax'],
  ['state', 'state'],
  ['federal-tax-credits', 'federal']
];

const BAND_TIERS: [AmiBand, IncomeTier][] = [
  ['_20_ami', 'veryLow'],
  ['_30_ami', 'veryLow'],
  ['_40_ami', 'veryLow'],
  ['_50_ami', 'veryLow'],
  ['_55_ami', 'low'],
  ['_60_ami', 'low'],
  ['_80_ami', 'low'],
  ['_90_ami', 'moderate'],
  ['_100_ami', 'moderate'],
  ['_105_ami', 'moderate'],
  ['_110_ami', 'moderate'],
  ['_120_ami', 'moderate'],
  ['_130_ami', 'aboveModerate'],
  ['_150_ami', 'aboveModerate']
];

/** A MOHCD 100% affordable new-construction row with the given band counts. */
function mohcdRow(id: string, units: string, bands: Partial<Record<AmiBand, string>>): RawRow {
  const row: RawRow = {
    project_id: id,
    general_housing_program: MOHCD_PROGRAM,
    project_type: 'New Construction',
    total_project_units: units,
    mohcd_affordable_units: units,
    ami_undeclared: '0'
  };
  for (const b of AMI_BANDS) row[b] = bands[b] ?? '0';
  return row;
}

/** One row per band, 1 home in it; total units i + 1 so every row counts in the p10. */
const PER_BAND: RawRow[] = AMI_BANDS.map((b, i) => mohcdRow(`B${i}`, String(i + 1), { [b]: '1' }));

describe('baselineFunding on the live file', () => {
  const out = baselineFunding(live, PER_BAND, AS_OF, LIVE_CAL);
  const bf = out.baselineFunding;

  it('gives the nine expected shares, summing to 1,000,000 millionths', () => {
    const shares = out.report.rows.map((r) => r.share);
    expect(shares).toEqual([
      0.119804, 0.072329, 0.032444, 0.022175, 0.051791, 0.040778, 0.00893, 0.137419, 0.51433
    ]);
    expect(Math.round(shares.reduce((a, b) => a + b, 0) * 1e6)).toBe(1e6);
    for (const p of bf.programmes) {
      const row = out.report.rows.find((r) => r.pool === p.pool)!;
      expect(p.instrument).toEqual({ kind: 'grant', share: row.share });
    }
  });

  it('emits the worked examples on the live file', () => {
    const shape = (p: Pool) => ({ ...p, label: '' });
    expect(shape(poolOf(bf.pools, 'city-ocoh'))).toEqual({
      id: 'city-ocoh',
      kind: 'dedicatedTax',
      label: '',
      inflows: [{ kind: 'yearly', from: day('2026-11-10'), to: null, dollarsPerYear: 48_600_000 }],
      debt: null,
      leverage: 1
    });
    const ocoh = bf.programmes.find((p) => p.id === 'baseline-city-ocoh')!;
    expect(ocoh).toMatchObject({ pool: 'city-ocoh', from: AS_OF, to: null });
    expect(ocoh.instrument.kind).toBe('grant');
    expect(shape(poolOf(bf.pools, 'federal-tax-credits'))).toEqual({
      id: 'federal-tax-credits',
      kind: 'federal',
      label: '',
      inflows: [{ kind: 'yearly', from: day('2026-11-10'), to: null, dollarsPerYear: 564_519_592 }],
      debt: null,
      leverage: 1
    });
    const trust = poolOf(bf.pools, 'city-housing-trust-fund');
    expect(shape(trust)).toEqual({
      id: 'city-housing-trust-fund',
      kind: 'generalRevenue',
      label: '',
      inflows: [
        {
          kind: 'yearly',
          from: day('2026-11-10'),
          to: day('2043-06-30'),
          dollarsPerYear: 27_400_000
        }
      ],
      debt: null,
      leverage: 1
    });
    const arrivals = inflowArrivals(trust.inflows[0], AS_OF, day('2066-12-31'));
    expect(arrivals).toHaveLength(17);
    expect(isoOf(arrivals[0])).toBe('2026-11-10');
    expect(isoOf(arrivals[16])).toBe('2042-11-10');
    expect(bf.programmes.find((p) => p.pool === 'city-housing-trust-fund')!.to).toBeNull();
    expect(shape(poolOf(bf.pools, 'city-debt'))).toEqual({
      id: 'city-debt',
      kind: 'goBond',
      label: '',
      inflows: [
        { kind: 'once', day: day('2026-11-10'), dollars: 80_500_000 },
        { kind: 'once', day: day('2027-11-10'), dollars: 80_500_000 },
        { kind: 'once', day: day('2028-11-10'), dollars: 80_500_000 },
        { kind: 'once', day: day('2029-11-10'), dollars: 18_810_000 }
      ],
      debt: { rate: 0.06, termYears: 20 },
      leverage: 1
    });
    expect(poolOf(bf.pools, 'city-impact-fees').inflows).toEqual([
      { kind: 'once', day: day('2026-11-10'), dollars: 34_800_000 },
      { kind: 'once', day: day('2027-11-10'), dollars: 10_358_744 }
    ]);
    for (const id of ['city-redevelopment', 'city-housing-stability-fund']) {
      expect(poolOf(bf.pools, id).inflows).toEqual([]);
      expect(bf.programmes.some((p) => p.pool === id)).toBe(false);
    }
  });

  it('emits nine pools in order and seven programmes', () => {
    expect(bf.pools.map((p) => [p.id, p.kind])).toEqual(POOLS);
    const funded = POOLS.map(([id]) => id).filter(
      (id) => id !== 'city-housing-stability-fund' && id !== 'city-redevelopment'
    );
    expect(bf.programmes.map((p) => p.id)).toEqual(funded.map((id) => `baseline-${id}`));
    expect(bf.programmes.map((p) => p.pool)).toEqual(funded);
    expect(bf.programmes).toHaveLength(7);
    for (const p of bf.programmes) {
      expect(p.from).toBe(AS_OF);
      expect(p.to).toBeNull();
    }
    const ids = [...bf.pools.map((p) => p.id), ...bf.programmes.map((p) => p.id)];
    expect(ids).toHaveLength(16);
    for (const id of ids) {
      expect(id).toMatch(BASELINE_ID_RE);
      expect(id.startsWith('u-')).toBe(false);
    }
    expect(bf.pools.filter((p) => p.debt !== null).map((p) => p.id)).toEqual(['city-debt']);
    expect(bf.pools.every((p) => p.leverage === 1)).toBe(true);
    for (const p of bf.pools) {
      expect(Object.keys(p)).toEqual(['id', 'kind', 'label', 'inflows', 'debt', 'leverage']);
    }
  });

  it('puts federal in fill tier 1, state in 2 and the City in 3', () => {
    expect(out.report.rows.map((r) => r.fillTier)).toEqual([3, 3, 3, 3, 3, 3, 3, 2, 1]);
  });

  it('builds each programme as a grant reaching affordable homes from asOf', () => {
    for (const p of bf.programmes) {
      expect(Object.keys(p)).toEqual([
        'id',
        'label',
        'pool',
        'reach',
        'instrument',
        'from',
        'to',
        'minHomes',
        'tiers'
      ]);
      expect(p.label).toBe(`${poolOf(bf.pools, p.pool).label}: grant toward an affordable home`);
      expect(p.reach).toBe('affordable');
      expect(p.instrument.kind).toBe('grant');
      expect(p.from).toBe(AS_OF);
      expect(p.to).toBeNull();
      expect(p.minHomes).toBe(out.report.mix.minHomes);
      expect(p.tiers).toEqual(out.report.mix.tiers);
    }
  });

  it('reads the check from the first year', () => {
    expect(bf.check).toMatchObject({ impliedHomesPerYear: 780, observedHomesPerYear: 980 });
    expect(out.report.check).toEqual({ impliedHomesPerYear: 780, observedHomesPerYear: 980 });
    expect(out.warnings).toEqual([]);
    expect(out.report.warning).toBeNull();
    expect(out.report.awardRows).toBe(19);
    const federal = out.report.rows[8];
    expect(federal.impliedHomesPerYear).toBe(1274);
    for (const id of ['city-housing-stability-fund', 'city-redevelopment']) {
      const row = out.report.rows.find((r) => r.pool === id)!;
      expect(row.programme).toBeNull();
      expect(row.impliedHomesPerYear).toBeNull();
    }
    expect(
      bf.check.provenance.method.startsWith(
        "Implied: over the pools with a programme and a share above 0, the least of their first year's dollars ÷ (share × $861,525), rounded half up: 780."
      )
    ).toBe(true);
  });

  it('reports the first year by source', () => {
    expect(out.report.rows.map((r) => r.firstYear)).toEqual([
      80_500_000, 48_600_000, 21_800_000, 0, 34_800_000, 27_400_000, 0, 150_000_000, 564_519_592
    ]);
    expect(out.report.rows.map((r) => r.end)).toEqual([
      '$260.3 million left',
      'no end',
      'no end',
      'spent',
      '$45.2 million left',
      'ends 2043-06-30',
      'spent',
      'no end',
      'no end'
    ]);
  });

  it('states each bound in its provenance entry', () => {
    expect(bf.provenance).toHaveLength(bf.pools.length + 1);
    const ends = [
      '$260.3 million left',
      'no end',
      'no end',
      'spent',
      '$45.2 million left',
      'ends 2043-06-30',
      'spent'
    ];
    live.city.sources.forEach((s, i) => {
      const entry = bf.provenance[i];
      const pool = bf.pools[i];
      expect(entry.tier).toBe(Math.max(2, s.bound.tier));
      const method = entry.method;
      const recorded = method.indexOf('Recorded (tier 1): ');
      const inferred = method.indexOf(
        'Inferred (tier 2): Exhibit F gives one figure for the City and no split by source. ' +
          'This source is taken to pay in proportion to its FY2024-25 spending: '
      );
      expect(recorded).toBe(0);
      expect(inferred).toBeGreaterThan(recorded);
      const sentence = boundSentence(s.bound, pool.inflows, AS_OF);
      expect(method.indexOf(sentence)).toBeGreaterThan(inferred);
      expect(method).not.toContain('with no end (an assumption');
      expect(method.includes('First inflow on asOf')).toBe(pool.inflows.length > 0);
      expect(method.indexOf(s.note)).toBeGreaterThan(method.indexOf(sentence));
      expect(method).toContain('FY2024-25 dollars, not adjusted');
      expect(entry.label).toBe(
        `${s.label}: $${(s.dollarsPerYear / 1e6).toFixed(1)} million a year, FY2024-25 (${ends[i]})`
      );
      const bla = {
        label: `${live.city.cite.label}, p. 6, Exhibit E; p. 7, Exhibit F`,
        url: live.city.cite.url
      };
      const boundCite = {
        label: `${s.bound.cite.label}, ${s.bound.cite.page}`,
        url: s.bound.cite.url
      };
      expect(entry.sources).toEqual(
        s.debt === null
          ? [bla, boundCite]
          : [
              bla,
              { label: `${s.debt.cite.label}, ${s.debt.cite.page}`, url: s.debt.cite.url },
              boundCite
            ]
      );
      expect(entry.window).toEqual(['2024-07-01', '2025-06-30']);
      if (s.debt === null) expect(method).not.toContain('Debt terms');
    });
    expect(bf.provenance[0].label).toBe(
      'City: general-obligation bonds and other debt: $80.5 million a year, FY2024-25 ($260.3 million left)'
    );
    const debt = live.city.sources[0].debt!;
    expect(
      bf.provenance[0].method.endsWith(
        `Debt terms: rate 6.0%, 20 years (p. 106, Exhibit 40: '${debt.cite.quote}'), the ` +
          "Analyst's assumption (tier 2); repayment is nominal."
      )
    ).toBe(true);
    const state = bf.provenance[7];
    expect(state.tier).toBe(2);
    expect(state.label).toBe(`${live.state.label}: $150.0 million a year (a lower bound; no end)`);
    expect(state.method.startsWith(live.state.method)).toBe(true);
    expect(state.method).toContain('First inflow on asOf');
    expect(state.method.endsWith(boundSentence(live.state.bound, bf.pools[7].inflows, AS_OF))).toBe(
      true
    );
    // The state bound's cite equals the state's own: it is not repeated.
    expect(state.sources).toEqual([
      {
        label: `${live.state.bound.cite.label}, ${live.state.bound.cite.page}`,
        url: live.state.bound.cite.url
      }
    ]);
    const federal = bf.provenance[8];
    expect(federal.tier).toBe(2);
    expect(federal.label).toBe(
      'Federal: low-income housing tax credits: at most $564.5 million a year (no end)'
    );
    expect(federal.label).not.toContain('uncapped');
    const award =
      'Of the 15 new-construction awards of 2024–2025, 14 used the 4% credit (1,925 of 1,960 ' +
      'homes).';
    const fedSentence = boundSentence(live.federal.bound, bf.pools[8].inflows, AS_OF);
    expect(federal.method.startsWith(`${live.federal.method} ${award} Share: `)).toBe(true);
    expect(federal.method.endsWith(` ${fedSentence} FY2024-25 dollars, not adjusted.`)).toBe(true);
    expect(federal.method).not.toContain('evidence digest');
    expect(federal.sources).toEqual([
      {
        label: `${live.federal.cite.label}, ${live.federal.cite.page}`,
        url: live.federal.cite.url
      },
      {
        label: `${live.federal.bound.cite.label}, ${live.federal.bound.cite.page}`,
        url: live.federal.bound.cite.url
      }
    ]);
    expect(federal.n).toBe(15);
    expect(federal.window).toEqual(['2024-01-01', '2025-12-31']);
    for (const p of bf.provenance.slice(0, 9)) expect(p.tier).toBe(2);
    expect(bf.provenance.some((p) => p.tier === 1)).toBe(false);
    for (const p of [...bf.provenance, bf.check.provenance]) {
      expect(p.method).not.toMatch(/rests on .*not on a source listed/);
    }
    const last = bf.provenance[9];
    expect(last.tier).toBe(0);
    expect(last.sources).toEqual([
      {
        label: 'SF MOHCD affordable housing pipeline (DataSF aaxw-2cb8)',
        url: 'https://data.sf.gov/d/aaxw-2cb8'
      }
    ]);
    expect(last.n).toBe(AMI_BANDS.length);
    expect(last.window).toEqual(['2023-09-30', '2023-09-30']);
    expect(bf.check.provenance.tier).toBe(2);
    expect(bf.check.provenance.label).toBe(
      'Homes a year the baseline funding pays for, against award records'
    );
    expect(bf.check.provenance.n).toBe(15);
    expect(bf.check.provenance.window).toEqual(['2024-01-01', '2025-12-31']);
  });

  it('emits pools and programmes that checkPool and checkProgramme accept', () => {
    const ids = new Set(bf.pools.map((p) => p.id));
    bf.pools.forEach((p, i) => expect(() => checkPool(p, `pools[${i}]`)).not.toThrow());
    bf.programmes.forEach((p, i) =>
      expect(() => checkProgramme(p, `programmes[${i}]`, ids)).not.toThrow()
    );
  });
});

describe('inflows from a bound', () => {
  it("takes inflowArrivals' anniversaries, 29 February as 28 February", () => {
    const from = day('2028-02-29');
    const days = [0, 1, 2, 3, 4].map((k) => isoOf(anniversary(from, k)));
    expect(days).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
    const arrivals = inflowArrivals(
      { kind: 'yearly', from, to: null, dollarsPerYear: 1 },
      from,
      anniversary(from, 4)
    );
    expect(arrivals).toEqual([0, 1, 2, 3, 4].map((k) => anniversary(from, k)));
    const once = boundInflows(remaining(3_500_000), 1_500_000, from);
    expect(once.map((f) => (f.kind === 'once' ? [isoOf(f.day), f.dollars] : null))).toEqual([
      ['2028-02-29', 1_500_000],
      ['2029-02-28', 1_500_000],
      ['2030-02-28', 500_000]
    ]);
  });

  it('gives an ends on asOf one arrival and an ends the day before none', () => {
    expect(boundInflows(ends('2026-11-10'), 27_400_000, AS_OF)).toEqual([
      { kind: 'yearly', from: AS_OF, to: AS_OF, dollarsPerYear: 27_400_000 }
    ]);
    expect(boundInflows(ends('2026-11-09'), 27_400_000, AS_OF)).toEqual([]);
    const withEnd = (on: string) => {
      const f: FundingFile = structuredClone(live);
      f.city.sources[5].bound = ends(on);
      return baselineFunding(f, PER_BAND, AS_OF, LIVE_CAL);
    };
    const on = withEnd('2026-11-10');
    expect(poolOf(on.baselineFunding.pools, 'city-housing-trust-fund').inflows).toHaveLength(1);
    expect(on.baselineFunding.programmes.map((p) => p.pool)).toContain('city-housing-trust-fund');
    const before = withEnd('2026-11-09');
    expect(poolOf(before.baselineFunding.pools, 'city-housing-trust-fund').inflows).toEqual([]);
    expect(before.baselineFunding.programmes.map((p) => p.pool)).not.toContain(
      'city-housing-trust-fund'
    );
    expect(before.report.rows[5]).toMatchObject({
      programme: null,
      impliedHomesPerYear: null,
      firstYear: 0,
      end: 'ended 2026-11-09'
    });
  });

  it('ends a remaining at an exact multiple and under one year', () => {
    expect(boundInflows(remaining(161_000_000), 80_500_000, AS_OF)).toEqual([
      { kind: 'once', day: AS_OF, dollars: 80_500_000 },
      { kind: 'once', day: day('2027-11-10'), dollars: 80_500_000 }
    ]);
    const under = boundInflows(remaining(10_000_000), 80_500_000, AS_OF);
    expect(under).toEqual([{ kind: 'once', day: AS_OF, dollars: 10_000_000 }]);
    expect(firstYearDollars(under, AS_OF)).toBe(10_000_000);
    const f: FundingFile = structuredClone(live);
    f.city.sources[0].bound = remaining(10_000_000);
    const row = baselineFunding(f, PER_BAND, AS_OF, LIVE_CAL).report.rows[0];
    expect(row.pool).toBe('city-debt');
    expect(row.firstYear).toBe(10_000_000);
    expect(row.impliedHomesPerYear).toBe(Math.floor(10_000_000 / (row.share * UNCOVERED) + 0.5));
  });

  it('gives a none and a spent remaining their inflows', () => {
    expect(
      boundInflows({ kind: 'none', reason: 'None.', tier: 2, cite }, 1_000_000, AS_OF)
    ).toEqual([{ kind: 'yearly', from: AS_OF, to: null, dollarsPerYear: 1_000_000 }]);
    expect(boundInflows(remaining(0), 1_000_000, AS_OF)).toEqual([]);
    // A yearly inflow of 0 dollars stays.
    expect(boundInflows(ends('2030-01-01'), 0, AS_OF)).toEqual([
      { kind: 'yearly', from: AS_OF, to: day('2030-01-01'), dollarsPerYear: 0 }
    ]);
  });

  it('writes the five bound sentences', () => {
    const c = '(tier 2; A cite, p. 1)';
    const htf = boundInflows(ends('2043-06-30'), 1, AS_OF);
    expect(boundSentence(ends('2043-06-30'), htf, AS_OF)).toBe(
      'Ends: the amount is held level from the first inflow to 2043-06-30; the last inflow is on ' +
        `2042-11-10. Ends. ${c}.`
    );
    expect(boundSentence(ends('2026-06-30'), [], AS_OF)).toBe(
      'Ended on 2026-06-30: the pool receives nothing and its programme is not in the baseline. ' +
        `Ends. ${c}.`
    );
    const debt = boundInflows(remaining(260_310_000), 80_500_000, AS_OF);
    expect(boundSentence(remaining(260_310_000), debt, AS_OF)).toBe(
      'Remaining: $260,310,000, paid at the yearly amount from the first inflow until used, 4 ' +
        `inflows, the last $18,810,000 on 2029-11-10. Left. ${c}.`
    );
    expect(boundSentence(remaining(0), [], AS_OF)).toBe(
      'Remaining: nothing; the pool receives nothing and its programme is not in the baseline. ' +
        `Left. ${c}.`
    );
    expect(boundSentence({ kind: 'none', reason: 'No law.', tier: 2, cite }, [], AS_OF)).toBe(
      `No end: No law. ${c}. The amount is held level from the first inflow (an assumption, not ` +
        'a forecast).'
    );
  });
});

describe('the live award rows', () => {
  it('are 19 rows with the expected sums by year', () => {
    const rows = live.awards.rows;
    expect(rows).toHaveLength(19);
    const sum = (y: number, nc: boolean) =>
      rows
        .filter((r) => r.year === y && (!nc || r.newConstruction))
        .reduce((a, r) => a + r.homes, 0);
    expect([sum(2024, true), sum(2025, true)]).toEqual([1274, 686]);
    expect([sum(2024, false), sum(2025, false)]).toEqual([1384, 839]);
  });
});

describe('fundingWarning', () => {
  it('fires when implied and observed differ by more than half of observed', () => {
    expect(fundingWarning(780, 500, [2024, 2025])).toBe(
      'baselineFunding: the baseline pools fully fund 780 affordable homes a year; the 2024–2025 ' +
        'bond and tax-credit awards show 500 (new construction); they differ by more than half'
    );
    expect(fundingWarning(780, 600, [2024, 2025])).toBeNull();
  });
});

describe('the MOHCD income mix', () => {
  it.each(BAND_TIERS)('maps %s to %s', (band, tier) => {
    const mix = mohcdMix(parseMohcdRows([mohcdRow('X', '5', { [band]: '1' })]));
    expect(mix.tiers[tier]).toBe(1);
    expect(mix.byBand[band]).toBe(1);
  });

  it('covers every band', () => {
    expect(BAND_TIERS.map(([b]) => b)).toEqual([...AMI_BANDS]);
  });

  it('takes the nearest-rank 10th percentile', () => {
    expect(nearestRankP10(Array.from({ length: 45 }, (_, i) => i + 1))).toBe(5);
    expect(nearestRankP10([2, 6])).toBe(2);
    expect(nearestRankP10([null, 0, 7])).toBe(7);
  });

  it('reads a blank band as 0 and leaves a blank size out of the p10 (Review Focus 3)', () => {
    const blank = mohcdRow('BLANK', '', { _30_ami: '3.0' });
    blank._80_ami = '';
    const mix = mohcdMix(parseMohcdRows([blank, mohcdRow('Y', '40', { _60_ami: '1' })]));
    expect(mix.byBand._30_ami).toBe(3);
    expect(mix.byBand._80_ami).toBe(0);
    expect(mix.tiers).toEqual({ veryLow: 0.75, low: 0.25, moderate: 0, aboveModerate: 0 });
    expect(mix.minHomes).toBe(40);
    expect(mix.used).toBe(2);
  });

  it('gives the fixture mix and leaves the inclusionary row out', () => {
    const out = baselineFunding(fixture, MOHCD_RAW, AS_OF, FIXTURE_CAL);
    expect(out.report.mix.tiers).toEqual({
      veryLow: 0.428572,
      low: 0.428571,
      moderate: 0.142857,
      aboveModerate: 0
    });
    expect(out.report.mix.minHomes).toBe(2);
    expect(out.report.mix.used).toBe(2);
    expect(out.report.mix.undeclared).toBe(1);
    expect(out.tally).toMatchObject({ fired: 1, of: 8 });
  });

  it('throws when no row qualifies', () => {
    const inclusionary = MOHCD_RAW.filter((r) => r.general_housing_program !== MOHCD_PROGRAM);
    expect(inclusionary).toHaveLength(1);
    const run = () => baselineFunding(fixture, inclusionary, AS_OF, FIXTURE_CAL);
    expect(run).toThrow(CalibrationError);
    expect(run).toThrow(
      'funding: no MOHCD 100% affordable new-construction rows with income bands'
    );
  });

  it('throws when the qualifying rows have no band-coded home', () => {
    expect(() => mohcdMix(parseMohcdRows([mohcdRow('Z', '10', {})]))).toThrow(
      'funding: no MOHCD 100% affordable new-construction rows with income bands'
    );
  });
});

describe('the City entries', () => {
  it('take their window from city.fiscalYear', () => {
    const f: FundingFile = structuredClone(live);
    f.city.fiscalYear = 'FY2023-24';
    const prov = baselineFunding(f, PER_BAND, AS_OF, LIVE_CAL).baselineFunding.provenance;
    for (const i of f.city.sources.keys()) {
      expect(prov[i].window).toEqual(['2023-07-01', '2024-06-30']);
    }
  });

  it('cite the debt page without a quote when the cite has none', () => {
    const prov = baselineFunding(fixture, MOHCD_RAW, AS_OF, FIXTURE_CAL).baselineFunding.provenance;
    expect(prov[0].method).toContain(
      "Debt terms: rate 6.0%, 20 years (Exhibit 40), the Analyst's assumption (tier 2); " +
        'repayment is nominal.'
    );
  });
});

describe('perHome against the uncovered cost', () => {
  it('throws on a one-dollar difference', () => {
    const off: FundingFile = structuredClone(live);
    off.perHome.city += 1;
    off.perHome.other -= 1;
    const run = () => baselineFunding(off, PER_BAND, AS_OF, LIVE_CAL);
    expect(run).toThrow(CalibrationError);
    expect(run).toThrow(
      'funding: perHome city + state + federal 861526 is not the uncovered cost 861525'
    );
  });
});

describe('baselineFunding in a fixture build', () => {
  const out = baselineFunding(fixture, MOHCD_RAW, AS_OF, FIXTURE_CAL);
  const bf = out.baselineFunding;

  it('labels every provenance entry tier 4', () => {
    for (const p of [...bf.provenance, bf.check.provenance]) {
      expect(p.tier).toBe(4);
      expect(p.label).toMatch(/^Fixture \(tier 4\): /);
    }
  });

  it("takes the federal entry's n and window from the award rows", () => {
    const federal = bf.provenance[8];
    expect(federal.n).toBe(2);
    expect(federal.window).toEqual(['2024-01-01', '2025-12-31']);
    expect(federal.sources).toEqual([
      {
        label: 'Fixture: invented funding (tier 4), Exhibit F',
        url: 'https://fixture.invalid/funding'
      },
      { label: 'Fixture: invented bound (tier 4), bound', url: 'https://fixture.invalid/funding' }
    ]);
    expect(
      federal.method.startsWith(
        'The fixture ceiling is 30 homes in 2025 times $443,108; invented (tier 4). Of the 2 '
      )
    ).toBe(true);
    expect(federal.label).toBe(
      'Fixture (tier 4): Federal: low-income housing tax credits: at most $13.3 million a year (no end)'
    );
  });

  it('has the funding shape funding-ui needs', () => {
    expect(bf.pools.map((p) => [p.id, p.kind])).toEqual(POOLS);
    expect(poolOf(bf.pools, 'federal-tax-credits').inflows).toEqual([
      { kind: 'yearly', from: AS_OF, to: null, dollarsPerYear: 13_293_240 }
    ]);
    expect(bf.programmes).toHaveLength(7);
    for (const p of bf.programmes) {
      expect(p.instrument.kind).toBe('grant');
      expect(p.reach).toBe('affordable');
      expect(p.minHomes).toBe(2);
      expect(p.minHomes).toBeLessThanOrEqual(11);
    }
    const shares = out.report.rows.map((r) => r.share);
    expect(Math.round(shares.reduce((a, b) => a + b, 0) * 1e6)).toBe(1e6);
    expect(bf.check).toMatchObject({ impliedHomesPerYear: 20, observedHomesPerYear: 25 });
    expect(out.warnings).toEqual([]);
    const ids = new Set(bf.pools.map((p) => p.id));
    bf.pools.forEach((p, i) => expect(() => checkPool(p, `pools[${i}]`)).not.toThrow());
    bf.programmes.forEach((p, i) =>
      expect(() => checkProgramme(p, `programmes[${i}]`, ids)).not.toThrow()
    );
  });
});
