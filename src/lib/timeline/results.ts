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
import { formatCount } from '$lib/scoreboard/format';
import { lensOf, type ChartLens } from './chart-lens';
import { byWhen, homesBy } from './copy';
import { indexOfDay } from './playhead';

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
  /** planEffect[i].completedNetNew (0 at today) while a policy is in force, else null. */
  effect: number | null;
  goal: GoalReading | null;
}

/** Where the playhead reads: its calendar month row, or today. */
export interface PlayheadAt {
  index: number;
  atToday: boolean;
}

/**
 * { index: indexOfDay(months, day), atToday: day <= asOf }. The one rule the header, the chart's
 * readout and the ruler's flag read.
 */
export function playheadAt(months: Day[], asOf: Day, day: Day): PlayheadAt {
  return { index: months.length > 0 ? indexOfDay(months, day) : 0, atToday: day <= asOf };
}

export interface HeadlineOpts {
  provisional: boolean;
  /**
   * A policy of the person's is in force in the document the numbers on show came from
   * (!nothingInForce(resultsDoc)). view.compare is never read: it is 'plan' for every document.
   */
  inForce: boolean;
}

/**
 * The headline at the playhead's month row. Null ("calculating…") without a view, while
 * `provisional`, or when view.filledThrough < at.index. At today it reads 0 homes, effect 0 (with a
 * policy in force) and the goal at TODAY. Reads a bounded number of rows.
 */
export function headlineAt(
  view: TimelineView | null,
  at: PlayheadAt,
  opts: HeadlineOpts,
  goal: Goal = GOAL
): Headline | null {
  if (!view || opts.provisional) return null;
  if (at.atToday) {
    return {
      homes: 0,
      at: null,
      effect: opts.inForce ? 0 : null,
      goal: readGoal(goal, view, TODAY)
    };
  }
  const i = at.index;
  if (view.filledThrough < i) return null;
  return {
    homes: view.rows[i].completedNet,
    at: view.months[i],
    effect: opts.inForce ? view.planEffect[i].completedNetNew : null,
    goal: readGoal(goal, view, i)
  };
}

/**
 * Homes completed from today under current law at month i:
 * rows[i].completedNet - planEffect[i].completedNetNew. Read only while a policy is in force (the
 * twin is then current law); it leaves out the twin's own pipeline completions.
 */
export function currentLawHomes(view: TimelineView, i: number): number {
  return view.rows[i].completedNet - view.planEffect[i].completedNetNew;
}

/**
 * The chart's readout at position j (0 today, j = i + 1 the end of month i), by lens (through
 * lensOf):
 * homes: the header's line 1 for it, then ', ' + the effect while inForce ('0 homes by today';
 * '1,234 homes by Apr 2040, +56 from your policy').
 * source: line 1, then ', 800 from today's pipeline'.
 * effect: the header's effect figure and the month: '+56 from your policy by Apr 2040'.
 * Reads one row; '' where month j - 1 is not filled.
 */
export function chartReading(
  view: TimelineView,
  j: number,
  inForce: boolean,
  lens: ChartLens = 'homes'
): string {
  // headlineAt's month rule without its goal reading, so only row j - 1 is read.
  const i = j - 1;
  if (i >= 0 && view.filledThrough < i) return '';
  const at = i < 0 ? null : view.months[i];
  const shown = lensOf(lens, inForce);
  const effect = () => fromPolicyText(i < 0 ? 0 : view.planEffect[i].completedNetNew);
  if (shown === 'effect') return `${effect()} by ${byWhen(at)}`;
  const main = homesBy(i < 0 ? 0 : view.rows[i].completedNet, at);
  if (shown === 'source')
    return `${main}, ${formatCount(i < 0 ? 0 : view.rows[i].completedNetPipeline)} from today's pipeline`;
  if (!inForce) return main;
  return `${main}, ${effect()}`;
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
