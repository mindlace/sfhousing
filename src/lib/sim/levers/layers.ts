/**
 * The stock layers as envelope tables, the most-permissive blend and the time-switched current
 * law (plan 2 rulings 1 and 3). Tables are views over the decoded columns where they can be and
 * fresh arrays where a row choice is made; callers must not mutate them. Worker-safe.
 */
import { NULL_CAP, SB79_STATUSES, type PolicyParcels } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { mostPermissive } from '$lib/data/stock-layers';
import { STOCK_LAYERS, type StockLayerId } from './types';

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

export type Period = 'before' | 'after';

/** One stock layer's columns as parcels.bin / policy.bin carry them. 'currentLaw' = FZP + §207.11. */
export function stockTable(ctx: LayerCtx, id: StockLayerId): EnvelopeTable {
  const { parcels: p, policy: q } = ctx;
  const count = p.count;
  switch (id) {
    case 'fzp':
      return {
        count,
        stories: p.envelopeStories,
        cap: q.fzpYieldCap,
        yield: p.yield,
        hostable: p.hostable
      };
    case 'base':
      return {
        count,
        stories: p.baseStories,
        cap: p.baseCap,
        yield: p.baseYield,
        hostable: p.hostableBase
      };
    case 'sb79':
      return {
        count,
        stories: q.sb79Stories,
        cap: q.sb79Cap,
        yield: q.sb79Yield,
        hostable: q.hostableSb79
      };
    case 'currentLaw':
      return {
        count,
        stories: q.currentStories,
        cap: q.currentCap,
        yield: q.currentYield,
        hostable: q.hostableCurrent
      };
  }
}

const topOf = (t: EnvelopeTable, i: number, F: number) => ({
  yieldTop: t.yield[i * F + F - 1],
  hostable: t.hostable[i] === 1
});

function emptyTable(count: number, F: number): EnvelopeTable {
  return {
    count,
    stories: new Uint8Array(count),
    cap: new Uint16Array(count).fill(NULL_CAP),
    yield: new Uint16Array(count * F),
    hostable: new Uint8Array(count)
  };
}

function copyRow(to: EnvelopeTable, i: number, from: EnvelopeTable, F: number): void {
  to.stories[i] = from.stories[i];
  to.cap[i] = from.cap[i];
  to.hostable[i] = from.hostable[i];
  to.yield.set(from.yield.subarray(i * F, i * F + F), i * F);
}

const winsMemo = new WeakMap<LayerCtx, Uint8Array>();
const afterMemo = new WeakMap<LayerCtx, EnvelopeTable>();

/**
 * 1 where the after-switch current law takes the SB 79 row (ruling 1): SB 79 applies, the lot is
 * not permanently exempt and SB 79 is more permissive than FZP. Memoised per ctx.
 */
export function sb79WinsAfter(ctx: LayerCtx): Uint8Array {
  const hit = winsMemo.get(ctx);
  if (hit) return hit;
  const F = ctx.parcels.fillLevels.length;
  const fzp = stockTable(ctx, 'fzp');
  const sb79 = stockTable(ctx, 'sb79');
  const { sb79Status, exemptPermanent } = ctx.policy;
  const applies = SB79_STATUSES.indexOf('applies');
  const out = new Uint8Array(ctx.parcels.count);
  for (let i = 0; i < out.length; i++)
    if (
      sb79Status[i] === applies &&
      exemptPermanent[i] === 0 &&
      mostPermissive(topOf(fzp, i, F), topOf(sb79, i, F)) === 'b'
    )
      out[i] = 1;
  winsMemo.set(ctx, out);
  return out;
}

/**
 * Current law from the switch day (ruling 1): the SB 79 row where `sb79WinsAfter`, otherwise the
 * FZP row. §207.11 has lapsed with the Alternative Plan, and the temporary exemptions end on the
 * same date.
 */
export function currentLawAfterTable(ctx: LayerCtx): EnvelopeTable {
  const hit = afterMemo.get(ctx);
  if (hit) return hit;
  const F = ctx.parcels.fillLevels.length;
  const fzp = stockTable(ctx, 'fzp');
  const sb79 = stockTable(ctx, 'sb79');
  const wins = sb79WinsAfter(ctx);
  const out = emptyTable(ctx.parcels.count, F);
  for (let i = 0; i < out.count; i++) copyRow(out, i, wins[i] ? sb79 : fzp, F);
  afterMemo.set(ctx, out);
  return out;
}

/** The current-law table for a period; `assumeAlternativePlanKept` keeps FZP + §207.11 throughout. */
export function currentLawTable(
  ctx: LayerCtx,
  period: Period,
  assumeAlternativePlanKept: boolean
): EnvelopeTable {
  return period === 'after' && !assumeAlternativePlanKept
    ? currentLawAfterTable(ctx)
    : stockTable(ctx, 'currentLaw');
}

/**
 * The most-permissive blend of the chosen layers. Layers are walked in STOCK_LAYERS order; a
 * row's four fields come from one winning layer, and a tie keeps the earlier layer, so the
 * result does not depend on the order of `layers`. An empty stock hosts nothing.
 */
export function blendStock(
  ctx: LayerCtx,
  layers: readonly StockLayerId[],
  period: Period,
  assumeAlternativePlanKept: boolean
): EnvelopeTable {
  const F = ctx.parcels.fillLevels.length;
  const tables = STOCK_LAYERS.filter((id) => layers.includes(id)).map((id) =>
    id === 'currentLaw'
      ? currentLawTable(ctx, period, assumeAlternativePlanKept)
      : stockTable(ctx, id)
  );
  const out = emptyTable(ctx.parcels.count, F);
  if (tables.length === 0) return out;
  for (let i = 0; i < out.count; i++) {
    let winner = tables[0];
    for (let k = 1; k < tables.length; k++)
      if (mostPermissive(topOf(winner, i, F), topOf(tables[k], i, F)) === 'b') winner = tables[k];
    copyRow(out, i, winner, F);
  }
  return out;
}
