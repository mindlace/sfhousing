/**
 * What the DBI and Planning records say about the buildings developers choose (building-choice
 * spec, Acceptance and the parameter table): the targets the record check holds the world engine
 * to, and the permit-valuation ratio that prices Type I above the top anchor. Pure functions over
 * the histories, `permits.parquet` rows and parcels; `record-targets.json` is written to the
 * build's derived cache and never uploaded.
 */
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { MONTH_DAYS } from '../../src/lib/timelapse/time';
import type { Day, ProjectHistory, Provenance } from '../../src/lib/timelapse/types';
import { isoOf } from '../project-records/parse';
import { isoToDay, median } from '../project-records/multiphase';
import { startCohort } from './affordable-cohort';
import { HEIGHT_BANDS, bandIndex, completedByBand, storiedById } from './fzp-cal/height-time';
import { datasf } from './fzp-cal/provenance';
import { buildSpells, normalise, qualifies } from './fzp-cal/spells';
import type { NormHistory, PermitRow } from './fzp-cal/types';
import { PLANNING_START } from './fzp-cal/window';

/** The derived-cache file the record check reads (never uploaded). */
export const RECORD_TARGETS_JSON = 'record-targets.json';
/** A check bucket needs this many records; below it the target is reported only. */
export const CHECK_MIN_N = 30;
/** Limit buckets of built height ÷ limit, on base stories at filing; 999 is any. */
export const LIMIT_BUCKETS = [4, 6, 8, 12, 999] as const;
/** Share at or above this fraction of the limit counts as built to the limit. */
export const NEAR_LIMIT = 0.9;
/** Built height ÷ limit: the mean is held within this, whatever its SE. */
export const MEAN_RATIO_TOL = 0.1;
/** Code limits on stories by type: no record check allows a simulated start above them. */
export const TYPE_MAX_STORIES = { V: 6, III: 8 } as const;
/** Large lots: at least this lot area, with a limit of at least this many stories. */
export const LARGE_LOT_M2 = 1500;
export const LARGE_LOT_LIMIT = 13;
/** Homes per new project: projects of at least this many homes. */
export const PROJECT_MIN_HOMES = 10;

export type ParcelsForRecords = Pick<ScenarioParcels, 'lotAreaM2' | 'baseStories'> & {
  index: ReadonlyMap<string, number>;
};

/** One record statistic: `checked` is false (report only) when n < CHECK_MIN_N. */
export interface Target {
  stat: number;
  n: number;
  se: number;
  tol: number;
  checked: boolean;
}
export type BandTarget = Target & { upTo: number };
export interface CohortMean {
  mean: number;
  n: number;
  se: number;
}

export interface RecordTargets {
  schema: 1;
  asOf: Day;
  /** The latest ten record years, not before PLANNING_START (ISO days, inclusive). */
  window: [string, string];
  /** Built height ÷ limit by limit bucket: the mean, and the share at or above NEAR_LIMIT. */
  heightRatio: { upTo: number; mean: Target; nearLimit: Target; overLimit: number }[];
  constructionType: {
    /** Issued permits by height band and DBI type; II and IV are `other`. */
    byBand: { upTo: number; n: number; V: number; III: number; I: number; other: number }[];
    maxStories: typeof TYPE_MAX_STORIES;
    /** Records above the code limits (the check itself is exact on the simulation). */
    recordsOver: { V: number; III: number };
    typeIShare8to12: Target;
  };
  /** Median months of completed spells by height band (ruling F8: the model's own stages). */
  stageMonths: { permitIssued: BandTarget[]; construction: BandTarget[] };
  /** Median homes of permits for PROJECT_MIN_HOMES or more, by height band. */
  homesPerProject: BandTarget[];
  /** Large lots with a high limit: the share built as Type I at 13 or more stories. */
  largeLotTypeI: Target;
  /** Built height ÷ limit by start cohort; `diff` is affordable − private, `se` its SE. */
  cohort: { affordable: CohortMean; private: CohortMean; diff: number; se: number };
}

/** Linear-interpolation quantile (R type 7) of sorted values; NaN when empty. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

const checked = (n: number) => n >= CHECK_MIN_N;

/** A share k of n with its binomial SE √(p(1−p)/n); tolerance 2 SE. */
export function binomialTarget(k: number, n: number): Target {
  if (n === 0) return { stat: 0, n: 0, se: 0, tol: 0, checked: false };
  const p = k / n;
  const se = Math.sqrt((p * (1 - p)) / n);
  return { stat: p, n, se, tol: 2 * se, checked: checked(n) };
}

/** A median with its large-sample SE 1.25 × IQR ÷ (1.35 √n); tolerance 2 SE. */
export function medianTarget(xs: readonly number[], scale = 1): Target {
  if (xs.length === 0) return { stat: 0, n: 0, se: 0, tol: 0, checked: false };
  const s = [...xs].sort((a, b) => a - b);
  const iqr = quantile(s, 0.75) - quantile(s, 0.25);
  const se = (1.25 * iqr) / (1.35 * Math.sqrt(s.length)) / scale;
  return {
    stat: (median(s) as number) / scale,
    n: s.length,
    se,
    tol: 2 * se,
    checked: checked(s.length)
  };
}

