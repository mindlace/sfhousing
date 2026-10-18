/**
 * The initiation model (T4a; stage-calibration spec §4.6): bin merging, the ridge-IRLS logit with
 * the measurement-basis nuisance term, the back-cast and its V28 gate, the hold-out, the FZP
 * application's expected filings and extrapolation share, and the fixture fallback. A pure
 * function of the aggregated panel (`aggregatePanel`) and the FZP application.
 */
import { log } from '../../../src/lib/timelapse/math';
import { initiationHazard } from '../../../src/lib/timelapse/model';
import type { FeatureId, InitiationModel, Provenance } from '../../../src/lib/timelapse/types';
import { compareCells, fitLogit, linearPredictor, logistic, type LogitFit } from './irls';
import { PANEL_FEATURES, type FitCell, type PanelResult } from './panel';
import { datasf } from './provenance';
import { sig6 } from './tail';
import { CalibrationError, type CalProfile } from './types';

/** Initial bin edges (spec §4.6 "Bins"; tier 4 binning choice). */
export const INITIAL_EDGES: Record<FeatureId, number[]> = {
  potentialRatio: [0, 1, 1.5, 2, 3, 5, 10, 20],
  existingUnits: [0, 1, 2, 3, 5, 10, 20, 50],
  lotAreaM2: [0, 150, 250, 400, 800, 2000, 5000],
  yearBuilt: [0, 1800, 1906, 1930, 1950, 1979, 2000],
  storiesGap: [-100, 0, 1, 2, 3, 5, 10],
  improvementShare: [0, 0.1, 0.25, 0.4, 0.55, 0.7, 0.85],
  rentControlLikely: [0, 1],
  landUseClass: [0, 1, 2, 3, 4, 5]
};

/** The design's term order: the §4.6 feature table, the same order as `FitCell.bins`. */
export const TERM_ORDER: FeatureId[] = [
  'potentialRatio',
  'existingUnits',
  'lotAreaM2',
  'yearBuilt',
  'storiesGap',
  'improvementShare',
  'rentControlLikely',
  'landUseClass'
];

/** Features that never merge: a binary flag and a category index. */
const CATEGORICAL: ReadonlySet<FeatureId> = new Set(['rentControlLikely', 'landUseClass']);

const FIRST_YEAR = 2007;
const LAST_YEAR = 2025;
/** Panel years 2007..2025: the divisor of the historical mean. */
const PANEL_YEARS = LAST_YEAR - FIRST_YEAR + 1;
/** The hold-out fit uses cells through this year and predicts the years after it. */
const HOLD_OUT_LAST_FIT = 2022;
/** V28: predicted within 2% of observed, per basis. */
const BACKCAST_TOL = 0.02;
/** Tier-4 sanity band on FZP expected filings ÷ the historical mean. */
export const FZP_BAND: [number, number] = [0.5, 20];
const FIXTURE_HAZARD = 0.05;
const FIXTURE_LABEL = 'fixture: high hazard so simulated starts appear within the e2e horizon';

/** The FZP application of the published model (Task 16 builds it from T11's `featureValue`). */
export interface FzpApplication {
  features(i: number): Record<FeatureId, number>;
  /** indices of hostable parcels with no in-flight project */
  hostable: number[];
}

export interface InitiationBinReport {
  /** the merged bin's lower edge */
  lo: number;
  exposure: number;
  events: number;
  /** Σ fitted hazard (each cell's own basis) × exposure */
  predicted: number;
  /** published coefficient; null in fixture mode (no fit) */
  coef: number | null;
}

export interface InitiationTermReport {
  feature: FeatureId;
  categorical: boolean;
  initialEdges: number[];
  /** the merged (published) edges */
  edges: number[];
  /** initial bin → merged bin */
  map: number[];
  bins: InitiationBinReport[];
}

export interface BackcastRow {
  year: number;
  basis: 0 | 1;
  exposure: number;
  observed: number;
  predicted: number;
}

export interface HoldOutReport {
  fitThrough: number;
  rows: { year: number; observed: number; predicted: number }[];
  observed: number;
  predicted: number;
}

