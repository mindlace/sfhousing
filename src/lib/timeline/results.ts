// The Results face and the header score from the stepped view (timeline-ui rules 26 and 27). Pure.
import { RHNA_ID, scoreAt } from '$lib/fzp/score-view';
import type { ScoreAt } from '$lib/fzp/types';
import { monthIndex, utcParts } from '$lib/fzp/time';
import type { TargetProgress } from '$lib/scoreboard/types';
import type { TimelineScore } from '$lib/sim/scenario/types';
import type { PlanRow, TimelineView } from '$lib/sim/world/score/types';
import type { TierUnits } from '$lib/timelapse/types';

/** The plan effect is still a mean of fractions here; the page shows whole homes. */
const whole = Math.round;

const wholePlan = (p: PlanRow): PlanRow => ({
  entitledNew: whole(p.entitledNew),
  completedNetNew: whole(p.completedNetNew)
});

/**
 * Today's TimelineScore shape over the filled months: shown = world 1's rows, no band, tiers from
 * view.tiers + tierBaseline + tierTargets, money = view.money (its perAddedHome and displacedShare
 * are the view's own).
 */
export function scoreOfView(view: TimelineView, tierBaseline: TierUnits | null): TimelineScore {
  const k = view.filledThrough + 1;
  return {
    months: view.months,
    shown: view.shown.slice(0, k),
    planEffect: view.planEffect.slice(0, k).map(wholePlan),
    planEffectBand: [],
    band: [],
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

/**
 * The Results at calendar month i (i <= filledThrough): world 1's ScoreAt. `score` is
 * `scoreOfView(view, tierBaseline)` when the caller has it already.
 */
export function resultsAt(
  view: TimelineView,
  tierBaseline: TierUnits | null,
  i: number,
  score: TimelineScore = scoreOfView(view, tierBaseline)
): ScoreAt {
  return scoreAt(score, i);
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
    total: filled ? view.baseline.completedNet + view.shown[last].completedNet : null,
    year,
    delta: filled && view.compare === 'plan' ? whole(view.planEffect[last].completedNetNew) : null,
    target
  };
}
