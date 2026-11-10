// Today's market against the published start model (market-baseline spec §4.4, §4.6).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StartCohort } from '../../lib/affordable-cohort';
import { parseMarketFile } from '../../enrichment/market-schema';
import { logistic } from '../../lib/fzp-cal/irls';
import { marketModel, marketToday, type MarketInput } from '../../lib/fzp-cal/market';
import { PROTOTYPES, type Prototype } from '../../../src/lib/sim/finance/prototypes';
import type { MarketFile } from '../../enrichment/market-schema';
import type { PanelStart } from '../../lib/fzp-cal/panel';
import { datasf } from '../../lib/fzp-cal/provenance';
import { sig6 } from '../../lib/fzp-cal/tail';
import { CalibrationError } from '../../lib/fzp-cal/types';

const MARKET_JSON_PATH = resolve(__dirname, '../../enrichment/market.json');
const marketFile = parseMarketFile(
  JSON.parse(readFileSync(MARKET_JSON_PATH, 'utf8')),
  'market.json'
);

const RECENT = [2023, 2025] as const;
const logit = (p: number) => Math.log(p / (1 - p));

function start(year: number, cohort: StartCohort = 'private'): PanelStart {
  return { year, basis: 0, cohort, homes: 10, stories: 4 };
}

/** `counts[y]` starts in year y, the first `affordable[y]` of them in the affordable cohort. */
function starts(
  counts: Record<number, number>,
  affordable: Record<number, number> = {}
): PanelStart[] {
  const out: PanelStart[] = [];
  for (const [y, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) {
      out.push(start(Number(y), i < (affordable[Number(y)] ?? 0) ? 'affordable' : 'private'));
    }
  }
  return out;
}

interface Opts {
  hazard?: number;
  exposure?: number;
  observed?: [number, number, number];
  affordable?: [number, number, number];
}

/** A live input: one cell per recent year, the panel starts matching the observed counts. */
function input(o: Opts = {}, over: Partial<MarketInput> = {}): MarketInput {
  const hazard = o.hazard ?? 1e-4;
  const exposure = o.exposure ?? 1e6;
  const observed = o.observed ?? [30, 40, 50];
  const affordable = o.affordable ?? [1, 1, 0];
  const z = logit(hazard);
  const impliedPerYear: Record<number, number> = {};
  const observedPerYear: Record<number, number> = {};
  for (let y = 2007; y <= 2025; y++) {
    impliedPerYear[y] = 100;
    observedPerYear[y] = 7;
  }
  const recentCells: MarketInput['recentCells'] = [];
  const counts: Record<number, number> = { 2021: 7, 2022: 7 };
  const aff: Record<number, number> = { 2022: 3 };
  for (let i = 0; i < 3; i++) {
    const y = RECENT[0] + i;
    recentCells.push({ exposure, z });
    impliedPerYear[y] = exposure * logistic(z);
    observedPerYear[y] = observed[i];
    counts[y] = observed[i];
    aff[y] = affordable[i];
  }
  return {
    fixture: false,
    impliedPerYear,
    observedPerYear,
    recentCells,
    holdOut: {
      fitThrough: 2022,
      rows: [
        { year: 2023, observed: observed[0], predicted: 110 },
        { year: 2024, observed: observed[1], predicted: 120 },
        { year: 2025, observed: observed[2], predicted: 130 }
      ],
      observed: observed[0] + observed[1] + observed[2],
      predicted: 360
    },
    starts: starts(counts, aff),
    enrichment: { file: marketFile, path: 'market.json' },
    initiationSources: [datasf('planningProjects'), datasf('permits')],
    ...over
  };
}

const implied3 = (x: MarketInput) =>
  sig6(x.impliedPerYear[2023] + x.impliedPerYear[2024] + x.impliedPerYear[2025]);

