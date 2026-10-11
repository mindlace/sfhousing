import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { MAX_PLAN_BYTES, OPS_MAX, planByteSize, type Plan, type PlanOp } from '$lib/plan';
import { createEditor } from './editor.svelte';

const plan0 = (ops: PlanOp[] = []): Plan => ({ schema: 1, datasetVersion: 'fixture-0', ops });

const stamp = (id: string): PlanOp => ({
  kind: 'erase',
  radiusM: 5,
  path: [[-122.41, 37.76]],
  id
});

const paint = (id: string, stories = 6): PlanOp => ({
  kind: 'paint',
  stories,
  radiusM: 30,
  path: [
    [-122.41, 37.76],
    [-122.409, 37.761]
  ],
  id
});

/** A 2,000-point in-bbox stroke with full-width coordinates (the largest realistic op). */
function bigOp(n: number): PlanOp {
  const path: [number, number][] = [];
  for (let i = 0; i < 2000; i++) {
    path.push([(-122_412_345 - i * 7 - n) / 1e6, (37_761_234 + i * 11 + n) / 1e6]);
  }
  return { kind: 'paint', stories: 80, radiusM: 500, path, id: `big${n}` };
}

describe('editor state machine', () => {
  it('commits, undoes and redoes with matching flags and returned ops', () => {
    const ed = createEditor(plan0());
    expect(ed.canUndo).toBe(false);
    expect(ed.canRedo).toBe(false);
    expect(ed.readOnly).toBe(false);

    const a = paint('a');
    const b = stamp('b');
    expect(ed.commit(a)).toEqual({ ok: true });
    expect(ed.commit(b)).toEqual({ ok: true });
    expect(ed.plan.ops.map((o) => o.id)).toEqual(['a', 'b']);
    expect(ed.canUndo).toBe(true);
    expect(ed.canRedo).toBe(false);

    expect(ed.undo()).toEqual(b);
    expect(ed.plan.ops.map((o) => o.id)).toEqual(['a']);
    expect(ed.canRedo).toBe(true);
    expect(ed.undo()).toEqual(a);
    expect(ed.plan.ops).toEqual([]);
    expect(ed.canUndo).toBe(false);
    expect(ed.undo()).toBeNull();

    expect(ed.redo()).toEqual(a);
    expect(ed.redo()).toEqual(b);
    expect(ed.plan.ops.map((o) => o.id)).toEqual(['a', 'b']);
    expect(ed.canRedo).toBe(false);
    expect(ed.redo()).toBeNull();
  });

  it('replaces the plan object on every change and never mutates the old one', () => {
    const start = plan0();
    const ed = createEditor(start);
    ed.commit(stamp('a'));
    expect(start.ops).toEqual([]);
    const afterCommit = ed.plan;
    ed.undo();
    expect(afterCommit.ops.map((o) => o.id)).toEqual(['a']);
    expect(ed.plan).not.toBe(afterCommit);
  });

  it('clears redo on a new commit', () => {
    const ed = createEditor(plan0());
    ed.commit(stamp('a'));
    ed.commit(stamp('b'));
    ed.undo();
    expect(ed.canRedo).toBe(true);
    ed.commit(stamp('c'));
    expect(ed.canRedo).toBe(false);
    expect(ed.redo()).toBeNull();
    expect(ed.plan.ops.map((o) => o.id)).toEqual(['a', 'c']);
  });

  it('clears redo on load and replaces the plan', () => {
    const ed = createEditor(plan0());
    ed.commit(stamp('a'));
    ed.undo();
    expect(ed.canRedo).toBe(true);
    const loaded = plan0([stamp('x'), stamp('y')]);
    ed.load(loaded);
    expect(ed.canRedo).toBe(false);
    expect(ed.plan.ops.map((o) => o.id)).toEqual(['x', 'y']);
    // Undo depth includes ops from a loaded plan.
    expect(ed.undo()?.id).toBe('y');
  });
});

