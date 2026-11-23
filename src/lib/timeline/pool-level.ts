/**
 * A pool's level on the timeline (timeline-ui, "A pool's bar shows its level"; funding-measures,
 * "A pool's lifetime level"): what is left of all the money a pool receives in the window, month by
 * month. The whole is the pool's lifetime receipts (`lifetimes`, from the engine's own money
 * track); what is used is read from the ledger series the page already receives
 * (`TimelineView.money`, finance-score.md "The ledger and its series"). A bar starts full and
 * drains; a yearly payment never refills it; a closed pool reads empty. Pure: no Svelte, no DOM.
 * The page builds a `LevelSet` once per view and document; a bar's path is built once per set and
 * span, and moving the playhead only moves two clip edges.
 */
import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance/terms';
import type { MoneyView, TimelineView } from '$lib/sim/world/score/types';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
import { inForceAt, moneyLeversOf } from '$lib/sim/world/policy/combine';
import { createMoneyTrack, moneyOrder } from '$lib/sim/world/policy/money';
import { isNoCeiling } from '$lib/timelapse/model';
import type { Day } from '$lib/timelapse/time';
import type { Pool } from '$lib/timelapse/types';
import { filledEndDay } from './playhead';
import type { Policy, SimPolicy4 } from './policy4';
import { playheadAt } from './results';

/** What the level needs of a pool: its leverage and its lifetime receipts (`lifetimes`). */
export interface LevelPool {
  id: string;
  leverage: number;
  /** All the money the pool receives in the window; null when it has no level. */
  lifetime: number | null;
}

/**
 * The level, the one place it is defined. Per filled month i, over the pools given whose lifetime
 * is not null and that the money carries:
 *
 *   Σ(shut ? 0 : leverage·lifetime − committed − spent − out − lostCredit) / Σ(leverage·lifetime)
 *
 * what is left of all the money the pools receive in the window. A pool reads 1 until money is
 * committed, drains as it is used, and rises only when used money returns (a loan repaid, a
 * commitment released); a yearly payment never raises it, as the payment is already counted. A
 * pool reads 0 in every month `money.shut` marks (F3: a closed pool awards nothing), false where
 * absent. Clamped to [0, 1]; NaN where the denominator is 0 (every lifetime 0, or no pool left).
 */
export function poolLevel(money: MoneyView, pools: readonly LevelPool[]): Float64Array {
  const n = money.fundedHomes.length;
  const out = new Float64Array(n).fill(NaN);
  const rows: { whole: number; s: MoneyView['pools'][number]; shut: readonly boolean[] }[] = [];
  let cap = 0;
  for (const p of pools) {
    if (p.lifetime === null) continue;
    const s = money.pools.find((q) => q.id === p.id);
    if (!s) continue;
    const whole = p.leverage * p.lifetime;
    rows.push({ whole, s, shut: money.shut[p.id] ?? [] });
    cap += whole;
  }
  if (!(cap > 0)) return out;
  for (let i = 0; i < n; i++) {
    let left = 0;
    for (const { whole, s, shut } of rows) {
      if (shut[i] === true) continue;
      left += whole - (s.committed[i] + s.spent[i] + s.out[i] + s.lostCredit[i]);
    }
    out[i] = Math.min(Math.max(left / cap, 0), 1);
  }
  return out;
}

/** A pool with a yearly inflow whose amount `isNoCeiling` (an older dataset's federal pool). */
const noCeiling = (p: Pool): boolean =>
  p.inflows.some((f) => f.kind === 'yearly' && isNoCeiling(f.dollarsPerYear));

let lastLife: {
  doc: SimPolicy4;
  baseline: readonly Pool[];
  asOf: Day;
  life: ReadonlyMap<string, number | null>;
} | null = null;

