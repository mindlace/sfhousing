// The pinned goal's words in each state of a round (pure).
import { formatShortMonthYear } from '$lib/fzp/format';
import { formatCount } from '$lib/scoreboard/format';
import type { Day } from '$lib/timelapse/time';
import { monthsBetween, spanText, type Verdict } from '../rounds';

export interface PinnedCtx {
  amount: number;
  target: Day | null;
  /** defaultGoal(asOf).deadline. */
  legal: Day;
  round: number;
  finished: boolean;
  /** The number of policies the next round offers (0 at the last round). */
  next: number;
}

export interface PinnedWords {
  line1: string;
  line2: string;
  /**
   * Below sm: count, then homes (may hide), then rest (the month); then result (the early or late
   * part, '' while pending), which wraps beneath when the line has no room for it.
   */
  phone: { count: string; short: string; homes: string; rest: string; result: string };
  /** What a screen reader is told when this state arrives; null for pending. */
  live: string | null;
  /** The gift's accessible name in a win; null otherwise. */
  gift: string | null;
}

/** 82069 -> '82k'. */
export function compactCount(n: number): string {
  return n < 1000 ? formatCount(n) : `${Math.round(n / 1000)}k`;
}

/** 'Current law' (round 0), 'Round 2', 'Every policy' (finished). */
export function roundName(round: number, finished: boolean): string {
  if (finished) return 'Every policy';
  return round === 0 ? 'Current law' : `Round ${round}`;
}

const policies = (n: number) => `${n} new ${n === 1 ? 'policy' : 'policies'}`;

export function pinnedWords(v: Verdict, c: PinnedCtx): PinnedWords {
  const count = formatCount(c.amount);
  const short = compactCount(c.amount);
  if (v.tag === 'pending') {
    const rest = c.target === null ? `by ${formatShortMonthYear(c.legal)}` : '';
    const when = c.target === null ? rest : `before ${formatShortMonthYear(c.target)}`;
    let line2: string;
    if (c.finished) line2 = 'Beat your best';
    else if (c.target === null && c.round === 0) line2 = 'Play to see current law';
    else if (c.next === 0) line2 = 'Beat it: every policy';
    else line2 = `Beat it: ${policies(c.next)}`;
    return {
      line1: `${count} homes ${when}`,
      line2,
      phone: { count, short, homes: ' homes', rest: when, result: '' },
      live: null,
      gift: null
    };
  }
  const when =
    v.goalMonth === null
      ? `after ${formatShortMonthYear(c.legal)}`
      : `by ${formatShortMonthYear(v.goalMonth)}`;
  const mark = c.target ?? c.legal;
  let line2: string;
  let gift: string | null = null;
  if (v.tag === 'win') {
    if (c.round === 0 || v.goalMonth === null) line2 = 'Current law';
    else line2 = `${spanText(monthsBetween(v.goalMonth, mark))} early`;
    if (c.finished) gift = 'Keep this date';
    else if (c.next === 0) gift = 'Open the gift: every policy';
    else gift = `Open the gift: ${policies(c.next)}`;
  } else if (v.goalMonth === null) {
    line2 = 'Late';
  } else {
    const months = monthsBetween(mark, v.goalMonth);
    line2 = months <= 0 ? 'Not earlier' : `${spanText(months)} late`;
  }
  const line1 = `${count} homes ${when}`;
  return {
    line1,
    line2,
    phone: { count, short, homes: '', rest: when, result: line2 },
    live: `${line1}, ${line2}.${gift === null ? '' : ` ${gift}.`}`,
    gift
  };
}
