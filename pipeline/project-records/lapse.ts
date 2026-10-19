/**
 * Lapsed approvals on open histories at `entitled` (spec 4.6, partner ruling 2b-d): the inferred
 * lapse of a discretionary approval (`pr.stages.inferred-lapse`, Ruling IL1) and the statutory
 * expiry of a streamlined one (`pr.stages.streamlined-expiry`, Ruling SE1). The activity tests
 * follow the linkage measurement (`linkage-measure.md` section 6). Pure; derive.ts applies them.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Day } from '../../src/lib/timelapse/time';
import type { ProjectHistory, Stage } from '../../src/lib/timelapse/types';
import {
  LAPSE_GRACE_DAYS,
  affordableExempt,
  discretionaryExpiry,
  streamlinedExpiry
} from './entitlement';
import { lapseInstrument } from './classify';
import { lastEnteredStage } from './stale';
import type { LinkedProject } from './types';

type End = ProjectHistory['end'];
type Entered = Partial<Record<Stage, Day>>;

/** The current parcels a project's parcels or lots stand for: `parcelIds` and their descendants. */
export function parcelFamily(
  proj: Pick<LinkedProject, 'parcelIds' | 'blklots'>,
  descendants: (blklot: string) => readonly ParcelId[]
): Set<ParcelId> {
  const out = new Set<ParcelId>(proj.parcelIds);
  for (const b of new Set<string>([...proj.blklots, ...proj.parcelIds])) {
    for (const id of descendants(b)) out.add(id);
  }
  return out;
}

/** One project's dated activity for the IL1 test: its entered stage days and permit filed days. */
export interface Activity {
  proj: LinkedProject;
  days: readonly Day[];
}

/** The activities by parcel (`parcelIds`), for `otherActivity`. */
export function activityIndex(items: readonly Activity[]): Map<ParcelId, Activity[]> {
  const out = new Map<ParcelId, Activity[]>();
  for (const it of items) {
    for (const id of it.proj.parcelIds) {
      const list = out.get(id);
      if (list) list.push(it);
      else out.set(id, [it]);
    }
  }
  return out;
}

/**
 * Ruling IL1: another linked project (any kind) on the family's parcels with a stage day or permit
 * filed day on or after `since`. A project sharing an anchor Planning record (a split part of the
 * same case) is not another project.
 */
export function otherActivity(
  proj: LinkedProject,
  family: ReadonlySet<ParcelId>,
  index: ReadonlyMap<ParcelId, readonly Activity[]>,
  since: Day
): boolean {
  const own = new Set(proj.anchors.map((a) => a.recordId));
  const seen = new Set<string>([proj.id]);
  for (const id of family) {
    for (const it of index.get(id) ?? []) {
      if (seen.has(it.proj.id)) continue;
      seen.add(it.proj.id);
      if (it.proj.anchors.some((a) => own.has(a.recordId))) continue;
      if (it.days.some((d) => d >= since)) return true;
    }
  }
  return false;
}

/**
 * The DA / PRX exclusion of Rulings IL1 and SE1: a DVA child record, a pipeline row naming a
 * development agreement, or a parcel (or descendant) in a DA or multi-phase master's parcels.
 */
export function daExcluded(
  proj: LinkedProject,
  family: ReadonlySet<ParcelId>,
  daParcels: ReadonlySet<ParcelId>
): boolean {
  if (proj.children.some((c) => c.type === 'DVA')) return true;
  if (proj.pipelineRows.some((r) => r.da !== null)) return true;
  for (const id of family) if (daParcels.has(id)) return true;
  return false;
}

/** An open history whose last entered stage is `entitled`: its entitled day and last observed. */
function openAtEntitled(entered: Entered, end: End | null): { entitled: Day; seen: Day } | null {
  if (end === null || end.kind !== 'open' || lastEnteredStage(entered) !== 'entitled') return null;
  return { entitled: entered.entitled as Day, seen: end.lastObserved };
}

export interface LapseCtx {
  asOf: Day;
  family: ReadonlySet<ParcelId>;
  index: ReadonlyMap<ParcelId, readonly Activity[]>;
  daParcels: ReadonlySet<ParcelId>;
}