function cohortMean(xs: readonly number[]): CohortMean {
  const n = xs.length;
  if (n === 0) return { mean: 0, n: 0, se: 0 };
  const mean = xs.reduce((a, x) => a + x, 0) / n;
  if (n === 1) return { mean, n, se: 0 };
  const ss = xs.reduce((a, x) => a + (x - mean) ** 2, 0);
  return { mean, n, se: Math.sqrt(ss / (n - 1)) / Math.sqrt(n) };
}

/** A history's earliest entered day, any stage. */
function firstRecord(h: NormHistory): Day | null {
  let first: Day | null = null;
  for (const day of Object.values(h.eff)) {
    if (day !== undefined && (first === null || day < first)) first = day;
  }
  return first;
}

/** The latest ten record years ending at `asOf`, not before PLANNING_START. */
export function targetWindow(asOf: Day): [Day, Day] {
  const iso = isoOf(asOf);
  const tenBack = isoToDay(`${Number(iso.slice(0, 4)) - 10}${iso.slice(4)}`);
  return [Math.max(tenBack, isoToDay(PLANNING_START)), asOf];
}

/** Permits issued in the window, not superseded, with recorded stories of at least 1. */
function issuedIn(permits: readonly PermitRow[], [from, to]: [Day, Day]): PermitRow[] {
  return permits.filter(
    (p) =>
      p.superseded !== true &&
      p.issued_day !== null &&
      p.issued_day >= from &&
      p.issued_day <= to &&
      p.proposed_stories !== null &&
      p.proposed_stories >= 1
  );
}

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Every record target of the spec's Acceptance table at `asOf`. Histories are the qualifying
 * project histories, normalised as the calibration does; stage spells are the calibration's.
 * Permits are `permits.parquet` rows (one per linked new-construction permit).
 */
export function recordTargets(
  histories: readonly ProjectHistory[],
  permits: readonly PermitRow[],
  parcels: ParcelsForRecords,
  asOf: Day
): RecordTargets {
  const window = targetWindow(asOf);
  const [from, to] = window;
  const norm = normalise(histories.filter(qualifies).sort(byId), asOf).norm;

  // Built height ÷ limit, by the limit at filing, for histories first recorded in the window.
  const ratios = LIMIT_BUCKETS.map((): number[] => []);
  const cohorts = { affordable: [] as number[], private: [] as number[] };
  for (const h of norm) {
    const first = firstRecord(h);
    const stories = h.src.storiesProposed;
    const base = h.src.baseStoriesAtFiling;
    if (first === null || first < from || first > to) continue;
    if (stories === null || base === null || stories < 1 || base < 1) continue;
    const r = stories / base;
    ratios[bandIndex(LIMIT_BUCKETS, base)].push(r);
    const c = startCohort(h.src.planningProposed);
    if (c === 'affordable' || c === 'private') cohorts[c].push(r);
  }
  const heightRatio = ratios.map((rs, i) => {
    const m = cohortMean(rs);
    return {
      upTo: LIMIT_BUCKETS[i],
      mean: { stat: m.mean, n: m.n, se: m.se, tol: MEAN_RATIO_TOL, checked: checked(m.n) },
      nearLimit: binomialTarget(rs.filter((r) => r >= NEAR_LIMIT).length, rs.length),
      overLimit: rs.filter((r) => r > 1).length
    };
  });
  const affordable = cohortMean(cohorts.affordable);
  const priv = cohortMean(cohorts.private);

  // Construction type by height band, from issued permits.
  const issued = issuedIn(permits, window);
  const byBand = HEIGHT_BANDS.map((upTo) => ({ upTo, n: 0, V: 0, III: 0, I: 0, other: 0 }));
  const recordsOver = { V: 0, III: 0 };
  let i8to12 = 0;
  let n8to12 = 0;
  for (const p of issued) {
    const t = p.construction_type;
    if (t === null) continue;
    const s = p.proposed_stories as number;
    const b = byBand[bandIndex(HEIGHT_BANDS, s)];
    b.n++;
    if (t === 'V' || t === 'III' || t === 'I') b[t]++;
    else b.other++;
    if (t === 'V' && s > TYPE_MAX_STORIES.V) recordsOver.V++;
    if (t === 'III' && s > TYPE_MAX_STORIES.III) recordsOver.III++;
    if (s >= 8 && s <= 12) {
      n8to12++;
      if (t === 'I') i8to12++;
    }
  }

  // Stage intervals on the model's own stages, by height band.
  const { spells } = buildSpells(norm, asOf);
  const storied = storiedById(norm);
  const stageBands = (stage: 'permitIssued' | 'construction'): BandTarget[] =>
    completedByBand(spells, storied, stage, HEIGHT_BANDS, window).flatMap((xs, i) =>
      xs.length === 0 ? [] : [{ upTo: HEIGHT_BANDS[i], ...medianTarget(xs, MONTH_DAYS) }]
    );

  // Homes per project of 10 or more, by height band.
  const homes = HEIGHT_BANDS.map((): number[] => []);
  for (const p of issued) {
    if (p.proposed_units === null || p.proposed_units < PROJECT_MIN_HOMES) continue;
    homes[bandIndex(HEIGHT_BANDS, p.proposed_stories as number)].push(p.proposed_units);
  }

  // Large lots with a limit of 13 or more: Type I at 13 or more stories.
  let large = 0;
  let tall = 0;
  for (const p of issued) {
    if (p.construction_type === null) continue;
    let area = 0;
    let limit = 0;
    for (const id of p.parcel_ids) {
      const i = parcels.index.get(id);
      if (i === undefined) continue;
      area += parcels.lotAreaM2[i];
      limit = Math.max(limit, parcels.baseStories[i]);
    }
    if (area < LARGE_LOT_M2 || limit < LARGE_LOT_LIMIT) continue;
    large++;
    if (p.construction_type === 'I' && (p.proposed_stories as number) >= LARGE_LOT_LIMIT) tall++;
  }

  return {
    schema: 1,
    asOf,
    window: [isoOf(from), isoOf(to)],
    heightRatio,
    constructionType: {
      byBand,
      maxStories: TYPE_MAX_STORIES,
      recordsOver,
      typeIShare8to12: binomialTarget(i8to12, n8to12)
    },
    stageMonths: {
      permitIssued: stageBands('permitIssued'),
      construction: stageBands('construction')
    },
    homesPerProject: homes.flatMap((xs, i) =>
      xs.length === 0 ? [] : [{ upTo: HEIGHT_BANDS[i], ...medianTarget(xs) }]
    ),
    largeLotTypeI: binomialTarget(tall, large),
    cohort: {
      affordable,
      private: priv,
      diff: affordable.mean - priv.mean,
      se: Math.sqrt(affordable.se ** 2 + priv.se ** 2)
    }
  };
}

