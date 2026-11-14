import { limitStatements } from '$lib/sim/finance';
import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import {
  addedBorrowing,
  tierBaselineOf,
  tierContext,
  type TierCtx
} from '$lib/sim/scenario/finance-score';
import { inflowArrivals } from '$lib/sim/scenario/funding';
import { REFERENCES, monthsOf, phasingOf } from '$lib/sim/scenario/score';
import type { SimInput } from '$lib/sim/scenario/types';
import type { ProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type { Inflow, Pool } from '$lib/timelapse/types';
import { monthFirstDay, monthLastDay, monthOfDay } from '../months';
import type { FinanceFrame, PolicyTimeline } from '../policy/frame';
import type { ScoreStatics } from './types';

/** The last day of the calendar month that starts on `first`. */
function lastDayOf(first: Day): Day {
  return addMonths(first, 1) - 1;
}

/** The programme definitions `tiersOf` reads, for each model month of the window (rule 2). */
export interface TierTable {
  /** For rows no award splits: `affordable` only (no programmes). */
  base: TierCtx;
  /** `[m]` for model month m in 1..windowMonths: the ctx of month m's frame, null without finance. */
  byMonth: (TierCtx | null)[];
}

const TIER_TABLES = new WeakMap<ScoreStatics, TierTable>();

/** What of a finance frame `tiersOf` reads: pool kinds, programmes (pricing, tiers) and terms. */
function tierKey(f: FinanceFrame): string {
  return JSON.stringify([
    f.pools.map((p) => [p.id, p.kind]),
    f.programmes.map((g) => [g.id, g.pool, g.instrument, g.tiers]),
    f.terms
  ]);
}

/**
 * The tier table of the window's frames, one `tierContext` per distinct finance state (they
 * share `affordable`), or null when no frame of month 1 or of a change up to `windowMonths`
 * carries finance.
 */
function tierTableOf(
  input: SimInput,
  timeline: PolicyTimeline,
  windowMonths: number
): TierTable | null {
  const base = tierContext({ projects: input.projects });
  const byKey = new Map<string, TierCtx>();
  const ctxOf = (f: FinanceFrame | null): TierCtx | null => {
    if (f === null) return null;
    const key = tierKey(f);
    let ctx = byKey.get(key);
    if (ctx === undefined) {
      const own = tierContext({
        projects: [],
        finance: {
          pools: f.pools,
          programmes: f.programmes,
          off: [],
          slope: f.slope,
          terms: f.terms
        }
      });
      ctx = { ...own, affordable: base.affordable };
      byKey.set(key, ctx);
    }
    return ctx;
  };
  const byMonth: (TierCtx | null)[] = [null];
  const changes = new Set(timeline.changes());
  let ctx: TierCtx | null = null;
  for (let m = 1; m <= windowMonths; m++) {
    if (m === 1 || changes.has(m)) ctx = ctxOf(timeline.frameAt(m).finance);
    byMonth.push(ctx);
  }
  return byKey.size === 0 ? null : { base, byMonth };
}

/**
 * The tier table `scoreStaticsOf` made for `s`; null without finance. A copy of a ScoreStatics with
 * finance (e.g. a `structuredClone`) has none and throws.
 */
export function tierTableFor(s: ScoreStatics): TierTable | null {
  if (s.tierBaseline === null) return null;
  const t = TIER_TABLES.get(s);
  if (t === undefined) {
    throw new Error(
      'world-score: ScoreStatics without its tier context; pass the object scoreStaticsOf returned'
    );
  }
  return t;
}

type Finance = NonNullable<SimInput['finance']>;
type OffSpan = Finance['off'][number];

/**
 * The plan's money over the window as one `finance` (rule 12): pools, programmes, slope and terms
 * of month `windowMonths`'s frame (the same ids and order in every frame). A pool's shape (label,
 * kind and debt terms) is month W's definition, a decided simplification: were two spans to give
 * one pool id different debt terms, all its borrowing in the window is priced on month W's. Each
 * pool's inflows are the arrivals its definition in force each month gives over that month's days
 * (month 1 from `asOf`), one `once` inflow each, and `off` holds the days whose frame drops them
 * (a pool not in force or switched off; an uncapped pool has no inflows), merged into spans. So `addedBorrowing` of it counts exactly the
 * frames' arrivals. Null when no frame of months 1..`windowMonths` has finance. Throws when a
 * frame holds an arrival its pool's definition does not give.
 */
export function planFinanceOf(
  timeline: PolicyTimeline,
  asOf: Day,
  windowMonths: number
): Finance | null {
  const frames: (FinanceFrame | null)[] = [];
  let last: FinanceFrame | null = null;
  for (let m = 1; m <= windowMonths; m++) {
    const f = timeline.frameAt(m).finance;
    frames.push(f);
    if (f !== null) last = f;
  }
  if (last === null) return null;
  const off: OffSpan[] = [];
  const pools = last.pools.map((shape, q): Pool => {
    const inflows: Inflow[] = [];
    let open: OffSpan | null = null;
    for (let m = 1; m <= windowMonths; m++) {
      const f = frames[m - 1];
      const lo = m === 1 ? asOf : monthFirstDay(asOf, m);
      const hi = monthLastDay(asOf, m);
      // What the definition in force gives this month, and what the frame holds, by day.
      const want = new Map<Day, number>();
      const def = f === null ? shape : f.pools[q];
      for (const fl of def.inflows) {
        const dollars = fl.kind === 'once' ? fl.dollars : fl.dollarsPerYear;
        for (const day of inflowArrivals(fl, lo, hi)) {
          inflows.push({ kind: 'once', day, dollars });
          want.set(day, (want.get(day) ?? 0) + dollars);
        }
      }
      const got = new Map<Day, number>();
      if (f !== null) {
        for (const a of f.arrivals) {
          if (a.pool === q) got.set(a.day, (got.get(a.day) ?? 0) + a.dollars);
        }
      }
      for (const [day, dollars] of got) {
        if (want.get(day) !== dollars) {
          throw new Error(
            `world-score: month ${m}'s frame has ${dollars} reaching pool ${shape.id} on day ` +
              `${day}, its definition gives ${want.get(day) ?? 0}`
          );
        }
      }
      for (const day of [...want.keys()].sort((a, b) => a - b)) {
        if (got.has(day)) open = null;
        else if (open !== null) open.to = day;
        else off.push((open = { pool: shape.id, from: day, to: day }));
      }
    }
    return { ...shape, inflows };
  });
  return { pools, programmes: last.programmes, off, slope: last.slope, terms: last.terms };
}

/**
 * What the page needs once. `months` runs from the dataset month to the last calendar month whose
 * last day is at or before the last day of model month `windowMonths`. `limits` are those of the
 * borrowing the plan adds over the window (`planFinanceOf`) beyond the dataset's baseline pools
 * (the default document's money), through `horizonOf`: seed-free and independent of any ledger.
 */
export function scoreStaticsOf(
  input: SimInput,
  timeline: PolicyTimeline,
  base: 'plan' | 'preFzp',
  windowMonths: number,
  rhna: ProjectsFile['rhnaCompletedNet']
): ScoreStatics {
  const asOf = input.asOf;
  const limit = monthLastDay(asOf, windowMonths);
  let h = lastDayOf(firstOfMonth(asOf));
  while (lastDayOf(h + 1) <= limit) h = lastDayOf(h + 1);
  const tiers = tierTableOf(input, timeline, windowMonths);
  const months = monthsOf(asOf, h);
  const plan = planFinanceOf(timeline, asOf, windowMonths);
  const baselinePools = input.finance?.pools ?? [];
  const out: ScoreStatics = {
    asOf,
    months,
    lastIndex: months.length - 1,
    baseline: rhna,
    tierBaseline: tiers === null ? null : tierBaselineOf(rhna),
    phasing: phasingOf(input.projects, asOf),
    references:
      base === 'preFzp' ? REFERENCES : REFERENCES.filter((r) => r.measure === 'completedNet'),
    compare: base,
    limits: plan === null ? null : limitStatements(addedBorrowing(plan, baselinePools, asOf, h)),
    // Plain data, so `viewOf` gives `owed` from a copy (month W's terms, see `planFinanceOf`).
    debts:
      plan === null
        ? null
        : plan.pools.flatMap((p) =>
            p.debt === null
              ? []
              : [{ pool: p.id, debt: { rate: p.debt.rate, termYears: p.debt.termYears } }]
          )
  };
  if (tiers !== null) TIER_TABLES.set(out, tiers);
  return out;
}

/** The last day of the last calendar month. */
export function horizonOf(s: ScoreStatics): Day {
  return lastDayOf(s.months[s.lastIndex]);
}

/** `[i]` is the model month holding the last day of calendar month i. */
export function finalTable(s: ScoreStatics): Int32Array {
  const out = new Int32Array(s.lastIndex + 1);
  for (let i = 0; i <= s.lastIndex; i++) out[i] = monthOfDay(s.asOf, lastDayOf(s.months[i]));
  return out;
}
