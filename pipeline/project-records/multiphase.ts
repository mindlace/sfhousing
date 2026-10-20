/**
 * DA multi-phase phasing for PRX masters (spec 4.10.2 and 4.10.3): enriched phases from the
 * curated schedule, the phase-size fallback, and the last resort. Also the V24 file checks of
 * `multiphase.json` (spec 4.10.1).
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { InFlightProject } from '../../src/lib/timelapse/projects';
import type { Day } from '../../src/lib/timelapse/time';
import type { MultiphaseEntry, MultiphaseFile, MultiphasePhase } from '../enrichment/schema';
import type { PipelineRow } from './types';

/** V24 bounds on the enriched scale factor R / Σ (tier-4 check bound). */
export const SCALE_BOUNDS = [0.8, 1.25] as const;

type Phase = NonNullable<InFlightProject['phases']>[number];

export interface PhaseContext {
  master: PipelineRow;
  entry: MultiphaseEntry | null;
  /** The master's `history.entitled`; only used to flag a planned date not after it. */
  masterEntitled: Day | null;
  /** R after DA netting (spec 4.10.2); defaults to the row's `new_pipeline_units`. */
  units?: number;
  /** Resolved DA parcels (spec 4.10.2), before exclusion. */
  daParcels: ParcelId[];
  /**
   * Parcels of every other in-flight project (non-masters, the tracking parcels of every other
   * in-flight master, earlier masters' final parcels) and of every completed history.
   */
  excluded: ReadonlySet<ParcelId>;
  /** Resolved tracking `blklot` of the master. */
  trackingParcels: ParcelId[];
  /** Median proposed units of the project's completed buildings (n >= 1), else null. */
  projectU: { u: number; n: number } | null;
  /** Citywide median of completed type 1/2 permits with >= 50 units since 2015, else null. */
  citywideU: { u: number; n: number } | null;
  resolve(blklots: string[]): ParcelId[];
  areaM2(id: ParcelId): number;
}

export interface PhaseResult {
  phases: InFlightProject['phases'];
  parcelIds: ParcelId[];
  mode: 'enriched' | 'fallback' | 'lastResort';
  /** DQ-3: a last resort with no free DA parcel, so `parcelIds` is []. */
  scoreOnly: boolean;
  /** Enriched: R before netting / Σ remaining units (the curation check). Otherwise null. */
  scale: number | null;
  /** Number of phase merges. */
  merged: number;
  /** Fallback: the phase size u used (project median, else citywide). Otherwise null. */
  u: { u: number; n: number } | null;
  /** V24 failures. */
  problems: string[];
  /** Non-failing notes for the report: unresolved phase blklots, a schedule with no remaining phase. */
  warnings: string[];
}

/** 'YYYY-MM-DD' as a UTC day number (no clipping: planned dates may be after asOf). */
export function isoToDay(iso: string): Day {
  return Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
}

/**
 * Splits `total` in proportion to `units` by largest remainder, ties to the earlier entry.
 * Integer inputs are exact. Σ units = 0 splits evenly.
 */
export function largestRemainder(units: number[], total: number): number[] {
  const sum = units.reduce((s, u) => s + u, 0);
  const weights = sum === 0 ? units.map(() => 1) : units;
  const denom = sum === 0 ? units.length : sum;
  if (denom === 0) return [];
  const out: number[] = [];
  const rems: { i: number; rem: number }[] = [];
  weights.forEach((w, i) => {
    const num = w * total;
    const fl = Math.floor(num / denom);
    out.push(fl);
    rems.push({ i, rem: num - fl * denom });
  });
  let left = total - out.reduce((s, x) => s + x, 0);
  rems.sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const { i } of rems) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return out;
}

/** Median; the mean of the two middle values for even n; null when empty. */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function minDay(a: Day | null, b: Day | null): Day | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** A phased master's parcels: the free DA parcels plus the phase parcels, else the free tracking. */
function masterParcels(daAvail: ParcelId[], phases: Phase[], freeTracking: ParcelId[]): ParcelId[] {
  const all = new Set(daAvail);
  for (const p of phases) for (const id of p.parcelIds) all.add(id);
  return all.size > 0 ? [...all].sort() : [...freeTracking].sort();
}

