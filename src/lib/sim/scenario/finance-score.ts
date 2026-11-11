/**
 * finance-score: homes by income tier and public money in the results (spec
 * docs/superpowers/specs/2026-11-09-finance-score-design.md). Pure; worker-safe.
 *
 * Tiers first (spec 4.1): `tierContext` builds a run's `TierCtx` once per loaded input, and
 * `tiersOf` splits one schedule's final units by income tier.
 */
import {
  INCOME_TIERS,
  type IncomeTier,
  type ResolvedTerms,
  type TierUnits
} from '$lib/timelapse/types';
import { fundBundle, inclusionaryUnits, prototypeFor, type BundleItem } from '../finance';
import type { Schedule, SimInput } from './types';

export type { LedgerEvent } from './money';

/** Exact (unrounded) shares of a funded affordable project's homes, summing to 1 within 1e-9. */
export type TierShares = Record<IncomeTier | 'unrecorded', number>;

/** The `ctx` of F13's `tiersOf(sc, ctx)` (spec 2, "Internal types"). */
export interface TierCtx {
  /** a pipeline schedule's (or phase's) `projectId` → its recorded affordable homes */
  affordable: Map<string, number>;
  /** each programme id of `finance.programmes` → its pricing item and its `tiers` */
  programmes: Map<string, { item: BundleItem; tiers: Record<IncomeTier, number> | null }>;
  /** the run's `finance.terms`; null without `finance` */
  terms: ResolvedTerms | null;
  /** internal memo of spec 4.1 case 1, keyed by the sorted, comma-joined paying programmes */
  weights: Map<string, TierShares>;
}

/** The five `TierUnits` fields in tie order: earlier wins a tie (F13). */
export const TIER_FIELDS = [
  'veryLow',
  'low',
  'moderate',
  'aboveModerate',
  'unrecorded'
] as const satisfies readonly (keyof TierUnits)[];

/** Floating-point tolerance of the floors and of a remainder tie; not a model number. */
const EPS = 1e-9;

/**
 * Whole parts of `exact` summing to `n`: each `floor(x + 1e-9)`, then the homes left over one each
 * to the largest remainders, remainders within 1e-9 a tie, ties to the lower index.
 */
function largestRemainder(n: number, exact: readonly number[]): number[] {
  const out = exact.map((x) => Math.floor(x + EPS));
  const rem = exact.map((x, i) => x - out[i]);
  const taken = exact.map(() => false);
  let left = n - out.reduce((s, x) => s + x, 0);
  while (left > 0 && exact.length > 0) {
    let best = -1;
    for (let i = 0; i < exact.length; i++) {
      if (taken[i]) continue;
      if (best < 0 || rem[i] > rem[best] + EPS) best = i;
    }
    if (best < 0) {
      // every field has had one: a second round (unreachable with shares summing to 1)
      taken.fill(false);
      continue;
    }
    taken[best] = true;
    out[best] += 1;
    left--;
  }
  return out;
}

/** `n` homes split by `shares` (spec 4.1, "Splitting by shares"); sums exactly to `n`. */
export function splitByShares(n: number, shares: TierShares): TierUnits {
  const parts = largestRemainder(
    n,
    TIER_FIELDS.map((f) => n * shares[f])
  );
  return {
    veryLow: parts[0],
    low: parts[1],
    moderate: parts[2],
    aboveModerate: parts[3],
    unrecorded: parts[4]
  };
}

/**
 * A master's `total` recorded affordable homes over its phases in proportion to `phaseUnits`, by
 * largest remainder, ties to the lower phase index (spec 4.1 case 3, "Phases"). Phases of no
 * homes in all get nothing.
 */
export function allocatePhases(total: number, phaseUnits: readonly number[]): number[] {
  const all = phaseUnits.reduce((s, u) => s + u, 0);
  if (!(all > 0)) return phaseUnits.map(() => 0);
  return largestRemainder(
    total,
    phaseUnits.map((u) => (total * u) / all)
  );
}