export interface InitiationReport {
  mode: 'fit' | 'fixture';
  events: { record: number; permit: number; total: number };
  exposureMonths: number;
  parcelYears: number;
  /** parcel-years left out (no row, or hostable_base false), in total and per roll year */
  parcelYearsExcluded: number;
  parcelYearsExcludedByYear: Record<number, number>;
  eventsOffPanel: number;
  eventsCovered: number;
  minBinEvents: number;
  ridgeLambda: number;
  terms: InitiationTermReport[];
  /** the published intercept */
  intercept: number;
  /** the measurement-basis coefficient (6 significant digits), never shipped; null in fixture mode */
  basis: number | null;
  iterations: number | null;
  /** with each cell's own basis: per year and basis (cells with exposure), and per basis */
  backcast: {
    byYear: BackcastRow[];
    byBasis: { basis: 0 | 1; observed: number; predicted: number }[];
  };
  /** null in fixture mode; `error` when the 2007–2022 refit fails (report only) */
  holdOut: HoldOutReport | { error: string } | null;
  /** Σ published hazard (basis 0) × exposure per year, 2007..2025 */
  impliedPerYear: Record<number, number>;
  /**
   * 12 · Σ published hazard over the last panel year's mean monthly at-risk set (its exposure ÷ 12;
   * the panel aggregates do not keep December alone): the annual rate at the end of the pre-FZP era
   */
  impliedSteadyState: number;
  observedPerYear: Record<number, number>;
  /** FZP expected filings per year: 12 · Σ published hazard over the hostable, unoccupied parcels */
  fzpPerYear: number;
  /** fzpPerYear ÷ impliedSteadyState; null when the latter is 0 */
  fzpRatio: number | null;
  hostable: number;
  /** observed events ÷ 19 */
  historicalMean: number;
  /** fzpPerYear ÷ historicalMean; null when the latter is 0 */
  fzpVsHistorical: number | null;
  /** fzpVsHistorical outside FZP_BAND (or undefined) */
  fzpWarning: boolean;
  extrapolation: {
    maxAtRisk: { potentialRatio: number; storiesGap: number };
    parcels: number;
    parcelShare: number;
    filingsShare: number;
  };
  /** per imputed bit 0..6: share of at-risk exposure / of event months with the bit set */
  mask: { exposureShare: number[]; eventShare: number[]; anyExposure: number; anyEvents: number };
  /** every term by its published coefficient range (max − min), descending */
  topEffects: { feature: FeatureId; range: number }[];
}

/**
 * Merges thin bins of a numeric feature (spec §4.6): the highest bin with fewer than `minEvents`
 * events merges into the bin below, repeatedly, until no bin above the bottom one is thin; then a
 * thin bottom bin merges into the bin above, repeatedly. A categorical feature is returned
 * unchanged. Merging bin i into i − 1 drops edge i; merging the bottom bin up drops the edge
 * above it.
 */
export function mergeBins(
  edges: number[],
  eventsPerBin: number[],
  minEvents: number,
  categorical: boolean
): { edges: number[]; map: number[] } {
  if (eventsPerBin.length !== edges.length) {
    throw new CalibrationError('mergeBins: one event count per bin expected');
  }
  if (categorical) return { edges: [...edges], map: edges.map((_, i) => i) };
  // groups[g] = the initial bins it holds, ascending
  const groups = edges.map((_, i) => [i]);
  const ev = [...eventsPerBin];
  for (;;) {
    let g = -1;
    for (let i = groups.length - 1; i >= 1; i--) {
      if (ev[i] < minEvents) {
        g = i;
        break;
      }
    }
    if (g < 0) break;
    groups[g - 1].push(...groups[g]);
    ev[g - 1] += ev[g];
    groups.splice(g, 1);
    ev.splice(g, 1);
  }
  while (groups.length > 1 && ev[0] < minEvents) {
    groups[1].unshift(...groups[0]);
    ev[1] += ev[0];
    groups.shift();
    ev.shift();
  }
  const map = new Array<number>(edges.length);
  groups.forEach((members, g) => members.forEach((i) => (map[i] = g)));
  return { edges: groups.map((members) => edges[members[0]]), map };
}