/** Ruling IL2a: a `building_permits` token that looks like a permit number. */
export function isPermitToken(token: string): boolean {
  return /^\d{6,}[A-Z]?$/.test(token) || /^BLDG-/i.test(token);
}

/**
 * Which lapse rule a history takes (Rulings IL1, SE1, SE2): `inferred` for a discretionary one or
 * a Housing Choice-SF one, `streamlined` for SB 35 / SB 423 / AB 2011, `none` for HSD and AB 2162
 * (and for a history on no pathway, or permit-only).
 */
export function lapseRule(
  proj: LinkedProject,
  pathway: string | null
): 'inferred' | 'streamlined' | 'none' {
  if (pathway === 'discretionary') return 'inferred';
  if (pathway !== 'streamlined') return 'none';
  const i = lapseInstrument(proj);
  return i === 'statutory' ? 'streamlined' : i === 'hcsf' ? 'inferred' : 'none';
}

/** Ruling SE2: an open streamlined history at `entitled` with no lapse rule (HSD, AB 2162). */
export function lapseNoRule(
  proj: LinkedProject,
  pathway: string | null,
  entered: Entered,
  end: End | null
): boolean {
  return (
    pathway === 'streamlined' &&
    lapseRule(proj, pathway) === 'none' &&
    openAtEntitled(entered, end) !== null
  );
}

/**
 * Ruling IL1's test, in or out of flight: an open discretionary (or Housing Choice-SF, Ruling SE2)
 * history at `entitled` whose project holds no permit (after linkage) and whose Planning records
 * name none in `building_permits` (Rulings IL2, IL2a), no child record opened after the entitled
 * day, no DA tie, and no other project active on its parcels since entitled - 365. Null when it
 * fails; else
 * the rule expiry and `due` = max(rule expiry, last observed). The caller exits a project not in
 * flight at `due + LAPSE_GRACE_DAYS` when that is on or before asOf, and flags an in-flight one
 * when `due` is.
 */
export function inferredLapse(
  proj: LinkedProject,
  pathway: string | null,
  entered: Entered,
  end: End | null,
  ctx: LapseCtx
): { expiry: Day; due: Day; exitDay: Day } | null {
  if (lapseRule(proj, pathway) !== 'inferred') return null;
  const o = openAtEntitled(entered, end);
  if (o === null) return null;
  if (proj.permits.length > 0) return null;
  // Ruling IL2: a named permit means one was filed, fetched or not (a satellite implies a permit).
  if (proj.anchors.some((a) => a.permits.some(isPermitToken))) return null;
  if (proj.children.some((c) => c.openDay !== null && c.openDay > o.entitled)) return null;
  if (daExcluded(proj, ctx.family, ctx.daParcels)) return null;
  if (otherActivity(proj, ctx.family, ctx.index, o.entitled - 365)) return null;
  const expiry = discretionaryExpiry(o.entitled);
  const due = Math.max(expiry, o.seen);
  return { expiry, due, exitDay: due + LAPSE_GRACE_DAYS };
}

/**
 * Ruling SE1's test (SE2: SB 35 / SB 423 / AB 2011 evidence only): an open streamlined history at
 * `entitled`, with no DA tie. Null when it
 * fails; `exempt` when the primary Planning record proposes half or more affordable units (it
 * never expires); else its expiry day (the caller exits it when that is on or before asOf).
 */
export function streamlinedLapse(
  proj: LinkedProject,
  pathway: string | null,
  entered: Entered,
  end: End | null,
  ctx: Pick<LapseCtx, 'family' | 'daParcels'>
): { exempt: true } | { exempt: false; day: Day } | null {
  if (lapseRule(proj, pathway) !== 'streamlined') return null;
  const o = openAtEntitled(entered, end);
  if (o === null) return null;
  if (daExcluded(proj, ctx.family, ctx.daParcels)) return null;
  const p = proj.primary;
  if (affordableExempt(p?.affordableProp ?? null, p?.unitsProp ?? null)) return { exempt: true };
  return { exempt: false, day: streamlinedExpiry(o.entitled) };
}

/** The exit both rules give: `{ entitled, expired, day }`. */
export function lapseExit(day: Day): End {
  return { kind: 'exit', stage: 'entitled', reason: 'expired', day };
}