describe('editor refusals', () => {
  it('refuses too-many-ops at OPS_MAX and leaves the plan unchanged', () => {
    const ops = Array.from({ length: OPS_MAX }, (_, i) => stamp(`s${i}`));
    const ed = createEditor(plan0(ops));
    const before = ed.plan;
    expect(ed.commit(stamp('one-more'))).toEqual({ ok: false, reason: 'too-many-ops' });
    expect(ed.plan).toBe(before);
    expect(ed.plan.ops).toHaveLength(OPS_MAX);
  });

  it('refuses too-large past MAX_PLAN_BYTES with no partial op', () => {
    const ops: PlanOp[] = [];
    let n = 0;
    while (planByteSize(plan0([...ops, bigOp(n)])) <= MAX_PLAN_BYTES) ops.push(bigOp(n++));
    const next = bigOp(n);
    expect(ops.length).toBeGreaterThan(0);
    expect(planByteSize(plan0(ops))).toBeLessThanOrEqual(MAX_PLAN_BYTES);
    expect(planByteSize(plan0([...ops, next]))).toBeGreaterThan(MAX_PLAN_BYTES);

    const ed = createEditor(plan0(ops));
    const before = ed.plan;
    expect(ed.commit(next)).toEqual({ ok: false, reason: 'too-large' });
    expect(ed.plan).toBe(before);
    expect(ed.plan.ops).toHaveLength(ops.length);
    expect(ed.plan.ops.some((o) => o.id === next.id)).toBe(false);
  });

  it('refuses a redo that no longer fits and keeps it on the stack', () => {
    // Undo then redo restores an accepted plan, so a refusal needs a loaded plan already over a
    // limit (load does not validate).
    const ops = Array.from({ length: OPS_MAX + 2 }, (_, i) => stamp(`s${i}`));
    const ed = createEditor(plan0(ops));
    const top = ed.undo();
    expect(top?.id).toBe(`s${OPS_MAX + 1}`);
    const before = ed.plan;
    expect(ed.redo()).toBeNull();
    expect(ed.plan).toBe(before);
    expect(ed.canRedo).toBe(true);
    expect(ed.redo()).toBeNull();
    expect(ed.plan.ops).toHaveLength(OPS_MAX + 1);
  });

  it('refuses everything in read-only mode', () => {
    const ed = createEditor(plan0([stamp('a')]), { readOnly: true });
    expect(ed.readOnly).toBe(true);
    expect(ed.canUndo).toBe(false);
    expect(ed.canRedo).toBe(false);
    expect(ed.commit(stamp('b'))).toEqual({ ok: false, reason: 'read-only' });
    expect(ed.undo()).toBeNull();
    expect(ed.redo()).toBeNull();
    expect(ed.plan.ops.map((o) => o.id)).toEqual(['a']);
  });

  it('load toggles read-only', () => {
    const ed = createEditor(plan0([stamp('a')]));
    ed.load(plan0([stamp('a')]), { readOnly: true });
    expect(ed.readOnly).toBe(true);
    expect(ed.canUndo).toBe(false);
    ed.load(plan0([stamp('a')]));
    expect(ed.readOnly).toBe(false);
    expect(ed.canUndo).toBe(true);
  });
});

describe('editor rebase on commit', () => {
  it('rebases onto a differing datasetVersion', () => {
    const ed = createEditor(plan0([stamp('a')]));
    expect(ed.commit(stamp('b'), { datasetVersion: 'fixture-1' })).toEqual({ ok: true });
    expect(ed.plan.datasetVersion).toBe('fixture-1');
    expect(ed.plan.ops.map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('keeps the plan version when the given version is invalid, and still appends', () => {
    const ed = createEditor(plan0());
    expect(() => ed.commit(stamp('b'), { datasetVersion: 'bad' })).not.toThrow();
    expect(ed.plan.datasetVersion).toBe('fixture-0');
    expect(ed.plan.ops.map((o) => o.id)).toEqual(['b']);
  });
});

describe('editor reactivity', () => {
  it('drives $derived and $effect readers of plan, canUndo and canRedo', () => {
    const ed = createEditor(plan0());
    const len = $derived(ed.plan.ops.length);
    const readLen = () => len;
    const seen: number[] = [];
    const flags: string[] = [];
    const cleanup = $effect.root(() => {
      $effect(() => {
        seen.push(ed.plan.ops.length);
      });
      $effect(() => {
        flags.push(`${ed.canUndo}/${ed.canRedo}`);
      });
    });
    flushSync();
    expect(readLen()).toBe(0);
    ed.commit(stamp('a'));
    flushSync();
    expect(readLen()).toBe(1);
    ed.undo();
    flushSync();
    expect(readLen()).toBe(0);
    expect(seen).toEqual([0, 1, 0]);
    expect(flags).toEqual(['false/false', 'true/false', 'false/true']);
    cleanup();
  });
});
