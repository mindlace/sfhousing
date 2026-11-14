import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import { tierBaselineOf, tierContext, type TierCtx } from '$lib/sim/scenario/finance-score';
import { REFERENCES, monthsOf, phasingOf } from '$lib/sim/scenario/score';
import type { SimInput } from '$lib/sim/scenario/types';
import type { ProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import { monthLastDay, monthOfDay } from '../months';
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

/**
 * What the page needs once. `months` runs from the dataset month to the last calendar month whose
 * last day is at or before the last day of model month `windowMonths`.
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
    limits: null
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