describe('marketToday: the levels', () => {
  it('measures observed over implied starts in the last three panel years', () => {
    const x = input();
    const r = marketToday(x);
    const implied = implied3(x);
    expect(r.today.years).toEqual([2023, 2025]);
    expect(r.today.implied).toBe(implied);
    expect(r.today.observed.all).toBe(120);
    expect(r.today.observed.private).toBe(118);
    expect(r.today.all).toBe(sig6(Math.log(120 / implied)));
    expect(r.today.private).toBe(sig6(Math.log(118 / implied)));
  });

  it('removes the affordable-cohort starts from the private count, over the same implied', () => {
    const x = input({ observed: [3, 3, 4], affordable: [1, 0, 1] });
    const r = marketToday(x);
    const implied = implied3(x);
    expect(r.today.observed).toEqual({ all: 10, private: 8 });
    expect(r.today.implied).toBe(implied);
    expect(r.today.private).toBe(sig6(Math.log(8 / implied)));
    expect(r.cohorts).toEqual({ affordable: 2, private: 8, noRecord: 0, unknown: 0 });
  });

  it('emits today in declaration order with a tier 2 provenance that never names the hold-out', () => {
    const r = marketToday(input());
    expect(Object.keys(r.today)).toEqual([
      'all',
      'private',
      'years',
      'observed',
      'implied',
      'provenance'
    ]);
    const p = r.today.provenance;
    expect(p.tier).toBe(2);
    expect(p.label).toBe(
      "Today's market: new-project filings in 2023-2025 against the starts the start model, fitted on 2007-2025, implies for those years (tier 2)"
    );
    expect(p.sources).toEqual([datasf('planningProjects'), datasf('permits')]);
    expect(p.n).toBe(120);
    expect(p.window).toEqual(['2023-01-01', '2025-12-31']);
    expect(p.method).not.toMatch(/hold-out/i);
    expect(p.method).toMatch(/at least 95% affordable homes/);
    expect(p.method).toMatch(/0 starts had no Planning record and 0 no recorded counts/);
  });

  it('counts no-record and unknown starts as private and says how many', () => {
    const x = input();
    const recent = x.starts.filter((s) => s.year === 2024 && s.cohort === 'private');
    recent[0].cohort = 'noRecord';
    recent[1].cohort = 'noRecord';
    recent[2].cohort = 'unknown';
    const r = marketToday(x);
    expect(r.today.observed.private).toBe(118);
    expect(r.cohorts).toEqual({ affordable: 2, private: 115, noRecord: 2, unknown: 1 });
    expect(r.today.provenance.method).toMatch(
      /2 starts had no Planning record and 1 no recorded counts, and count as private/
    );
  });

  it('lists each recent year in the rows', () => {
    const x = input();
    const r = marketToday(x);
    expect(r.rows.map((w) => [w.year, w.observed, w.affordable, w.private])).toEqual([
      [2023, 30, 1, 29],
      [2024, 40, 1, 39],
      [2025, 50, 0, 50]
    ]);
    expect(r.rows[0].implied).toBe(sig6(x.impliedPerYear[2023]));
    expect(r.rows.map((w) => w.holdOutPredicted)).toEqual([110, 120, 130]);
  });
});

describe('marketToday: the reproduction check', () => {
  it('reproduces the observed count closely for small hazards, without a warning', () => {
    const r = marketToday(input());
    expect(Math.abs(r.reproduction! - 120) / 120).toBeLessThan(1e-4);
    expect(r.warnings.some((w) => /more than 2% apart/.test(w))).toBe(false);
    expect(r.today.provenance.method).toContain(`X = ${r.reproduction}`);
  });

  it('warns when the shifted model misses the observed count by more than 2%', () => {
    const r = marketToday(input({ hazard: 0.3, exposure: 1000 }));
    expect(r.warnings.some((w) => /more than 2% apart/.test(w))).toBe(true);
    expect(r.warnings.find((w) => /more than 2% apart/.test(w))).toMatch(
      /^market: the shifted published model predicts [\d.]+ starts in 2023-2025 against 120 observed \(more than 2% apart\)$/
    );
  });
});

