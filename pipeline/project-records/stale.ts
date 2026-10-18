/**
 * Partner rulings on stale open histories (spec 4.6 "Stale open histories"): completion from
 * construction evidence (`pr.stages.complete-from-evidence`, Ruling C2), the statutory permit
 * expiry exit (`pr.stages.statutory-expiry`, Ruling E2) and the curated imagery verdicts
 * (`pr.stages.verified-construction`, Ruling C3). They rewrite a T4d history's `end` (and, for a
 * completion, `entered.complete`) only: deriveProjects applies them after the in-flight decision
 * and never to a history whose project is in flight, so T3 is unchanged. Pure.
 */
import { STAGE_ORDER } from '../../src/lib/timelapse/types';
import type { ProjectHistory, Stage } from '../../src/lib/timelapse/types';
import type { Day } from '../../src/lib/timelapse/time';
import type { ConstructionVerdict } from '../enrichment/construction-schema';
import { exitAt } from './ends';
import { eraOf, permitDeadline } from './expiry';
import { DEAD_STATUSES } from './link';
import { unitBearingPermits } from './stages';
import type { HousingRow, LinkedProject, ProjectRecordsInput } from './types';
import type { ParcelId } from '../../src/lib/data/parcel';

type Entered = Partial<Record<Stage, Day>>;
type End = ProjectHistory['end'];

const DAY_MS = 86_400_000;
const FIRST_ROLL_YEAR = 2007;

/** The last entered stage in `STAGE_ORDER`, or null. */
export function lastEnteredStage(entered: Entered): Stage | null {
  let last: Stage | null = null;
  for (const s of STAGE_ORDER) if (entered[s] !== undefined) last = s;
  return last;
}

/**
 * A terminal permit: a dead one (withdrawn, cancelled, expired, disapproved, revoked) that was not
 * superseded by a later filing, so it sits alongside the live ones. A `complete` permit is not
 * terminal: one finished building of several is itself completion evidence (as in the partner's
 * measurement of the 197 open-at-construction histories, which kept such projects).
 */
function hasTerminalPermit(proj: LinkedProject): boolean {
  return proj.permits.some((q) => !proj.superseded.has(q.number) && DEAD_STATUSES.has(q.status));
}

/** xdht-4php completion days by permit number and by resolved parcel, ascending. */
export interface HousingIndex {
  byPermit: ReadonlyMap<string, Day[]>;
  byParcel: ReadonlyMap<ParcelId, Day[]>;
}

/** xdht-4php `form_no` values of new construction (Ruling C4). */
const NEW_CONSTRUCTION_FORMS: ReadonlySet<string> = new Set(['1', '2']);

/**
 * Indexes the valid xdht completion days of new-construction rows (form 1 or 2, net units > 0;
 * Ruling C4); `resolve` maps a block-lot to its current parcels.
 */
export function indexHousing(
  rows: readonly HousingRow[],
  resolve: (blklots: string[]) => ParcelId[]
): HousingIndex {
  const byPermit = new Map<string, Day[]>();
  const byParcel = new Map<ParcelId, Day[]>();
  const add = <K>(m: Map<K, Day[]>, k: K, d: Day) => {
    const xs = m.get(k);
    if (xs) xs.push(d);
    else m.set(k, [d]);
  };
  for (const r of rows) {
    if (r.firstCompletionDay === null) continue;
    // Ruling C4: only new-construction completions; a demolition (form 6) or alteration (3, 8)
    // row on the lot is often posted after the new permit's issuance and dates no completion.
    if (!NEW_CONSTRUCTION_FORMS.has(r.form ?? '') || r.netUnits === null || r.netUnits <= 0) {
      continue;
    }
    if (r.bpa !== null) add(byPermit, r.bpa, r.firstCompletionDay);
    if (r.blklot !== null)
      for (const id of resolve([r.blklot])) add(byParcel, id, r.firstCompletionDay);
  }
  for (const m of [byPermit, byParcel]) for (const xs of m.values()) xs.sort((a, b) => a - b);
  return { byPermit, byParcel };
}

/** The callbacks evidence (ii) reads (T13 `scenario_panel`). */
export type AssessorCtx = Pick<
  ProjectRecordsInput,
  'assessorUnits' | 'yearBuilt' | 'lienDay' | 'latestRollYear'
>;

/**
 * Ruling C2 applies: the history is open, its last entered stage is `construction`, and no
 * non-superseded permit is complete or dead.
 */
export function evidenceApplies(proj: LinkedProject, entered: Entered, end: End): boolean {
  return (
    end.kind === 'open' && lastEnteredStage(entered) === 'construction' && !hasTerminalPermit(proj)
  );
}

function yearOf(d: Day): number {
  return new Date(d * DAY_MS).getUTCFullYear();
}

/**
 * Ruling C2 evidence, build-time data only, (i) before (ii):
 * (i) the earliest xdht-4php `first_completion_date` on or after the construction day, on a
 *     new-construction row (form 1 or 2, net units > 0; Ruling C4) whose `bpa` is one of the
 *     project's permits or whose `blocklot` resolves into its parcels;
 * (ii) the `lien_day` of the first roll year Y after the construction year in which Σ assessor
 *     units over the project's parcels exceed the baseline by at least min(units, ⌈units / 2⌉),
 *     or in which a parcel's `year_built` is at least the construction year. The baseline is the
 *     last roll year at or before the construction year, clamped to 2007..latest (no roll exists
 *     before 2007); a parcel with no roll row counts 0 units, as in `existingUnitsAt`.
 * Null when neither holds.
 */
