/**
 * The dock's one selection, shared by the Transit tab's layers (its rules and the FZP baseline
 * row) and the Paint tab's painted areas, and the height-limits view it chooses. Pure TS.
 */
import type { ParcelId } from '$lib/data/parcel';
import type { LimitsView } from '$lib/map/height/limits-style';
import type { LimitOwner } from '$lib/sim/levers/source';
import type { SimTool } from './brush-tools.svelte';
import { paintBrushOf, type Lots, type SimPolicy } from './policy';

export type DockSelection =
  { kind: 'rule'; id: string } | { kind: 'paint'; id: string } | { kind: 'fzp' } | null;

/**
 * `sel`, or null once its rule or brush has left the policy (Remove, Undo, a restore). The FZP
 * baseline never leaves.
 */
export function liveSelection(sel: DockSelection, p: SimPolicy): DockSelection {
  if (sel === null || sel.kind === 'fzp') return sel;
  const list = sel.kind === 'rule' ? p.rules : p.custom;
  return list.some((x) => x.id === sel.id) ? sel : null;
}

/**
 * What a click on `lot` selects: its rule (if still in the policy), its painted area, else the FZP
 * row; null clears. `owner` is the worker's, from the limits it holds, which may be a revision
 * behind the policy: a rule id that is missing, empty or no longer in the policy reads FZP, as
 * does paint whose area the main thread cannot name (its lots unknown, or since erased).
 */
export function selectionForLot(
  owner: LimitOwner | null,
  lot: ParcelId | null,
  p: SimPolicy,
  lots: Lots
): DockSelection {
  if (lot === null || owner === null) return null;
  if (owner.kind === 'rule') {
    const id = owner.ruleId;
    return id && p.rules.some((r) => r.id === id) ? { kind: 'rule', id } : { kind: 'fzp' };
  }
  if (owner.kind === 'paint') {
    const id = paintBrushOf(p, lots, lot);
    return id === null ? { kind: 'fzp' } : { kind: 'paint', id };
  }
  return { kind: 'fzp' };
}

/** The dock tab that lists a selection: a rule and the FZP baseline on Transit, paint on Paint. */
export function tabOf(sel: Exclude<DockSelection, null>): 'transit' | 'paint' {
  return sel.kind === 'paint' ? 'paint' : 'transit';
}

/**
 * A selected rule → rule mode; the FZP baseline → fzp; a selected painted area, or Paint/Erase
 * chosen (edit) → paint; else plain.
 */
export function limitsViewOf(sel: DockSelection, tool: SimTool, mode: 'edit' | 'view'): LimitsView {
  if (sel?.kind === 'rule') return { kind: 'rule', ruleId: sel.id };
  if (sel?.kind === 'fzp') return { kind: 'fzp' };
  if (sel?.kind === 'paint') return { kind: 'paint' };
  return mode === 'edit' && (tool === 'paint' || tool === 'erase')
    ? { kind: 'paint' }
    : { kind: 'plain' };
}
