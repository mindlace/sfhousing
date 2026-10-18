/**
 * Partner rulings on stale open histories (spec 4.6 "Stale open histories"): completion from
 * construction evidence (`pr.stages.complete-from-evidence`, Ruling C2), the statutory permit
 * expiry exit (`pr.stages.statutory-expiry`, Ruling E2) and the curated imagery verdicts
 * (`pr.stages.verified-construction`, Ruling C3). They rewrite a T4d history's `end` (and, for a
 * completion, `entered.complete`). deriveProjects applies them after the in-flight decision and
 * before DA netting: the evidence and verdict rules never touch an in-flight project's history,
 * while the statutory exit also ends an in-flight project's history, which then leaves flight
 * (Ruling I4). Pure.
 */
import { STAGE_ORDER } from '../../src/lib/timelapse/types';
import type { ProjectHistory, Stage } from '../../src/lib/timelapse/types';
import type { Day } from '../../src/lib/timelapse/time';
import type { ConstructionVerdict } from '../enrichment/construction-schema';
import { exitAt } from './ends';
import { eraOf, permitDeadline } from './expiry';
import { DEAD_STATUSES } from './link';
import { permitCompletionDay, unitBearingPermits } from './stages';
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

/** One xdht-4php completion: its day and its `bpa` (the row's id; null when absent). */
export interface HousingCompletion {
  day: Day;
  bpa: string | null;
}

/** xdht-4php completions by permit number and by resolved parcel, ascending by day, then bpa. */
export interface HousingIndex {
  byPermit: ReadonlyMap<string, HousingCompletion[]>;
  byParcel: ReadonlyMap<ParcelId, HousingCompletion[]>;
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
  const byPermit = new Map<string, HousingCompletion[]>();
  const byParcel = new Map<ParcelId, HousingCompletion[]>();
  const add = <K>(m: Map<K, HousingCompletion[]>, k: K, c: HousingCompletion) => {
    const xs = m.get(k);
    if (xs) xs.push(c);
    else m.set(k, [c]);
  };
  for (const r of rows) {
    if (r.firstCompletionDay === null) continue;
    // Ruling C4: only new-construction completions; a demolition (form 6) or alteration (3, 8)
    // row on the lot is often posted after the new permit's issuance and dates no completion.
    if (!NEW_CONSTRUCTION_FORMS.has(r.form ?? '') || r.netUnits === null || r.netUnits <= 0) {
      continue;
    }
    const c = { day: r.firstCompletionDay, bpa: r.bpa };
    if (r.bpa !== null) add(byPermit, r.bpa, c);
    if (r.blklot !== null) for (const id of resolve([r.blklot])) add(byParcel, id, c);
  }
  const order = (a: HousingCompletion, b: HousingCompletion) =>
    a.day - b.day || ((a.bpa ?? '') < (b.bpa ?? '') ? -1 : (a.bpa ?? '') > (b.bpa ?? '') ? 1 : 0);
  for (const m of [byPermit, byParcel]) for (const xs of m.values()) xs.sort(order);
  return { byPermit, byParcel };
}

/** The callbacks evidence (ii) reads (T13 `scenario_panel`). */
export type AssessorCtx = Pick<
  ProjectRecordsInput,
  'assessorUnits' | 'yearBuilt' | 'lienDay' | 'latestRollYear' | 'panelImputed'
>;

/** T11/T13 `imputed` bits evidence (ii) will not read: 3 (`existingUnits`) and 5 (row carried). */
const IMPUTED_UNITS_OR_CARRIED = (1 << 3) | (1 << 5);

/**
 * Ruling C2 applies: the history is open, its last entered stage is `construction`, and no
 * non-superseded permit is dead (a `complete` permit does not stop it; see `hasTerminalPermit`).
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
 *     before 2007); a parcel with no roll row counts 0 units, as in `existingUnitsAt`. A panel
 *     row whose `imputed` mask has bit 3 (units replaced) or bit 5 (row carried from the previous
 *     year) is not read (main's ruling 4): it is neither a baseline nor a gain, so a parcel adds
 *     to the gain only when both its baseline and year-Y rows are clean, and its `year_built`
 *     counts only from a clean row.
 * A multi-building project is dated by its first building's completion (the earliest (i) row or
 * the first qualifying roll year): accepted by main's ruling 4.
 * `bpas` are the sorted, unique `bpa` ids of the xdht rows that date an (i) completion (the
 * history lists them in `sources`); [] for (ii). Null when neither holds.
 */
