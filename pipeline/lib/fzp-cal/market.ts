/**
 * Today's market (market-baseline spec §4.4, §4.6): the recent years' observed starts against the
 * starts the published start model implies for them, the reproduction check, the hold-out
 * diagnostic, the live errors and warnings, and the fixture's invented levels. A pure function of
 * the initiation report's per-year sums, the panel's counted starts and the enrichment file.
 * `marketModel` adds the Controller cross-check, the public-money slope and the build's counts.
 */
import { log } from '../../../src/lib/timelapse/math';
import type { MarketModel, Provenance } from '../../../src/lib/timelapse/types';
import {
  PROTOTYPES,
  costPerHome,
  prototypeFor,
  uncoveredPerHome,
  type Prototype,
  type PrototypeId
} from '../../../src/lib/sim/finance/prototypes';
import { AFFORDABLE_COHORT_SHARE, type StartCohort } from '../affordable-cohort';
import type { MarketFile } from '../../enrichment/market-schema';
import type { InitiationReport } from './initiation';
import { logistic } from './irls';
import type { PanelStart } from './panel';
import { datasf } from './provenance';
import { sig6 } from './tail';
import { CalibrationError } from './types';

/** F2: the last three panel years. */
export const RECENT_YEARS = 3;
/** F2: the last five panel years (the slope weights). */
export const WEIGHT_YEARS = 5;

/** The reproduction check's tolerance: the back-cast's `BACKCAST_TOL` (tier 4). */
const REPRODUCTION_TOL = 0.02;
/** The tier 4 sanity band on `today.all`. */
const BAND: [number, number] = [log(0.1), log(2)];

/** The cohort threshold as a percentage, for the method text (one source: affordable-cohort.ts). */
const AFFORDABLE_PERCENT = `${+(AFFORDABLE_COHORT_SHARE * 100).toPrecision(12)}%`;

/** The fixture's invented counts (spec §4.4, "Fixture profile"). */
const FIXTURE = { observed: 10, private: 9, implied: 20 } as const;

export interface MarketInput {
  /** `CalProfile.fixtureInitiation` */
  fixture: boolean;
  /** `InitiationReport.impliedPerYear` */
  impliedPerYear: Record<number, number>;
  observedPerYear: Record<number, number>;
  recentCells: { exposure: number; z: number }[];
  holdOut: InitiationReport['holdOut'];
  starts: PanelStart[];
  enrichment: { file: MarketFile; path: string };
  initiationSources: { label: string; url: string }[];
  /** defaults to PROTOTYPES; injectable so the guards of spec §4.4 are testable */
  prototypes?: readonly Prototype[];
}

export interface MarketTodayResult {
  today: MarketModel['today'];
  /** one per recent year; [] in fixture */
  rows: {
    year: number;
    observed: number;
    affordable: number;
    private: number;
    implied: number;
    holdOutPredicted: number | null;
  }[];
  /** the recent years' panel starts by cohort (fixture too) */
  cohorts: Record<StartCohort, number>;
  /** X: the published model shifted by today.all over the recent cells; null in fixture */
  reproduction: number | null;
  /** null in fixture */
  holdOut: { predicted: number; logRatio: number } | { error: string } | null;
  warnings: string[];
}

/** The recent years `[L − 2, L]`, L the largest key of `impliedPerYear`, and the first year. */
function panelYears(impliedPerYear: Record<number, number>): {
  first: number;
  years: [number, number];
} {
  const keys = Object.keys(impliedPerYear).map(Number);
  if (keys.length === 0) throw new CalibrationError('market: the initiation report has no years');
  const last = Math.max(...keys);
  return { first: Math.min(...keys), years: [last - RECENT_YEARS + 1, last] };
}

function countCohorts(starts: PanelStart[]): Record<StartCohort, number> {
  const c: Record<StartCohort, number> = { affordable: 0, private: 0, noRecord: 0, unknown: 0 };
  for (const s of starts) c[s.cohort]++;
  return c;
}