/**
 * Per pool id the track orders, the pool's lifetime receipts: the dollars of every arrival the
 * engine's money track (`createMoneyTrack`) gives it over months 1 to `WINDOW_MONTHS`, on the
 * baseline pools with no programmes, no off spans, slope 0 and the market terms, month m's levers
 * those in force on its first day. A yearly inflow with no end counts each payment to the window's
 * last month; a payment after a span ends, or past the window, counts nothing; an off policy's
 * pool is 0. Null for a pool one of whose definitions (the calibration's for a baseline pool,
 * every span's pool for an added one) has a yearly inflow whose amount `isNoCeiling`, and for
 * every pool when the track throws. The last result is kept, keyed by the identity of `doc` and
 * `baseline` and the value of `asOf`.
 */
export function lifetimes(
  doc: SimPolicy4,
  baseline: readonly Pool[],
  asOf: Day
): ReadonlyMap<string, number | null> {
  if (
    lastLife !== null &&
    lastLife.doc === doc &&
    lastLife.baseline === baseline &&
    lastLife.asOf === asOf
  )
    return lastLife.life;
  const finance = {
    pools: [...baseline],
    programmes: [],
    off: [],
    slope: 0,
    terms: resolveTerms(MARKET_TERMS)
  };
  const ids = moneyOrder(doc, finance).pools;
  const life = new Map<string, number | null>(ids.map((id) => [id, 0]));
  try {
    const track = createMoneyTrack(doc, { asOf, finance });
    for (let m = 1; m <= WINDOW_MONTHS; m++) {
      const got = track.month(m, moneyLeversOf(inForceAt(doc, monthFirstDay(asOf, m))));
      if (got === null) break;
      const { pools, arrivals } = got.frame;
      for (const a of arrivals) {
        const id = pools[a.pool].id;
        life.set(id, (life.get(id) ?? 0) + a.dollars);
      }
    }
    for (const p of baseline) if (noCeiling(p)) life.set(p.id, null);
    for (const p of doc.kinds.money) {
      if (p.where.tag !== 'fund') continue;
      for (const s of p.spans)
        if (s.what.tag === 'fund' && s.what.pool !== null && noCeiling(s.what.pool))
          life.set(s.what.pool.id, null);
    }
  } catch {
    for (const id of life.keys()) life.set(id, null);
  }
  lastLife = { doc, baseline, asOf, life };
  return life;
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
  /** Fund policies with an own pool whose lifetime is not null, by policy id. */
  byPolicy: ReadonlyMap<string, Float64Array>;
  /** The baseline pools whose lifetime is not null, summed: "Current funding". */
  fixed: Float64Array | null;
}

const NO_POOLS: readonly Pool[] = [];

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
 * pool included, each read against `lifetimes(doc, baseline, asOf)`. A pool whose lifetime is null
 * (a yearly amount that `isNoCeiling`, or a track that throws) has no level and stays out of the
 * sum. Leverage comes from the document the numbers are from (`doc`, the held one while stale) and
 * the calibration, as the engine read them. Null without a view or without money.
 */
export function levelSet(
  view: TimelineView | null,
  doc: SimPolicy4,
  baseline: readonly Pool[] | undefined,
  asOf: Day
): LevelSet | null {
  const money = view?.money;
  if (!view || !money) return null;
  const life = lifetimes(doc, baseline ?? NO_POOLS, asOf);
  const carried = (id: string) => money.pools.some((q) => q.id === id);
  const last = monthFirstDay(asOf, WINDOW_MONTHS);
  const byPolicy = new Map<string, Float64Array>();
  for (const p of doc.kinds.money) {
    const def = ownPool(p, last);
    if (def === null) continue;
    const lifetime = life.get(def.id) ?? null;
    if (lifetime === null || !carried(def.id)) continue;
    byPolicy.set(p.id, poolLevel(money, [{ id: def.id, leverage: def.leverage, lifetime }]));
  }
  const summed: LevelPool[] = [];
  for (const p of baseline ?? NO_POOLS) {
    const lifetime = life.get(p.id) ?? null;
    if (lifetime !== null && carried(p.id))
      summed.push({ id: p.id, leverage: p.leverage, lifetime });
  }
  const fixed = summed.length > 0 ? poolLevel(money, summed) : null;
  return { months: view.months, asOf, byPolicy, fixed };
}
