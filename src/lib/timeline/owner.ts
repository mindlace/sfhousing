/**
 * Names over a schema 4 document for the card and the map tap (timeline-ui rules 19, 21): who sets
 * a lot's limit, and who pays for a funded start. Pure.
 */
import type { CardFunding } from '$lib/fzp/card';
import { fundingName, type Baseline } from '$lib/sim-page/funding-view';
import type { LimitOwner } from '$lib/sim/levers/source';
import type { PolicyLimitOwner } from '$lib/sim/world/policy/limits';
import type { Pool, Programme } from '$lib/timelapse/types';
import type { SimPolicy4 } from './policy4';

/**
 * The policy that sets a lot's limit, or null for the Family Zoning Plan. The timeline worker's
 * owners are `PolicyLimitOwner`s, typed as the map's `LimitOwner` on the way through.
 */
export function policyOfOwner(o: LimitOwner): string | null {
  const p = o as PolicyLimitOwner | LimitOwner;
  if (p.kind === 'fzp' || !('policy' in p)) return null;
  return typeof p.policy === 'string' ? p.policy : null;
}

/** The label of the policy that sets the lot; null for the plan or a policy no longer there. */
export function ownerName4(o: LimitOwner, doc: SimPolicy4): string | null {
  const id = policyOfOwner(o);
  if (id === null) return null;
  const k = doc.kinds;
  return [...k.zoning, ...k.permitting, ...k.money].find((p) => p.id === id)?.label ?? null;
}

/** The pools and programmes every money policy of `doc` adds, over all its spans (later wins). */
export function fundsOf4(doc: SimPolicy4): { pools: Pool[]; programmes: Programme[] } {
  const pools = new Map<string, Pool>();
  const programmes = new Map<string, Programme>();
  for (const p of doc.kinds.money) {
    for (const s of p.spans) {
      if (s.what.tag !== 'fund') continue;
      if (s.what.pool) pools.set(s.what.pool.id, s.what.pool);
      for (const g of s.what.programmes) programmes.set(g.id, g);
    }
  }
  return { pools: [...pools.values()], programmes: [...programmes.values()] };
}

/** The card's "Funded by" line: `fundingName` over the document's money and the baseline's. */
export function fundingName4(
  doc: SimPolicy4,
  baseline: Baseline | undefined
): (c: CardFunding) => string | null {
  const { pools, programmes } = fundsOf4(doc);
  return fundingName({ baselineScale: [], pools, programmes, terms: {} }, baseline);
}
