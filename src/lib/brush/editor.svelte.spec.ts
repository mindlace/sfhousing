import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PLAN_BYTES,
  OPS_MAX,
  TITLE_MAX_CHARS,
  planByteSize,
  type Plan,
  type PlanOp
} from '$lib/plan';
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

describe('editor onLoad', () => {
  it('notifies after load updates state, and stops after unsubscribe', () => {
    const ed = createEditor(plan0([stamp('a')]));
    ed.undo();
    const seen: { plan: Plan; readOnly: boolean; canRedo: boolean; arg: Plan }[] = [];
    const off = ed.onLoad((p) =>
      seen.push({ plan: ed.plan, readOnly: ed.readOnly, canRedo: ed.canRedo, arg: p })
    );
    const p2 = plan0([paint('b')]);
    ed.load(p2, { readOnly: true });
    expect(seen).toEqual([{ plan: p2, readOnly: true, canRedo: false, arg: p2 }]);
    expect(seen[0].arg).toBe(p2);

    off();
    ed.load(plan0());
    expect(seen).toHaveLength(1);
    off(); // idempotent
  });

  it('isolates a throwing listener: the others still run and load does not throw', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ed = createEditor(plan0());
    const boom = new Error('boom');
    const seen: string[] = [];
    ed.onLoad(() => {
      throw boom;
    });
    ed.onLoad(() => void seen.push('second'));
    const p2 = plan0([stamp('a')]);
    expect(() => ed.load(p2)).not.toThrow();
    expect(seen).toEqual(['second']);
    expect(ed.plan).toBe(p2);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]).toContain(boom);
    err.mockRestore();
  });

  it('commit, undo and redo do not notify', () => {
    const ed = createEditor(plan0());
    let n = 0;
    ed.onLoad(() => n++);
    ed.commit(stamp('a'));
    ed.undo();
    ed.redo();
    expect(n).toBe(0);
  });
});

describe('setTitle', () => {
  it('replaces plan with the normalised title, keeping ops', () => {
    const e = createEditor(plan0());
    e.commit(stamp('a'));
    const before = e.plan;
    e.setTitle('  Mission infill  ');
    expect(e.plan).not.toBe(before);
    expect(e.plan.title).toBe('Mission infill');
    expect(e.plan.ops).toEqual(before.ops);
  });
  it('empty or whitespace removes the title key', () => {
    const e = createEditor({ ...plan0(), title: 'x' });
    e.setTitle('   ');
    expect('title' in e.plan).toBe(false);
    e.setTitle('y');
    e.setTitle(undefined);
    expect('title' in e.plan).toBe(false);
  });
  it('clips to TITLE_MAX_CHARS', () => {
    const e = createEditor(plan0());
    e.setTitle('a'.repeat(TITLE_MAX_CHARS + 5));
    expect(e.plan.title).toHaveLength(TITLE_MAX_CHARS);
  });
  it('preserves undo and redo', () => {
    const e = createEditor(plan0());
    e.commit(stamp('a'));
    e.commit(stamp('b'));
    e.undo();
    e.setTitle('t');
    expect(e.canRedo).toBe(true);
    expect(e.redo()?.id).toBe('b');
    expect(e.plan.title).toBe('t');
    expect(e.undo()?.id).toBe('b');
  });
  it('is a no-op when read-only', () => {
    const e = createEditor(plan0(), { readOnly: true });
    const before = e.plan;
    e.setTitle('t');
    expect(e.plan).toBe(before);
  });
  it('does not fire onLoad', () => {
    const e = createEditor(plan0());
    const cb = vi.fn();
    e.onLoad(cb);
    e.setTitle('t');
    expect(cb).not.toHaveBeenCalled();
  });
  it('same title is a no-op (no new object)', () => {
    const e = createEditor({ ...plan0(), title: 't' });
    const before = e.plan;
    e.setTitle(' t ');
    expect(e.plan).toBe(before);
  });
});
