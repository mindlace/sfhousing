// G6: the ladder of deadlines, and fitting a saved game to this build's catalogue.
import { formatShortMonthYear } from '$lib/fzp/format';
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import { defaultGoal, type Goal } from '$lib/goal/goal';
import type { Day } from '$lib/timelapse/time';
import { LADDER_YEARS } from './catalogue/ladder-years';
import { NODES } from './catalogue/nodes';
import { SIDE_GOALS, type SideGoal } from './side-goals';
import type { GameState, NodeId } from './state';
import type { TreeNode } from './tree';

export interface Rung {
  deadline: Day;
  label: string;
}

export const RUNGS: number = LADDER_YEARS.length + 1;

/** The last day of the UTC calendar month holding `day`. */
function endOfMonth(day: Day): Day {
  const { y, m } = utcParts(day);
  return dayFromUtc(y, m + 1, 1) - 1;
}

export function ladder(asOf: Day): Rung[] {
  const first = defaultGoal(asOf).deadline;
  const floor = endOfMonth(asOf);
  const rungs: Rung[] = [{ deadline: first, label: formatShortMonthYear(first) }];
  for (const year of LADDER_YEARS) {
    const before = rungs[rungs.length - 1].deadline;
    const deadline = Math.min(before, Math.max(floor, dayFromUtc(year, 12, 31)));
    rungs.push({ deadline, label: formatShortMonthYear(deadline) });
  }
  return rungs;
}

export function goalAt(asOf: Day, rung: number, amount?: number): Goal {
  if (!Number.isInteger(rung) || rung < 0 || rung >= RUNGS) {
    throw new RangeError(`No rung ${rung}`);
  }
  const base = defaultGoal(asOf);
  return { ...base, deadline: ladder(asOf)[rung].deadline, amount: amount ?? base.amount };
}

export function finished(s: GameState): boolean {
  return s.met.some((m) => m.rung === RUNGS - 1);
}

export function takeNext(s: GameState): GameState {
  const met = s.met.some((m) => m.rung === s.rung);
  return met && s.rung + 1 < RUNGS ? { ...s, rung: s.rung + 1 } : s;
}

/** The state with what this build no longer has dropped; the same object when nothing is. */
export function fitGame(
  s: GameState,
  nodes: readonly TreeNode[] = NODES,
  goals: readonly SideGoal[] = SIDE_GOALS
): GameState {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bought: Record<NodeId, number> = {};
  for (const [id, level] of Object.entries(s.bought)) {
    const node = byId.get(id);
    if (node && node.levels.length > 0) bought[id] = Math.min(level, node.levels.length);
  }
  const known = new Set(goals.map((g) => g.id));
  const side: Record<string, string> = {};
  for (const [id, at] of Object.entries(s.side)) if (known.has(id)) side[id] = at;
  const rung = Math.min(s.rung, RUNGS - 1);
  const met = s.met.filter((m) => m.rung < RUNGS);
  const same =
    rung === s.rung &&
    met.length === s.met.length &&
    Object.keys(bought).length === Object.keys(s.bought).length &&
    Object.entries(bought).every(([id, level]) => s.bought[id] === level) &&
    Object.keys(side).length === Object.keys(s.side).length;
  return same ? s : { ...s, bought, side, rung, met };
}
