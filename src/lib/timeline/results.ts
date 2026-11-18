// The Results face and the header score from the stepped view (timeline-ui rules 26 and 27). Pure.
import { fromPolicyText, scoreAt } from '$lib/fzp/score-view';
import type { ScoreAt } from '$lib/fzp/types';
import {
  GOAL,
  TODAY,
  goalName,
  goalText,
  readGoal,
  type Goal,
  type GoalReading
} from '$lib/goal/goal';
import type { TimelineScore } from '$lib/sim/scenario/types';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import type { TierUnits } from '$lib/timelapse/types';
import { homesBy } from './copy';

/**
 * Today's TimelineScore shape over the filled months: shown = the world's rows, no band, tiers from
 * view.tiers + tierBaseline + tierTargets, money = view.money (its perAddedHome and displacedShare
 * are the view's own).
 */
export function scoreOfView(view: TimelineView, tierBaseline: TierUnits | null): TimelineScore {
  const k = view.filledThrough + 1;
  return {
    months: view.months,
    shown: view.rows.slice(0, k),
    planEffect: view.planEffect.slice(0, k),
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
 * The Results at calendar month i (i <= filledThrough): the world's ScoreAt. `score` is
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

export interface Headline {
  /** Simulated net homes completed from today to the playhead: rows[i].completedNet; 0 at today. */
  homes: number;
  /** months[i]; null at today. */
  at: Day | null;
  /** planEffect[i].completedNetNew (0 at today) when view.compare === 'plan', else null. */
  effect: number | null;
  goal: GoalReading | null;
}

/**
 * The headline at calendar month i. Null ("calculating…") without a view, while `provisional`,
 * or when view.filledThrough < i. `atToday` (the playhead's day is the dataset date) reads
 * today: 0 homes, effect 0, the goal at TODAY. Reads a bounded number of rows.
 */
export function headlineAt(
  view: TimelineView | null,
  i: number,
  atToday: boolean,
  provisional: boolean,
  goal: Goal = GOAL
): Headline | null {
  if (!view || provisional) return null;
  if (atToday) {
    return {
      homes: 0,
      at: null,
      effect: view.compare === 'plan' ? 0 : null,
      goal: readGoal(goal, view, TODAY)
    };
  }
  if (view.filledThrough < i) return null;
  return {
    homes: view.rows[i].completedNet,
    at: view.months[i],
    effect: view.compare === 'plan' ? view.planEffect[i].completedNetNew : null,
    goal: readGoal(goal, view, i)
  };
}

export interface HeadlineText {
  main: string;
  effect: string | null;
  goal: string | null;
  goalName: string | null;
}

export function headlineText(h: Headline, goal: Goal = GOAL): HeadlineText {
  return {
    main: homesBy(h.homes, h.at),
    effect: h.effect === null ? null : fromPolicyText(h.effect),
    goal: h.goal === null ? null : goalText(h.goal),
    goalName: h.goal === null ? null : goalName(goal)
  };
}

/** main, effect and goal, in that order, the nulls left out, joined by ', '. */
export function headlineSpoken(t: HeadlineText): string {
  return [t.main, t.effect, t.goal].filter((s): s is string => s !== null).join(', ');
}