const sumOver = (r: Record<number, number>, [y0, y1]: [number, number]): number => {
  let s = 0;
  for (let y = y0; y <= y1; y++) s += r[y] ?? 0;
  return s;
};

/** Today's levels, the checks, the errors and warnings (spec §4.4); the fixture's fixed levels. */
export function marketToday(x: MarketInput): MarketTodayResult {
  const { first, years } = panelYears(x.impliedPerYear);
  const [y0, y1] = years;
  const span = `${y0}-${y1}`;
  const window: [string, string] = [`${y0}-01-01`, `${y1}-12-31`];
  const recent = x.starts.filter((s) => s.year >= y0 && s.year <= y1);
  const cohorts = countCohorts(recent);

  if (x.fixture) {
    return {
      today: {
        all: sig6(log(FIXTURE.observed / FIXTURE.implied)),
        private: sig6(log(FIXTURE.private / FIXTURE.implied)),
        years,
        observed: { all: FIXTURE.observed, private: FIXTURE.private },
        implied: FIXTURE.implied,
        provenance: {
          tier: 4,
          label: `fixture: today's market in ${span}, invented counts (tier 4)`,
          sources: [datasf('planningProjects')],
          method: `The counts are invented for the fixture build, not measured: ${FIXTURE.observed} observed starts (${FIXTURE.private} private) against ${FIXTURE.implied} implied, chosen to give round factors on the odds (ln 0.5 and ln 0.45).`,
          n: FIXTURE.observed,
          window
        }
      },
      rows: [],
      cohorts,
      reproduction: null,
      holdOut: null,
      warnings: []
    };
  }

  const O = sumOver(x.observedPerYear, years);
  if (O === 0) throw new CalibrationError(`market: no starts in ${span}`);
  if (recent.length !== O) {
    throw new CalibrationError(
      `market: ${recent.length} panel starts in ${span} do not match ${O} initiation events`
    );
  }
  const A = cohorts.affordable;
  const Op = O - A;
  if (Op === 0) throw new CalibrationError(`market: no private starts in ${span}`);
  const I = sig6(sumOver(x.impliedPerYear, years));
  if (!Number.isFinite(I) || I <= 0) {
    throw new CalibrationError(`market: implied starts ${I} in ${span} are not positive`);
  }

  const all = sig6(log(O / I));
  const priv = sig6(log(Op / I));
  let X = 0;
  for (const c of x.recentCells) X += c.exposure * logistic(c.z + all);
  X = sig6(X);

  const warnings: string[] = [];
  if (all < BAND[0] || all > BAND[1]) {
    warnings.push(`market: today.all ${all} is outside [ln 0.1, ln 2]`);
  }
  if (Math.abs(X - O) > REPRODUCTION_TOL * O) {
    warnings.push(
      `market: the shifted published model predicts ${X} starts in ${span} against ${O} observed (more than 2% apart)`
    );
  }

  let holdOut: MarketTodayResult['holdOut'] = null;
  const holdOutByYear = new Map<number, number>();
  if (x.holdOut !== null && 'error' in x.holdOut) {
    holdOut = { error: x.holdOut.error };
  } else if (x.holdOut !== null) {
    const h = x.holdOut;
    for (const row of h.rows) holdOutByYear.set(row.year, row.predicted);
    holdOut =
      h.observed > 0 && h.predicted > 0
        ? { predicted: h.predicted, logRatio: log(h.observed / h.predicted) }
        : { error: `observed ${h.observed} or predicted ${h.predicted} is not positive` };
  }
  if (holdOut !== null && 'error' in holdOut) {
    warnings.push(
      `market: the hold-out refit failed: ${holdOut.error}; the report has no hold-out diagnostic`
    );
  }

  const rows: MarketTodayResult['rows'] = [];
  for (let y = y0; y <= y1; y++) {
    const observed = x.observedPerYear[y] ?? 0;
    const affordable = recent.filter((s) => s.year === y && s.cohort === 'affordable').length;
    rows.push({
      year: y,
      observed,
      affordable,
      private: observed - affordable,
      implied: sig6(x.impliedPerYear[y] ?? 0),
      holdOutPredicted: holdOutByYear.get(y) ?? null
    });
  }

  const provenance: Provenance = {
    tier: 2,
    label: `Today's market: new-project filings in ${span} against the starts the start model, fitted on ${first}-${y1}, implies for those years (tier 2)`,
    sources: x.initiationSources,
    method:
      `O = ${O} new-project filings in ${span} (every initiation event of the panel, both bases); ` +
      `A = ${A} of them are in the affordable cohort, so O_p = O − A = ${Op} private starts. ` +
      `A start is private unless its primary Planning record proposes at least ${AFFORDABLE_PERCENT} affordable homes; ` +
      `${cohorts.noRecord} starts had no Planning record and ${cohorts.unknown} no recorded counts, and count as private. ` +
      `I = ${I} starts implied for those years by the published start model (its basis 0 hazard summed over the years' lot-months). ` +
      `today.all = ln(O ÷ I) = ln(${O} ÷ ${I}) = ${all}; today.private = ln(O_p ÷ I) = ln(${Op} ÷ ${I}) = ${priv}. ` +
      `Reproduction check: the published model shifted by today.all predicts X = ${X} starts for those years against O = ${O}.`,
    n: O,
    window
  };

  return {
    today: { all, private: priv, years, observed: { all: O, private: Op }, implied: I, provenance },
    rows,
    cohorts,
    reproduction: X,
    holdOut,
    warnings
  };
}

