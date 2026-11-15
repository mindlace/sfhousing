/**
 * The selection on /sim. On the timeline (schema 4) a selection is a policy's span (`SpanRef`),
 * by policy id: the height-limits view it chooses, and what a tap on a lot selects (rule 19). The
 * schema 3 dock's selection (`DockSelection`, `liveSelection`) stays for TransitTab until it goes.
 * Pure TS.
 */
import type { ParcelId } from '$lib/data/parcel';
import type { LimitsView } from '$lib/map/height/limits-style';
import type { LimitOwner } from '$lib/sim/levers/source';
import type { Day } from '$lib/timelapse/time';
import { policyOfOwner } from '$lib/timeline/owner';
import { spanAt, type SimPolicy4 } from '$lib/timeline/policy4';
import { FIXED_ID, fixedRef, isFixedRef } from '$lib/timeline/rows';
import { policyOf, type SpanRef } from '$lib/timeline/spans';
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
 * A selected transit policy → rule mode on its id (a transit policy is one rule, `ruleId ===
 * policy`); the fixed zoning row → fzp; a selected painted policy, or Paint/Erase chosen (edit) →
 * paint; else plain.
 */
export function limitsViewOf(
  sel: SpanRef | null,
  doc: SimPolicy4,
  tool: SimTool,
  mode: 'edit' | 'view'
): LimitsView {
  if (sel !== null && sel.kind === 'zoning') {
    if (isFixedRef(sel)) {
      if (sel.id === FIXED_ID) return { kind: 'fzp' };
    } else {
      const where = policyOf(doc, 'zoning', sel.id)?.where.tag;
      if (where === 'transit') return { kind: 'rule', ruleId: sel.id };
      if (where === 'painted') return { kind: 'paint' };
    }
  }
  return mode === 'edit' && (tool === 'paint' || tool === 'erase')
    ? { kind: 'paint' }
    : { kind: 'plain' };
}

/**
 * What a tap on `lot` selects: the policy that sets its limit (`owner`, the worker's answer for
 * the last view month), on its span covering `day`, else its first; the fixed zoning row for the
 * plan, or for a policy the document no longer holds (the answer may be a revision behind). No lot
 * or no owner clears the selection.
 */
export function selectionForLot(
  owner: LimitOwner | null,
  lot: ParcelId | null,
  doc: SimPolicy4,
  day: Day
): SpanRef | null {
  if (lot === null || owner === null) return null;
  const id = policyOfOwner(owner);
  const p = id === null ? undefined : policyOf(doc, 'zoning', id);
  if (!p || p.spans.length === 0) return fixedRef('zoning');
  const at = spanAt(p, day);
  const span = at === null ? 0 : p.spans.indexOf(at);
  return { kind: 'zoning', id: p.id, span };
}