export function evidenceDay(
  proj: LinkedProject,
  entered: Entered,
  units: number,
  ctx: { housing: HousingIndex; assessor: AssessorCtx }
): { day: Day; source: 'xdht' | 'assessor'; bpas: string[] } | null {
  const start = entered.construction;
  if (start === undefined) return null;
  const candidates: HousingCompletion[] = [];
  for (const q of proj.permits) candidates.push(...(ctx.housing.byPermit.get(q.number) ?? []));
  for (const id of proj.parcelIds) candidates.push(...(ctx.housing.byParcel.get(id) ?? []));
  const after = candidates.filter((c) => c.day >= start);
  if (after.length > 0) {
    const day = Math.min(...after.map((c) => c.day));
    const bpas = new Set<string>();
    for (const c of after) if (c.day === day && c.bpa !== null) bpas.add(c.bpa);
    return { day, source: 'xdht', bpas: [...bpas].sort() };
  }

  const a = ctx.assessor;
  const clean = (id: ParcelId, y: number) =>
    ((a.panelImputed(id, y) ?? 0) & IMPUTED_UNITS_OR_CARRIED) === 0;
  const startYear = yearOf(start);
  const baseYear = Math.min(Math.max(startYear, FIRST_ROLL_YEAR), a.latestRollYear);
  const gain = (y: number) => {
    let g = 0;
    for (const id of proj.parcelIds) {
      if (!clean(id, baseYear) || !clean(id, y)) continue;
      g += (a.assessorUnits(id, y) ?? 0) - (a.assessorUnits(id, baseYear) ?? 0);
    }
    return g;
  };
  const need = Math.min(units, Math.ceil(0.5 * units));
  for (let y = Math.max(startYear + 1, FIRST_ROLL_YEAR); y <= a.latestRollYear; y++) {
    const built = proj.parcelIds.some(
      (id) => clean(id, y) && (a.yearBuilt(id, y) ?? -Infinity) >= startYear
    );
    if ((units >= 1 && gain(y) >= need) || built) {
      const lien = a.lienDay(y);
      if (lien !== null) return { day: lien, source: 'assessor', bpas: [] };
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
 * Ruling E2's exit test over the unit-bearing permits, at least one: each has a deadline (an
 * issued day and an era with a completion maximum); every deadline is before `asOf`; none has
 * activity after its own deadline; none is `reinstated` (a `suspend` status does not block).
 * `day` is the latest deadline when the test passes, else null. A project with a unit-bearing
 * permit that has a completion day (`permitCompletionDay`) or status `complete` is excluded
 * (`excludedComplete`, main's ruling 2: I3 rejected; a building of the project was finished, so
 * the remaining permits do not expire it) and stays open. `permits` counts the unit-bearing
 * permits whose deadline reads a Table B bracket (era E0-E2) and `noValuation` those of them with
 * no recorded valuation, which took the middle bracket.
 */
export function expiryTest(
  proj: LinkedProject,
  asOf: Day
): { day: Day | null; permits: number; noValuation: number; excludedComplete: boolean } {
  const open = unitBearingPermits(proj);
  const excludedComplete = open.some(
    (q) => q.status === 'complete' || permitCompletionDay(q, proj.completions) !== null
  );
  // The not-complete, E0-E2 permits: the deadlines read from a Table B bracket (spec 4.11).
  const bracketed = open.filter((q) => {
    const era = eraOf(q);
    return q.status !== 'complete' && era !== null && era !== 'E3';
  });
  const noValuation = bracketed.filter((q) => q.valuation === null).length;
  let day: Day | null = null;
  let pass = open.length > 0 && !excludedComplete;
  // An excluded history reads no deadline, so none of its permits counts (spec 4.11).
  if (excludedComplete) return { day: null, permits: 0, noValuation: 0, excludedComplete };
  for (const q of open) {
    const deadline = permitDeadline(q);
    if (deadline === null || deadline >= asOf) pass = false;
    else if (q.lastActivityDay !== null && q.lastActivityDay > deadline) pass = false;
    else if (q.status === 'reinstated') pass = false;
    else if (day === null || deadline > day) day = deadline;
  }
  return { day: pass ? day : null, permits: bracketed.length, noValuation, excludedComplete };
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
