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
  /** Resolved DA parcels (spec 4.10.2), before exclusion. */
  daParcels: ParcelId[];
  /** Parcels of every other in-flight project, every completed history and earlier masters. */
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
  /** Enriched: R / Σ remaining units before scaling. Otherwise null. */
  scale: number | null;
  /** Number of phase merges. */
  merged: number;
  problems: string[];
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

function masterParcels(
  daAvail: ParcelId[],
  phases: Phase[] | null,
  tracking: ParcelId[]
): ParcelId[] {
  const all = new Set(daAvail);
  for (const p of phases ?? []) for (const id of p.parcelIds) all.add(id);
  return all.size > 0 ? [...all].sort() : [...tracking].sort();
}

interface Draft {
  units: number;
  parcelIds: ParcelId[];
  planned: Day | null;
  source: Phase['source'];
}

function enriched(
  ctx: PhaseContext,
  schedule: NonNullable<MultiphaseEntry['schedule']>,
  remaining: MultiphasePhase[],
  R: number,
  caseNo: string,
  problems: string[]
): { phases: Phase[]; scale: number; merged: number } {
  const taken = new Set<ParcelId>();
  const drafts: Draft[] = remaining.map((ph) => {
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
      problems.push(
        `${caseNo}: phase '${ph.name}' plannedPermitFiled ${ph.plannedPermitFiled} is not after ` +
          'the master entitlement'
      );
    }
    return {
      units: ph.units,
      parcelIds,
      planned,
      source: {
        label: schedule.label,
        url: ph.facts.units.url,
        retrieved: ph.facts.units.retrieved
      }
    };
  });

  const sum = drafts.reduce((s, d) => s + d.units, 0);
  const scale = R / sum;
  if (scale < SCALE_BOUNDS[0] || scale > SCALE_BOUNDS[1]) {
    problems.push(
      `${caseNo}: scale factor ${scale} (R ${R} / Σ ${sum}) is outside ` +
        `[${SCALE_BOUNDS[0]}, ${SCALE_BOUNDS[1]}]`
    );
  }
  const scaled = largestRemainder(
    drafts.map((d) => d.units),
    R
  );
  drafts.forEach((d, i) => (d.units = scaled[i]));

  const keep = drafts.map((d) => d.parcelIds.length > 0 && d.units > 0);
  if (!keep.some(Boolean)) {
    const parcelIds = ctx.trackingParcels.filter((id) => !ctx.excluded.has(id)).sort();
    if (parcelIds.length === 0) {
      problems.push(`${caseNo}: every phase and the tracking parcel are excluded`);
    }
    const planned = drafts.reduce<Day | null>((m, d) => minDay(m, d.planned), null);
    return {
      phases: [
        {
          units: R,
          parcelIds: parcelIds.length > 0 ? parcelIds : [...ctx.trackingParcels].sort(),
          plannedPermitFiled: planned,
          source: drafts[0].source
        }
      ],
      scale,
      merged: drafts.length - 1
    };
  }

  let merged = 0;
  const kept = drafts.map((d, i) => (keep[i] ? { ...d } : null));
  drafts.forEach((d, i) => {
    if (keep[i]) return;
    let target = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (keep[j]) {
        target = j;
        break;
      }
    }
    if (target < 0) target = keep.indexOf(true, i + 1);
    const t = kept[target]!;
    t.units += d.units;
    t.planned = minDay(t.planned, d.planned);
    merged++;
  });
  const phases = kept
    .filter((d): d is Draft => d !== null)
    .map((d) => ({
      units: d.units,
      parcelIds: d.parcelIds,
      plannedPermitFiled: d.planned,
      source: d.source
    }));
  return { phases, scale, merged };
}

/**
 * Builds the master's T3 `phases` (spec 4.10.2). Enriched when the entry has a schedule and at
 * least one `remaining` phase; else the fallback from the phase size u (project median, then
 * citywide); else (no u, or no DA parcel left) the last resort, `phases: null`.
 */
export function buildPhases(ctx: PhaseContext): PhaseResult {
  const caseNo = ctx.master.caseNo ?? `pipeline row ${ctx.master.idx}`;
  const R = ctx.master.newUnits ?? 0;
  const problems: string[] = [];
  const daAvail = [...new Set(ctx.daParcels)].filter((id) => !ctx.excluded.has(id)).sort();

  const lastResort = (): PhaseResult => ({
    phases: null,
    parcelIds: masterParcels(daAvail, null, ctx.trackingParcels),
    mode: 'lastResort',
    scale: null,
    merged: 0,
    problems
  });

  if (R < 1) {
    problems.push(`${caseNo}: no remaining units (new_pipeline_units ${ctx.master.newUnits})`);
    return lastResort();
  }

  const entry = ctx.entry;
  const remaining = entry?.phases.filter((p) => p.status === 'remaining') ?? [];
  if (entry && entry.schedule && remaining.length > 0) {
    const r = enriched(ctx, entry.schedule, remaining, R, caseNo, problems);
    return {
      phases: r.phases,
      parcelIds: masterParcels(daAvail, r.phases, ctx.trackingParcels),
      mode: 'enriched',
      scale: r.scale,
      merged: r.merged,
      problems
    };
  }

  const u = [ctx.projectU, ctx.citywideU].find((x) => x !== null && x.u > 0)?.u ?? null;
  const P = daAvail.length;
  if (u === null || P === 0) return lastResort();

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
      source: null
    });
  }
  return {
    phases,
    parcelIds: masterParcels(daAvail, phases, ctx.trackingParcels),
    mode: 'fallback',
    scale: null,
    merged: 0,
    problems
  };
}

/**
 * V24 file checks (spec 4.10.1): every entry names a PRX row in the pipeline, every PRX row with
 * `newUnits >= 1` has an entry, and every retrieval date (schedule, searched, facts) is <= asOf.
 * `prxRows` are the pipeline rows with `prx` true.
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
  });

  for (const r of prxRows) {
    if (r.caseNo !== null && (r.newUnits ?? 0) >= 1 && !entries.has(r.caseNo)) {
      problems.push(`multiphase.json: PRX row ${r.caseNo} (${r.newUnits} units) has no entry`);
    }
  }
  return problems;
}
