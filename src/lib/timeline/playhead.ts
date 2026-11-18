// Playhead rules for the timeline: keys, the filled end, the flag, Play's label and the
// view-month gate.
import { formatShortMonthYear } from '$lib/fzp/format';
import {
  dayFromUtc,
  monthIndex,
  monthStart,
  nextMonth,
  prevMonth,
  shiftYear,
  utcParts
} from '$lib/fzp/time';
import { monthOfDay } from '$lib/sim/world/months';
import type { Day } from '$lib/timelapse/time';
import { playFromText } from './copy';

/** Calendar month index of `day` in `months` (clamped to [0, months.length - 1]). */
export function indexOfDay(months: Day[], day: Day): number {
  return monthIndex(day, months[0], months.length);
}

/** The last day of calendar month `filledThrough`; `asOf` when nothing is filled. */
export function filledEndDay(months: Day[], filledThrough: number, asOf: Day): Day {
  if (filledThrough < 0 || months.length === 0) return asOf;
  const k = Math.min(filledThrough, months.length - 1);
  if (k + 1 < months.length) return months[k + 1] - 1;
  const { y, m } = utcParts(months[k]);
  return dayFromUtc(y, m + 1, 1) - 1;
}

/** The model month the playhead is in, for `viewMonth`: max(1, monthOfDay(asOf, day)). */
export function viewMonthOf(asOf: Day, day: Day): number {
  return Math.max(1, monthOfDay(asOf, day));
}

const FORWARD_KEYS = new Set(['ArrowRight', 'ArrowUp', 'PageUp']);

/** The day a key moves the playhead to, or null for a key it ignores (rule 23). */
export function keyTarget(key: string, day: Day, asOf: Day, end: Day): Day | null {
  // After a refill withdrew months under the playhead (day > end) forward keys leave it be (rule 25).
  if (day > end && FORWARD_KEYS.has(key)) return day;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return prevMonth(day, asOf);
    case 'ArrowRight':
    case 'ArrowUp':
      return nextMonth(day, end);
    case 'PageDown':
      return shiftYear(day, -1, asOf, end);
    case 'PageUp':
      return shiftYear(day, 1, asOf, end);
    case 'Home':
      return asOf;
    case 'End':
      return end;
    default:
      return null;
  }
}

/** Clamps a requested day into [asOf, end]. */
export function clampDay(day: Day, asOf: Day, end: Day): Day {
  return Math.min(Math.max(day, asOf), Math.max(asOf, end));
}

/** The ruler's date flag: 'Today' at the dataset date, else the playhead month's short name. */
export function dateFlag(day: Day, asOf: Day): string {
  return day <= asOf ? 'Today' : formatShortMonthYear(monthStart(day));
}

/** Play's label: Pause while playing; Play from wins over Replay; Replay at `last`; else Play. */
export function playLabel(s: { playing: boolean; playFrom: Day | null; atLast: boolean }): string {
  if (s.playing) return 'Pause';
  if (s.playFrom !== null) return playFromText(s.playFrom);
  return s.atLast ? 'Replay' : 'Play';
}

interface GateDeps {
  send(month: number): void;
  now(): number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  minMs?: number;
}

/** Sends the wanted view month at most once per `minMs`; the latest wanted goes out after the gap. */
export class MonthGate {
  #deps: GateDeps;
  #setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  #clearTimer: (t: ReturnType<typeof setTimeout>) => void;
  #lastSent = -Infinity;
  #pending: number | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: GateDeps) {
    this.#deps = deps;
    // Called as plain functions, never as methods of `deps`: a bare window.setTimeout throws
    // "Illegal invocation" when `this` is not the window.
    const st = deps.setTimeout;
    const ct = deps.clearTimeout;
    this.#setTimer = st ? (fn, ms) => st(fn, ms) : (fn, ms) => globalThis.setTimeout(fn, ms);
    this.#clearTimer = ct ? (t) => ct(t) : (t) => globalThis.clearTimeout(t);
  }

  want(month: number): void {
    const wait = this.#lastSent + (this.#deps.minMs ?? 250) - this.#deps.now();
    if (this.#timer === null && wait <= 0) {
      this.#fire(month);
      return;
    }
    this.#pending = month;
    if (this.#timer === null) {
      this.#timer = this.#setTimer(() => {
        this.#timer = null;
        const m = this.#pending;
        this.#pending = null;
        if (m !== null) this.#fire(m);
      }, wait);
    }
  }

  dispose(): void {
    if (this.#timer !== null) this.#clearTimer(this.#timer);
    this.#timer = null;
    this.#pending = null;
  }

  #fire(month: number): void {
    this.#lastSent = this.#deps.now();
    this.#deps.send(month);
  }
}