interface Draft {
  units: number;
  parcelIds: ParcelId[];
  planned: Day | null;
  source: Phase['source'];
  /** The phase's curated stories (tier 1), else null. */
  stories: number | null;
}

/** The stories every draft agrees on, else null (an unknown height disagrees). */
function agreedStories(drafts: readonly Draft[]): number | null {
  const s = drafts[0]?.stories ?? null;
  return drafts.every((d) => d.stories === s) ? s : null;
}

/** A phase's `stories` and `storiesTier` from its curated stories. */
function storiesOf(stories: number | null): Pick<Phase, 'stories' | 'storiesTier'> {
  return { stories, storiesTier: stories === null ? null : 1 };
}

/**
 * Folds every draft for which `drop` holds into the nearest earlier kept draft, else the next kept
 * one: units, parcels and the earliest planned date go with it, and the target keeps its stories
 * only when the two agree. Needs at least one kept draft.
 */
function mergeInto(
  drafts: Draft[],
  drop: (d: Draft) => boolean
): { kept: Draft[]; merged: number } {
  const keep = drafts.map((d) => !drop(d));
  const out = drafts.map((d, i) => (keep[i] ? { ...d, parcelIds: [...d.parcelIds] } : null));
  let merged = 0;
  drafts.forEach((d, i) => {
    if (keep[i]) return;
    let target = -1;
    for (let j = i - 1; j >= 0 && target < 0; j--) if (keep[j]) target = j;
    if (target < 0) target = keep.indexOf(true, i + 1);
    const t = out[target]!;
    t.units += d.units;
    t.parcelIds = [...t.parcelIds, ...d.parcelIds].sort();
    t.planned = minDay(t.planned, d.planned);
    if (t.stories !== d.stories) t.stories = null;
    merged++;
  });
  return { kept: out.filter((d): d is Draft => d !== null), merged };
}

function enriched(
  ctx: PhaseContext,
  schedule: NonNullable<MultiphaseEntry['schedule']>,
  remaining: MultiphasePhase[],
  R: number,
  rBefore: number,
  caseNo: string,
  problems: string[],
  warnings: string[],
  moot: string[]
): { phases: Phase[] | null; scale: number; merged: number } {
  const taken = new Set<ParcelId>();
  const drafts: Draft[] = remaining.map((ph) => {
    if (ph.blklots.length === 0) warnings.push(`${caseNo} phase ${ph.name}: names no blklots`);
    for (const b of ph.blklots) {
      if (ctx.resolve([b]).length === 0) {
        warnings.push(`${caseNo} phase ${ph.name}: blklot ${b} resolves to no parcel`);
      }
    }
    const resolved = ctx.resolve(ph.blklots);
    if (resolved.length > 0 && resolved.every((id) => ctx.excluded.has(id))) {
      problems.push(
        `${caseNo}: remaining phase '${ph.name}' resolves only to parcels of another in-flight ` +
          'or completed project (excluded); mark it built or separate'
      );
    }
    const parcelIds = [...new Set(resolved)]
      .filter((id) => !ctx.excluded.has(id) && !taken.has(id))
      .sort();
    for (const id of parcelIds) taken.add(id);
    const planned = ph.plannedPermitFiled === null ? null : isoToDay(ph.plannedPermitFiled);
    if (planned !== null && ctx.masterEntitled !== null && planned <= ctx.masterEntitled) {
      const msg =
        `${caseNo}: phase '${ph.name}' plannedPermitFiled ${ph.plannedPermitFiled} is not after ` +
        'the master entitlement';
      problems.push(msg);
      moot.push(msg);
    }
    return {
      units: ph.units,
      parcelIds,
      planned,
      source: {
        label: schedule.label,
        url: ph.facts.units.url,
        retrieved: ph.facts.units.retrieved
      },
      stories: ph.stories ?? null
    };
  });

  const sum = drafts.reduce((s, d) => s + d.units, 0);
  // The curation factor uses R before netting (netting is reported apart). It is returned, not
  // checked here: checkV24 reports one out of bounds once.
  const scale = rBefore / sum;

  if (drafts.every((d) => d.parcelIds.length === 0)) {
    const parcelIds = ctx.trackingParcels.filter((id) => !ctx.excluded.has(id)).sort();
    if (parcelIds.length === 0) {
      // Ruling L2: no free tracking parcel either, so phasing is dropped (a phase would double-draw).
      warnings.push(
        `${caseNo}: every phase and the tracking parcel belong to other projects; phasing dropped`
      );
      return { phases: null, scale, merged: 0 };
    }
    const planned = drafts.reduce<Day | null>((m, d) => minDay(m, d.planned), null);
    return {
      phases: [
        {
          units: R,
          parcelIds,
          plannedPermitFiled: planned,
          source: drafts[0].source,
          ...storiesOf(agreedStories(drafts))
        }
      ],
      scale,
      merged: drafts.length - 1
    };
  }

  // 1. Parcel-less phases merge; 2. the merged phases scale to R; 3. phases scaled to 0 merge.
  const first = mergeInto(drafts, (d) => d.parcelIds.length === 0);
  const scaled = largestRemainder(
    first.kept.map((d) => d.units),
    R
  );
  first.kept.forEach((d, i) => (d.units = scaled[i]));
  const second = mergeInto(first.kept, (d) => d.units === 0);
  const phases = second.kept.map((d) => ({
    units: d.units,
    parcelIds: d.parcelIds,
    plannedPermitFiled: d.planned,
    source: d.source,
    ...storiesOf(d.stories)
  }));
  return { phases, scale, merged: first.merged + second.merged };
}

