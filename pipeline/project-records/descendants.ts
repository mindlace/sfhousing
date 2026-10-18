/**
 * The current parcels descended from a block-lot (spec 4.10.2 DA parcels of a schedule-null
 * master; main's ruling 3 and Ruling D1, revised). The chain is the subdivision record in
 * scenario-data's `src_parcel_attrs` (acdm-wktn, the source `parcel_lineage` is built from):
 * - a retired lot X dropped on day d yields every lot on its block added on day d; those that are
 *   themselves retired are followed in turn, and every active lot reached gives its `mapblklot`;
 *   the root X also gives its lineage mapping (`parcel_lineage.current_mapblklot`), when non-null;
 * - an active lot yields its own `mapblklot`;
 * - a lot with no attrs row, or a retired lot with no drop day, yields only its lineage mapping.
 * The block is the `^\d{4}[A-Z]?` prefix of the block-lot, the lot the `\d{3}[A-Z]?` rest. Pure:
 * the result is sorted, unique and inside `parcelIds`, whatever the row order.
 */
import type { ParcelId } from '../../src/lib/data/parcel';

/** One `src_parcel_attrs` row; `added` / `dropped` are `YYYY-MM-DD` (or null). */
export interface ParcelAttrsRow {
  blklot: string;
  mapblklot: string | null;
  /** NULL reads as retired, as scenario-data's 80_scenario.sql does. */
  active: boolean | null;
  added: string | null;
  dropped: string | null;
}

const BLOCK_LOT = /^(\d{4}[A-Z]?)(\d{3}[A-Z]?)$/;

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The block of a block-lot, or null when it is not in `<block><lot>` form. */
export function blockOf(blklot: string): string | null {
  return BLOCK_LOT.exec(blklot)?.[1] ?? null;
}

/** Row order for picking one row per block-lot: the active row first, then by every field. */
function rowOrder(a: ParcelAttrsRow, b: ParcelAttrsRow): number {
  const act = (r: ParcelAttrsRow) => (r.active === true ? 0 : 1);
  return (
    act(a) - act(b) ||
    cmp(a.mapblklot ?? '', b.mapblklot ?? '') ||
    cmp(a.added ?? '', b.added ?? '') ||
    cmp(a.dropped ?? '', b.dropped ?? '')
  );
}

/**
 * Indexes the attrs rows once and returns the `descendants` callback of `ProjectRecordsInput`.
 * `lineage` is the build's block-lot mapping (active `mapblklot`, else `parcel_lineage`).
 */
export function descendantsIndex(
  rows: readonly ParcelAttrsRow[],
  o: { parcelIds: ReadonlySet<ParcelId>; lineage: (blklot: string) => ParcelId | null }
): (blklot: string) => ParcelId[] {
  // One row per block-lot (a duplicate keeps its active row), deterministically.
  const sorted = [...rows].sort((a, b) => cmp(a.blklot, b.blklot) || rowOrder(a, b));
  const byLot = new Map<string, ParcelAttrsRow>();
  for (const r of sorted) if (!byLot.has(r.blklot)) byLot.set(r.blklot, r);
  // `<block>|<added day>` -> the block-lots added that day, in block-lot order.
  const addedOn = new Map<string, string[]>();
  for (const r of byLot.values()) {
    const block = blockOf(r.blklot);
    if (block === null || r.added === null) continue;
    const key = `${block}|${r.added}`;
    const list = addedOn.get(key);
    if (list) list.push(r.blklot);
    else addedOn.set(key, [r.blklot]);
  }

  const memo = new Map<string, ParcelId[]>();
  return (blklot: string): ParcelId[] => {
    const hit = memo.get(blklot);
    if (hit) return [...hit];
    const out = new Set<ParcelId>();
    const add = (id: ParcelId | null) => {
      if (id !== null && o.parcelIds.has(id)) out.add(id);
    };
    const seen = new Set<string>();
    const walk = (lot: string, root: boolean): void => {
      if (seen.has(lot)) return; // a cycle in the record
      seen.add(lot);
      const r = byLot.get(lot);
      if (r === undefined) {
        add(o.lineage(lot));
        return;
      }
      if (r.active === true) {
        add(r.mapblklot ?? o.lineage(lot));
        return;
      }
      if (root || r.dropped === null) add(o.lineage(lot));
      const block = blockOf(lot);
      if (r.dropped === null || block === null) return;
      for (const child of addedOn.get(`${block}|${r.dropped}`) ?? []) walk(child, false);
    };
    walk(blklot, true);
    const result = [...out].sort(cmp);
    memo.set(blklot, result);
    return [...result];
  };
}
