import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializePlan, type Plan, type PlanOp } from '$lib/plan';
import { MemoryStorage } from './fixtures/memory-storage';
import { Autosave } from './autosave.svelte';
import { PLAN_KEY, writeRecord } from './storage';

const op = (id: string): PlanOp => ({ kind: 'erase', radiusM: 5, path: [[-122.41, 37.76]], id });
const plan = (n: number, over: Partial<Plan> = {}): Plan => ({
  schema: 1,
  datasetVersion: 'fixture-1',
  ops: Array.from({ length: n }, (_, i) => op(`o${i}`)),
  ...over
});
const NOW = new Date('2026-10-11T12:00:00.000Z');

function setup(s = new MemoryStorage(), currentVersion = 'fixture-1') {
  const setItem = vi.spyOn(s, 'setItem');
  const a = new Autosave({ currentVersion, storage: () => s, now: () => NOW });
  const planWrites = () => setItem.mock.calls.filter(([k]) => k === PLAN_KEY);
  return { s, a, setItem, planWrites };
}
const seed = (p: Plan, extra: Record<string, unknown> = {}) => {
  const s = new MemoryStorage();
  writeRecord(s, { v: 1, savedAt: 'x', plan: serializePlan(p), ...extra });
  return s;
};
const stored = (s: MemoryStorage) => JSON.parse(s.getItem(PLAN_KEY) as string);
const corruptKeys = (s: MemoryStorage) =>
  s.keys().filter((k) => k.startsWith('sfhousing:plan:corrupt:'));

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Autosave debounce', () => {
  it('3 schedules within 500 ms → exactly 1 write of the last plan', () => {
    const { s, a, planWrites } = setup();
    a.restore();
    a.schedule(plan(1));
    expect(a.status).toBe('saving');
    vi.advanceTimersByTime(200);
    a.schedule(plan(2));
    vi.advanceTimersByTime(200);
    a.schedule(plan(3));
    vi.advanceTimersByTime(499);
    expect(planWrites()).toHaveLength(0);
    expect(a.status).toBe('saving');
    vi.advanceTimersByTime(1);
    expect(planWrites()).toHaveLength(1);
    expect(stored(s).plan).toBe(serializePlan(plan(3)));
    expect(stored(s).savedAt).toBe(NOW.toISOString());
    expect(a.status).toBe('saved');
  });

  it('the restored plan reaching schedule() causes no write and no saving flicker', () => {
    const { a, planWrites } = setup(seed(plan(2)));
    const r = a.restore();
    a.schedule(r.plan);
    expect(a.status).toBe('saved');
    vi.advanceTimersByTime(1000);
    expect(planWrites()).toHaveLength(0);
  });

  it('a change undone before the timer fires cancels the pending write', () => {
    const { a, planWrites } = setup(seed(plan(2)));
    const r = a.restore();
    a.schedule(plan(3));
    a.schedule(r.plan);
    expect(a.status).toBe('saved');
    vi.advanceTimersByTime(1000);
    expect(planWrites()).toHaveLength(0);
  });
});

