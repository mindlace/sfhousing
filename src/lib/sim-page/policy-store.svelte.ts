/**
 * The /sim policy in memory (SimPage autosaves it, plan 5): `PolicyStore` keeps the document
 * with undo and redo. `PolicySync` (`src/lib/timeline/policy-sync.svelte.ts`) resolves its brush
 * queries.
 */
import type { SimPolicy4 } from '$lib/timeline/policy4';

type Entry<P> = { policy: P; label: string };

/**
 * The document in memory with undo and redo. Generic: schema 3 (`SimPolicy`, the old page) and
 * schema 4 (`SimPolicy4`, the timeline) share it.
 */
export class PolicyStore<P = SimPolicy4> {
  #policy: P;
  /** Each entry is the policy before a change, with that change's label. */
  #past = $state.raw<Entry<P>[]>([]);
  /** Each entry is the policy after an undone change, with that change's label. */
  #future = $state.raw<Entry<P>[]>([]);
  /** The coalesce key of the latest history entry; cleared by undo and redo. */
  #coalesceKey: string | undefined = undefined;
  #normalize: ((next: P, prev: P) => P) | undefined;

  /** `normalize` settles a changed document before it is recorded (`apply`, `undoTo`). */
  constructor(initial: P, normalize?: (next: P, prev: P) => P) {
    this.#policy = $state.raw(initial);
    this.#normalize = normalize;
  }

  /** Replaced (never mutated) on every change. */
  get policy(): P {
    return this.#policy;
  }

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** The label `undo` would undo ("Undo: …", layout ruling 7), or null. */
  get undoLabel(): string | null {
    return this.#past.at(-1)?.label ?? null;
  }

  /** The label `redo` would redo, or null. */
  get redoLabel(): string | null {
    return this.#future.at(-1)?.label ?? null;
  }

  /**
   * Records a change named `label` (for "Undo: …"); clears redo. Runs at once. A change that
   * returns the identical document (`===`) is no change: no entry, no notification. A change
   * with the same `coalesce` key as the latest one, with no undo or redo between, merges
   * into that entry: one undo reverses both, and the entry takes the newer label.
   */
  apply(change: (p: P) => P, label: string, coalesce?: string): void {
    const prev = this.#policy;
    let next = change(prev);
    if (next === prev) return;
    if (this.#normalize) next = this.#normalize(next, prev);
    if (next === prev) return;
    if (coalesce !== undefined && coalesce === this.#coalesceKey && this.#past.length > 0) {
      const last = this.#past.at(-1)!;
      this.#past = [...this.#past.slice(0, -1), { policy: last.policy, label }];
    } else {
      this.#past = [...this.#past, { policy: prev, label }];
    }
    this.#coalesceKey = coalesce;
    this.#future = [];
    this.#policy = next;
  }

  /**
   * Replaces the policy and clears undo and redo: a load (the autosave restore), not a change
   * the user can undo (Call 12).
   */
  reset(p: P): void {
    this.#past = [];
    this.#future = [];
    this.#coalesceKey = undefined;
    this.#policy = p;
  }

  /** Restores the policy before the latest change; returns its label, or null if none. */
  undo(): string | null {
    const last = this.#past.at(-1);
    if (!last) return null;
    this.#coalesceKey = undefined;
    this.#past = this.#past.slice(0, -1);
    this.#future = [...this.#future, { policy: this.#policy, label: last.label }];
    this.#policy = last.policy;
    return last.label;
  }

  /** Reapplies the latest undone change; returns its label, or null if none. */
  redo(): string | null {
    const next = this.#future.at(-1);
    if (!next) return null;
    this.#coalesceKey = undefined;
    this.#future = this.#future.slice(0, -1);
    this.#past = [...this.#past, { policy: this.#policy, label: next.label }];
    this.#policy = next.policy;
    return next.label;
  }

  /**
   * Undoes until `policy === p` (redo keeps what was undone). If `p` is not in the past,
   * records one change back to `p` labelled `label`.
   */
  undoTo(p: P, label: string): void {
    if (this.#policy === p) return;
    if (this.#past.some((e) => e.policy === p)) {
      while (this.#policy !== p && this.undo() !== null);
      return;
    }
    this.apply(() => p, label);
  }
}