/** Permits for 10 or more homes issued from this day on price the ratio. */
const RATIO_FROM = '2015-01-01';
/** Below this many permits on either side the ratio is 1. */
const RATIO_MIN_N = 10;
/** The top price anchor's stories (prototype D); the ratio prices Type I above it. */
const TOP_ANCHOR_STORIES = 24;
/** The lower anchor of the slope (prototype C). */
const SLOPE_FROM_STORIES = 13;

/**
 * Cost per home above the top anchor as a multiple of the anchor's: the median permit valuation
 * per home of permits for 10 or more homes issued 2015 on above 24 stories, over that at 13 to
 * 24. Valuation is not cost; only the ratio is used (tier 2, weak). Each permit counts once (the
 * first row with its number); superseded permits are left out. With fewer than 10 permits on either side the ratio is 1 (tier 4, invented).
 */
export function aboveTopCostRatio(permits: readonly PermitRow[]): {
  ratio: number;
  n: [number, number];
  provenance: Provenance;
} {
  const since = isoToDay(RATIO_FROM);
  const above: number[] = [];
  const slope: number[] = [];
  let last = since;
  // One value per permit: a permit's first row counts, later rows with its number do not.
  const counted = new Set<string>();
  for (const p of permits) {
    if (p.permit_number !== null) {
      if (counted.has(p.permit_number)) continue;
      counted.add(p.permit_number);
    }
    const s = p.proposed_stories;
    const u = p.proposed_units;
    if (p.superseded === true || p.issued_day === null || p.issued_day < since) continue;
    if (s === null || u === null || u < PROJECT_MIN_HOMES || p.valuation === null) continue;
    if (!(p.valuation > 0)) continue;
    last = Math.max(last, p.issued_day);
    if (s > TOP_ANCHOR_STORIES) above.push(p.valuation / u);
    else if (s >= SLOPE_FROM_STORIES) slope.push(p.valuation / u);
  }
  const n: [number, number] = [above.length, slope.length];
  const sources = [datasf('permits')];
  const what = `median permit valuation per home (revised cost, else estimate) of permits for ${PROJECT_MIN_HOMES} or more homes issued ${RATIO_FROM} on, one per permit number, superseded permits left out: above ${TOP_ANCHOR_STORIES} stories (n = ${n[0]}) over ${SLOPE_FROM_STORIES} to ${TOP_ANCHOR_STORIES} stories (n = ${n[1]})`;
  if (n[0] < RATIO_MIN_N || n[1] < RATIO_MIN_N) {
    return {
      ratio: 1,
      n,
      provenance: {
        tier: 4,
        label: 'Cost above 24 stories: ratio 1 (invented: too few permits)',
        sources,
        method: `${what}; fewer than ${RATIO_MIN_N} on a side, so the ratio is 1 (invented)`
      }
    };
  }
  const ratio = Math.round(((median(above) as number) / (median(slope) as number)) * 1e4) / 1e4;
  return {
    ratio,
    n,
    provenance: {
      tier: 2,
      label: 'Cost above 24 stories: permit valuation ratio (tier 2, weak: valuation is not cost)',
      sources,
      method: `${what}; valuation is not cost, only the ratio is used (weak)`,
      n: n[0] + n[1],
      window: [RATIO_FROM, isoOf(last)]
    }
  };
}
