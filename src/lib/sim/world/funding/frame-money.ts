// What one frame's money offers, indexed for the funding step (spec rules 3 and 17).
import { canonicalJson } from '$lib/sim-page/policy';
import { financeIndexOf, type FinanceIndex } from '$lib/sim/scenario/funding';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Pool, ProjectKind } from '$lib/timelapse/types';
import type { FinanceFrame, PolicyFrame, PolicyTimeline } from '../policy/frame';

type Finance = NonNullable<SimInput['finance']>;

export interface FrameMoney {
  fin: FinanceFrame;
  index: FinanceIndex;
  prog: Map<string, number>;
  pool: Map<string, number>;
  /** Offered programme indices of each kind, ascending (rule 3). */
  offered: Record<ProjectKind, number[]>;
  /** Least `minHomes` among `offered[kind]`; Infinity when none. */
  least: Record<ProjectKind, number>;
  /** Money identity (rule 17), as `policy/money.ts:170-182` keys it. */
  key: string;
  /** `offered[kind]` filtered to `minHomes <= units`, one shared array per distinct set. */
  bundleOf(kind: ProjectKind, units: number): number[];
  /** A joined id list mapped to its canonical bundle, null when an id is unknown or not offered. */
  bundleIds(ids: string): number[] | null;
}

/**
 * The money identity of a frame, built exactly as `policy/money.ts:170-182` builds the key it
 * folds into frame ids: the offered programmes in programme order, the pools they draw (by pool
 * index, without inflows) and the terms and slope. `FinanceFrame` carries no key, so this mirrors
 * it; `frame-money.spec.ts` checks the two agree.
 */
function keyOf(fin: FinanceFrame): string {
  const onOffer: [string, (typeof fin.programmes)[number]][] = [];
  const drawn = new Set<number>();
  const poolAt = new Map(fin.pools.map((p, q) => [p.id, q]));
  fin.programmes.forEach((g, i) => {
    if (fin.offered[i] !== 1) return;
    onOffer.push([g.id, g]);
    drawn.add(poolAt.get(g.pool)!);
  });
  const shape = (p: Pool) => {
    const out: Partial<Pool> = { ...p };
    delete out.inflows;
    return out;
  };
  return canonicalJson({
    offered: onOffer,
    pools: [...drawn].sort((a, b) => a - b).map((q) => [fin.pools[q].id, shape(fin.pools[q])]),
    terms: fin.terms,
    slope: fin.slope
  });
}

const memo = new WeakMap<PolicyTimeline, Map<number, FrameMoney>>();

/** The money side of `frame` (which must have `finance`), memoised per (timeline, frame id). */
export function frameMoney(timeline: PolicyTimeline, frame: PolicyFrame): FrameMoney {
  let byId = memo.get(timeline);
  if (byId === undefined) memo.set(timeline, (byId = new Map()));
  const hit = byId.get(frame.id);
  if (hit !== undefined) return hit;
  const fin = frame.finance;
  if (fin === null) throw new Error('frameMoney: the frame has no finance');

  // Offers come from `fin.offered`, never `isOffered`, so the spans are left out.
  const synthetic: Finance = {
    pools: fin.pools,
    programmes: fin.programmes,
    off: [],
    slope: fin.slope,
    terms: fin.terms
  };
  const index = financeIndexOf(synthetic);
  const prog = new Map(fin.programmes.map((g, i) => [g.id, i]));
  const pool = new Map(fin.pools.map((p, q) => [p.id, q]));
  const offered: Record<ProjectKind, number[]> = { market: [], affordable: [] };
  const least: Record<ProjectKind, number> = { market: Infinity, affordable: Infinity };
  fin.programmes.forEach((g, i) => {
    if (fin.offered[i] !== 1) return;
    offered[g.reach].push(i);
    if (g.minHomes < least[g.reach]) least[g.reach] = g.minHomes;
  });

  const bundles = new Map<string, number[]>();
  const canon = (set: number[]): number[] => {
    const k = set.join(',');
    let b = bundles.get(k);
    if (b === undefined) bundles.set(k, (b = set));
    return b;
  };
  // `bundleOf` per kind in an array indexed by units, capped at `top` (the largest `minHomes`
  // offered, rounded up): from there on every offered programme is met, so the set is the same.
  // Units off the array (not a whole number, or negative) use the keyed map.
  const top: Record<ProjectKind, number> = { market: 0, affordable: 0 };
  for (const kind of ['market', 'affordable'] as const)
    for (const i of offered[kind])
      top[kind] = Math.max(top[kind], Math.ceil(fin.programmes[i].minHomes));
  const byUnits: Record<ProjectKind, (number[] | undefined)[]> = { market: [], affordable: [] };
  const sized = new Map<string, number[]>();
  const bundleAt = (kind: ProjectKind, units: number): number[] =>
    canon(offered[kind].filter((i) => fin.programmes[i].minHomes <= units));

  const fm: FrameMoney = {
    fin,
    index,
    prog,
    pool,
    offered,
    least,
    key: keyOf(fin),
    bundleOf(kind, units) {
      const u = Math.min(units, top[kind]);
      if (Number.isInteger(u) && u >= 0) {
        const row = byUnits[kind];
        let b = row[u];
        if (b === undefined) {
          b = bundleAt(kind, u);
          row[u] = b;
        }
        return b;
      }
      const k = `${kind}|${units}`;
      let b = sized.get(k);
      if (b === undefined) {
        b = bundleAt(kind, units);
        sized.set(k, b);
      }
      return b;
    },
    bundleIds(ids) {
      const set: number[] = [];
      if (ids !== '')
        for (const id of ids.split(',')) {
          const i = prog.get(id);
          if (i === undefined || fin.offered[i] !== 1) return null;
          set.push(i);
        }
      return canon(set.sort((a, b) => a - b));
    }
  };
  byId.set(frame.id, fm);
  return fm;
}

/** Whether two frames carry the same money identity (rule 17): arrivals apart, the same offers, pools, terms and slope. */
export function sameMoney(a: PolicyFrame, b: PolicyFrame, timeline: PolicyTimeline): boolean {
  if (a.finance === null || b.finance === null) return a.finance === b.finance;
  if (a.finance === b.finance) return true;
  return frameMoney(timeline, a).key === frameMoney(timeline, b).key;
}
