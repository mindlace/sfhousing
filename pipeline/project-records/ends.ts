/**
 * Project ends, exits and `lastObserved` (spec 4.6 and the first half of 4.7). Consumes the
 * already-clamped `entered` map from `stages.ts` and a `LinkedProject`.
 */
import { STAGE_ORDER } from '../../src/lib/timelapse/types';
import type { ExitReason, ProjectHistory, Stage } from '../../src/lib/timelapse/types';
import type { Day } from '../../src/lib/timelapse/time';
import { DEAD_STATUSES } from './link';
import type { LinkedProject, Permit, Prj } from './types';

type Entered = Partial<Record<Stage, Day>>;

/** Permit status (lower-case) to exit reason (spec 4.6 rule 2). */
const PERMIT_REASON: Record<string, ExitReason> = {
  withdrawn: 'withdrawn',
  cancelled: 'cancelled',
  revoked: 'cancelled',
  expired: 'expired',
  disapproved: 'disapproved'
};

/** Spec 4.6 rule 3: exact `record_status` and `project_decision` strings, in check order. */
const PLANNING_EXITS: { reason: ExitReason; statuses: string[]; decisions: string[] }[] = [
  {
    reason: 'withdrawn',
    statuses: ['Closed - Withdrawn', 'Withdrawn', 'Project Withdrawn'],
    decisions: ['Withdawn', 'Withdrawn']
  },
  { reason: 'cancelled', statuses: ['Closed - Cancelled', 'Cancelled'], decisions: ['Cancelled'] },
  {
    reason: 'disapproved',
    statuses: ['Disapproved', 'Closed - Disapproved', 'Denied'],
    decisions: ['Disapproved']
  }
];

function firstEntered(entered: Entered): Day | null {
  let min: Day | null = null;
  for (const s of STAGE_ORDER) {
    const d = entered[s];
    if (d !== undefined && (min === null || d < min)) min = d;
  }
  return min;
}

/**
 * The latest valid date across the project's records (anchors' open, close and decision days;
 * children's open and close; review start and end; every permit's filed, issued, first
 * construction document, completed, status and last-activity days; pipeline status days), clamped
 * to `[first entered day, asOf]`. Satellites are sources only and do not contribute.
 *
 * With no dates found, the first entered day; with nothing entered either, `asOf`. With an empty
 * `entered` map the result is the max found date clamped to `asOf`.
 */
export function lastObserved(proj: LinkedProject, entered: Entered, asOf: Day): Day {
  let max: Day | null = null;
  const see = (d: Day | null): void => {
    if (d !== null && (max === null || d > max)) max = d;
  };
  for (const a of proj.anchors) {
    see(a.openDay);
    see(a.closeDay);
    see(a.decisionDay);
  }
  for (const c of proj.children) {
    see(c.openDay);
    see(c.closeDay);
  }
  for (const r of proj.reviews) {
    see(r.startDay);
    see(r.endDay);
  }
  for (const q of proj.permits) {
    see(q.filedDay);
    see(q.issuedDay);
    see(q.fcdDay);
    see(q.completedDateDay);
    see(q.statusDay);
    see(q.lastActivityDay);
  }
  for (const row of proj.pipelineRows) see(row.statusDay);

  const first = firstEntered(entered);
  if (max === null) return first ?? asOf;
  const capped = Math.min(max, asOf);
  return first === null ? capped : Math.max(first, capped);
}

/**
 * An exit: the stage is the latest entered stage with an entry day on or before the exit day, else
 * the first entered stage; the day is no earlier than that stage's entry. Null when nothing is
 * entered (deriveProjects drops such histories later).
 */
function exitAt(
  entered: Entered,
  reason: ExitReason,
  day: Day
): { kind: 'exit'; stage: Stage; reason: ExitReason; day: Day } | null {
  let stage: Stage | null = null;
  let first: Stage | null = null;
  for (const s of STAGE_ORDER) {
    const d = entered[s];
    if (d === undefined) continue;
    if (first === null) first = s;
    if (d <= day) stage = s;
  }
  stage ??= first;
  if (stage === null) return null;
  return { kind: 'exit', stage, reason, day: Math.max(day, entered[stage] as Day) };
}

/** Rule 2: the last-dead permit decides (latest status day, then highest number). */
function lastDead(permits: Permit[], fallback: Day): { permit: Permit; day: Day } {
  let best: { permit: Permit; day: Day } | null = null;
  for (const q of permits) {
    const day = q.statusDay ?? fallback;
    if (best === null || day > best.day || (day === best.day && q.number > best.permit.number)) {
      best = { permit: q, day };
    }
  }
  return best as { permit: Permit; day: Day };
}

function planningReason(a: Prj): ExitReason | null {
  for (const e of PLANNING_EXITS) {
    if (a.status !== null && e.statuses.includes(a.status)) return e.reason;
    if (a.decision !== null && e.decisions.includes(a.decision)) return e.reason;
  }
  return null;
}

/**
 * Spec 4.6, rules applied in order, first match decides. `entered` is the clamped stage history;
 * an empty map gives `{ kind: 'open' }` whenever an exit would need a stage.
 */
export function endOf(
  proj: LinkedProject,
  entered: Entered,
  ctx: { asOf: Day; ppaLag: number }
): ProjectHistory['end'] {
  const last = lastObserved(proj, entered, ctx.asOf);
  const open = { kind: 'open' as const, lastObserved: last };
  if (proj.kind === 'pipelineOnly') return open;

  // 1. Complete.
  if (entered.complete !== undefined) return { kind: 'complete', day: entered.complete };

  // 2. Permit exit.
  if (
    proj.permits.length > 0 &&
    proj.live.length === 0 &&
    proj.permits.every((q) => DEAD_STATUSES.has(q.status))
  ) {
    const { permit, day } = lastDead(proj.permits, last);
    return exitAt(entered, PERMIT_REASON[permit.status], day) ?? open;
  }

  if (proj.kind === 'ppaOnly') {
    // 5. PPA-only.
    const ppa = proj.children[0];
    if (ppa === undefined) return open;
    if (ppa.status === 'Closed - Withdrawn' || ppa.status === 'Closed - Cancelled') {
      const reason = ppa.status === 'Closed - Withdrawn' ? 'withdrawn' : 'cancelled';
      return exitAt(entered, reason, ppa.closeDay ?? last) ?? open;
    }
    if (ppa.openDay !== null && ctx.asOf - ppa.openDay > ctx.ppaLag) {
      return exitAt(entered, 'withdrawn', ppa.closeDay ?? ppa.openDay) ?? open;
    }
    return open;
  }

  if (proj.permits.length === 0) {
    // 3. Planning exit: the first anchor (recordId order) that matches decides.
    for (const a of [...proj.anchors].sort((x, y) => (x.recordId < y.recordId ? -1 : 1))) {
      const reason = planningReason(a);
      if (reason !== null) {
        return exitAt(entered, reason, a.decisionDay ?? a.closeDay ?? last) ?? open;
      }
    }

    // 4. Closed without a decision.
    if (
      proj.anchors.length > 0 &&
      entered.entitled === undefined &&
      proj.anchors.every((a) => a.status === 'Closed' && !a.decision)
    ) {
      let close: Day | null = null;
      for (const a of proj.anchors) {
        if (a.closeDay !== null && (close === null || a.closeDay > close)) close = a.closeDay;
      }
      return exitAt(entered, 'withdrawn', close ?? last) ?? open;
    }
  }

  // 6. Open.
  return open;
}
