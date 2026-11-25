// G6 (contracts stub): a run's reading, take and result, and settling. game-core makes it real.
import { utcParts } from '$lib/fzp/time';
import { readGoal, type Goal } from '$lib/goal/goal';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { Day } from '$lib/timelapse/time';
import type { Stage } from '$lib/timelapse/types';
import { RUNG_LUMP } from './catalogue/tuning';
import { sideShown, type SideInput } from './side-goals';
import type { GameState, Units } from './state';
import { credit } from './units';

export interface RunTake {
  dropped: Units;
  collected: Units;
}

export interface RunReading {
  homes: number;
  reachedOn: Day | null;
  stages: Record<Exclude<Stage, 'complete'>, number>;
  waitingMoney: number | null;
}

export interface RunResult extends RunTake, RunReading {
  rung: number;
  amount: number;
  datasetVersion: string;
  at: string;
  lump: Units | null;
  side: { id: string; reward: Units }[];
}

/** The deadline's calendar month in the view, clamped to [0, view.lastIndex]. */
export function deadlineIndex(deadline: Day, view: TimelineView): number {
  const a = utcParts(deadline);
  const b = utcParts(view.months[0]);
  const i = (a.y - b.y) * 12 + (a.m - b.m);
  return Math.min(Math.max(i, 0), view.lastIndex);
}

export function readRun(view: TimelineView, goal: Goal): RunReading | null {
  if (view.months.length === 0 || view.filledThrough < 0) return null;
  const i = deadlineIndex(goal.deadline, view);
  if (i > view.filledThrough) return null;
  const reading = readGoal(goal, view, i);
  if (!reading) return null;
  return {
    homes: goal.measure.valueAt(view, i),
    reachedOn: reading.reachedOn,
    stages: { ...view.rows[i].inProgress },
    waitingMoney: view.waitingMoney?.[i] ?? null
  };
}

export function resultOf(
  s: GameState,
  reading: RunReading,
  take: RunTake,
  input: SideInput,
  meta: { amount: number; datasetVersion: string; at: string }
): RunResult {
  const first = reading.reachedOn !== null && !s.met.some((m) => m.rung === s.rung);
  const side = sideShown(s).flatMap((g) => {
    const r = g.read(input);
    return r !== null && r.value >= r.target ? [{ id: g.id, reward: { ...g.reward } }] : [];
  });
  return {
    rung: s.rung,
    amount: meta.amount,
    datasetVersion: meta.datasetVersion,
    at: meta.at,
    homes: reading.homes,
    reachedOn: reading.reachedOn,
    stages: { ...reading.stages },
    waitingMoney: reading.waitingMoney,
    dropped: { ...take.dropped },
    collected: { ...take.collected },
    lump: first ? { ...RUNG_LUMP } : null,
    side
  };
}

export function settle(s: GameState, r: RunResult): GameState {
  const newRung = r.reachedOn !== null && !s.met.some((m) => m.rung === r.rung);
  let units = credit(s.units, r.collected);
  if (r.lump !== null && newRung) units = credit(units, r.lump);
  const side = { ...s.side };
  for (const e of r.side) {
    if (Object.hasOwn(side, e.id)) continue;
    units = credit(units, e.reward);
    side[e.id] = r.at;
  }
  const met = newRung
    ? [
        ...s.met,
        { rung: r.rung, reachedOn: r.reachedOn as Day, datasetVersion: r.datasetVersion, at: r.at }
      ].sort((a, b) => a.rung - b.rung)
    : s.met;
  return { ...s, units, met, side, runs: s.runs + 1, last: r };
}
