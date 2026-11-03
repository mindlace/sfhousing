/**
 * The open zoning rule form: SimPage owns it and RulesSection shows it inline in the dock's
 * Transit tab. It outlives the form's component: the dock unmounts the tab panel on a tab change,
 * a fold or a run, and the form comes back with the user's edits (its `draft`). Saving is one
 * labelled store change, so Undo names it; closing returns focus to the control that opened the
 * form.
 */
import { tick } from 'svelte';
import type { StopType } from '$lib/sim/levers/brushes';
import { ruleChangeLabel } from './brush-summary';
import { DEFAULT_BANDS, type ZoningRule } from './policy';
import type { PolicyStore } from './policy-store.svelte';

/** A band as typed: a field may be empty (null) or out of range until Save. */
export interface DraftBand {
  maxM: number | null;
  stories: number | null;
}

/** What the user has entered in an open rule form, seeded once from the rule being edited. */
export class RuleDraft {
  stopTypes = $state<StopType[]>([]);
  bands = $state<DraftBand[]>([]);
  /** Save was pressed with a problem: from then on the reason follows the fields. */
  attempted = $state(false);
  /** The form has been shown once (its heading took focus then; a remount does not move focus). */
  shown = false;

  constructor(initial?: ZoningRule) {
    this.stopTypes = initial ? [...initial.stopTypes] : [];
    this.bands = (initial ? initial.bands : DEFAULT_BANDS).map((b) => ({ ...b }));
  }
}

export interface FormRequest {
  /** The rule being edited; absent for a new rule. */
  initial?: ZoningRule;
  /** The user's entries so far. */
  draft: RuleDraft;
}

export class BrushForms {
  current = $state.raw<FormRequest | null>(null);
  /** A selector for the control to focus on close (it may have been remounted meanwhile). */
  #returnTo: string | null = null;

  /** Opens the form for `req.initial` (or a new rule) with a fresh draft. */
  open(req: { initial?: ZoningRule }, returnTo: string): void {
    this.#returnTo = returnTo;
    this.current = { ...req, draft: new RuleDraft(req.initial) };
  }

  /** Closes the form and, once the DOM has settled, focuses the control that opened it. */
  close(): void {
    const sel = this.#returnTo;
    this.current = null;
    this.#returnTo = null;
    if (sel) void tick().then(() => document.querySelector<HTMLElement>(sel)?.focus());
  }

  /** Discards the open form without moving focus (the rule it edits was removed). */
  dismiss(): void {
    this.current = null;
    this.#returnTo = null;
  }

  /** Adds `r`, or replaces the rule with its id; returns the change's label. */
  save(store: PolicyStore, r: ZoningRule): string {
    const editing = store.policy.rules.some((x) => x.id === r.id);
    const label = editing ? `Edited: ${ruleChangeLabel(r)}` : ruleChangeLabel(r);
    store.apply((p) => {
      // An edit that changed nothing is no change (so Undo does not name it).
      const old = p.rules.find((x) => x.id === r.id);
      if (old && JSON.stringify(old) === JSON.stringify(r)) return p;
      return { ...p, rules: old ? p.rules.map((x) => (x.id === r.id ? r : x)) : [...p.rules, r] };
    }, label);
    return label;
  }
}
