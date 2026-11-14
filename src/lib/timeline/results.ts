// The Results face and the header score from the stepped view (timeline-ui rules 26 and 27). Pure.
import { RHNA_ID, scoreAt } from '$lib/fzp/score-view';
import type { ScoreAt } from '$lib/fzp/types';
import { monthIndex, utcParts } from '$lib/fzp/time';
import type { TargetProgress } from '$lib/scoreboard/types';
import type { TimelineScore } from '$lib/sim/scenario/types';
import type { MonthRow, PlanRow, TimelineView } from '$lib/sim/world/score/types';
import type { TierUnits } from '$lib/timelapse/types';

/** The simulated cities average to fractions; the page shows whole homes. */
const whole = Math.round;

/** Whole numbers that sum to `total` (largest remainder), in the order given. */
function apportion(values: number[], total: number): number[] {
  const floors = values.map(Math.floor);
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = values
    .map((v, i) => ({ i, r: v - Math.floor(v) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]++;
    left--;
  }
  return floors;
}

function wholeRow(r: MonthRow): MonthRow {
  const net = whole(r.completedNet);
  const [pipeline, fresh] = apportion([r.completedNetPipeline, r.completedNetNew], net);
  const inProgress = { ...r.inProgress };
  for (const k of Object.keys(inProgress) as (keyof typeof inProgress)[]) {
    inProgress[k] = whole(inProgress[k]);
  }
  return {
    completedNet: net,
    completedNetPipeline: pipeline,
    completedNetNew: fresh,
    entitledNew: whole(r.entitledNew),
    inProgress,
    exitedUnits: whole(r.exitedUnits)
  };
}

const wholePlan = (p: PlanRow): PlanRow => ({
  entitledNew: whole(p.entitledNew),
  completedNetNew: whole(p.completedNetNew)
});

/**
 * Today's TimelineScore shape over the filled months: shown = the mean (rule 26), band p10/p50/p90
 * = lo/mean/hi, planEffectBand from the view's planEffectBand, tiers from view.tiers +
 * tierBaseline + tierTargets, money = view.money (its perAddedHome and displacedShare are the
 * view's own).
 */
export function scoreOfView(view: TimelineView, tierBaseline: TierUnits | null): TimelineScore {
  const k = view.filledThrough + 1;
  const mean = view.mean.slice(0, k);
  return {
    months: view.months,
    shown: mean.map(wholeRow),
    planEffect: view.planEffect.slice(0, k).map(wholePlan),
    planEffectBand: view.planEffectBand.slice(0, k).map((b, i) => ({
      p10: whole(b.lo.completedNetNew),
      p50: whole(view.planEffect[i].completedNetNew),
      p90: whole(b.hi.completedNetNew)
    })),
    band: view.band.slice(0, k).map((b, i) => ({
      p10: whole(b.lo),
      p50: whole(mean[i].completedNet),
      p90: whole(b.hi)
    })),
    baseline: view.baseline,
    phasing: view.phasing,
    targets: view.targets,
    references: view.references,
    ...(view.tiers && view.tierTargets && tierBaseline
      ? {
          tiers: {
            completed: view.tiers.slice(0, k),
            baseline: tierBaseline,
            targets: view.tierTargets
          }
        }
      : {}),
    ...(view.money ? { money: view.money } : {})
  };
}

/** The Results at calendar month i (i <= filledThrough): today's ScoreAt over the average, and "This city". */
export function resultsAt(
  view: TimelineView,
  tierBaseline: TierUnits | null,
  i: number
): { at: ScoreAt; city: number } {
  return {
    at: scoreAt(scoreOfView(view, tierBaseline), i),
    city: view.baseline.completedNet + whole(view.shown[i].completedNet)
  };
}

/** Rule 27. total is null until filledThrough === lastIndex; delta only when compare === 'plan'; target null until filled to its deadline. */
export function headerOf(view: TimelineView | null): {
  total: number | null;
  year: number;
  delta: number | null;
  target: TargetProgress | null;
} {
  if (!view) return { total: null, year: 0, delta: null, target: null };
  const last = view.lastIndex;
  const filled = view.filledThrough === last;
  const year = utcParts(view.months[last]).y;
  const rhna = view.targets.find((t) => t.target.id === RHNA_ID);
  let target: TargetProgress | null = null;
  if (rhna) {
    const d = monthIndex(rhna.deadline, view.months[0], view.months.length);
    if (d <= view.filledThrough) target = { target: rhna.target, fraction: rhna.fraction[d] };
  }
  return {
    total: filled ? view.baseline.completedNet + whole(view.mean[last].completedNet) : null,
    year,
    delta: filled && view.compare === 'plan' ? whole(view.planEffect[last].completedNetNew) : null,
    target
  };
}
