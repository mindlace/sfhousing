/**
 * Which source decides each lot's effective story limit: FZP as written, custom paint, or a
 * zoning rule. Mirrors `resolvePlan`'s order (rules strictly above FZP with the first maximum
 * winning, then paint in order, then protected lots reset to FZP). Worker-safe.
 */
import { stockTable, type LayerCtx } from './layers';
import type { SimLevers } from './types';

export const SRC_FZP = 0;
export const SRC_PAINT = 1;
/** Rule `ruleIds[k]` is code `SRC_RULE0 + k`. */
export const SRC_RULE0 = 2;
/** Reserved for "no lot here" in geometry built from this table. */
export const SRC_NONE = 0xffff;

export interface LimitSources {
  /** Per lot row: `SRC_FZP`, `SRC_PAINT` or `SRC_RULE0 + k`. */
  source: Uint16Array;
  /** Each distinct edit `source` of `levers.rules`, first appearance first; an edit without one is `''`. */
  ruleIds: string[];
}

export function limitSources(
  ctx: LayerCtx,
  levers: SimLevers,
  protectedRows: Int32Array
): LimitSources {
  const index = ctx.parcels.index;
  const fzp = stockTable(ctx, 'fzp').stories;
  const source = new Uint16Array(ctx.parcels.count); // SRC_FZP
  const ruleIds: string[] = [];
  const code = new Map<string, number>();
  const best = new Uint8Array(ctx.parcels.count); // the highest rule so far: only a strict raise takes over

  for (const e of levers.rules) {
    const id = e.source ?? '';
    let k = code.get(id);
    if (k === undefined) {
      k = ruleIds.length;
      code.set(id, k);
      ruleIds.push(id);
    }
    for (const lot of e.lots) {
      const i = index.get(lot);
      if (i === undefined) continue;
      if (e.stories > fzp[i] && e.stories > best[i]) {
        best[i] = e.stories;
        source[i] = SRC_RULE0 + k;
      }
    }
  }
  for (const e of levers.paint)
    for (const lot of e.lots) {
      const i = index.get(lot);
      if (i !== undefined) source[i] = SRC_PAINT;
    }
  for (const i of protectedRows) source[i] = SRC_FZP;
  return { source, ruleIds };
}

/** The layer that sets a lot's limit: FZP, the paint strokes, or a rule (by its edit `source` id). */
export type LimitOwner = { kind: 'fzp' } | { kind: 'paint' } | { kind: 'rule'; ruleId: string };

/**
 * The owner of lot `row`'s limit (`row` indexes `s.source`). A code it cannot resolve to a rule id
 * (out of range, `SRC_NONE`, an edit with no `source`) reads FZP.
 */
export function ownerOf(s: LimitSources, row: number): LimitOwner {
  const code = s.source[row];
  if (code === SRC_PAINT) return { kind: 'paint' };
  const ruleId = code >= SRC_RULE0 ? s.ruleIds[code - SRC_RULE0] : undefined;
  return ruleId ? { kind: 'rule', ruleId } : { kind: 'fzp' };
}