/**
 * Builds the master's T3 `phases` (spec 4.10.2) for R = `ctx.units` (netted). Enriched when the
 * entry has a schedule and at least one `remaining` phase; else the fallback from the phase size u
 * (project median, then citywide); else (no u, no free DA parcel, or ruling L2) the last resort,
 * `phases: null`, drawing on exactly the free DA parcels, or score-only with none (DQ-3).
 * `problems` fail V24; `warnings` are non-failing report notes.
 */
export function buildPhases(ctx: PhaseContext): PhaseResult {
  const caseNo = ctx.master.caseNo ?? `pipeline row ${ctx.master.idx}`;
  const rBefore = ctx.master.newUnits ?? 0;
  const R = ctx.units ?? rBefore;
  const problems: string[] = [];
  const warnings: string[] = [];
  const daAvail = [...new Set(ctx.daParcels)].filter((id) => !ctx.excluded.has(id)).sort();
  const freeTracking = ctx.trackingParcels.filter((id) => !ctx.excluded.has(id));

  const lastResort = (): PhaseResult => ({
    phases: null,
    parcelIds: daAvail,
    mode: 'lastResort',
    scoreOnly: daAvail.length === 0,
    scale: null,
    merged: 0,
    u: null,
    problems,
    warnings
  });

  if (R < 1) {
    problems.push(`${caseNo}: no remaining units (new_pipeline_units ${ctx.master.newUnits})`);
    return lastResort();
  }

  const entry = ctx.entry;
  const remaining = entry?.phases.filter((p) => p.status === 'remaining') ?? [];
  if (entry && entry.schedule && remaining.length > 0) {
    const moot: string[] = [];
    const r = enriched(
      ctx,
      entry.schedule,
      remaining,
      R,
      rBefore,
      caseNo,
      problems,
      warnings,
      moot
    );
    if (r.phases === null) {
      // Ruling L2: plannedPermitFiled problems are moot without phases, and a last resort records
      // no scale for checkV24; the 4.10.3 curation problem (phase resolves only to excluded
      // parcels) stays and still fails V24.
      const kept = problems.filter((m) => !moot.includes(m));
      problems.length = 0;
      problems.push(...kept);
      return lastResort();
    }
    return {
      phases: r.phases,
      parcelIds: masterParcels(daAvail, r.phases, freeTracking),
      mode: 'enriched',
      scoreOnly: false,
      scale: r.scale,
      merged: r.merged,
      u: null,
      problems,
      warnings
    };
  }
  if (entry && entry.schedule) {
    warnings.push(
      `${caseNo}: schedule lists no remaining phase but ${R} units remain; using the fallback`
    );
  }

  const used = [ctx.projectU, ctx.citywideU].find((x) => x !== null && x.u > 0) ?? null;
  const P = daAvail.length;
  if (used === null || P === 0) return lastResort();
  const u = used.u;

  const k = Math.min(P, Math.max(1, Math.floor(R / u + 0.5)));
  const base = Math.floor(R / k);
  const extra = R % k;
  const byArea = [...daAvail].sort((a, b) => ctx.areaM2(b) - ctx.areaM2(a) || (a < b ? -1 : 1));
  const phases: Phase[] = [];
  for (let i = 0; i < k; i++) {
    phases.push({
      units: base + (i < extra ? 1 : 0),
      parcelIds: [byArea[i]],
      plannedPermitFiled: null,
      source: null,
      ...storiesOf(null)
    });
  }
  return {
    phases,
    parcelIds: masterParcels(daAvail, phases, freeTracking),
    mode: 'fallback',
    scoreOnly: false,
    scale: null,
    merged: 0,
    u: { u: used.u, n: used.n },
    problems,
    warnings
  };
}

