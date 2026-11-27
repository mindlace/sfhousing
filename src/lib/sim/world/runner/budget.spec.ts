import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MEMO_CAP, PREVIEW_MAX_LOTS, SLICE_MS, SLICE_PLAN_MS, createToken } from './budget';

describe('budget', () => {
  it('imports nothing, so the page can take PREVIEW_MAX_LOTS', () => {
    const src = readFileSync(new URL('./budget.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
  });

  it('a cancelled token clears its timers and drops later calls', () => {
    const live = new Map<number, () => void>();
    const cleared: number[] = [];
    let next = 0;
    const token = createToken({
      setTimeout: (fn) => {
        live.set(++next, fn);
        return next;
      },
      clearTimeout: (h) => {
        cleared.push(h as number);
        live.delete(h as number);
      }
    });
    let ran = 0;
    token.later(() => ran++, 10);
    token.later(() => ran++, 10);
    expect(live.size).toBe(2);
    expect(token.cancelled).toBe(false);
    token.cancel();
    expect(token.cancelled).toBe(true);
    expect(cleared.sort()).toEqual([1, 2]);
    expect(live.size).toBe(0);
    expect(token.later(() => ran++, 10)).toBeUndefined();
    expect(live.size).toBe(0);
    expect(ran).toBe(0);
  });

  it('runs a timer that fires before the cancel', () => {
    const fns: (() => void)[] = [];
    const token = createToken({ setTimeout: (fn) => fns.push(fn), clearTimeout: () => {} });
    let ran = 0;
    token.later(() => ran++, 1);
    fns[0]();
    expect(ran).toBe(1);
  });

  it('keeps the budgets', () => {
    expect([SLICE_MS, SLICE_PLAN_MS, MEMO_CAP, PREVIEW_MAX_LOTS]).toEqual([50, 45, 60_000, 300]);
  });
});