describe('Autosave flush listeners', () => {
  it('visibilitychange → hidden flushes immediately', () => {
    const { s, a, planWrites } = setup();
    a.restore();
    const detach = a.attach();
    a.schedule(plan(1));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(planWrites()).toHaveLength(1);
    expect(stored(s).plan).toBe(serializePlan(plan(1)));
    vi.advanceTimersByTime(1000);
    expect(planWrites()).toHaveLength(1);
    detach();
  });

  it('visibilitychange → visible does not flush', () => {
    const { a, planWrites } = setup();
    a.restore();
    const detach = a.attach();
    a.schedule(plan(1));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(planWrites()).toHaveLength(0);
    detach();
  });

  it('pagehide flushes immediately', () => {
    const { a, planWrites } = setup();
    a.restore();
    const detach = a.attach();
    a.schedule(plan(1));
    window.dispatchEvent(new Event('pagehide'));
    expect(planWrites()).toHaveLength(1);
    detach();
  });

  it('the remover detaches listeners and leaves no timer running', () => {
    const { a, planWrites } = setup();
    a.restore();
    const detach = a.attach();
    detach();
    a.schedule(plan(1));
    window.dispatchEvent(new Event('pagehide'));
    expect(planWrites()).toHaveLength(0);
    a.flush();
    expect(planWrites()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the remover flushes a pending plan so an in-app navigation loses nothing', () => {
    const { a, planWrites } = setup();
    a.restore();
    const detach = a.attach();
    a.schedule(plan(1));
    detach();
    expect(planWrites()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Autosave restore', () => {
  it('missing → empty plan on current, no notice', () => {
    const { a } = setup();
    expect(a.restore()).toEqual({
      plan: { schema: 1, datasetVersion: 'fixture-1', ops: [] },
      notice: null
    });
    expect(a.status).toBe('saved');
  });

  it('corrupt record → preserved under a corrupt: key + notice corrupt', () => {
    const s = new MemoryStorage();
    s.setItem(PLAN_KEY, '{nope');
    const { a } = setup(s);
    const r = a.restore();
    expect(r.notice).toEqual({ kind: 'corrupt' });
    expect(r.plan.ops).toEqual([]);
    expect(corruptKeys(s).map((k) => s.getItem(k))).toEqual(['{nope']);
    expect(a.status).toBe('saved');
    // a second restore does not re-preserve or re-notify
    expect(a.restore().notice).toBeNull();
    expect(corruptKeys(s)).toHaveLength(1);
  });

  it('v: 2 record → corrupt', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify({ v: 2, savedAt: 'x', plan: serializePlan(plan(1)) });
    s.setItem(PLAN_KEY, raw);
    const { a } = setup(s);
    expect(a.restore().notice).toEqual({ kind: 'corrupt' });
    expect(corruptKeys(s).map((k) => s.getItem(k))).toEqual([raw]);
  });

  it('future-schema plan → preserved + notice future', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify({
      v: 1,
      savedAt: 'x',
      plan: JSON.stringify({ schema: 2, datasetVersion: 'fixture-1', ops: [] })
    });
    s.setItem(PLAN_KEY, raw);
    const { a } = setup(s);
    const r = a.restore();
    expect(r.notice).toEqual({ kind: 'future' });
    expect(r.plan.ops).toEqual([]);
    expect(corruptKeys(s).map((k) => s.getItem(k))).toEqual([raw]);
  });

  it('Review Focus 3: corrupt record + all writes throwing → empty, corrupt, off, no throw', () => {
    const s = new MemoryStorage();
    s.setItem(PLAN_KEY, '{nope');
    s.failWrites = true;
    const { a } = setup(s);
    let r: ReturnType<Autosave['restore']> | undefined;
    expect(() => (r = a.restore())).not.toThrow();
    expect(r?.plan).toEqual({ schema: 1, datasetVersion: 'fixture-1', ops: [] });
    expect(r?.notice).toEqual({ kind: 'corrupt' });
    expect(a.status).toBe('off');
    // the unpreserved corrupt record is never overwritten
    expect(s.getItem(PLAN_KEY)).toBe('{nope');
    a.schedule(plan(1));
    vi.advanceTimersByTime(500);
    expect(s.getItem(PLAN_KEY)).toBe('{nope');
    expect(a.status).toBe('off');
    // once writes work, it is preserved first, then the plan is written
    s.failWrites = false;
    a.schedule(plan(2));
    vi.advanceTimersByTime(500);
    expect(corruptKeys(s).map((k) => s.getItem(k))).toEqual(['{nope']);
    expect(stored(s).plan).toBe(serializePlan(plan(2)));
    expect(a.status).toBe('saved');
  });

  it('setItem QuotaExceededError → off; next schedule with writes succeeding → saved', () => {
    const { s, a } = setup();
    a.restore();
    s.failWrites = true;
    a.schedule(plan(1));
    vi.advanceTimersByTime(500);
    expect(a.status).toBe('off');
    s.failWrites = false;
    a.schedule(plan(2));
    expect(a.status).toBe('off');
    vi.advanceTimersByTime(500);
    expect(a.status).toBe('saved');
    expect(stored(s).plan).toBe(serializePlan(plan(2)));
  });

  it('older datasetVersion → rebased, written back before any timer, notice once', () => {
    const s = seed(plan(2, { datasetVersion: 'fixture-0', title: 'Kept' }), {
      lastPublished: { id: 'abcdEFGH', hash: 'b'.repeat(64) }
    });
    const { a, planWrites } = setup(s);
    const r = a.restore();
    expect(r.plan.datasetVersion).toBe('fixture-1');
    expect(r.plan.title).toBe('Kept');
    expect(r.notice).toEqual({ kind: 'rebased', from: 'fixture-0', to: 'fixture-1' });
    expect(planWrites()).toHaveLength(1);
    expect(stored(s).plan).toBe(serializePlan(r.plan));
    expect(stored(s).lastPublished).toEqual({ id: 'abcdEFGH', hash: 'b'.repeat(64) });
    expect(a.lastPublished).toEqual({ id: 'abcdEFGH', hash: 'b'.repeat(64) });
    expect(a.restore().notice).toBeNull();
  });

  it('same version → notice null, lastPublished loaded', () => {
    const lp = { id: 'abcdEFGH', hash: 'c'.repeat(64) };
    const { a, planWrites } = setup(seed(plan(2), { lastPublished: lp }));
    const r = a.restore();
    expect(r.notice).toBeNull();
    expect(r.plan).toEqual(plan(2));
    expect(a.lastPublished).toEqual(lp);
    expect(planWrites()).toHaveLength(0);
  });

  it('restore(handoff) uses the handoff plan (rebased) over the stored one', () => {
    const s = seed(plan(4), { lastPublished: { id: 'abcdEFGH', hash: 'd'.repeat(64) } });
    const { a } = setup(s);
    const handoff = serializePlan(plan(1, { datasetVersion: 'fixture-0', title: 'Remixed' }));
    const r = a.restore(handoff);
    expect(r.plan).toEqual(plan(1, { title: 'Remixed' }));
    expect(r.notice).toBeNull();
    expect(a.lastPublished).toBeUndefined();
    expect(stored(s).plan).toBe(serializePlan(r.plan));
    expect(stored(s)).not.toHaveProperty('lastPublished');
  });

  it('restore(handoff) with storage unavailable still returns the handoff plan, status off', () => {
    const a = new Autosave({ currentVersion: 'fixture-1', storage: () => null });
    const r = a.restore(serializePlan(plan(2)));
    expect(r.plan).toEqual(plan(2));
    expect(a.status).toBe('off');
  });

  it('localStorage getter throwing → off, empty plan', () => {
    const a = new Autosave({
      currentVersion: 'fixture-1',
      storage: () => {
        throw new Error('denied');
      }
    });
    const r = a.restore();
    expect(r).toEqual({ plan: { schema: 1, datasetVersion: 'fixture-1', ops: [] }, notice: null });
    expect(a.status).toBe('off');
  });

  it('getItem throwing → off, empty plan', () => {
    const s = new MemoryStorage();
    s.getItem = () => {
      throw new Error('denied');
    };
    const { a } = setup(s);
    expect(a.restore().plan.ops).toEqual([]);
    expect(a.status).toBe('off');
  });

  it('invalid currentVersion → TypeError with context', () => {
    const { a } = setup(new MemoryStorage(), 'bogus');
    expect(() => a.restore()).toThrow(/Autosave.*bogus/);
  });
});

describe('Autosave.setLastPublished', () => {
  it('stores lastPublished and writes immediately, cancelling the pending write', () => {
    const { s, a, planWrites } = setup();
    a.restore();
    a.schedule(plan(1));
    const lp = { id: 'abcdEFGH', hash: 'e'.repeat(64) };
    a.setLastPublished(lp, plan(2));
    expect(a.lastPublished).toEqual(lp);
    expect(planWrites()).toHaveLength(1);
    expect(stored(s)).toMatchObject({ plan: serializePlan(plan(2)), lastPublished: lp });
    expect(a.status).toBe('saved');
    vi.advanceTimersByTime(1000);
    expect(planWrites()).toHaveLength(1);
    // later autosaves keep lastPublished in the record
    a.schedule(plan(3));
    vi.advanceTimersByTime(500);
    expect(stored(s).lastPublished).toEqual(lp);
  });
});