/** A merged cell with its roll year. */
interface YearCell {
  year: number;
  cell: FitCell;
}

function compareYearCells(a: YearCell, b: YearCell): number {
  return a.year - b.year || compareCells(a.cell, b.cell);
}

/** Sums `cells` into one cell per (bins, basis), sorted. */
function collapse(cells: YearCell[]): FitCell[] {
  const by = new Map<string, FitCell>();
  for (const { cell } of cells) {
    const key = `${cell.bins.join(',')}|${cell.basis}`;
    const c = by.get(key);
    if (c) {
      c.exposure += cell.exposure;
      c.events += cell.events;
    } else {
      by.set(key, { ...cell, bins: [...cell.bins] });
    }
  }
  return [...by.values()].sort(compareCells);
}

/** The panel's cells with years, in (year, bins, basis) order. */
function panelCells(panel: PanelResult): YearCell[] {
  const out: YearCell[] = [];
  for (const [key, cell] of panel.cells) {
    const year = Number(key.slice(0, key.indexOf('|')));
    if (!Number.isInteger(year))
      throw new CalibrationError(`panel cell key without a year: ${key}`);
    if (cell.bins.length !== TERM_ORDER.length) {
      throw new CalibrationError(`panel cell has ${cell.bins.length} bins: ${key}`);
    }
    out.push({ year, cell });
  }
  return out.sort(compareYearCells);
}

const share = (a: number, b: number): number => (b > 0 ? a / b : 0);
const pct = (x: number): string => `${(100 * x).toFixed(2)}%`;
/** A number in shipped provenance: 6 significant digits, non-finite "none" (never Infinity/NaN). */
const fin = (x: number | null): string =>
  x !== null && Number.isFinite(x) ? String(Number(x.toPrecision(6))) : 'none';

/** Hazard of a merged bin tuple under the published model (basis 0). */
function publishedHazard(model: InitiationModel, bins: number[]): number {
  let z = model.intercept;
  for (let t = 0; t < model.terms.length; t++) z += model.terms[t].coef[bins[t]];
  return logistic(z);
}

/** What the fitted provenance's `method` names besides the panel (spec §4.10). */
export interface InitiationContext {
  /** `calibration.method.permitOnlyPre2015` (§4.4 step 4) */
  permitOnlyPre2015: { fired: number; of: number };
}

/**
 * Fits the initiation model (spec §4.6) or, with `cal.fixtureInitiation`, returns the fixed
 * fixture model; either way the report is computed from the panel. Live: fewer than
 * `initMinEvents` panel events is a `CalibrationError`; with `cal.backcastGate`, so is a detection
 * basis with no exposure or no events (V28 needs both).
 */
