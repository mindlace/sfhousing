/**
 * The time-aware scoreboard as pure functions of a T8 `TimelineScore` and a month index
 * (spec §4.5). No DOM, no state: the components read these on every frame, so each is O(1) in
 * project count.
 */
import { formatCompactCount, formatCount, formatPercent } from '$lib/scoreboard';
import type { TimelineScore } from '$lib/sim/protocol';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import type { Day } from '$lib/timelapse/time';
import { formatMonthYear } from './format';
import { inStageLabel } from './labels';
import { YEAR_2045, monthIndex, utcParts } from './time';
import type { Marker, ScoreAt } from './types';

const RHNA_ID = 'rhna';
const EN_DASH = '–';
const CALCULATING = 'Range: calculating…';
const STILL_CALCULATING = ' (still calculating)';

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
  const planBand = score.planEffectBand[i];
  const band = score.band[i];
  return {
    monthIndex: i,
    total: base + shown.completedNet,
    actual: base,
    pipeline: shown.completedNetPipeline,
    fresh: shown.completedNetNew,
    planCompleted: plan ? plan.completedNetNew : null,
    planEntitled: plan ? plan.entitledNew : null,
    planBand: planBand ? { low: planBand.p10, high: planBand.p90 } : null,
    band: band ? { low: base + band.p10, high: base + band.p90 } : null,
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

function range(low: number, high: number): string {
  return `${formatCount(low)}${EN_DASH}${formatCount(high)}`;
}

/** Item 5: the 8-in-10 range of the total, which includes the baseline (same basis as `shown`). */
export function bandLine(
  score: TimelineScore,
  i: number,
  provisional: boolean
): { text: string; busy: boolean } {
  const b = scoreAt(score, i).band;
  if (!b) return { text: CALCULATING, busy: true };
  return {
    text: `In 8 of 10 simulated futures: ${range(b.low, b.high)}${provisional ? STILL_CALCULATING : ''}`,
    busy: provisional
  };
}

/** Item 5a: the plan effect's range. A difference of two runs, so no baseline. */
export function planBandLine(
  score: TimelineScore,
  i: number,
  provisional: boolean
): { text: string; busy: boolean } {
  const b = scoreAt(score, i).planBand;
  if (!b) return { text: CALCULATING, busy: true };
  return {
    text: `In 8 of 10 futures: ${range(b.low, b.high)}${provisional ? STILL_CALCULATING : ''}`,
    busy: provisional
  };
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

function rhnaFraction(at: ScoreAt): number | null {
  const t = at.targets.find((x) => x.tp.target.id === RHNA_ID);
  return t ? t.tp.fraction : null;
}

/** The sr-only live-region text once the day settles. */
export function announcement(day: Day, at: ScoreAt): string {
  const f = rhnaFraction(at);
  const tail = f === null ? '.' : `, ${formatPercent(f)} of RHNA.`;
  return `${formatMonthYear(day)}: ${formatCount(at.total)} net new homes in this simulation${tail}`;
}

/** Line 1 of the collapsed mobile bar. */
export function barText(at: ScoreAt): string {
  const f = rhnaFraction(at);
  const head = `${formatCompactCount(at.total)} net new homes`;
  return f === null ? head : `${head} · ${formatPercent(f)} of RHNA`;
}
