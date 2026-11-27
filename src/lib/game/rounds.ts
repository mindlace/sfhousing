// The result rule of a round (pure): is the forecast pending, a win or late against the target,
// judged only on the months the player has seen.
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import type { Day } from '$lib/timelapse/time';
import { CATALOGUE, POLICY_KEYS, ROUNDS, isPolicyKey } from './catalogue/rounds';
import type { GameState } from './state';

export type Verdict =
  | { tag: 'pending' }
  | { tag: 'win'; goalMonth: Day | null }
  | { tag: 'late'; goalMonth: Day | null };

export const PENDING: Verdict = Object.freeze({ tag: 'pending' as const });

export interface Seen {
  /** The month to beat (its first day); null: none yet. */
  target: Day | null;
  round: number;
  /** The first month (view.months[m]) the current forecast reaches the goal in its filled
   *  months, read over the whole window; null: not in them. */
  goalMonth: Day | null;
  /** The forecast is filled to the window's last month. */
  whole: boolean;
  /** reveal.from: where the seen range starts (today, or the last reset day, lowered as the
   *  playhead goes back). */
  seenFrom: Day;
  /** reveal.reached: the furthest day seen. */
  seen: Day;
  /** The window's last day (filledEndDay of the last index). */
  lastDay: Day;
  /** Not stale, no edit waiting, not provisional, a view present. */
  current: boolean;
}

function monthStart(day: Day): Day {
  const { y, m } = utcParts(day);
  return dayFromUtc(y, m, 1);
}

/** Calendar months from a's month to b's, negative when b is earlier. */
export function monthsBetween(a: Day, b: Day): number {
  const p = utcParts(a);
  const q = utcParts(b);
  return (q.y - p.y) * 12 + (q.m - p.m);
}

/** 27 -> '2 yr 3 mo', 24 -> '2 years', 12 -> '1 year', 5 -> '5 months', 1 -> '1 month'. */
export function spanText(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return m === 1 ? '1 month' : `${m} months`;
  if (m === 0) return y === 1 ? '1 year' : `${y} years`;
  return `${y} yr ${m} mo`;
}

/** The first that applies of the rules in the plan: pending, win or late. */
export function judge(s: Seen): Verdict {
  if (!s.current) return PENDING;
  const from = monthStart(s.seenFrom);
  const isSeen = (m: Day) => from <= m && m <= s.seen;
  const { target, goalMonth } = s;
  const early = goalMonth !== null && (target === null || goalMonth < target);
  if (goalMonth !== null && isSeen(goalMonth) && early) return { tag: 'win', goalMonth };
  const atEnd = s.whole && s.seen >= s.lastDay;
  if (target === null && s.round === 0 && goalMonth === null && atEnd) {
    return { tag: 'win', goalMonth: null };
  }
  if (target !== null && isSeen(target) && (goalMonth !== null || s.whole) && !early) {
    return { tag: 'late', goalMonth };
  }
  if (target === null && s.round > 0 && goalMonth === null && atEnd) {
    return { tag: 'late', goalMonth: null };
  }
  return PENDING;
}

/** Known keys, each once, sorted. */
const sortedKeys = (keys: Iterable<string>): string[] =>
  [...new Set([...keys].filter(isPolicyKey))].sort();

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Unknown or duplicate editable keys dropped (sorted), round clamped to ROUNDS; `s` itself
 *  when nothing changes. Replaces fitGame. */
export function fitState(s: GameState): GameState {
  const editable = sortedKeys(s.editable);
  const round = Math.min(s.round, ROUNDS);
  if (round === s.round && sameList(editable, s.editable)) return s;
  return { ...s, round, editable };
}

/** Taking a win: target = goalMonth ?? target; wins + { round, goalMonth, beat: target, at,
 *  datasetVersion }; editable gains every key in `on` that is offered; below ROUNDS round + 1,
 *  at ROUNDS finished = true with every key editable; already finished: target, wins only. */
export function takeWin(
  s: GameState,
  w: { goalMonth: Day | null; on: ReadonlySet<string>; datasetVersion: string; at: string }
): GameState {
  const win = {
    round: s.round,
    goalMonth: w.goalMonth,
    beat: s.target,
    at: w.at,
    datasetVersion: w.datasetVersion
  };
  const next = { ...s, target: w.goalMonth ?? s.target, wins: [...s.wins, win] };
  if (s.finished) return next;
  const offered = new Set<string>([
    ...CATALOGUE.filter((e) => e.round <= s.round).map((e) => e.key),
    ...s.editable
  ]);
  if (s.round >= ROUNDS) return { ...next, finished: true, editable: sortedKeys(POLICY_KEYS) };
  const gained = [...w.on].filter((k) => offered.has(k));
  return { ...next, round: s.round + 1, editable: sortedKeys([...s.editable, ...gained]) };
}
