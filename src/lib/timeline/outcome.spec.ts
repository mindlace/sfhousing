// The goal outcome: what the furthest date reached says of the goal (pure).
import { describe, expect, it } from 'vitest';
import { STATE_TARGET, readGoal, type Goal } from '$lib/goal/goal';
import type { TimelineView } from '$lib/sim/world/score/types';
import { viewOf } from '$lib/sim/world/score/view';
import { goalOutcome, awaitsView, outcomeKey, outcomeText } from './outcome';
import { calendarMonths, chunk, cut, statics } from './test/fixtures';

// The measure at month i is 1000 + 3i + 1 (the baseline 1000 plus the row), 1000 at today.
const view = calendarMonths(viewOf([chunk(0, 24)], statics()));
const M = view.months;
const ASOF = M[0];
const goal = (amount: number, k: number): Goal => ({ ...STATE_TARGET, amount, deadline: M[k] });
/** The view with its rows read through a proxy that records the month indexes read. */
function counted(v: TimelineView): { view: TimelineView; reads: number[] } {
  const reads: number[] = [];
  const rows = new Proxy(v.rows, {
    get(target, key, recv) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads.push(Number(key));
      return Reflect.get(target, key, recv);
    }
  });
  return { view: { ...v, rows }, reads };
}

describe('goalOutcome', () => {
  it('nothing before the deadline is reached and the goal unmet', () => {
    const g = goal(1100, 12);
    expect(goalOutcome(g, view, ASOF, ASOF)).toBeNull();
    expect(goalOutcome(g, view, M[6], ASOF)).toBeNull();
    // On the deadline itself it is not passed.
    expect(goalOutcome(g, view, M[12], ASOF)).toBeNull();
  });

  it('reached: the month the amount is met by the deadline, once the furthest date gets there', () => {
    const g = goal(1025, 12);
    expect(goalOutcome(g, view, M[7], ASOF)).toBeNull();
    expect(goalOutcome(g, view, M[8], ASOF)).toEqual({ kind: 'reached', on: M[8] });
    expect(goalOutcome(g, view, M[10] + 5, ASOF)).toEqual({ kind: 'reached', on: M[8] });
    expect(goalOutcome(g, view, M[23], ASOF)).toEqual({ kind: 'reached', on: M[8] });
    // Met at today: reached at the dataset date.
    expect(goalOutcome(goal(1000, 12), view, ASOF, ASOF)).toEqual({ kind: 'reached', on: M[0] });
  });

  it('missed: once the furthest date passes the deadline, by the amount still short', () => {
    const g = goal(1100, 12);
    expect(goalOutcome(g, view, M[12] + 1, ASOF)).toEqual({ kind: 'missed', short: 63 });
    expect(goalOutcome(g, view, M[23], ASOF)).toEqual({ kind: 'missed', short: 63 });
    // Met after the deadline is still a miss.
    expect(goalOutcome(goal(1050, 12), view, M[23], ASOF)).toEqual({ kind: 'missed', short: 13 });
  });

  it('nothing for a deadline outside the window', () => {
    const early: Goal = { ...STATE_TARGET, amount: 1100, deadline: M[0] - 40 };
    expect(goalOutcome(early, view, M[23], ASOF)).toBeNull();
    const late: Goal = { ...STATE_TARGET, amount: 1100, deadline: M[23] + 400 };
    expect(goalOutcome(late, view, M[23], ASOF)).toBeNull();
    expect(goalOutcome(goal(1100, 12), null, M[23], ASOF)).toBeNull();
  });

  it('nothing when the view does not cover the months read', () => {
    const part = cut(view, 5);
    // The month reached is past what is filled.
    expect(goalOutcome(goal(1010, 12), part, M[8], ASOF)).toBeNull();
    // Passed the deadline, which is not filled.
    expect(goalOutcome(goal(1100, 12), part, M[13], ASOF)).toBeNull();
    // Inside what is filled it reads.
    expect(goalOutcome(goal(1010, 12), part, M[5], ASOF)).toEqual({ kind: 'reached', on: M[3] });
  });

  it('reads no row past the deadline month, and a bounded number of times', () => {
    for (const reached of [ASOF, M[6], M[13], M[23]]) {
      const c = counted(view);
      goalOutcome(goal(1100, 12), c.view, reached, ASOF);
      expect(c.reads.length).toBeLessThanOrEqual(12 + 3);
      expect(Math.max(-1, ...c.reads)).toBeLessThanOrEqual(12);
    }
  });

  it('agrees with readGoal on the month the goal is reached', () => {
    const cases: [Goal, number][] = [
      [goal(1025, 12), 8],
      [goal(1000, 12), 0],
      [{ ...goal(1025, 12), countsFrom: M[0] - 200 }, 20],
      [goal(1025, 5), 20]
    ];
    for (const [g, k] of cases) {
      const o = goalOutcome(g, view, M[k], ASOF);
      const r = readGoal(g, view, Math.min(k, 12))!;
      expect(o?.kind === 'reached' ? o.on : null).toBe(r.reachedOn);
    }
    // At today.
    const today = goalOutcome(goal(1000, 12), view, ASOF, ASOF);
    expect(today).toEqual({ kind: 'reached', on: readGoal(goal(1000, 12), view, -1)!.reachedOn });
  });

  it('awaitsView only when a step exists but the months read are not filled', () => {
    const part = cut(view, 5);
    expect(awaitsView(goal(1100, 12), part, M[13], ASOF)).toBe(true);
    expect(awaitsView(goal(1100, 12), part, M[5], ASOF)).toBe(false);
    expect(awaitsView(goal(1100, 12), view, M[23], ASOF)).toBe(false);
    expect(awaitsView({ ...STATE_TARGET, deadline: M[0] - 40 }, part, M[23], ASOF)).toBe(false);
  });

  it('outcomeText and outcomeKey', () => {
    const g: Goal = { ...STATE_TARGET, amount: 1025, deadline: M[12] };
    const reached = { kind: 'reached', on: M[8] } as const;
    expect(outcomeText(reached, g, true)).toBe(
      'Goal reached in Jul 2027, by the Nov 2027 deadline.'
    );
    const missed = { kind: 'missed', short: 3313 } as const;
    expect(outcomeText(missed, g, true)).toBe(
      'Goal missed by 3,313 homes. Change the policy and play again.'
    );
    expect(outcomeText(missed, g, false)).toBe(
      'Goal missed by 3,313 homes. Add a policy and play again.'
    );
    expect(outcomeKey(reached)).toBe(`reached:${M[8]}`);
    expect(outcomeKey(missed)).toBe('missed:3313');
  });
});
