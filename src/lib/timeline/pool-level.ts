/**
 * A pool's level on the timeline (timeline-ui, "A pool's bar shows its level"): how much of the
 * money a pool has received so far is still free, month by month, read from the ledger series the
 * page already receives (`TimelineView.money`, finance-score.md "The ledger and its series"). Pure:
 * no Svelte, no DOM. The page builds a `LevelSet` once per view and document; a bar's path is built
 * once per set and span, and moving the playhead only moves two clip edges.
 */
import type { MoneyView, TimelineView } from '$lib/sim/world/score/types';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
import { isNoCeiling } from '$lib/timelapse/model';
import type { Day } from '$lib/timelapse/time';
import type { Pool } from '$lib/timelapse/types';
import { filledEndDay } from './playhead';
import type { Policy, SimPolicy4 } from './policy4';
import { playheadAt } from './results';

/** What the level needs of a pool's definition: its leverage. */
export interface LevelPool {
  id: string;
  leverage: number;
}

/**
 * The level, the one place it is defined. Per filled month i, over the pools given that the money
 * carries:
 *
 *   Σ(leverage·received − committed − spent − out − lostCredit) / Σ(leverage·received)
 *
 * the free share of the money received so far: the engine's available money (identity I4,
 * finance-score.md; `availableOf` in the step engine) over the most the pool could hold. A pool
 * paid every year refills at each payment, on purpose: yearly money arrives in yearly lumps. By I4
 * the numerator is never negative and never more than the denominator, so the clamp to [0, 1]
 * only guards rounding. NaN where the denominator is 0 (nothing received yet) or no pool the
 * money carries is given. Which pools have a level at all is `levelSet`'s rule.
 */
export function poolLevel(money: MoneyView, pools: readonly LevelPool[]): Float64Array {
  const n = money.fundedHomes.length;
  const out = new Float64Array(n).fill(NaN);
  const rows: { lev: number; s: MoneyView['pools'][number] }[] = [];
  for (const p of pools) {
    const s = money.pools.find((q) => q.id === p.id);
    if (s) rows.push({ lev: p.leverage, s });
  }
  if (rows.length === 0) return out;
  for (let i = 0; i < n; i++) {
    let cap = 0;
    let used = 0;
    for (const { lev, s } of rows) {
      cap += lev * s.received[i];
      used += s.committed[i] + s.spent[i] + s.out[i] + s.lostCredit[i];
    }
    if (cap > 0) out[i] = Math.min(Math.max((cap - used) / cap, 0), 1);
  }
  return out;
}

const W = 1000;
const H = 20;
const num = (n: number) => n.toFixed(2);

/**
 * Month i's steps in the box [from, to]: month i runs from its first day (the dataset date for
 * month 0) to the day after its last; its level holds across it, so the level drawn at the
 * playhead is the one its month reads. Runs of finite levels, each a list of [x0, x1, y].
 */
function runsOf(
  level: ArrayLike<number>,
  months: readonly Day[],
  asOf: Day,
  from: Day,
  to: Day
): [number, number, number][][] {
  const span = Math.max(to - from, 1);
  const x = (d: Day) => ((Math.min(Math.max(d, from), to) - from) / span) * W;
  const runs: [number, number, number][][] = [];
  let run: [number, number, number][] | null = null;
  const ms = months as Day[];
  for (let i = 0; i < level.length && i < months.length; i++) {
    const a = i === 0 ? Math.max(asOf, months[0]) : months[i];
    const b = filledEndDay(ms, i, asOf) + 1;
    if (b <= from) continue;
    if (a >= to) break;
    const v = level[i];
    if (!Number.isFinite(v)) {
      run = null;
      continue;
    }
    if (run === null) runs.push((run = []));
    run.push([x(a), x(b), (1 - v) * H]);
  }
  return runs;
}

/**
 * The empty part as closed SVG paths in a 1000 × 20 box spanning [from, to]: each month's level
 * held across that month, y = (1 − level) × 20 from the top; a run of NaN breaks the path (no
 * point is written for it). '' when no month has a level.
 */
export function levelPath(
  level: ArrayLike<number>,
  months: readonly Day[],
  asOf: Day,
  from: Day,
  to: Day
): string {
  let d = '';
  for (const run of runsOf(level, months, asOf, from, to)) {
    const [x0] = run[0];
    d += `M${num(x0)},0`;
    for (const [a, b, y] of run) d += `L${num(a)},${num(y)}L${num(b)},${num(y)}`;
    d += `L${num(run[run.length - 1][1])},0Z`;
  }
  return d;
}

