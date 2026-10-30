/**
 * The open rule brush form, shared by BrushSection (inline from md) and SimPage (below md, the
 * form replaces the sheet's contents, layout ruling 9). Saving is one labelled store change, so
 * Undo names it; closing returns focus to the control that opened the form.
 */
import { tick } from 'svelte';
import { changeLabel, type RuleKind } from './brush-summary';
import type { ZoningBrush } from './policy';
import type { PolicyStore } from './policy-store.svelte';

export interface FormRequest {
  kind: RuleKind;
  /** The brush being edited; absent for a new brush. */
  initial?: ZoningBrush;
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

  /** Adds `b`, or replaces the brush with its id; returns the change's label. */
  save(store: PolicyStore, b: ZoningBrush): string {
    const editing = store.policy.brushes.some((x) => x.id === b.id);
    const label = editing ? `Edited: ${changeLabel(b)}` : changeLabel(b);
    store.apply((p) => {
      // An edit that changed nothing is no change (so Undo does not name it).
      const old = p.brushes.find((x) => x.id === b.id);
      if (old && JSON.stringify(old) === JSON.stringify(b)) return p;
      return {
        ...p,
        brushes: old ? p.brushes.map((x) => (x.id === b.id ? b : x)) : [...p.brushes, b]
      };
    }, label);
    return label;
  }
}
