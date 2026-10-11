import {
  MAX_PLAN_BYTES,
  OPS_MAX,
  planByteSize,
  rebasePlan,
  type Plan,
  type PlanOp
} from '$lib/plan';

export type CommitResult =
  { ok: true } | { ok: false; reason: 'too-large' | 'too-many-ops' | 'read-only' };

export interface Editor {
  readonly plan: Plan;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readOnly: boolean;
  load(plan: Plan, opts?: { readOnly?: boolean }): void; // clears redo
  commit(op: PlanOp, opts?: { datasetVersion?: string }): CommitResult; // clears redo (R11)
  undo(): PlanOp | null;
  redo(): PlanOp | null;
  /** Calls `cb` after each `load` updates state (never on commit/undo/redo). Returns unsubscribe. */
  onLoad(cb: (plan: Plan) => void): () => void;
}

/**
 * The in-memory plan and its undo/redo stacks (spec §4.5, §4.6). `plan` and `redo` are replaced,
 * never mutated, on every change, so `$state.raw` tracks them.
 */
export function createEditor(initial: Plan, opts: { readOnly?: boolean } = {}): Editor {
  let plan = $state.raw(initial);
  let redo = $state.raw<PlanOp[]>([]);
  let readOnly = $state(opts.readOnly ?? false);
  // Plain callbacks, not state.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const loadListeners = new Set<(plan: Plan) => void>();

  /** Appends op to base, or names the limit it would break. */
  function append(base: Plan, op: PlanOp): Plan | 'too-large' | 'too-many-ops' {
    const next: Plan = { ...base, ops: [...base.ops, op] };
    if (next.ops.length > OPS_MAX) return 'too-many-ops';
    if (planByteSize(next) > MAX_PLAN_BYTES) return 'too-large';
    return next;
  }

  return {
    get plan() {
      return plan;
    },
    get canUndo() {
      return !readOnly && plan.ops.length > 0;
    },
    get canRedo() {
      return !readOnly && redo.length > 0;
    },
    get readOnly() {
      return readOnly;
    },
    load(next, loadOpts = {}) {
      plan = next;
      readOnly = loadOpts.readOnly ?? false;
      redo = [];
      for (const cb of [...loadListeners]) cb(next);
    },
    commit(op, commitOpts = {}) {
      if (readOnly) return { ok: false, reason: 'read-only' };
      let base = plan;
      const v = commitOpts.datasetVersion;
      if (v !== undefined && v !== plan.datasetVersion) {
        // Defensive (spec §4.5): plan-sharing already rebases at load.
        try {
          base = rebasePlan(plan, v);
        } catch (e) {
          if (!(e instanceof TypeError)) throw e;
        }
      }
      const next = append(base, op);
      if (typeof next === 'string') return { ok: false, reason: next };
      plan = next;
      redo = [];
      return { ok: true };
    },
    undo() {
      if (readOnly || plan.ops.length === 0) return null;
      const op = plan.ops[plan.ops.length - 1];
      plan = { ...plan, ops: plan.ops.slice(0, -1) };
      redo = [...redo, op];
      return op;
    },
    redo() {
      if (readOnly || redo.length === 0) return null;
      const op = redo[redo.length - 1];
      const next = append(plan, op);
      if (typeof next === 'string') return null;
      plan = next;
      redo = redo.slice(0, -1);
      return op;
    },
    onLoad(cb) {
      const entry = (p: Plan) => cb(p); // a fresh entry, so subscribing one cb twice is two
      loadListeners.add(entry);
      return () => void loadListeners.delete(entry);
    }
  };
}
