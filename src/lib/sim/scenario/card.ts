// The T6 `ProjectCard` and the day-based project choice (spec §4.9): what fzp-mode's hover/tap
// card shows for a project at the scrubbed day. Worker-safe and pure (no transcendental Math).
import type { ParcelId } from '$lib/data/parcel';
import { massedUnits, massingApproximate, unitsTolerance } from '$lib/generator';
import type { GeneratedBuilding } from '$lib/generator';
import type { InFlightProject, QualityRuleRef } from '$lib/timelapse/projects';
import { DYING_DAYS, type Day } from '$lib/timelapse/time';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import type { Master } from './simulate';
import type { Massing, ProjectCard, Schedule, SimInput } from './types';

/** What `projectCard` reads: the run's inputs and the card-time seams. */
export interface CardCtx {
  asOf: Day;
  input: SimInput;
  /** The T3 rows by id (a phase reads its master's row). */
  rows: Map<string, InFlightProject>;
  /** The run's masters by `masterId` (a phase card's Planning-side context). */
  masters: Map<string, Master>;
  qualityRules: Map<string, QualityRuleRef>;
  /** The massing of revision `k`; the worker passes `massingFor` over its memo. */
  building(s: Schedule, k: number): Massing;
  /** Logs `msg` once per `key`, however often it is called (the ctx's responsibility). */
  logOnce(key: string, msg: string): void;
}

const PLANNING_SIDE: readonly Stage[] = ['preApplication', 'filed', 'entitled'];
/** The massing of an unphased multi-phase row: a footprint entry, never a building. */
const FOOTPRINT_ONLY: Massing = { footprint: [] };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `Block <B>, Lot <L>`: B is the first 4 characters plus a following letter, L is the rest. */
export function blockLot(parcelId: ParcelId): string {
  const n = /^[A-Za-z]$/.test(parcelId.charAt(4)) ? 5 : 4;
  return `Block ${parcelId.slice(0, n)}, Lot ${parcelId.slice(n)}`;
}

/** The schedule's first entered day (its ghost appears then). */
export function firstDay(s: Schedule): Day {
  let first = Infinity;
  for (const day of Object.values(s.entered)) if (day < first) first = day;
  return first;
}

/** Visible at `day`: started, and not exited more than `DYING_DAYS` ago (§4.9). */
export function isVisible(s: Schedule, day: Day): boolean {
  if (firstDay(s) > day) return false;
  return !(s.end.kind === 'exit' && day - s.end.day > DYING_DAYS);
}

/**
 * The §4.9 selection among the shown-run schedules on one parcel: the named project if it is
 * visible at `day`; otherwise the latest-started project whose first stage is on or before `day`,
 * if that one is visible; otherwise none. Same-day starts tie-break on the larger `projectId`, so
 * the choice does not depend on input order.
 */
export function chooseProject(onParcel: Schedule[], day: Day, projectId?: string): Schedule | null {
  if (projectId !== undefined) {
    const named = onParcel.find((s) => s.projectId === projectId);
    if (named && isVisible(named, day)) return named;
  }
  let latest: Schedule | null = null;
  let latestFirst = -Infinity;
  for (const s of onParcel) {
    const f = firstDay(s);
    if (f > day) continue;
    if (f > latestFirst || (f === latestFirst && cmp(s.projectId, latest!.projectId) > 0)) {
      latest = s;
      latestFirst = f;
    }
  }
  return latest !== null && isVisible(latest, day) ? latest : null;
}

/** The index of the latest revision on or before `day` (0 if none is). */
function revisionAt(s: Schedule, day: Day): number {
  let k = 0;
  for (let i = 0; i < s.revisions.length; i++) if (s.revisions[i].day <= day) k = i;
  return k;
}

function smallestParcel(ids: ParcelId[]): ParcelId | null {
  let best: ParcelId | null = null;
  for (const id of ids) if (best === null || id < best) best = id;
  return best;
}

function massingOf(
  s: Schedule,
  b: GeneratedBuilding | null,
  units: number
): ProjectCard['massing'] {
  if (b === null) return 'none';
  if (s.origin === 'simulated')
    return massedUnits(b) === 0 || Math.abs(b.units - units) > unitsTolerance(units)
      ? 'approximate'
      : 'matched';
  return massingApproximate(b) || massedUnits(b) === 0 ? 'approximate' : 'matched';
}