export function evidenceDay(
  proj: LinkedProject,
  entered: Entered,
  units: number,
  ctx: { housing: HousingIndex; assessor: AssessorCtx }
): { day: Day; source: 'xdht' | 'assessor' } | null {
  const start = entered.construction;
  if (start === undefined) return null;
  let best: Day | null = null;
  const see = (days: readonly Day[] | undefined) => {
    const d = days?.find((x) => x >= start);
    if (d !== undefined && (best === null || d < best)) best = d;
  };
  for (const q of proj.permits) see(ctx.housing.byPermit.get(q.number));
  for (const id of proj.parcelIds) see(ctx.housing.byParcel.get(id));
  if (best !== null) return { day: best, source: 'xdht' };

  const a = ctx.assessor;
  const startYear = yearOf(start);
  const sum = (y: number) => {
    let s = 0;
    for (const id of proj.parcelIds) s += a.assessorUnits(id, y) ?? 0;
    return s;
  };
  const baseYear = Math.min(Math.max(startYear, FIRST_ROLL_YEAR), a.latestRollYear);
  const base = sum(baseYear);
  const need = Math.min(units, Math.ceil(0.5 * units));
  for (let y = Math.max(startYear + 1, FIRST_ROLL_YEAR); y <= a.latestRollYear; y++) {
    const built = proj.parcelIds.some((id) => (a.yearBuilt(id, y) ?? -Infinity) >= startYear);
    if ((units >= 1 && sum(y) - base >= need) || built) {
      const lien = a.lienDay(y);
      if (lien !== null) return { day: lien, source: 'assessor' };
    }
  }
  return null;
}

/**
 * `entered` with `complete` at `day`, forward-clamped to the latest entered day (spec 4.5); the
 * flag says the clamp moved it.
 */
export function completeAt(entered: Entered, day: Day): { entered: Entered; clamped: boolean } {
  const latest = Math.max(...Object.values(entered));
  return {
    entered: { ...entered, complete: Math.max(day, latest) },
    clamped: day < latest
  };
}

/** Ruling E2 applies: the history is open and its last entered stage is permit-issued or later. */
export function expiryApplies(entered: Entered, end: End): boolean {
  const s = lastEnteredStage(entered);
  return end.kind === 'open' && (s === 'permitIssued' || s === 'construction');
}

/**
 * Ruling E2's exit test over the unit-bearing permits that are not `complete` (finished work does
 * not expire; the partner's measurement read "all permits that carry an issue day and are not
 * complete"), at least one: each has a deadline (an issued day and an era with a completion
 * maximum); every deadline is before `asOf`; none has activity after its own deadline; none is
 * `reinstated` (a `suspend` status does not block). `day` is the latest deadline when the test
 * passes, else null. `permits` counts those permits whose deadline reads a Table B bracket (era
 * E0-E2) and `noValuation` those of them with no recorded valuation, which took the middle
 * bracket.
 */
export function expiryTest(
  proj: LinkedProject,
  asOf: Day
): { day: Day | null; permits: number; noValuation: number } {
  const open = unitBearingPermits(proj).filter((q) => q.status !== 'complete');
  const bracketed = open.filter((q) => {
    const era = eraOf(q);
    return era !== null && era !== 'E3';
  });
  const noValuation = bracketed.filter((q) => q.valuation === null).length;
  let day: Day | null = null;
  let pass = open.length > 0;
  for (const q of open) {
    const deadline = permitDeadline(q);
    if (deadline === null || deadline >= asOf) pass = false;
    else if (q.lastActivityDay !== null && q.lastActivityDay > deadline) pass = false;
    else if (q.status === 'reinstated') pass = false;
    else if (day === null || deadline > day) day = deadline;
  }
  return { day: pass ? day : null, permits: bracketed.length, noValuation };
}

/** The statutory-expiry exit: `expired` at the last entered stage, dated by the deadline (L1). */
export function expiryExit(entered: Entered, day: Day): End | null {
  return exitAt(entered, 'expired', day);
}

/**
 * A curated verdict applied to an open history (Ruling C3): `complete` at `completeDay`
 * (forward-clamped), `dead` an exit `withdrawn` at the last entered stage dated by `checked`
 * (L1), `unknown` no change (null). A day after `asOf` is not applied (null, with a reason).
 */
export function verdictEnd(
  entered: Entered,
  v: ConstructionVerdict,
  asOf: Day
): { end: End; entered: Entered; clamped: boolean } | { skip: string } | null {
  const dayOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
  if (v.verdict === 'unknown') return null;
  if (v.verdict === 'complete') {
    const d = dayOf(v.completeDay as string);
    if (d > asOf) return { skip: `completeDay ${v.completeDay} is after the snapshot` };
    const c = completeAt(entered, d);
    return { end: { kind: 'complete', day: c.entered.complete as Day }, ...c };
  }
  const d = dayOf(v.checked);
  if (d > asOf) return { skip: `checked ${v.checked} is after the snapshot` };
  const end = exitAt(entered, 'withdrawn', d);
  return end === null ? null : { end, entered, clamped: false };
}
