/**
 * The data layers as envelope tables: FZP as written (the plan's starting point) and pre-FZP
 * zoning. Tables are views over the decoded columns; callers must not mutate them. Worker-safe.
 */
import type { PolicyParcels } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';

export interface EnvelopeTable {
  count: number;
  stories: Uint8Array;
  cap: Uint16Array; // NULL_CAP = none
  yield: Uint16Array; // count × F
  hostable: Uint8Array;
}

export interface LayerCtx {
  parcels: ScenarioParcels;
  policy: PolicyParcels;
}

export type DataLayer = 'fzp' | 'base';

/** One data layer's columns as parcels.bin / policy.bin carry them. */
export function stockTable(ctx: LayerCtx, id: DataLayer): EnvelopeTable {
  const { parcels: p, policy: q } = ctx;
  const count = p.count;
  return id === 'fzp'
    ? {
        count,
        stories: p.envelopeStories,
        cap: q.fzpYieldCap,
        yield: p.yield,
        hostable: p.hostable
      }
    : {
        count,
        stories: p.baseStories,
        cap: p.baseCap,
        yield: p.baseYield,
        hostable: p.hostableBase
      };
}