/** `entered` as card stages, in `STAGE_ORDER`, those on or before `day`. */
function stagesOf(
  entered: Partial<Record<Stage, Day>>,
  day: Day,
  only: readonly Stage[],
  actual: (stage: Stage, at: Day) => boolean
): ProjectCard['stages'] {
  const out: ProjectCard['stages'] = [];
  for (const stage of only) {
    const at = entered[stage];
    if (at !== undefined && at <= day) out.push({ stage, day: at, actual: actual(stage, at) });
  }
  return out;
}

/**
 * The card of `s` at `day` (§4.9). Call only for a schedule `chooseProject` returned. A phase
 * takes its master row's label, sources and quality, and its stages start with the master's
 * Planning-side stages. `end` is null while the end is after `day` (an open end never is).
 */
export function projectCard(s: Schedule, day: Day, ctx: CardCtx): ProjectCard {
  const pipeline = s.origin === 'pipeline';
  const row = pipeline ? (ctx.rows.get(s.phase?.masterId ?? s.projectId) ?? null) : null;
  if (pipeline && row === null)
    ctx.logOnce(`card:row:${s.projectId}`, `no project row for ${s.projectId}`);

  const k = revisionAt(s, day);
  const rev = s.revisions[k];

  // An unphased multi-phase row has a footprint entry only (§4.9): no building to ask for.
  const raw = s.multiPhase && s.phase === null ? FOOTPRINT_ONLY : ctx.building(s, k);
  const b = 'footprint' in raw ? null : raw;

  const anchor = smallestParcel(s.parcelIds);
  const label = row?.label ?? (anchor === null ? '' : blockLot(anchor));

  let stories: number | null;
  let storiesTier: ProjectCard['storiesTier'];
  if (rev.stories !== null) {
    stories = rev.stories;
    // 0 or 3 only for the record's own value at revisions[0] of a non-phase row (§4.9)
    storiesTier = !pipeline ? null : k === 0 && s.phase === null ? (row?.storiesTier ?? null) : 4;
  } else {
    stories = b?.stories ?? null;
    storiesTier = pipeline && stories !== null ? 4 : null;
  }

  let stages: ProjectCard['stages'];
  const history = row?.history ?? {};
  if (s.phase !== null) {
    const m = ctx.masters.get(s.phase.masterId);
    if (m === undefined)
      ctx.logOnce(`card:master:${s.phase.masterId}`, `no master for ${s.projectId}`);
    const context = m
      ? stagesOf(
          m.entered,
          day,
          PLANNING_SIDE,
          (stage, at) => at <= ctx.asOf && history[stage] === at
        )
      : [];
    // a phase's own stages are always simulated: its filing is after asOf
    stages = [...context, ...stagesOf(s.entered, day, STAGE_ORDER, () => false)];
  } else {
    stages = stagesOf(
      s.entered,
      day,
      STAGE_ORDER,
      (stage, at) => pipeline && at <= ctx.asOf && history[stage] === at
    );
  }

  const quality: ProjectCard['quality'] = [];
  for (const id of [...(row?.quality ?? [])].sort(cmp)) {
    const rule = ctx.qualityRules.get(id);
    if (rule === undefined) {
      ctx.logOnce(`card:quality:${id}`, `quality rule ${id} is not in qualityRules`);
      continue;
    }
    quality.push({ label: rule.label, tier: rule.tier, valueTier: rule.valueTier });
  }

  let localProgram = false;
  if (!pipeline)
    for (const id of s.parcelIds) {
      const i = ctx.input.parcels.index.get(id);
      if (i !== undefined && ctx.input.parcels.localProgram[i] === 1) localProgram = true;
    }

  return {
    projectId: s.projectId,
    origin: s.origin,
    label,
    pathway: s.pathway,
    units: rev.units,
    existingUnits: s.existingUnits,
    stories,
    storiesTier,
    massing: massingOf(s, b, rev.units),
    multiPhase: s.multiPhase,
    phase: s.phase,
    localProgram,
    stages,
    revisions: s.revisions.filter((r) => r.day <= day).map((r) => ({ ...r })),
    end: s.end.kind !== 'open' && s.end.day <= day ? { ...s.end } : null,
    sources: (row?.sources ?? []).map((x) => ({ ...x })),
    quality
  };
}