export function fitInitiation(
  panel: PanelResult,
  cal: CalProfile,
  fzp: FzpApplication,
  ctx: InitiationContext
): { model: InitiationModel; report: InitiationReport } {
  for (let t = 0; t < TERM_ORDER.length; t++) {
    if (TERM_ORDER[t] !== PANEL_FEATURES[t]) {
      throw new CalibrationError('TERM_ORDER differs from the panel feature order');
    }
  }
  const total = panel.events.record + panel.events.permit;
  const fixture = cal.fixtureInitiation;
  if (!fixture && cal.initMinEvents !== null && total < cal.initMinEvents) {
    throw new CalibrationError(
      `initiation: ${total} panel events, fewer than INIT_MIN_EVENTS = ${cal.initMinEvents}`
    );
  }

  // 1. Raw-bin event totals over all years and bases, then the merged bins.
  const raw = panelCells(panel);
  const merges = TERM_ORDER.map((f, t) => {
    const ev = INITIAL_EDGES[f].map(() => 0);
    for (const { cell } of raw) {
      const b = cell.bins[t];
      if (!Number.isInteger(b) || b < 0 || b >= ev.length) {
        throw new CalibrationError(`panel bin ${b} out of range for ${f}`);
      }
      ev[b] += cell.events;
    }
    return mergeBins(INITIAL_EDGES[f], ev, cal.minBinEvents, CATEGORICAL.has(f));
  });
  const nBins = merges.map((m) => m.edges.length);

  // 2. Raw cells into merged cells, per year.
  const byYear = new Map<string, YearCell>();
  for (const { year, cell } of raw) {
    const bins = cell.bins.map((b, t) => merges[t].map[b]);
    const key = `${year}|${bins.join(',')}|${cell.basis}`;
    const c = byYear.get(key);
    if (c) {
      c.cell.exposure += cell.exposure;
      c.cell.events += cell.events;
    } else {
      byYear.set(key, {
        year,
        cell: { bins, basis: cell.basis, exposure: cell.exposure, events: cell.events }
      });
    }
  }
  const cells = [...byYear.values()].sort(compareYearCells);
  if (cal.backcastGate) {
    const exposure = [0, 0];
    const events = [0, 0];
    for (const { cell } of cells) {
      exposure[cell.basis] += cell.exposure;
      events[cell.basis] += cell.events;
    }
    if (!(exposure[0] > 0 && exposure[1] > 0 && events[0] > 0 && events[1] > 0)) {
      throw new CalibrationError('initiation: one detection basis has no data');
    }
  }

  // 3. The fit (live) or the fixed model (fixture).
  let fit: LogitFit | null = null;
  let model: InitiationModel;
  if (fixture) {
    model = {
      kind: 'logit-monthly',
      intercept: sig6(log(FIXTURE_HAZARD / (1 - FIXTURE_HAZARD))),
      terms: [],
      provenance: {
        tier: 4,
        label: FIXTURE_LABEL,
        sources: [datasf('planningProjects')],
        method: `fixture build (FIXTURE_CAL): a fixed monthly hazard of ${FIXTURE_HAZARD} for every hostable parcel, intercept = logit(${FIXTURE_HAZARD}), no terms; not fitted (tier 4, made up)`
      }
    };
  } else {
    const f = fitLogit(collapse(cells), nBins, cal.ridgeLambda);
    fit = f;
    model = {
      kind: 'logit-monthly',
      intercept: sig6(f.intercept),
      terms: TERM_ORDER.map((feature, t) => ({
        feature,
        bins: [...merges[t].edges],
        coef: f.coef[t].map(sig6)
      })),
      // set below from the report (basis coefficient, extrapolation share)
      provenance: { tier: 2, label: '', sources: [], method: '' }
    };
  }

  // A merged cell's hazard: published (basis 0), and fitted (the fit with the cell's own basis;
  // the fixed model in fixture mode).
  const pub = (c: FitCell): number => publishedHazard(model, c.bins);
  const fitted = (c: FitCell): number =>
    fit ? logistic(linearPredictor(fit, c.bins, c.basis)) : pub(c);

  // 4. Back-cast, per-bin observed/predicted and implied per-year totals.
  const binRep = merges.map((m) => m.edges.map(() => ({ exposure: 0, events: 0, predicted: 0 })));
  const byBasis = [
    { basis: 0 as const, observed: 0, predicted: 0 },
    { basis: 1 as const, observed: 0, predicted: 0 }
  ];
  const yearRows = new Map<string, BackcastRow>();
  const impliedPerYear: Record<number, number> = {};
  const observedPerYear: Record<number, number> = {};
  for (let y = FIRST_YEAR; y <= LAST_YEAR; y++) {
    impliedPerYear[y] = 0;
    observedPerYear[y] = 0;
  }
  for (const { year, cell } of cells) {
    const pred = cell.exposure * fitted(cell);
    for (let t = 0; t < TERM_ORDER.length; t++) {
      const b = binRep[t][cell.bins[t]];
      b.exposure += cell.exposure;
      b.events += cell.events;
      b.predicted += pred;
    }
    byBasis[cell.basis].observed += cell.events;
    byBasis[cell.basis].predicted += pred;
    const rk = `${year}|${cell.basis}`;
    let row = yearRows.get(rk);
    if (!row) {
      row = { year, basis: cell.basis, exposure: 0, observed: 0, predicted: 0 };
      yearRows.set(rk, row);
    }
    row.exposure += cell.exposure;
    row.observed += cell.events;
    row.predicted += pred;
    if (year in impliedPerYear) {
      impliedPerYear[year] += cell.exposure * pub(cell);
      observedPerYear[year] += cell.events;
    }
  }
  const backcastRows = [...yearRows.values()].sort((a, b) => a.year - b.year || a.basis - b.basis);
  const lastYear = panel.years.length > 0 ? Math.max(...panel.years) : null;
  const impliedSteadyState =
    lastYear !== null && lastYear in impliedPerYear ? impliedPerYear[lastYear] : 0;

  // 5. Hold-out: refit on 2007–2022, predict 2023–2025 (report only).
  let holdOut: InitiationReport['holdOut'] = null;
  if (!fixture) {
    try {
      const hf = fitLogit(
        collapse(cells.filter((c) => c.year <= HOLD_OUT_LAST_FIT)),
        nBins,
        cal.ridgeLambda
      );
      const rows: HoldOutReport['rows'] = [];
      for (let y = HOLD_OUT_LAST_FIT + 1; y <= LAST_YEAR; y++) {
        rows.push({ year: y, observed: 0, predicted: 0 });
      }
      for (const { year, cell } of cells) {
        if (year <= HOLD_OUT_LAST_FIT || year > LAST_YEAR) continue;
        const r = rows[year - HOLD_OUT_LAST_FIT - 1];
        r.observed += cell.events;
        r.predicted += cell.exposure * logistic(linearPredictor(hf, cell.bins, cell.basis));
      }
      let observed = 0;
      let predicted = 0;
      for (const r of rows) {
        observed += r.observed;
        predicted += r.predicted;
      }
      holdOut = { fitThrough: HOLD_OUT_LAST_FIT, rows, observed, predicted };
    } catch (e) {
      if (!(e instanceof CalibrationError)) throw e;
      holdOut = { error: e.message };
    }
  }

  // 6. The FZP application: expected filings and the extrapolation share.
  const hostable = [...fzp.hostable].sort((a, b) => a - b);
  let fzpSum = 0;
  let beyondSum = 0;
  let beyond = 0;
  const max = panel.maxAtRisk;
  for (const i of hostable) {
    const f = fzp.features(i);
    const h = initiationHazard(model, f);
    fzpSum += h;
    if (f.potentialRatio > max.potentialRatio || f.storiesGap > max.storiesGap) {
      beyond++;
      beyondSum += h;
    }
  }
  const fzpPerYear = 12 * fzpSum;
  const historicalMean = total / PANEL_YEARS;
  const fzpVsHistorical = historicalMean > 0 ? fzpPerYear / historicalMean : null;
  const extrapolation = {
    maxAtRisk: { potentialRatio: max.potentialRatio, storiesGap: max.storiesGap },
    parcels: beyond,
    parcelShare: share(beyond, hostable.length),
    filingsShare: share(beyondSum, fzpSum)
  };

  // 7. Report assembly.
  const terms: InitiationTermReport[] = TERM_ORDER.map((feature, t) => ({
    feature,
    categorical: CATEGORICAL.has(feature),
    initialEdges: [...INITIAL_EDGES[feature]],
    edges: [...merges[t].edges],
    map: [...merges[t].map],
    bins: merges[t].edges.map((lo, b) => ({
      lo,
      ...binRep[t][b],
      coef: fixture ? null : model.terms[t].coef[b]
    }))
  }));
  const topEffects = model.terms
    .map((term) => ({
      feature: term.feature,
      range: Math.max(...term.coef) - Math.min(...term.coef)
    }))
    .sort((a, b) => b.range - a.range);
  const basis = fit ? sig6(fit.basis) : null;
  const report: InitiationReport = {
    mode: fixture ? 'fixture' : 'fit',
    events: { record: panel.events.record, permit: panel.events.permit, total },
    exposureMonths: panel.exposureMonths,
    parcelYears: panel.parcelYears,
    parcelYearsExcluded: panel.parcelYearsExcluded,
    parcelYearsExcludedByYear: { ...panel.parcelYearsExcludedByYear },
    eventsOffPanel: panel.eventsOffPanel,
    eventsCovered: panel.eventsCovered,
    minBinEvents: cal.minBinEvents,
    ridgeLambda: cal.ridgeLambda,
    terms,
    intercept: model.intercept,
    basis,
    iterations: fit ? fit.iterations : null,
    backcast: { byYear: backcastRows, byBasis },
    holdOut,
    impliedPerYear,
    impliedSteadyState,
    observedPerYear,
    fzpPerYear,
    fzpRatio: impliedSteadyState > 0 ? fzpPerYear / impliedSteadyState : null,
    hostable: hostable.length,
    historicalMean,
    fzpVsHistorical,
    fzpWarning:
      fzpVsHistorical === null || fzpVsHistorical < FZP_BAND[0] || fzpVsHistorical > FZP_BAND[1],
    extrapolation,
    mask: {
      exposureShare: panel.mask.exposure.map((x) => share(x, panel.exposureMonths)),
      eventShare: panel.mask.events.map((x) => share(x, total)),
      anyExposure: share(panel.mask.anyExposure, panel.exposureMonths),
      anyEvents: share(panel.mask.anyEvents, total)
    },
    topEffects
  };
  if (fit) model.provenance = fittedProvenance(report, total, cal, ctx);
  return { model, report };
}

