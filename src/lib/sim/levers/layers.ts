/**
 * The data layers as envelope tables: FZP as written (the plan's starting point) and pre-FZP
 * zoning. Tables are views over the decoded columns; callers must not mutate them. Worker-safe.
 */
import type { OptionTable } from '$lib/data/option-table';
import type { PolicyParcels } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';

/** Per lot: the story limit, the unit cap and whether the lot may host a new project at all. */
export interface EnvelopeTable {
  count: number;
  stories: Uint8Array;
  cap: Uint16Array; // NULL_CAP = none
  /**
   * 0/1: eligible, at least one story and not protected. A view hosts where this is 1 and some
   * option the envelope allows gains a home after the cap (`parcelsView`).
   */
  hostable: Uint8Array;
}

export interface LayerCtx {
  parcels: ScenarioParcels;
  policy: PolicyParcels;
  /** options.bin: the building options every envelope chooses among. */
  options: OptionTable;
}

export type DataLayer = 'fzp' | 'base';

/** One data layer's columns as parcels.bin / policy.bin carry them. */
export function stockTable(ctx: LayerCtx, id: DataLayer): EnvelopeTable {
  const p = ctx.parcels;
  const count = p.count;
  return id === 'fzp'
    ? {
        count,
        stories: p.envelopeStories,
        cap: p.fzpCap,
        hostable: p.hostable
      }
    : {
        count,
        stories: p.baseStories,
        cap: p.baseCap,
        hostable: p.hostableBase
      };
}
