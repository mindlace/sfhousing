import {
  MAX_PLAN_BYTES,
  OPS_MAX,
  planByteSize,
  rebasePlan,
  TITLE_MAX_CHARS,
  type Plan,
  type PlanOp
} from '$lib/plan';

export type CommitResult =
  { ok: true } | { ok: false; reason: 'too-large' | 'too-many-ops' | 'read-only' };

/** What `undo` and `redo` hand back: what the host must now do. */
export type HistoryStep =
  | { kind: 'op'; op: PlanOp } // a stroke committed, undone or redone
  | { kind: 'rows'; plan: Plan; label: string }; // a row removed or restored: send `plan`

type Entry = { kind: 'op'; op: PlanOp } | { kind: 'rows'; removed: RemovedOp[]; label: string };
interface RemovedOp {
  index: number; // its place in the plan before the removal
  op: PlanOp;
}

export interface Editor {
  readonly plan: Plan;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly readOnly: boolean;
  load(plan: Plan, opts?: { readOnly?: boolean }): void; // clears redo
  commit(op: PlanOp, opts?: { datasetVersion?: string }): CommitResult; // clears redo (R11)
  undo(): HistoryStep | null;
  redo(): HistoryStep | null;
  /** Removes the ops with these ids as one undoable step; false if read-only or none matched. */
  removeOps(ids: readonly string[], label: string): boolean;
  /** Calls `cb` after each `load` updates state (never on commit/undo/redo). Returns unsubscribe. */
  onLoad(cb: (plan: Plan) => void): () => void;
  /**
   * Sets the plan title (plan-sharing's Publish dialog). Trims, treats empty as undefined and
   * clips to TITLE_MAX_CHARS. Replaces `plan` with a new object (so an `$effect` on `plan`
   * fires) but keeps undo/redo, never fires `onLoad`, and so never re-sends the plan to the
   * worker (the title does not affect rendering). No-op when read-only or unchanged.
   */
  setTitle(title: string | undefined): void;
}

/**
 * The in-memory plan and its undo/redo stacks (spec §4.5, §4.6). `plan`, `past` and `future` are
 * replaced, never mutated, on every change, so `$state.raw` tracks them. Each stack entry is one
 * step: a stroke, or a row of ops removed together. A loaded plan starts with one stroke entry
 * per op, so Undo still steps back through it.
 */
export function createEditor(initial: Plan, opts: { readOnly?: boolean } = {}): Editor {
  let plan = $state.raw(initial);
  let past = $state.raw<Entry[]>(initial.ops.map((op) => ({ kind: 'op', op })));
  let future = $state.raw<Entry[]>([]);
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
      return !readOnly && past.length > 0;
    },
    get canRedo() {
      return !readOnly && future.length > 0;
    },
    get readOnly() {
      return readOnly;
    },
    load(next, loadOpts = {}) {
      plan = next;
      readOnly = loadOpts.readOnly ?? false;
      past = next.ops.map((op) => ({ kind: 'op', op }));
      future = [];
      for (const cb of [...loadListeners]) {
        try {
          cb(next);
        } catch (e) {
          // One bad listener must not stop the rest or fail the caller's load.
          console.error('[brush] onLoad listener threw', e);
        }
      }
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
      past = [...past, { kind: 'op', op }];
      future = [];
      return { ok: true };
    },
    undo() {
      if (readOnly || past.length === 0) return null;
      const entry = past[past.length - 1];
      past = past.slice(0, -1);
      future = [...future, entry];
      if (entry.kind === 'op') {
        // Stack order: the last entry's op is the plan's last op.
        plan = { ...plan, ops: plan.ops.slice(0, -1) };
        return { kind: 'op', op: entry.op };
      }
      const ops = [...plan.ops];
      for (const r of entry.removed) ops.splice(r.index, 0, r.op); // ascending: each lands in place
      plan = { ...plan, ops };
      return { kind: 'rows', plan, label: entry.label };
    },
    redo() {
      if (readOnly || future.length === 0) return null;
      const entry = future[future.length - 1];
      if (entry.kind === 'op') {
        const next = append(plan, entry.op);
        if (typeof next === 'string') return null;
        plan = next;
      } else {
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const gone = new Set(entry.removed.map((r) => r.op.id));
        plan = { ...plan, ops: plan.ops.filter((o) => !gone.has(o.id)) };
      }
      future = future.slice(0, -1);
      past = [...past, entry];
      return entry.kind === 'op'
        ? { kind: 'op', op: entry.op }
        : { kind: 'rows', plan, label: entry.label };
    },
    removeOps(ids, label) {
      if (readOnly) return false;
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const drop = new Set(ids);
      const removed: RemovedOp[] = [];
      plan.ops.forEach((op, index) => {
        if (drop.has(op.id)) removed.push({ index, op });
      });
      if (removed.length === 0) return false;
      plan = { ...plan, ops: plan.ops.filter((o) => !drop.has(o.id)) };
      past = [...past, { kind: 'rows', removed, label }];
      future = [];
      return true;
    },
    setTitle(title) {
      if (readOnly) return;
      const t = title?.trim().slice(0, TITLE_MAX_CHARS) || undefined;
      if (t === plan.title) return;
      const next: Plan = { ...plan };
      if (t === undefined) delete next.title;
      else next.title = t;
      plan = next;
    },
    onLoad(cb) {
      const entry = (p: Plan) => cb(p); // a fresh entry, so subscribing one cb twice is two
      loadListeners.add(entry);
      return () => void loadListeners.delete(entry);
    }
  };
}