export interface MarketReport extends Omit<MarketTodayResult, 'today'> {
  mode: 'fit' | 'fixture';
  /** the weight years `[L − 4, L]` */
  years: [number, number];
  /** one row per prototype, A to E */
  weights: {
    id: PrototypeId;
    rule: string;
    starts: number;
    weight: number;
    uncoveredPerHome: number;
    costPerHome: number;
    uncoveredShare: number;
  }[];
  /** weight-year private starts left out: homes not recorded; homes ≥ 25 and stories not recorded */
  unbinned: { homes: number; stories: number };
  /** true when the fixture has no binned start and every prototype weighs the same */
  equalWeights: boolean;
  typicalUncoveredShare: number;
  typicalCostOverValue: number;
  /** the lagged index means: recent = the recent years, reference = every panel year */
  means: { costRecent: number; costReference: number; priceRecent: number; priceReference: number };
  counts: Record<string, number>;
}

/** The weights table's rule per prototype (the bins of `prototypeFor`, F4). */
const RULES: Record<PrototypeId, string> = {
  A: 'homes ≥ 25, stories ≤ 6',
  B: 'homes ≥ 25, stories 7 to 10',
  C: 'homes ≥ 25, stories 11 to 18',
  D: 'homes ≥ 25, stories above 18',
  E: 'homes under 25'
};

const MODEL_GAP = 1;

/** The prototype a start is priced as, or why it is unbinned (spec §4.3). */
function binStart(s: PanelStart): PrototypeId | 'homes' | 'stories' {
  if (s.homes === null) return 'homes';
  if (s.homes < 25) {
    // Spec §4.3: fewer than 25 homes gives E before stories is read, so a missing stories value
    // does not matter here; prototypeFor needs a finite stories (row F4), so it is given 0.
    return prototypeFor(s.stories ?? 0, s.homes).id;
  }
  if (s.stories === null) return 'stories';
  return prototypeFor(s.stories, s.homes).id;
}

const periodText = (p: [number, number][]): string => p.map(([a, b]) => `${a}-${b}`).join(', ');

function mean(values: Record<string, number>, [y0, y1]: [number, number], path: string): number {
  let s = 0;
  for (let y = y0; y <= y1; y++) {
    const v = values[String(y)];
    if (v === undefined) throw new CalibrationError(`market: ${path}: no cost index for ${y}`);
    s += v;
  }
  return s / (y1 - y0 + 1);
}

