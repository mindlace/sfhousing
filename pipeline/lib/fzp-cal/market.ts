/**
 * Today's market (market-baseline spec §4.4, §4.6): the recent years' observed starts against the
 * starts the published start model implies for them, the reproduction check, the hold-out
 * diagnostic, the live errors and warnings, and the fixture's invented levels. A pure function of
 * the initiation report's per-year sums, the panel's counted starts and the enrichment file.
 */
import { log } from '../../../src/lib/timelapse/math';
import type { MarketModel, Provenance } from '../../../src/lib/timelapse/types';
import type { Prototype } from '../../../src/lib/sim/finance/prototypes';
import type { StartCohort } from '../affordable-cohort';
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
      `A start is private unless its primary Planning record proposes at least 95% affordable homes; ` +
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