describe('marketToday: the hold-out diagnostic', () => {
  it('reports the log ratio of observed to the hold-out prediction', () => {
    const r = marketToday(input());
    expect(r.holdOut).not.toBeNull();
    expect('logRatio' in r.holdOut!).toBe(true);
    const h = r.holdOut as { predicted: number; logRatio: number };
    expect(h.predicted).toBe(360);
    expect(h.logRatio).toBeCloseTo(Math.log(120 / 360), 9);
  });

  it('carries a failed refit as an error with the verbatim warning and the same today', () => {
    const good = marketToday(input());
    const r = marketToday(input({}, { holdOut: { error: 'singular' } }));
    expect(r.holdOut).toEqual({ error: 'singular' });
    expect(r.warnings).toContain(
      'market: the hold-out refit failed: singular; the report has no hold-out diagnostic'
    );
    expect(r.today).toEqual(good.today);
    expect(r.rows.map((w) => w.holdOutPredicted)).toEqual([null, null, null]);
  });
});

describe('marketToday: live errors', () => {
  const fails = (x: MarketInput, message: string) => {
    expect(() => marketToday(x)).toThrow(CalibrationError);
    expect(() => marketToday(x)).toThrow(message);
  };

  it('fails with no starts', () => {
    fails(input({ observed: [0, 0, 0], affordable: [0, 0, 0] }), 'market: no starts in 2023-2025');
  });

  it('fails when every start is in the affordable cohort', () => {
    fails(
      input({ observed: [2, 1, 1], affordable: [2, 1, 1] }),
      'market: no private starts in 2023-2025'
    );
  });

  it('fails when the implied starts are not positive', () => {
    const x = input();
    x.impliedPerYear[2023] = 0;
    x.impliedPerYear[2024] = 0;
    x.impliedPerYear[2025] = 0;
    fails(x, 'market: implied starts 0 in 2023-2025 are not positive');
  });

  it('fails when the panel starts do not match the initiation events', () => {
    const x = input();
    x.starts.push(start(2024));
    fails(x, 'market: 121 panel starts in 2023-2025 do not match 120 initiation events');
  });

  it('is a CalibrationError with exactly the message', () => {
    try {
      marketToday(input({ observed: [0, 0, 0], affordable: [0, 0, 0] }));
    } catch (e) {
      expect(e).toBeInstanceOf(CalibrationError);
      expect((e as Error).message).toBe('market: no starts in 2023-2025');
      return;
    }
    expect.unreachable('marketToday did not throw');
  });
});

describe('marketToday: the sanity band', () => {
  const BAND = /^market: today\.all -?[\d.]+ is outside \[ln 0\.1, ln 2\]$/;

  it('warns when today.all is far below the band', () => {
    const r = marketToday(input({ observed: [1, 0, 0], affordable: [0, 0, 0] }));
    expect(r.warnings.some((w) => BAND.test(w))).toBe(true);
  });

  it('does not warn when observed is about implied', () => {
    const r = marketToday(input({ observed: [100, 100, 100], affordable: [0, 0, 0] }));
    expect(r.warnings.some((w) => BAND.test(w))).toBe(false);
    expect(r.warnings).toEqual([]);
  });
});

describe('marketToday: the fixture profile', () => {
  it('ships the invented fixture levels at tier 4 with no checks', () => {
    const r = marketToday(input({}, { fixture: true, holdOut: null }));
    expect(r.today).toEqual({
      all: -0.693147,
      private: -0.798508,
      years: [2023, 2025],
      observed: { all: 10, private: 9 },
      implied: 20,
      provenance: r.today.provenance
    });
    expect(Object.keys(r.today)).toEqual([
      'all',
      'private',
      'years',
      'observed',
      'implied',
      'provenance'
    ]);
    expect(r.today.provenance.tier).toBe(4);
    expect(r.today.provenance.label).toMatch(/^fixture:/);
    expect(r.today.provenance.sources).toEqual([datasf('planningProjects')]);
    expect(r.today.provenance.method).toMatch(/invented/);
    expect(r.reproduction).toBeNull();
    expect(r.holdOut).toBeNull();
    expect(r.rows).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.cohorts).toEqual({ affordable: 2, private: 118, noRecord: 0, unknown: 0 });
  });

  it('does not throw on a fixture input with no starts', () => {
    const r = marketToday(
      input({ observed: [0, 0, 0], affordable: [0, 0, 0] }, { fixture: true, starts: [] })
    );
    expect(r.today.observed).toEqual({ all: 10, private: 9 });
    expect(r.cohorts).toEqual({ affordable: 0, private: 0, noRecord: 0, unknown: 0 });
  });

  it('takes the years from the last panel year', () => {
    const x = input({}, { fixture: true, holdOut: null });
    x.impliedPerYear[2026] = 5;
    expect(marketToday(x).today.years).toEqual([2024, 2026]);
  });
});