/** The fitted model's provenance (spec §4.6, §4.10): tier 2 over 2007–2025. */
function fittedProvenance(
  r: InitiationReport,
  n: number,
  cal: CalProfile,
  ctx: InitiationContext
): Provenance {
  const x = r.extrapolation;
  const pre2015 = `; permit-only histories before 2015 count as pathway unknown: n = ${ctx.permitOnlyPre2015.fired} of ${ctx.permitOnlyPre2015.of} (calibration.method.permitOnlyPre2015); the initiation event does not depend on the pathway`;
  return {
    tier: 2,
    label:
      'New-project filing hazard: SF Planning records (2015 on) and new-construction permit filings (2007–2014) on the assessor-roll parcel panel (tier 2)',
    sources: [
      datasf('planningProjects'),
      datasf('planningRecords'),
      datasf('permits'),
      datasf('assessorRoll')
    ],
    method:
      `discrete-time hazard: binomial logit on hostable parcel-months 2007-01 to 2025-12 (one trial per parcel-month), ridge IRLS with RIDGE_LAMBDA = ${cal.ridgeLambda} (tier 4) on the bin coefficients, bins merged to at least MIN_BIN_EVENTS = ${cal.minBinEvents} (tier 4) events (binning tier 4); ` +
      `events ${r.events.record} by first Planning record (2015 on, tier 0 dates) and ${r.events.permit} by first permit filing (before 2015); ` +
      `pre-2015 events detected by first new-construction permit filing (tier 2 proxy); a measurement-definition term (permit-filing proxy vs first Planning record) is fitted and not shipped, so the published level is set by 2015+ first-record events; this is not a market adjustment; basis coefficient = ${fin(r.basis)}; ` +
      'the event is a tier 2 proxy for project initiation (it misses projects that died before filing and dates the rest later); the panel base heights are the tier-3 pre-FZP heights proxy; ' +
      `FZP values above the top bin edge take the top bin (clamp): ${pct(x.parcelShare)} of hostable parcels and ${pct(x.filingsShare)} of FZP expected filings have potentialRatio or storiesGap above the panel's at-risk maximum (${fin(x.maxAtRisk.potentialRatio)}, ${fin(x.maxAtRisk.storiesGap)}), tier 2, applied beyond historical support (top-bin clamp)${pre2015}`,
    n,
    window: ['2007-01-01', '2025-12-31']
  };
}

/** V28: per detection basis, |predicted − observed| ≤ 2% of observed. */
export function backcastGate(r: InitiationReport): { ok: boolean; detail: string } {
  const parts: string[] = [];
  let ok = true;
  for (const b of r.backcast.byBasis) {
    const name = b.basis === 1 ? 'permit' : 'record';
    const pass = Math.abs(b.predicted - b.observed) <= BACKCAST_TOL * b.observed;
    if (!pass) ok = false;
    parts.push(
      `${name}: predicted ${b.predicted.toFixed(2)} vs observed ${b.observed} (${pass ? 'ok' : 'outside 2%'})`
    );
  }
  return { ok, detail: parts.join('; ') };
}
