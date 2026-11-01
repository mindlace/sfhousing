/**
 * The open zoning rule form, shared by BrushSection (inline from md) and SimPage (below md, the
 * form replaces the sheet's contents, layout ruling 9). Saving is one labelled store change, so
 * Undo names it; closing returns focus to the control that opened the form.
 */
import { tick } from 'svelte';
import { ruleChangeLabel, type RuleKind } from './brush-summary';
import type { ZoningRule } from './policy';
import type { PolicyStore } from './policy-store.svelte';

export interface FormRequest {
  kind: RuleKind;
  /** The rule being edited; absent for a new rule. */
  initial?: ZoningRule;
}

export class BrushForms {
  current = $state.raw<FormRequest | null>(null);
  /** A selector for the control to focus on close (it may have been remounted meanwhile). */
  #returnTo: string | null = null;

  open(req: FormRequest, returnTo: string): void {
    this.#returnTo = returnTo;
    this.current = req;
  }

  /** Closes the form and, once the DOM has settled, focuses the control that opened it. */
  close(): void {
    const sel = this.#returnTo;
    this.current = null;
    this.#returnTo = null;
    if (sel) void tick().then(() => document.querySelector<HTMLElement>(sel)?.focus());
  }

  /** Discards the open form without moving focus (the panel closed or changed layout). */
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
