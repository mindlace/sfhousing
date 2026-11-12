// Baseline funding: pools, programmes, shares, the MOHCD mix and the homes-a-year check
// (finance-data spec 4.6; section 6, pipeline item 5).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFundingFile, type FundingFile } from '../../enrichment/funding-schema';
import {
  AMI_BANDS,
  MOHCD_PROGRAM,
  baselineFunding,
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
import { BASELINE_ID_RE, checkPool, checkProgramme } from '../../../src/lib/timelapse/model';
import type { IncomeTier } from '../../../src/lib/timelapse/types';

const LIVE_PATH = resolve(__dirname, '../../enrichment/funding.json');
const FIXTURE_PATH = resolve(__dirname, '../fixtures/mini/enrichment/funding.json');
const load = (p: string): FundingFile => parseFundingFile(JSON.parse(readFileSync(p, 'utf8')), p);
const live = load(LIVE_PATH);
const fixture = load(FIXTURE_PATH);

const AS_OF = Date.UTC(2026, 10, 9) / 86_400_000;

const POOLS: [string, string][] = [
  ['city-debt', 'goBond'],
  ['city-ocoh', 'dedicatedTax'],
  ['city-general-fund', 'generalRevenue'],
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

  it('gives the eight expected shares, summing to 1,000,000 millionths', () => {
    const shares = bf.programmes.map((p) => (p.instrument as { share: number }).share);
    expect(shares).toEqual([
      0.119804, 0.072329, 0.054619, 0.051791, 0.040778, 0.00893, 0.137419, 0.51433
    ]);
    expect(Math.round(shares.reduce((a, b) => a + b, 0) * 1e6)).toBe(1e6);
  });

  it('emits the eight pools of spec 4.5 in order and their programmes', () => {
    expect(bf.pools.map((p) => [p.id, p.kind])).toEqual(POOLS);
    expect(bf.programmes.map((p) => p.id)).toEqual(POOLS.map(([id]) => `baseline-${id}`));
    expect(bf.programmes.map((p) => p.pool)).toEqual(POOLS.map(([id]) => id));
    const ids = [...bf.pools.map((p) => p.id), ...bf.programmes.map((p) => p.id)];
    expect(ids).toHaveLength(16);
    for (const id of ids) {
      expect(id).toMatch(BASELINE_ID_RE);
      expect(id.startsWith('u-')).toBe(false);
    }
  });

  it('puts federal in fill tier 1, state in 2 and the City in 3', () => {
    expect(out.report.rows.map((r) => r.fillTier)).toEqual([3, 3, 3, 3, 3, 3, 2, 1]);
  });

  it('has debt only on city-debt, inflows from asOf and an uncapped federal pool', () => {
    expect(bf.pools.filter((p) => p.debt !== null).map((p) => p.id)).toEqual(['city-debt']);
    expect(bf.pools[0].debt).toEqual({ rate: 0.06, termYears: 20 });
    for (const p of bf.pools.slice(0, 7)) {
      expect(p.uncapped).toBe(false);
      expect(p.inflows).toHaveLength(1);
      expect(p.inflows[0]).toEqual({
        kind: 'yearly',
        from: AS_OF,
        to: null,
        dollarsPerYear: p.id === 'state' ? 150_000_000 : expect.any(Number)
      });
    }
    const federal = bf.pools[7];
    expect(federal.uncapped).toBe(true);
    expect(federal.inflows).toEqual([]);
    expect(bf.pools.every((p) => p.leverage === 1)).toBe(true);
    expect(Object.keys(bf.pools[0])).toEqual([
      'id',
      'kind',
      'label',
      'inflows',
      'uncapped',
      'debt',
      'leverage'
    ]);
  });

  it('builds each programme as a grant reaching affordable homes from asOf', () => {
    for (const [i, p] of bf.programmes.entries()) {
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
      expect(p.label).toBe(`${bf.pools[i].label}: grant toward an affordable home`);
      expect(p.reach).toBe('affordable');
      expect(p.instrument.kind).toBe('grant');
      expect(p.from).toBe(AS_OF);
      expect(p.to).toBeNull();
      expect(p.minHomes).toBe(out.report.mix.minHomes);
      expect(p.tiers).toEqual(out.report.mix.tiers);
    }
  });

  it('checks 780 implied homes a year against 980 observed, with no warning', () => {
    expect(bf.check).toMatchObject({ impliedHomesPerYear: 780, observedHomesPerYear: 980 });
    expect(out.report.check).toEqual({ impliedHomesPerYear: 780, observedHomesPerYear: 980 });
    expect(out.warnings).toEqual([]);
    expect(out.report.warning).toBeNull();
    expect(out.report.awardRows).toBe(19);
  });

  it('repeats each City note and the state and federal methods in the provenance', () => {
    expect(bf.provenance).toHaveLength(bf.pools.length + 1);
    live.city.sources.forEach((s, i) => {
      expect(bf.provenance[i].tier).toBe(2);
      const method = bf.provenance[i].method;
      const recorded = method.indexOf('Recorded (tier 1): ');
      const inferred = method.indexOf(
        'Inferred (tier 2): Exhibit F gives one figure for the City and no split by source. ' +
          'This source is taken to pay in proportion to its FY2024-25 spending: '
      );
      expect(recorded).toBe(0);
      expect(inferred).toBeGreaterThan(recorded);
      const held =
        'The amount is held level from the first inflow, with no end (an assumption, not a ' +
        'forecast).';
      expect(method.indexOf(held)).toBeGreaterThan(inferred);
      expect(method.indexOf('First inflow on asOf')).toBeGreaterThan(method.indexOf(held));
      expect(method.indexOf(s.note)).toBeGreaterThan(method.indexOf(held));
      expect(bf.provenance[i].method).toContain(s.note);
      expect(bf.provenance[i].method).toContain('FY2024-25 dollars, not adjusted');
      expect(bf.provenance[i].label).toBe(
        `${s.label}: $${(s.dollarsPerYear / 1e6).toFixed(1)} million a year, FY2024-25 (held level)`
      );
      const bla = {
        label: `${live.city.cite.label}, p. 6, Exhibit E; p. 7, Exhibit F`,
        url: live.city.cite.url
      };
      expect(bf.provenance[i].sources).toEqual(
        s.debt === null
          ? [bla]
          : [bla, { label: `${s.debt.cite.label}, ${s.debt.cite.page}`, url: s.debt.cite.url }]
      );
      expect(bf.provenance[i].window).toEqual(['2024-07-01', '2025-06-30']);
      if (s.debt === null) expect(bf.provenance[i].method).not.toContain('Debt terms');
    });
    const debt = live.city.sources[0].debt!;
    expect(
      bf.provenance[0].method.endsWith(
        `Debt terms: rate 6.0%, 20 years (p. 106, Exhibit 40: '${debt.cite.quote}'), the ` +
          "Analyst's assumption (tier 2); repayment is nominal."
      )
    ).toBe(true);
    expect(bf.provenance[6].tier).toBe(2);
    expect(bf.provenance[6].method).toContain(live.state.method);
    const federal = bf.provenance[7];
    expect(federal.tier).toBe(2);
    expect(federal.label).toBe('Federal: low-income housing tax credits: uncapped');
    expect(federal.method.startsWith(live.federal.method)).toBe(true);
    const award =
      'Of the 15 new-construction awards of 2024–2025, 14 used the 4% credit (1,925 of 1,960 ' +
      'homes).';
    expect(federal.method).toContain(`${live.federal.method} ${award} Share: `);
    expect(federal.method.endsWith('FY2024-25 dollars, not adjusted.')).toBe(true);
    expect(federal.method).not.toContain('evidence digest');
    expect(federal.sources).toEqual([
      {
        label: `${live.federal.cite.label}, ${live.federal.cite.page}`,
        url: live.federal.cite.url
      },
      ...live.federal.uncapped.cites.map((c) => ({ label: `${c.label}, ${c.page}`, url: c.url }))
    ]);
    expect(federal.sources).toHaveLength(4);
    expect(federal.n).toBe(live.federal.uncapped.rounds);
    expect(federal.n).toBe(3);
    expect(federal.window).toEqual(live.federal.uncapped.window);
    expect(federal.window).toEqual(['2026-01-01', '2026-09-14']);
    for (const p of bf.provenance.slice(0, 8)) expect(p.tier).toBe(2);
    expect(bf.provenance.some((p) => p.tier === 1)).toBe(false);
    for (const p of [...bf.provenance, bf.check.provenance]) {
      expect(p.method).not.toMatch(/rests on .*not on a source listed/);
    }
    const last = bf.provenance[8];
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
      'baselineFunding: the capped pools fully fund 780 affordable homes a year; the 2024–2025 ' +
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

  it("takes the federal entry's n, window and sources from federal.uncapped", () => {
    const federal = bf.provenance[7];
    expect(federal.n).toBe(1);
    expect(federal.window).toEqual(['2026-01-01', '2026-01-01']);
    expect(federal.sources).toEqual([
      {
        label: 'Fixture: invented funding (tier 4), Exhibit F',
        url: 'https://fixture.invalid/funding'
      },
      {
        label: 'Fixture: invented allocation record (tier 4), fixture',
        url: 'https://fixture.invalid/funding'
      }
    ]);
    expect(
      federal.method.startsWith('The fixture pool is uncapped; invented (tier 4). Of the 2 ')
    ).toBe(true);
  });

  it('has the funding shape funding-ui needs', () => {
    expect(bf.pools.map((p) => [p.id, p.kind])).toEqual(POOLS);
    expect(bf.pools.filter((p) => p.uncapped).map((p) => p.id)).toEqual(['federal-tax-credits']);
    expect(bf.programmes).toHaveLength(8);
    for (const p of bf.programmes) {
      expect(p.instrument.kind).toBe('grant');
      expect(p.reach).toBe('affordable');
      expect(p.minHomes).toBe(2);
      expect(p.minHomes).toBeLessThanOrEqual(11);
    }
    const shares = bf.programmes.map((p) => (p.instrument as { share: number }).share);
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
