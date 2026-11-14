/**
 * The money side of each month's policy frame (policy-timeline spec, rules 6, 7, 15 and 16).
 * Pure TS, worker-safe.
 *
 * Rule 6 needs no per-day cutting here: spans begin on a month's first day and end on a month's
 * last day (rule 4), so the policies in force are the same on every day of a month, and the
 * levers in force on the month's first day hold for the whole month. Building `finance` from
 * those levers and reading only the month's days (offered on the first day, arrivals over the
 * month) is exactly "counts only on days inside a span of its policy".
 */
import { buildFinance } from '$lib/sim/levers/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { financeIndexOf, inflowArrivals, isOff, isOffered } from '$lib/sim/scenario/funding';
import type { FinanceIndex } from '$lib/sim/scenario/funding';
import type { SimInput } from '$lib/sim/scenario/types';
import { canonicalJson } from '$lib/sim-page/policy';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { Pool, Programme } from '$lib/timelapse/types';
import { monthFirstDay, monthLastDay } from '../months';
import type { FinanceFrame } from './frame';

type Finance = NonNullable<SimInput['finance']>;

/** The `fund` effects of a money policy, span by span. */
function fundsOf(p: Policy): { pool: Pool | null; programmes: Programme[] }[] {
  if (p.where.tag !== 'fund') return [];
  return p.spans.flatMap((s) => (s.what.tag === 'fund' ? [s.what] : []));
}

/**
 * The frame order of pool and programme ids (rule 15): the baseline's, in its order, then the
 * added ones in document order, one entry per id. Every money policy counts, on or off, so the
 * arrays do not change when a policy is switched.
 */
export function moneyOrder(
  doc: SimPolicy4,
  base: SimInput['finance']
): { pools: string[]; programmes: string[] } {
  const pools = new Set<string>(base?.pools.map((p) => p.id) ?? []);
  const programmes = new Set<string>(base?.programmes.map((g) => g.id) ?? []);
  for (const p of doc.kinds.money)
    for (const w of fundsOf(p)) {
      if (w.pool !== null) pools.add(w.pool.id);
      for (const g of w.programmes) programmes.add(g.id);
    }
  return { pools: [...pools], programmes: [...programmes] };
}

/**
 * Where an added id's definition comes from when its policy is not in force: the policy's spans
 * in order, each with its definition of the id.
 */
interface Added<T> {
  policy: Policy;
  spans: { from: Day; def: T }[];
}

function addedDefs(doc: SimPolicy4): {
  pools: Map<string, Added<Pool>>;
  programmes: Map<string, Added<Programme>>;
} {
  const pools = new Map<string, Added<Pool>>();
  const programmes = new Map<string, Added<Programme>>();
  const add = <T>(m: Map<string, Added<T>>, id: string, policy: Policy, from: Day, def: T) => {
    let a = m.get(id);
    if (a === undefined) m.set(id, (a = { policy, spans: [] }));
    a.spans.push({ from, def });
  };
  for (const p of doc.kinds.money) {
    if (p.where.tag !== 'fund') continue;
    for (const s of p.spans) {
      if (s.what.tag !== 'fund') continue;
      if (s.what.pool !== null) add(pools, s.what.pool.id, p, s.from, s.what.pool);
      for (const g of s.what.programmes) add(programmes, g.id, p, s.from, g);
    }
  }
  return { pools, programmes };
}

/**
 * The definition of an id whose policy is not in force on `day`: that of the last span begun by
 * then while the policy is on (the last one in force), else the first span's (builder's call).
 * For an id whose policy is not yet in force, the entry carries its first span's definition as a
 * placeholder that S5 forces: it lies outside the frame identity and is never offered, so nothing
 * reads it as in force.
 */
function restingDef<T>(a: Added<T>, day: Day): T {
  let def = a.spans[0].def;
  if (a.policy.on) for (const s of a.spans) if (s.from <= day) def = s.def;
  return def;
}

