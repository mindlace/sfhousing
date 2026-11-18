/**
 * The time-aware scoreboard as pure functions of a T8 `TimelineScore` and a month index
 * (spec §4.5). No DOM, no state: the components read these on every frame, so each is O(1) in
 * project count.
 */
import { formatCount } from '$lib/scoreboard';
import type { TimelineScore } from '$lib/sim/protocol';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import type { Day } from '$lib/timelapse/time';
import { formatMonthYear, formatShortMonthYear } from './format';
import { inStageLabel } from './labels';
import { YEAR_2045, monthIndex, utcParts } from './time';
import type { Marker, ScoreAt } from './types';

/** The id of the RHNA target in `score.targets`. */
export const RHNA_ID = 'rhna';
import { CALCULATING } from './copy';

export { CALCULATING };

type OpenStage = Exclude<Stage, 'complete'>;

/** Stages that can hold in-progress units, in T2 order. */
const OPEN_STAGES: OpenStage[] = STAGE_ORDER.filter((s): s is OpenStage => s !== 'complete');

/** The month index of `deadline` in the score's monthly series. */
export function deadlineIndex(score: TimelineScore, deadline: Day): number {
  return monthIndex(deadline, score.months[0], score.months.length);
}

/** The scoreboard at month index `i`. */
export function scoreAt(score: TimelineScore, i: number): ScoreAt {
  const shown = score.shown[i];
  const base = score.baseline.completedNet;
  const plan = score.planEffect[i];
  return {
    monthIndex: i,
    total: base + shown.completedNet,
    actual: base,
    pipeline: shown.completedNetPipeline,
    fresh: shown.completedNetNew,
    planCompleted: plan ? plan.completedNetNew : null,
    planEntitled: plan ? plan.entitledNew : null,
    inProgress: OPEN_STAGES.map((stage) => ({ stage, units: shown.inProgress[stage] })),
    exitedUnits: shown.exitedUnits,
    targets: score.targets.map((t) => ({
      tp: { target: t.target, fraction: t.fraction[i] },
      atDeadline: t.fraction[deadlineIndex(score, t.deadline)]
    }))
  };
}

/**
 * One row per stage that has units: `STAGE_ORDER` stages first, then any other key (a stage the
 * labels do not know yet still renders, as its id).
 */
export function inProgressRows(
  rec: Record<string, number>
): { stage: string; label: string; units: number }[] {
  const known: string[] = OPEN_STAGES.filter((s) => s in rec);
  const extra = Object.keys(rec).filter((k) => !(STAGE_ORDER as readonly string[]).includes(k));
  return [...known, ...extra].map((stage) => ({
    stage,
    label: inStageLabel(stage),
    units: rec[stage]
  }));
}

/** Item 13: the multi-phase footnote; `null` when no master plan is in the data. */
export function phasingFootnote(p: TimelineScore['phasing']): string | null {
  if (p.masters <= 0) return null;
  let text =
    `Multi-phase projects: ${formatCount(p.phasesScheduled)} phases scheduled from published plans, ` +
    `${formatCount(p.phasesEstimated)} estimated from past projects`;
  if (p.unenriched.length > 0) {
    const drawn = p.unenriched.filter((u) => u.drawn).length;
    const scoreOnly = p.unenriched.length - drawn;
    const clauses: string[] = [];
    if (drawn > 0) clauses.push(`${drawn} drawn as one footprint on a free lot`);
    if (scoreOnly > 0) clauses.push(`${scoreOnly} counted in the score but not drawn`);
    text +=
      `; ${p.unenriched.length} projects without phase data are simulated as one project each: ` +
      clauses.join(', ');
  }
  return `${text}.`;
}

/** The earliest `by` that falls in 2045, else 2045-01-01 (OD-T4). */
function day2045(score: TimelineScore): Day {
  const in2045 = score.references.map((r) => r.by).filter((d) => utcParts(d).y === 2045);
  return in2045.length > 0 ? Math.min(...in2045) : YEAR_2045;
}

/** The two jump buttons on the scrubber track (spec §4.4). */
export function scrubMarkers(score: TimelineScore): Marker[] {
  const markers: Marker[] = [];
  const rhna = score.targets.find((t) => t.target.id === RHNA_ID);
  if (rhna) {
    markers.push({
      day: rhna.deadline,
      label: 'RHNA deadline',
      name: `Jump to RHNA deadline, ${formatMonthYear(rhna.deadline)}`
    });
  }
  markers.push({ day: day2045(score), label: '2045', name: 'Jump to 2045' });
  return markers;
}

/** The /sim header delta: "+1,234 from your policy", "−56 from your policy" (U+2212), "+0 …". */
export function fromPolicyText(n: number): string {
  return `${n < 0 ? '' : '+'}${formatCount(n)} from your policy`;
}

/** The header score's delta: "vs FZP +1,234", "vs FZP −56" (U+2212), "vs FZP +0". */
export function vsFzpText(n: number): string {
  return `vs FZP ${n < 0 ? '' : '+'}${formatCount(n)}`;
}

/** '15,234 homes built from Jun 2022 count toward the goal.' */
export function builtTowardGoalText(baseline: TimelineScore['baseline']): string {
  return `${formatCount(baseline.completedNet)} homes built from ${formatShortMonthYear(baseline.since)} count toward the goal.`;
}