/** The level's edge alone, as open SVG paths in the same box ('' when none): the shape's line. */
export function levelLine(
  level: ArrayLike<number>,
  months: readonly Day[],
  asOf: Day,
  from: Day,
  to: Day
): string {
  let d = '';
  for (const run of runsOf(level, months, asOf, from, to)) {
    const [x0, , y0] = run[0];
    d += `M${num(x0)},${num(y0)}`;
    for (const [a, b, y] of run) d += `L${num(a)},${num(y)}L${num(b)},${num(y)}`;
  }
  return d;
}

/**
 * The month a bar spanning [from, to] reads its level at, for the playhead at `day`: the
 * headline's rule (`playheadAt`), -1 at today or where the bar does not cover the day.
 */
export function levelIndexAt(
  months: readonly Day[],
  asOf: Day,
  day: Day,
  from: Day,
  to: Day
): number {
  if (day < from || day > to || months.length === 0) return -1;
  const at = playheadAt(months as Day[], asOf, day);
  return at.atToday ? -1 : at.index;
}

/** The rounded percent at month i; null when level[i] is NaN or i is out of range. */
export function levelPercent(level: ArrayLike<number>, i: number): number | null {
  if (i < 0 || i >= level.length || !Number.isFinite(level[i])) return null;
  return Math.round(level[i] * 100);
}

/** ', 62% left' (Math.round) at month i; null when level[i] is NaN or i is out of range. */
export function levelLeft(level: ArrayLike<number>, i: number): string | null {
  const p = levelPercent(level, i);
  return p === null ? null : `, ${p}% left`;
}

/** The levels the timeline draws, built once per view and document. */
export interface LevelSet {
  months: readonly Day[];
  asOf: Day;
  /** Fund policies with an own pool that has a level (`hasLevel`), by policy id. */
  byPolicy: ReadonlyMap<string, Float64Array>;
  /** The baseline pools that have a level, summed: "Current funding". */
  fixed: Float64Array | null;
}

/**
 * Every pool has a level except one with a yearly inflow whose amount `isNoCeiling`: an older
 * dataset's federal pool, read as one yearly inflow of `LEGACY_UNCAPPED_DOLLARS`. Its bar draws
 * with no level and it stays out of "Current funding".
 */
function hasLevel(p: Pool): boolean {
  return !p.inflows.some((f) => f.kind === 'yearly' && isNoCeiling(f.dollarsPerYear));
}

/**
 * A fund policy's own pool as the score defines it: its definition in the window's last month
 * (that of the last span begun by then while the policy is on, else the first span's), as
 * `planFinanceOf` takes a pool's shape and the money track rests it. Null for a policy whose
 * programmes draw on a baseline pool.
 */
function ownPool(p: Policy, day: Day): Pool | null {
  if (p.where.tag !== 'fund') return null;
  let def: Pool | null = null;
  for (const s of p.spans) {
    if (s.what.tag !== 'fund' || s.what.pool === null) continue;
    if (def === null || (p.on && s.from <= day)) def = s.what.pool;
  }
  return def;
}

/**
 * The levels of `view`'s money: one entry per fund policy of `doc` with an own pool that the money
 * carries, and every `baseline` pool the money carries summed for "Current funding", the federal
 * pool included. A pool with a yearly inflow whose amount `isNoCeiling` has no level and stays out
 * of the sum (`hasLevel`). Leverage and inflows come from the document the numbers are from (`doc`,
 * the held one while stale) and the calibration, as the engine read them. Null without a view or
 * without money.
 */
export function levelSet(
  view: TimelineView | null,
  doc: SimPolicy4,
  baseline: readonly Pool[] | undefined,
  asOf: Day
): LevelSet | null {
  const money = view?.money;
  if (!view || !money) return null;
  const last = monthFirstDay(asOf, WINDOW_MONTHS);
  const byPolicy = new Map<string, Float64Array>();
  for (const p of doc.kinds.money) {
    const def = ownPool(p, last);
    if (def === null || !hasLevel(def)) continue;
    if (!money.pools.some((q) => q.id === def.id)) continue;
    byPolicy.set(p.id, poolLevel(money, [def]));
  }
  const summed = (baseline ?? []).filter(
    (p) => hasLevel(p) && money.pools.some((q) => q.id === p.id)
  );
  const fixed = summed.length > 0 ? poolLevel(money, summed) : null;
  return { months: view.months, asOf, byPolicy, fixed };
}
