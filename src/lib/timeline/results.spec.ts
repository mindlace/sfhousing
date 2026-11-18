import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { GOAL, TODAY, goalName, readGoal, type Goal } from '$lib/goal/goal';
import type { TimelineView } from '$lib/sim/world/score/types';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import { headlineAt, headlineSpoken, headlineText, resultsAt, scoreOfView } from './results';
import { calendarMonths, chunk, cut, statics } from './test/fixtures';

function whole(compare: 'plan' | 'preFzp' = 'plan'): TimelineView {
  const s = { ...statics({ finance: true }), compare };
  const v = viewOfLog(logFilled(logCompiled(EMPTY_LOG, s), chunk(0, 24, { pools: ['a', 'b'] })))!;
  return calendarMonths(v);
}

describe('headlineAt', () => {
  it('counts from today: the world at the playhead, without the baseline', () => {
    const v = whole();
    const h = headlineAt(v, 10, false, false)!;
    expect(h.homes).toBe(v.rows[10].completedNet);
    expect(h.at).toBe(v.months[10]);
  });

  it('reads 0 and today at the dataset date', () => {
    const v = whole();
    const h = headlineAt(v, 0, true, false)!;
    expect(h.homes).toBe(0);
    expect(h.at).toBeNull();
    expect(h.effect).toBe(0);
    expect(h.goal).toEqual(readGoal(GOAL, v, TODAY));
  });

  it('the effect shows only against the plan', () => {
    const v = whole();
    expect(headlineAt(v, 10, false, false)!.effect).toBe(v.planEffect[10].completedNetNew);
    expect(headlineAt(whole('preFzp'), 10, false, false)!.effect).toBeNull();
  });

  it('negative homes and effects stay negative', () => {
    const v = whole();
    const rows = v.rows.map((r, i) => (i === 3 ? { ...r, completedNet: -12 } : r));
    const planEffect = v.planEffect.map((p, i) => (i === 3 ? { ...p, completedNetNew: -56 } : p));
    const t = headlineText(headlineAt({ ...v, rows, planEffect }, 3, false, false)!);
    expect(t.main).toMatch(/^−12 homes by /);
    expect(t.effect).toBe('−56 from your policy');
  });

  it('is calculating only until the playhead month is filled', () => {
    const v = whole();
    expect(headlineAt(cut(v, 5), 4, false, false)).not.toBeNull();
    expect(headlineAt(cut(v, 5), 5, false, false)).not.toBeNull();
    expect(headlineAt(cut(v, 5), 6, false, false)).toBeNull();
    expect(headlineAt(null, 0, true, false)).toBeNull();
    expect(headlineAt(v, 3, false, true)).toBeNull();
  });

  it('nothing is read at the end of the window', () => {
    const v = whole();
    const before = headlineAt(v, 4, false, false);
    const rows = v.rows.map((r, i) => (i === v.lastIndex ? { ...r, completedNet: 999999 } : r));
    const planEffect = v.planEffect.map((p, i) =>
      i === v.lastIndex ? { ...p, completedNetNew: 888888 } : p
    );
    expect(headlineAt({ ...v, rows, planEffect }, 4, false, false)).toEqual(before);
  });

  it('reads a bounded number of rows, whatever the window length', () => {
    const v = whole();
    let reads = 0;
    const count = <T extends object>(a: T[]): T[] =>
      new Proxy(a, {
        get(t, k, r) {
          if (typeof k === 'string' && /^\d+$/.test(k)) reads++;
          return Reflect.get(t, k, r);
        }
      });
    const counted = { ...v, rows: count(v.rows), planEffect: count(v.planEffect) };
    const g: Goal = { ...GOAL, deadline: v.months[12] };
    for (const i of [0, 12, 23]) {
      reads = 0;
      expect(headlineAt(counted, i, false, false, g)).not.toBeNull();
      expect(reads).toBeLessThanOrEqual(Math.min(i, 12) + 4);
    }
  });
});

describe('headlineText and headlineSpoken', () => {
  const g: Goal = { ...GOAL, deadline: dayFromUtc(2027, 11, 1) };

  it('say the same thing', () => {
    const h = headlineAt(whole(), 6, false, false, g)!;
    const t = headlineText(h, g);
    expect(headlineSpoken(t)).toBe([t.main, t.effect, t.goal].filter(Boolean).join(', '));
    expect(t.goalName).toBe(goalName(g));
  });

  it('leave the goal out when there is none', () => {
    const h = { ...headlineAt(whole(), 6, false, false, g)!, goal: null };
    const t = headlineText(h, g);
    expect(t.goal).toBeNull();
    expect(t.goalName).toBeNull();
    expect(headlineSpoken(t)).toBe([t.main, t.effect].filter(Boolean).join(', '));
  });

  it('no header string says RHNA', () => {
    for (const compare of ['plan', 'preFzp'] as const) {
      for (const [i, today] of [
        [0, true],
        [3, false],
        [12, false],
        [23, false]
      ] as const) {
        const h = headlineAt(whole(compare), i, today, false)!;
        expect(JSON.stringify(headlineText(h))).not.toMatch(/RHNA/);
      }
    }
  });
});

describe('scoreOfView and resultsAt', () => {
  it('resultsAt reads the world', () => {
    const v = whole();
    const r = resultsAt(v, null, 12);
    expect(r.total).toBe(v.baseline.completedNet + v.rows[12].completedNet);
    expect('band' in r).toBe(false);
    expect('planBand' in r).toBe(false);
    expect(r.planCompleted).toBe(v.planEffect[12].completedNetNew);
  });

  it('scoreOfView passes no band', () => {
    const v = cut(whole(), 10);
    const s = scoreOfView(v, null);
    expect(s.band).toEqual([]);
    expect(s.planEffectBand).toEqual([]);
    expect(s.shown).toEqual(v.rows.slice(0, 11));
  });

  it('keeps only the filled months, money from the view and no tiers without a baseline', () => {
    const v = cut(whole(), 10);
    const s = scoreOfView(v, null);
    expect(s.shown).toHaveLength(11);
    expect(s.months).toHaveLength(24);
    expect(s.money).toBe(v.money ?? undefined);
    expect(s.tiers).toBeUndefined();
  });

  it('an empty view has no money or tiers', () => {
    const empty = viewOfLog(logCompiled(EMPTY_LOG, statics()))!;
    const s = scoreOfView(empty, null);
    expect(s.money).toBeUndefined();
    expect(s.shown).toEqual([]);
  });
});
