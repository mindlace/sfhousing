import { describe, expect, it } from 'vitest';
import { parsePlan, serializePlan, type Plan, type PlanOp } from '$lib/plan';
import { MemoryStorage } from './fixtures/memory-storage';
import { localOpCount, remixToLocal } from './remix';
import { PLAN_KEY, corruptKey, writeRecord } from './storage';

const op = (id: string): PlanOp => ({ kind: 'erase', radiusM: 5, path: [[-122.41, 37.76]], id });
const plan = (n: number, over: Partial<Plan> = {}): Plan => ({
  schema: 1,
  datasetVersion: 'fixture-0',
  ops: Array.from({ length: n }, (_, i) => op(`o${i}`)),
  ...over
});
const store = (p: Plan, s = new MemoryStorage()) => {
  writeRecord(s, {
    v: 1,
    savedAt: '2026-10-11T00:00:00.000Z',
    plan: serializePlan(p),
    lastPublished: { id: 'abcdEFGH', hash: 'a'.repeat(64) }
  });
  return s;
};

describe('localOpCount', () => {
  it('empty storage → 0', () => {
    expect(localOpCount(new MemoryStorage())).toBe(0);
  });
  it('3-op plan → 3', () => {
    expect(localOpCount(store(plan(3)))).toBe(3);
  });
  it('corrupt record → 0', () => {
    const s = new MemoryStorage();
    s.setItem(PLAN_KEY, '{nope');
    expect(localOpCount(s)).toBe(0);
  });
  it('null storage → 0', () => {
    expect(localOpCount(null)).toBe(0);
  });
  it('getItem throwing → 0', () => {
    const s = new MemoryStorage();
    s.getItem = () => {
      throw new Error('denied');
    };
    expect(localOpCount(s)).toBe(0);
  });
});

describe('remixToLocal', () => {
  it('writes the plan rebased to current, title kept, no lastPublished', () => {
    const s = store(plan(5));
    const shared = plan(2, { title: 'Theirs' });
    const r = remixToLocal(shared, 'fixture-1', s);
    expect(r.stored).toBe(true);
    const rec = JSON.parse(s.getItem(PLAN_KEY) as string);
    expect(rec.v).toBe(1);
    expect(rec).not.toHaveProperty('lastPublished');
    expect(rec.plan).toBe(r.planText);
    const p = parsePlan(rec.plan);
    expect(p.ok && p.value).toEqual({ ...shared, datasetVersion: 'fixture-1' });
  });

  it('preserves an existing corrupt record under corruptKey', () => {
    const s = new MemoryStorage();
    s.setItem(PLAN_KEY, '{nope');
    const now = new Date('2026-10-11T05:00:00.000Z');
    const r = remixToLocal(plan(1), 'fixture-1', s, now);
    expect(r.stored).toBe(true);
    expect(s.getItem(corruptKey(now.toISOString()))).toBe('{nope');
  });

  it('preserves a future-schema record too', () => {
    const s = new MemoryStorage();
    const raw = JSON.stringify({
      v: 1,
      savedAt: 'x',
      plan: JSON.stringify({ schema: 2, datasetVersion: 'fixture-0', ops: [] })
    });
    s.setItem(PLAN_KEY, raw);
    const now = new Date('2026-10-11T05:00:00.000Z');
    remixToLocal(plan(1), 'fixture-1', s, now);
    expect(s.getItem(corruptKey(now.toISOString()))).toBe(raw);
  });

  it('returns stored:false (and the plan text) when writes fail', () => {
    const s = store(plan(1));
    s.failWrites = true;
    const r = remixToLocal(plan(2, { title: 'T' }), 'fixture-1', s);
    expect(r.stored).toBe(false);
    expect(r.planText).toBe(serializePlan(plan(2, { title: 'T', datasetVersion: 'fixture-1' })));
  });

  it('does not overwrite a corrupt record it could not preserve', () => {
    const s = new MemoryStorage();
    s.setItem(PLAN_KEY, '{nope');
    s.failWrites = true;
    const r = remixToLocal(plan(1), 'fixture-1', s);
    expect(r.stored).toBe(false);
    expect(s.getItem(PLAN_KEY)).toBe('{nope');
  });

  it('null storage → stored:false', () => {
    expect(remixToLocal(plan(1), 'fixture-1', null).stored).toBe(false);
  });

  it('throws TypeError for an invalid current version', () => {
    expect(() => remixToLocal(plan(1), 'bogus', new MemoryStorage())).toThrow(TypeError);
  });
});
