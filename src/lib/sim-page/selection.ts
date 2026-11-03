/**
 * The dock's one selection, shared by the Transit tab's layers (its rules and the FZP baseline
 * row) and the Paint tab's painted areas, and the height-limits view it chooses. Pure TS.
 */
import type { LimitsView } from '$lib/map/height/limits-style';
import type { SimTool } from './brush-tools.svelte';
import type { SimPolicy } from './policy';

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