function at(
  year: number,
  stories: number | null,
  homes: number | null,
  cohort: StartCohort = 'private'
): PanelStart {
  return { year, basis: 0, cohort, homes, stories };
}

/** The weights input: every recent start hand-placed, one start before the weight years. */
function weightInput(over: Partial<MarketInput> = {}): MarketInput {
  const list = [
    at(2020, 5, 45),
    at(2023, 5, 45),
    at(2023, 8, 130, 'noRecord'),
    at(2024, 8, 130, 'unknown'),
    at(2024, null, 13),
    at(2025, 7, null),
    at(2025, null, 40),
    at(2025, 10, 100, 'affordable')
  ];
  return input({ observed: [2, 2, 3] }, { starts: list, ...over });
}

const share = (p: Prototype) => (p.shortfallPerHome + 65_000) / p.costPerHome;

describe('marketModel: the Controller cross-check', () => {
  it('reads the committed market.json to the spec values', () => {
    const { market, report } = marketModel(input());
    expect(market.crossCheck.logOdds).toBe(-1.28933);
    expect(report.means.costRecent).toBeCloseTo(115.266667, 5);
    expect(report.means.costReference).toBeCloseTo(101.747368, 5);
    expect(report.means.priceRecent).toBe(89.5);
    expect(report.means.priceReference).toBeCloseTo(85.878947, 5);
    expect(market.slope.crossChecks.costCoefficient).toBe(11.4345);
  });

  it('labels the cross-check tier 3 with the Controller source', () => {
    const p = marketModel(input()).market.crossCheck.provenance;
    expect(p.tier).toBe(3);
    expect(p.label).toBe(
      "The Controller's development model on its cost and price indices (tier 3, a cross-check; not used)"
    );
    expect(p.sources).toEqual([{ label: marketFile.source.label, url: marketFile.source.url }]);
    expect(p.method).toContain('chart-read, approximate');
    expect(p.method).toContain(
      "the Controller's model is annual, on a lot producing housing; ours is monthly, on a project's first filing; the two shifts are comparable only as odds ratios"
    );
    expect(p.method).toContain('2021-2023');
    expect(p.method).toContain('2005-2023');
  });

  it('fails when the price periods are not the panel years minus lagYears', () => {
    const file: MarketFile = structuredClone(marketFile);
    file.priceIndex.means[0].to = 2019;
    file.priceIndex.means[1].from = 2020;
    const x = input({}, { enrichment: { file, path: 'market.json' } });
    expect(() => marketModel(x)).toThrow(CalibrationError);
    expect(() => marketModel(x)).toThrow(
      'market: market.json: price periods 2005-2019, 2020-2023 do not match the panel years minus lagYears (2005-2020, 2021-2023)'
    );
  });
});