/** One master's DA netting (spec 4.10.2): R before and after, and the projects that netted it. */
export interface Netting {
  id: string;
  before: number;
  after: number;
  /** The netting projects' ids, in the given order. */
  by: string[];
}

/**
 * DA netting (spec 4.10.2, rule `pr.multiphase.da-netting`), before phasing, in the given (master
 * id) order. A master's netting projects are the candidates with a parcel among its DA parcels
 * that have not netted an earlier master; R = max(0, units - Σ their units). The caller passes as
 * candidates the in-flight non-master projects that match no pipeline row (a DQ-2 linked row is a
 * match). Pure.
 */
export function netMasters(
  masters: readonly { id: string; units: number; daParcels: readonly ParcelId[] }[],
  candidates: readonly { id: string; units: number; parcelIds: readonly ParcelId[] }[]
): Netting[] {
  const spent = new Set<string>();
  return masters.map((m) => {
    const da = new Set(m.daParcels);
    const by: string[] = [];
    let sum = 0;
    for (const c of candidates) {
      if (spent.has(c.id) || !c.parcelIds.some((id) => da.has(id))) continue;
      spent.add(c.id);
      by.push(c.id);
      sum += c.units;
    }
    return { id: m.id, before: m.units, after: Math.max(0, m.units - sum), by };
  });
}

/**
 * V24 file checks (spec 4.10.1): every entry names a PRX row in the pipeline, every PRX row with
 * `newUnits >= 1` has an entry, and every retrieval date (schedule, searched, phase and heights
 * facts) is <= asOf. `prxRows` are the pipeline rows with `prx` true.
 */
export function checkMultiphaseFile(
  f: MultiphaseFile,
  prxRows: PipelineRow[],
  asOf: Day
): string[] {
  const problems: string[] = [];
  const known = new Set(prxRows.map((r) => r.caseNo).filter((c): c is string => c !== null));
  const entries = new Set(f.projects.map((p) => p.caseNo));

  const late = (where: string, retrieved: string): void => {
    if (isoToDay(retrieved) > asOf) {
      problems.push(`multiphase.json ${where}: retrieved ${retrieved} is after asOf`);
    }
  };

  f.projects.forEach((p, i) => {
    const at = `projects[${i}] (${p.caseNo})`;
    if (!known.has(p.caseNo)) {
      problems.push(`multiphase.json ${at}: caseNo is not a PRX row in the pipeline`);
    }
    if (p.schedule) late(`${at}.schedule`, p.schedule.retrieved);
    p.searched.forEach((s, j) => late(`${at}.searched[${j}]`, s.retrieved));
    p.phases.forEach((ph, j) => {
      for (const [k, fact] of Object.entries(ph.facts)) {
        if (fact) late(`${at}.phases[${j}].facts.${k}`, fact.retrieved);
      }
    });
    for (const [k, fact] of Object.entries(p.heights?.facts ?? {})) {
      if (fact) late(`${at}.heights.facts.${k}`, fact.retrieved);
    }
  });

  for (const r of prxRows) {
    if (r.caseNo !== null && (r.newUnits ?? 0) >= 1 && !entries.has(r.caseNo)) {
      problems.push(`multiphase.json: PRX row ${r.caseNo} (${r.newUnits} units) has no entry`);
    }
  }
  return problems;
}