/**
 * A run's `TierCtx` (spec 2): `affordable` from `projects` (phases allocated, an unenriched
 * multi-phase row whole, rows of 0 omitted), `programmes` and `terms` from `finance`, `weights`
 * empty. Reads only `projects` and `finance`.
 */
export function tierContext(input: Pick<SimInput, 'projects' | 'finance'>): TierCtx {
  const affordable = new Map<string, number>();
  for (const row of input.projects) {
    const a = row.affordableHomes ?? 0;
    if (a === 0) continue;
    if (row.phases) {
      const shares = allocatePhases(
        a,
        row.phases.map((p) => p.units)
      );
      // engine.ts:195: a phase's projectId is '<id>:phase:<j + 1>' (1-based)
      shares.forEach((s, j) => {
        if (s > 0) affordable.set(`${row.id}:phase:${j + 1}`, s);
      });
    } else {
      affordable.set(row.id, a);
    }
  }
  const programmes: TierCtx['programmes'] = new Map();
  const fin = input.finance;
  if (fin) {
    const kinds = new Map(fin.pools.map((p) => [p.id, p.kind]));
    for (const g of fin.programmes) {
      const poolKind = kinds.get(g.pool);
      if (poolKind === undefined) {
        throw new Error(`tierContext: programme ${g.id} names unknown pool ${g.pool}`);
      }
      programmes.set(g.id, { item: { instrument: g.instrument, poolKind }, tiers: g.tiers });
    }
  }
  return { affordable, programmes, terms: fin?.terms ?? null, weights: new Map() };
}

/** Spec 4.1 case 1, steps 2-5: the five shares of a funded affordable project. */
function affordableShares(sc: Schedule, ids: readonly string[], ctx: TierCtx): TierShares {
  const progs = ids.map((id) => {
    const p = ctx.programmes.get(id);
    if (!p) throw new Error(`tiersOf: unknown programme ${id}`);
    return p;
  });
  const key = [...ids].sort().join(',');
  const hit = ctx.weights.get(key);
  if (hit) return hit;

  let w: number[];
  if (progs.length === 1) {
    w = [1];
  } else {
    if (!ctx.terms) throw new Error('tiersOf: a funded schedule on a context without terms');
    const r0 = sc.revisions[0];
    const b = fundBundle(
      progs.map((p) => p.item),
      'affordable',
      prototypeFor(r0.stories ?? 0, r0.units),
      ctx.terms
    );
    // all weights zero: the paying programmes count equally (tier 4 convention, spec 4.1 step 4)
    w =
      b.grantEquivalent > 0
        ? b.items.map((it) => it.grantEquivalent / b.grantEquivalent)
        : progs.map(() => 1 / progs.length);
  }
  const shares: TierShares = { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0, unrecorded: 0 };
  progs.forEach((p, k) => {
    if (p.tiers === null) {
      shares.unrecorded += w[k];
      return;
    }
    for (const t of INCOME_TIERS) shares[t] += w[k] * p.tiers[t];
  });
  ctx.weights.set(key, shares);
  return shares;
}

/**
 * One schedule's final units by income tier (F13, spec 4.1), summing exactly to them. Gross:
 * existing homes are netted in the series, never here.
 */
export function tiersOf(sc: Schedule, ctx: TierCtx): TierUnits {
  const u = sc.revisions[sc.revisions.length - 1].units;
  if (sc.kind === 'affordable') {
    const ids = sc.funding?.programmes ?? [];
    if (ids.length === 0) {
      return { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0, unrecorded: u };
    }
    return splitByShares(u, affordableShares(sc, ids, ctx));
  }
  if (sc.origin === 'simulated') {
    const inc = inclusionaryUnits(u);
    const onSite = inc.veryLow + inc.low + inc.moderate + inc.aboveModerate;
    return { ...inc, aboveModerate: inc.aboveModerate + u - onSite, unrecorded: 0 };
  }
  const unrecorded = Math.min(ctx.affordable.get(sc.projectId) ?? 0, u);
  return { veryLow: 0, low: 0, moderate: 0, aboveModerate: u - unrecorded, unrecorded };
}