describe('marketModel: the weights and the slope', () => {
  it('weights the binned private starts of the weight years by prototype', () => {
    const { market, report } = marketModel(weightInput());
    expect(report.years).toEqual([2021, 2025]);
    expect(report.weights.map((w) => [w.id, w.starts, w.weight])).toEqual([
      ['A', 1, 0.25],
      ['B', 2, 0.5],
      ['C', 0, 0],
      ['D', 0, 0],
      ['E', 1, 0.25]
    ]);
    expect(report.weights.map((w) => w.rule)).toEqual([
      'homes ≥ 25, stories ≤ 6',
      'homes ≥ 25, stories 7 to 10',
      'homes ≥ 25, stories 11 to 18',
      'homes ≥ 25, stories above 18',
      'homes under 25'
    ]);
    expect(report.weights[1]).toMatchObject({
      uncoveredPerHome: 217_000,
      costPerHome: 736_700,
      uncoveredShare: 217_000 / 736_700
    });
    expect(report.unbinned).toEqual({ homes: 1, stories: 1 });
    expect(report.equalWeights).toBe(false);
    expect(report.typicalUncoveredShare).toBeCloseTo(
      0.25 * (242000 / 729700) + 0.5 * (217000 / 736700) + 0.25 * (418000 / 929700),
      12
    );
    expect(market.slope.perCostShare).toBe(
      sig6(-market.today.private / report.typicalUncoveredShare)
    );
    const [A, B, , , E] = PROTOTYPES;
    const value = (p: Prototype) => p.costPerHome / (p.costPerHome - p.shortfallPerHome);
    expect(report.typicalCostOverValue).toBeCloseTo(
      0.25 * value(A) + 0.5 * value(B) + 0.25 * value(E),
      12
    );
    expect(market.slope.crossChecks.priceCoefficient).toBe(
      sig6(0.0143 * 89.5 * report.typicalCostOverValue)
    );
    expect(share(A)).toBeCloseTo(242000 / 729700, 12);
  });

  it('labels the slope tier 2 with counts, sources and the window', () => {
    const p = marketModel(weightInput()).market.slope.provenance;
    expect(p.tier).toBe(2);
    expect(p.label).toBe(
      "Odds shift for public money: closing a typical private project's uncovered cost returns its odds to the 2007-2025 average (tier 2)"
    );
    expect(p.n).toBe(4);
    expect(p.window).toEqual(['2021-01-01', '2025-12-31']);
    const urls = p.sources.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const s of [
      datasf('planningProjects'),
      datasf('permits'),
      ...PROTOTYPES[0].provenance.sources
    ]) {
      expect(urls).toContain(s.url);
    }
    expect(p.method).toContain('typicalUncoveredShare');
    expect(p.method).toMatch(/1 start.* homes not recorded/);
    const c = marketModel(weightInput()).market.slope.crossChecks.provenance;
    expect(c.tier).toBe(3);
    expect(c.sources).toEqual([{ label: marketFile.source.label, url: marketFile.source.url }]);
    expect(c.method).toContain('costCoefficient');
    expect(c.method).toContain('priceCoefficient');
  });

  it('fails live when no private start of the weight years has a prototype', () => {
    const x = input(
      { observed: [1, 0, 1] },
      { starts: [at(2023, null, null), at(2025, null, 30)] }
    );
    expect(() => marketModel(x)).toThrow(CalibrationError);
    expect(() => marketModel(x)).toThrow('market: no private start in 2021-2025 has a prototype');
  });

  it('falls back to equal weights in the fixture when no start is binned', () => {
    const { market, report } = marketModel(input({}, { fixture: true, holdOut: null, starts: [] }));
    expect(report.equalWeights).toBe(true);
    expect(report.weights.map((w) => w.weight)).toEqual([0.2, 0.2, 0.2, 0.2, 0.2]);
    expect(market.slope.perCostShare).toBe(
      sig6(-market.today.private / report.typicalUncoveredShare)
    );
  });

  it('guards a prototype with no positive value per home', () => {
    const prototypes = PROTOTYPES.map((p) =>
      p.id === 'A' ? { ...p, shortfallPerHome: p.costPerHome } : p
    );
    const x = weightInput({ prototypes });
    expect(() => marketModel(x)).toThrow(CalibrationError);
    expect(() => marketModel(x)).toThrow('market: prototype A has no positive value per home');
  });

  it('guards a typicalUncoveredShare that is not positive', () => {
    const prototypes = PROTOTYPES.map((p) => ({ ...p, shortfallPerHome: -65_000 }));
    const x = weightInput({ prototypes });
    expect(() => marketModel(x)).toThrow(CalibrationError);
    expect(() => marketModel(x)).toThrow('market: typicalUncoveredShare 0 is not positive');
  });
});