/** The Controller cross-check's lagged means (spec §4.4), after checking the price periods. */
function controllerMeans(
  file: MarketFile,
  path: string,
  first: number,
  [y0, y1]: [number, number]
): MarketReport['means'] {
  const lag = file.lagYears.value;
  const [m0, m1] = file.priceIndex.means;
  const expected: [number, number][] = [
    [first - lag, y0 - 1 - lag],
    [y0 - lag, y1 - lag]
  ];
  const got: [number, number][] = [
    [m0.from, m0.to],
    [m1.from, m1.to]
  ];
  if (got.some(([a, b], i) => a !== expected[i][0] || b !== expected[i][1])) {
    throw new CalibrationError(
      `market: ${path}: price periods ${periodText(got)} do not match the panel years minus lagYears (${periodText(expected)})`
    );
  }
  const n0 = m0.to - m0.from + 1;
  const n1 = m1.to - m1.from + 1;
  return {
    costRecent: mean(file.costIndex.values, [y0 - lag, y1 - lag], path),
    costReference: mean(file.costIndex.values, [first - lag, y1 - lag], path),
    priceRecent: m1.mean,
    priceReference: (n0 * m0.mean + n1 * m1.mean) / (n0 + n1)
  };
}

function dedupeByUrl(sources: { label: string; url: string }[]): { label: string; url: string }[] {
  const seen = new Set<string>();
  return sources.filter((s) => !seen.has(s.url) && seen.add(s.url) !== undefined);
}