/** A pool's definition without its inflows: what the frame identity (rule 16) covers. */
function poolShape(p: Pool): Omit<Pool, 'inflows'> {
  const out: Partial<Pool> = { ...p };
  delete out.inflows;
  return out as Omit<Pool, 'inflows'>;
}

export interface MoneyTrack {
  /** Call for m = 1, 2, … in order; null when `input.finance` is undefined (frames then have `finance: null`). */
  month(m: number, levers: FinanceLevers): { frame: FinanceFrame; key: string } | null;
}

/**
 * The money frames of `doc` on `input`'s dataset. `levers` for month m are the money in force on
 * its first day (`moneyLeversOf(inForceAt(doc, monthFirstDay(asOf, m)))`). `buildFinance` runs
 * once per distinct levers for the track's life, so its calls are bounded by the distinct sets of
 * spans in force, not by months.
 */
export function createMoneyTrack(
  doc: SimPolicy4,
  input: Pick<SimInput, 'asOf' | 'finance'>
): MoneyTrack {
  const base = input.finance;
  const asOf = input.asOf;
  if (base === undefined) return { month: () => null };

  const order = moneyOrder(doc, base);
  const poolAt = new Map(order.pools.map((id, q) => [id, q]));
  const added = addedDefs(doc);
  const built = new Map<string, FinanceIndex>();

  const indexOf = (levers: FinanceLevers): FinanceIndex => {
    const k = canonicalJson(levers);
    let idx = built.get(k);
    if (idx === undefined) {
      idx = financeIndexOf(buildFinance(base, levers, asOf) as Finance);
      built.set(k, idx);
    }
    return idx;
  };

  return {
    month(m, levers) {
      const idx = indexOf(levers);
      const fin = idx.finance;
      const first = monthFirstDay(asOf, m);
      const last = monthLastDay(asOf, m);

      const finPool = new Map(fin.pools.map((p, q) => [p.id, q]));
      const finProg = new Map(fin.programmes.map((g, i) => [g.id, i]));
      const pools = order.pools.map((id) => {
        const q = finPool.get(id);
        return q !== undefined ? fin.pools[q] : restingDef(added.pools.get(id)!, first);
      });
      const offered = new Uint8Array(order.programmes.length);
      const programmes = order.programmes.map((id, g) => {
        const i = finProg.get(id);
        if (i === undefined) return restingDef(added.programmes.get(id)!, first);
        if (isOffered(idx, i, first)) offered[g] = 1;
        return fin.programmes[i];
      });

      // As `Treasury` builds them (`scenario/money.ts`), over this month's days only.
      const lo = m === 1 ? asOf : first;
      const arrivals: FinanceFrame['arrivals'] = [];
      fin.pools.forEach((p, q) => {
        if (!idx.capped[q]) return;
        const pool = poolAt.get(p.id)!;
        for (const fl of p.inflows) {
          const dollars = fl.kind === 'once' ? fl.dollars : fl.dollarsPerYear;
          for (const day of inflowArrivals(fl, lo, last))
            if (!isOff(idx, q, day)) arrivals.push({ pool, day, dollars });
        }
      });
      arrivals.sort((a, b) => a.day - b.day || a.pool - b.pool); // stable: inflow order

      const onOffer: [string, Programme][] = [];
      const drawn = new Set<number>();
      programmes.forEach((g, i) => {
        if (offered[i] !== 1) return;
        onOffer.push([g.id, g]);
        drawn.add(poolAt.get(g.pool)!);
      });
      const key = canonicalJson({
        offered: onOffer,
        pools: [...drawn].sort((a, b) => a - b).map((q) => [pools[q].id, poolShape(pools[q])]),
        terms: fin.terms,
        slope: fin.slope
      });

      return {
        frame: { pools, programmes, offered, slope: fin.slope, terms: fin.terms, arrivals },
        key
      };
    }
  };
}