describe('marketModel: the hold-out never reaches market', () => {
  it('gives the same market for a different hold-out prediction or a failed refit', () => {
    const good = input();
    const other = input();
    other.holdOut = {
      ...(good.holdOut as Exclude<MarketInput['holdOut'], null | { error: string }>),
      predicted: 999
    };
    const failed = input({}, { holdOut: { error: 'singular' } });
    const a = marketModel(good).market;
    for (const x of [other, failed]) {
      const b = marketModel(x).market;
      expect(b).toEqual(a);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  });
});

describe('marketModel: the cross-check gap warning', () => {
  const GAP =
    /^market: today\.all -?[\d.]+ differs from the Controller cross-check -1\.28933 by more than 1$/;

  it('warns when today.all is far from the cross-check, after the today warnings', () => {
    const { report } = marketModel(input({ observed: [100, 100, 100], affordable: [0, 0, 0] }));
    expect(report.warnings.some((w) => GAP.test(w))).toBe(true);
    expect(GAP.test(report.warnings.at(-1)!)).toBe(true);
  });

  it('does not warn near the design level', () => {
    const { market, report } = marketModel(
      input({ observed: [52, 53, 53], affordable: [0, 0, 0] })
    );
    expect(market.today.all).toBeCloseTo(-0.64, 1);
    expect(report.warnings.some((w) => GAP.test(w))).toBe(false);
  });

  it('does not warn in the fixture', () => {
    const { report } = marketModel(input({}, { fixture: true, holdOut: null }));
    expect(report.warnings).toEqual([]);
  });
});

describe('marketModel: shapes, tiers and counts', () => {
  it('emits market and slope keys in declaration order with the live tiers', () => {
    const { market, report } = marketModel(input());
    expect(report.mode).toBe('fit');
    expect(Object.keys(market)).toEqual(['today', 'crossCheck', 'slope']);
    expect(Object.keys(market.slope)).toEqual(['perCostShare', 'provenance', 'crossChecks']);
    expect(Object.keys(market.slope.crossChecks)).toEqual([
      'costCoefficient',
      'priceCoefficient',
      'provenance'
    ]);
    expect(market.today.provenance.tier).toBe(2);
    expect(market.crossCheck.provenance.tier).toBe(3);
    expect(market.slope.provenance.tier).toBe(2);
    expect(market.slope.crossChecks.provenance.tier).toBe(3);
    for (const p of [market.today.provenance, market.slope.provenance]) {
      expect(p.n).toBeTypeOf('number');
      expect(p.window).toHaveLength(2);
    }
  });

  it('labels every fixture provenance tier 4 and fixture:, with the live cross-check value', () => {
    const { market, report } = marketModel(input({}, { fixture: true, holdOut: null }));
    expect(report.mode).toBe('fixture');
    expect(market.crossCheck.logOdds).toBe(-1.28933);
    for (const p of [
      market.today.provenance,
      market.crossCheck.provenance,
      market.slope.provenance,
      market.slope.crossChecks.provenance
    ]) {
      expect(p.tier).toBe(4);
      expect(p.label).toMatch(/^fixture:/);
    }
    expect(market.slope.perCostShare).toBe(
      sig6(-market.today.private / report.typicalUncoveredShare)
    );
  });

  it('counts the panel starts', () => {
    expect(marketModel(weightInput()).report.counts).toEqual({
      'calibration.market.recentStarts': 7,
      'calibration.market.recentPrivate': 6,
      'calibration.market.recentAffordable': 1,
      'calibration.market.recentNoRecord': 1,
      'calibration.market.recentUnknown': 1,
      'calibration.market.weightStarts': 4,
      'calibration.market.unbinnedHomes': 1,
      'calibration.market.unbinnedStories': 1
    });
  });

  it('counts the panel starts in the fixture too', () => {
    const counts = marketModel(weightInput({ fixture: true, holdOut: null })).report.counts;
    expect(counts['calibration.market.recentStarts']).toBe(7);
    expect(counts['calibration.market.weightStarts']).toBe(4);
  });
});