/** `calibration.market` and the report's section 11 inputs (spec §4.4, §4.6). */
export function marketModel(x: MarketInput): { market: MarketModel; report: MarketReport } {
  const { today, ...rest } = marketToday(x);
  const fixture = x.fixture;
  const { file, path } = x.enrichment;
  const { first } = panelYears(x.impliedPerYear);
  const [y0, y1] = today.years;
  const L = y1;
  const years: [number, number] = [L - WEIGHT_YEARS + 1, L];
  const weightSpan = `${years[0]}-${years[1]}`;
  const ref = `${first}-${y1}`;

  // The Controller cross-check.
  const means = controllerMeans(file, path, first, today.years);
  const bc = file.coefficients.cost.value;
  const bp = file.coefficients.price.value;
  const logOdds = sig6(
    bc * (means.costRecent - means.costReference) + bp * (means.priceRecent - means.priceReference)
  );
  const lag = file.lagYears.value;
  const controller = [{ label: file.source.label, url: file.source.url }];
  const [m0, m1] = file.priceIndex.means;
  const n0 = m0.to - m0.from + 1;
  const n1 = m1.to - m1.from + 1;
  const crossCheckMethod =
    `logOdds = β_c × (C̄_H − C̄_R) + β_p × (P̄_H − P̄_R), with β_c = ${bc} (${file.coefficients.cost.variable}) and β_p = ${bp} (${file.coefficients.price.variable}), ${file.coefficients.cost.locator}. ` +
    `The indices are lagged ${lag} years, as the Controller's model uses them (${file.lagYears.locator}): ` +
    `H is index years ${y0 - lag}-${y1 - lag} (panel years ${y0}-${y1}) and R index years ${first - lag}-${y1 - lag} (panel years ${ref}). ` +
    `C̄_H = ${sig6(means.costRecent)} and C̄_R = ${sig6(means.costReference)}, means of the cost index (${file.costIndex.locator}); ` +
    `P̄_H = ${sig6(means.priceRecent)}, the ${m1.from}-${m1.to} mean, and P̄_R = (${n0} × ${m0.mean} + ${n1} × ${m1.mean}) ÷ ${n0 + n1} = ${sig6(means.priceReference)}, the year-weighted mean of the two period means (${file.priceIndex.locator}). ` +
    `logOdds = ${bc} × (${sig6(means.costRecent)} − ${sig6(means.costReference)}) + ${bp} × (${sig6(means.priceRecent)} − ${sig6(means.priceReference)}) = ${logOdds}. ` +
    `The index values are chart-read, approximate. ` +
    `Reported, never applied: the Controller's model is annual, on a lot producing housing; ours is monthly, on a project's first filing; the two shifts are comparable only as odds ratios.`;
  const crossCheck: MarketModel['crossCheck'] = {
    logOdds,
    provenance: fixture
      ? {
          tier: 4,
          label:
            "fixture: the Controller's development model on its cost and price indices (tier 4 in the fixture build, a cross-check; not used)",
          sources: controller,
          method: crossCheckMethod
        }
      : {
          tier: 3,
          label:
            "The Controller's development model on its cost and price indices (tier 3, a cross-check; not used)",
          sources: controller,
          method: crossCheckMethod
        }
  };

  // The weights.
  const prototypes = [...(x.prototypes ?? PROTOTYPES)].sort((a, b) => (a.id < b.id ? -1 : 1));
  const binned: Record<PrototypeId, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  const unbinned = { homes: 0, stories: 0 };
  for (const s of x.starts) {
    if (s.year < years[0] || s.year > years[1] || s.cohort === 'affordable') continue;
    const b = binStart(s);
    if (b === 'homes' || b === 'stories') unbinned[b]++;
    else binned[b]++;
  }
  const nBinned = binned.A + binned.B + binned.C + binned.D + binned.E;
  if (nBinned === 0 && !fixture) {
    throw new CalibrationError(`market: no private start in ${weightSpan} has a prototype`);
  }
  const equalWeights = nBinned === 0;
  for (const p of prototypes) {
    if (p.costPerHome <= p.shortfallPerHome) {
      throw new CalibrationError(`market: prototype ${p.id} has no positive value per home`);
    }
  }
  const weights: MarketReport['weights'] = prototypes.map((p) => {
    const u = uncoveredPerHome('market', p);
    const c = costPerHome('market', p);
    return {
      id: p.id,
      rule: RULES[p.id],
      starts: binned[p.id],
      weight: equalWeights ? 1 / prototypes.length : binned[p.id] / nBinned,
      uncoveredPerHome: u,
      costPerHome: c,
      uncoveredShare: u / c
    };
  });
  let typicalUncoveredShare = 0;
  let typicalCostOverValue = 0;
  prototypes.forEach((p, i) => {
    typicalUncoveredShare += weights[i].weight * weights[i].uncoveredShare;
    typicalCostOverValue +=
      (weights[i].weight * p.costPerHome) / (p.costPerHome - p.shortfallPerHome);
  });
  if (!(typicalUncoveredShare > 0)) {
    throw new CalibrationError(
      `market: typicalUncoveredShare ${typicalUncoveredShare} is not positive`
    );
  }

  // The slope and its cross-checks.
  const perCostShare = sig6(-today.private / typicalUncoveredShare);
  const costCoefficient = sig6(-bc * means.costRecent);
  const priceCoefficient = sig6(bp * means.priceRecent * typicalCostOverValue);
  const weightWindow: [string, string] = [`${years[0]}-01-01`, `${years[1]}-12-31`];
  const slopeSources = dedupeByUrl([
    ...x.initiationSources,
    ...prototypes.flatMap((p) => p.provenance.sources)
  ]);
  const weightText = weights
    .map(
      (w) =>
        `${w.id} (${w.rule}) ${w.starts} starts, weight ${sig6(w.weight)}, uncovered ${w.uncoveredPerHome} ÷ cost ${w.costPerHome} = ${sig6(w.uncoveredShare)}`
    )
    .join('; ');
  const slopeMethod =
    `perCostShare = −today.private ÷ typicalUncoveredShare: closing a typical private project's whole uncovered cost (shortfall plus land) returns its odds to the ${ref} average. ` +
    (equalWeights
      ? `The fixture panel has no binned private start in ${weightSpan}, so every prototype weighs ${sig6(1 / prototypes.length)} (tier 4). `
      : `Weights are the shares of the ${nBinned} binned private starts of ${weightSpan} (affordable-cohort starts left out) in each prototype. `) +
    `Per prototype: ${weightText}. ` +
    `Left out: ${unbinned.homes} start${unbinned.homes === 1 ? '' : 's'} with homes not recorded and ${unbinned.stories} of 25 homes or more with stories not recorded. ` +
    `typicalUncoveredShare = Σ w_p × uncoveredPerHome ÷ costPerHome = ${sig6(typicalUncoveredShare)}; ` +
    `perCostShare = −(${today.private}) ÷ ${sig6(typicalUncoveredShare)} = ${perCostShare}.`;
  const crossChecksMethod =
    `The same quantity, a log-odds shift per 100% of construction cost, from each of the Controller's coefficients; reported, never applied. ` +
    `costCoefficient = −β_c × C̄_H = ${-bc} × ${sig6(means.costRecent)} = ${costCoefficient}: a grant paying share s of construction cost is read as a proportional cut of s in the cost index, s × C̄_H index points. ` +
    `priceCoefficient = β_p × P̄_H × typicalCostOverValue = ${bp} × ${sig6(means.priceRecent)} × ${sig6(typicalCostOverValue)} = ${priceCoefficient}: a grant of g a home is read as a price rise of g on a building worth costPerHome − shortfallPerHome a home (residual land value = value − cost), with typicalCostOverValue = Σ w_p × costPerHome ÷ (costPerHome − shortfallPerHome) over the slope's weights. ` +
    `The index means are chart-read, approximate.`;
  const slope: MarketModel['slope'] = {
    perCostShare,
    provenance: fixture
      ? {
          tier: 4,
          label:
            "fixture: odds shift for public money, from the fixture's invented private level (tier 4)",
          sources: slopeSources,
          method: slopeMethod,
          n: nBinned,
          window: weightWindow
        }
      : {
          tier: 2,
          label: `Odds shift for public money: closing a typical private project's uncovered cost returns its odds to the ${ref} average (tier 2)`,
          sources: slopeSources,
          method: slopeMethod,
          n: nBinned,
          window: weightWindow
        },
    crossChecks: {
      costCoefficient,
      priceCoefficient,
      provenance: fixture
        ? {
            tier: 4,
            label:
              "fixture: the public-money slope from the Controller's cost and price coefficients (tier 4 in the fixture build, cross-checks; not used)",
            sources: controller,
            method: crossChecksMethod
          }
        : {
            tier: 3,
            label:
              "The public-money slope from the Controller's cost and price coefficients (tier 3, cross-checks; not used)",
            sources: controller,
            method: crossChecksMethod
          }
    }
  };

  const warnings = [...rest.warnings];
  if (!fixture && Math.abs(today.all - logOdds) > MODEL_GAP) {
    warnings.push(
      `market: today.all ${today.all} differs from the Controller cross-check ${logOdds} by more than 1`
    );
  }

  const c = rest.cohorts;
  const recent = c.affordable + c.private + c.noRecord + c.unknown;
  const counts: Record<string, number> = {
    'calibration.market.recentStarts': recent,
    'calibration.market.recentPrivate': recent - c.affordable,
    'calibration.market.recentAffordable': c.affordable,
    'calibration.market.recentNoRecord': c.noRecord,
    'calibration.market.recentUnknown': c.unknown,
    'calibration.market.weightStarts': nBinned,
    'calibration.market.unbinnedHomes': unbinned.homes,
    'calibration.market.unbinnedStories': unbinned.stories
  };

  return {
    market: { today, crossCheck, slope },
    report: {
      ...rest,
      warnings,
      mode: fixture ? 'fixture' : 'fit',
      years,
      weights,
      unbinned,
      equalWeights,
      typicalUncoveredShare,
      typicalCostOverValue,
      means,
      counts
    }
  };
}
