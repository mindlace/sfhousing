import { describe, expect, it } from 'vitest';
import { formatShortMonthYear } from '$lib/fzp/format';
import { dayFromUtc } from '$lib/fzp/time';
import { TODAY, defaultGoal, goalName, readGoal, type Goal } from '$lib/goal/goal';
import type { TimelineView } from '$lib/sim/world/score/types';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import { fromPolicyText } from '$lib/fzp/score-view';
import { homesBy } from './copy';
import {
  chartReading,
  currentLawHomes,
  headlineAt,
  headlineSpoken,
  headlineText,
  playheadAt,
  resultsAt,
  scoreOfView,
  todayAt,
  type HeadlineOpts
} from './results';
import { calendarMonths, chunk, cut, statics } from './test/fixtures';

/** A goal whose deadline falls in the fixture's two-year window. */
const TEST_GOAL: Goal = {
  ...defaultGoal(dayFromUtc(2029, 1, 1)),
  deadline: dayFromUtc(2031, 1, 31)
};
const OPTS: HeadlineOpts = { provisional: false, inForce: true };
const at = (index: number, atToday = false) => ({ index, atToday });

function whole(compare: 'plan' | 'preFzp' = 'plan'): TimelineView {
  const s = { ...statics({ finance: true }), compare };
  const v = viewOfLog(logFilled(logCompiled(EMPTY_LOG, s), chunk(0, 24, { pools: ['a', 'b'] })))!;
  return calendarMonths(v);
}

describe('headlineAt', () => {
  it('counts from today: the world at the playhead, without the baseline', () => {
    const v = whole();
    const h = headlineAt(v, at(10), OPTS, TEST_GOAL)!;
    expect(h.homes).toBe(v.rows[10].completedNet);
    expect(h.at).toBe(v.months[10]);
  });

  it('reads 0 and today at the dataset date', () => {
    const v = whole();
    const h = headlineAt(v, at(0, true), OPTS, TEST_GOAL)!;
    expect(h.homes).toBe(0);
    expect(h.at).toBeNull();
    expect(h.effect).toBe(0);
    expect(h.goal).toEqual(readGoal(TEST_GOAL, v, TODAY));
  });

  it('playheadAt reads the calendar month and today', () => {
    const v = whole();
    expect(playheadAt(v.months, v.months[0] + 3, v.months[0] + 3)).toEqual({
      index: 0,
      atToday: true
    });
    expect(playheadAt(v.months, v.months[0] + 3, v.months[5] + 9)).toEqual({
      index: 5,
      atToday: false
    });
  });

  it('the effect shows only with a policy in force, whatever view.compare says', () => {
    const v = whole();
    expect(headlineAt(v, at(10), OPTS, TEST_GOAL)!.effect).toBe(v.planEffect[10].completedNetNew);
    expect(headlineAt(v, at(10), { ...OPTS, inForce: false }, TEST_GOAL)!.effect).toBeNull();
    expect(headlineAt(whole('preFzp'), at(10), OPTS, TEST_GOAL)!.effect).toBe(
      v.planEffect[10].completedNetNew
    );
    expect(headlineAt(v, at(0, true), OPTS, TEST_GOAL)!.effect).toBe(0);
    expect(headlineAt(v, at(0, true), { ...OPTS, inForce: false }, TEST_GOAL)!.effect).toBeNull();
  });

  it("names the row's month", () => {
    const v = whole();
    for (const i of [0, 7, v.lastIndex]) {
      expect(headlineAt(v, at(i), OPTS, TEST_GOAL)!.at).toBe(v.months[i]);
    }
  });

  it('currentLawHomes is the plan world less the effect', () => {
    const v = whole();
    expect(currentLawHomes(v, 6)).toBe(v.rows[6].completedNet - v.planEffect[6].completedNetNew);
  });

  it('chartReading at today and at a month, with and without a policy in force', () => {
    const v = whole();
    expect(chartReading(v, 0, true)).toBe('0 homes by today, +0 from your policy');
    expect(chartReading(v, 0, false)).toBe('0 homes by today');
    expect(chartReading(v, 5, false)).toBe(homesBy(v.rows[4].completedNet, v.months[4]));
    expect(chartReading(v, 5, true)).toBe(
      `${homesBy(v.rows[4].completedNet, v.months[4])}, ${fromPolicyText(v.planEffect[4].completedNetNew)}`
    );
    // The header's line 1 for the same month.
    expect(chartReading(v, 11, false)).toBe(
      headlineText(headlineAt(v, at(10), { ...OPTS, inForce: false }, TEST_GOAL)!, TEST_GOAL).main
    );
  });

  it('chartReading source: "1,234 homes by Apr 2040, 800 from today\'s pipeline"', () => {
    const v = whole();
    const rows = v.rows.map((r, i) =>
      i === 4 ? { ...r, completedNet: 1234, completedNetPipeline: 800 } : r
    );
    const m = formatShortMonthYear(v.months[4]);
    for (const inForce of [true, false]) {
      expect(chartReading({ ...v, rows }, 5, inForce, 'source')).toBe(
        `1,234 homes by ${m}, 800 from today's pipeline`
      );
      expect(chartReading(v, 0, inForce, 'source')).toBe(
        "0 homes by today, 0 from today's pipeline"
      );
    }
    // Its first part is the header's line 1 for the month.
    expect(chartReading(v, 11, false, 'source')).toMatch(
      new RegExp(
        `^${headlineText(headlineAt(v, at(10), { ...OPTS, inForce: false }, TEST_GOAL)!, TEST_GOAL).main}, `
      )
    );
    expect(chartReading(cut(v, 4), 9, false, 'source')).toBe('');
    // homes is the default.
    expect(chartReading(v, 5, true, 'homes')).toBe(chartReading(v, 5, true));
  });

  it('chartReading effect: "+56 from your policy by Apr 2040"; "+0 from your policy by today" at 0', () => {
    const v = whole();
    const planEffect = v.planEffect.map((p, i) =>
      i === 4 ? { ...p, completedNetNew: 56 } : i === 5 ? { ...p, completedNetNew: -3 } : p
    );
    const w = { ...v, planEffect };
    expect(chartReading(w, 5, true, 'effect')).toBe(
      `+56 from your policy by ${formatShortMonthYear(v.months[4])}`
    );
    expect(chartReading(w, 6, true, 'effect')).toBe(
      `−3 from your policy by ${formatShortMonthYear(v.months[5])}`
    );
    expect(chartReading(w, 0, true, 'effect')).toBe('+0 from your policy by today');
    // The header's effect figure for the same month.
    const h = headlineText(headlineAt(w, at(4), OPTS, TEST_GOAL)!, TEST_GOAL);
    expect(chartReading(w, 5, true, 'effect')).toMatch(new RegExp(`^\\${h.effect} by `));
    // Without a policy in force: the homes reading.
    expect(chartReading(w, 5, false, 'effect')).toBe(chartReading(w, 5, false));
  });

  it('negative homes and effects stay negative', () => {
    const v = whole();
    const rows = v.rows.map((r, i) => (i === 3 ? { ...r, completedNet: -12 } : r));
    const planEffect = v.planEffect.map((p, i) => (i === 3 ? { ...p, completedNetNew: -56 } : p));
    const t = headlineText(
      headlineAt({ ...v, rows, planEffect }, at(3), OPTS, TEST_GOAL)!,
      TEST_GOAL
    );
    expect(t.main).toMatch(/^−12 homes by /);
    expect(t.effect).toBe('−56 from your policy');
  });

  it('is calculating only until the playhead month is filled', () => {
    const v = whole();
    expect(headlineAt(cut(v, 5), at(4), OPTS, TEST_GOAL)).not.toBeNull();
    expect(headlineAt(cut(v, 5), at(5), OPTS, TEST_GOAL)).not.toBeNull();
    expect(headlineAt(cut(v, 5), at(6), OPTS, TEST_GOAL)).toBeNull();
    expect(headlineAt(null, at(0, true), OPTS, TEST_GOAL)).toBeNull();
    expect(headlineAt(v, at(3), { ...OPTS, provisional: true }, TEST_GOAL)).toBeNull();
  });

  it('nothing is read at the end of the window', () => {
    const v = whole();
    const before = headlineAt(v, at(4), OPTS, TEST_GOAL);
    const rows = v.rows.map((r, i) => (i === v.lastIndex ? { ...r, completedNet: 999999 } : r));
    const planEffect = v.planEffect.map((p, i) =>
      i === v.lastIndex ? { ...p, completedNetNew: 888888 } : p
    );
    expect(headlineAt({ ...v, rows, planEffect }, at(4), OPTS, TEST_GOAL)).toEqual(before);
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
    const g: Goal = { ...TEST_GOAL, deadline: v.months[12] };
    for (const i of [0, 12, 23]) {
      reads = 0;
      expect(headlineAt(counted, at(i), OPTS, g)).not.toBeNull();
      expect(reads).toBeLessThanOrEqual(Math.min(i, 12) + 4);
    }
  });
});

describe('headlineText and headlineSpoken', () => {
  const g: Goal = { ...TEST_GOAL, deadline: dayFromUtc(2027, 11, 1) };

  it('say the same thing', () => {
    const h = headlineAt(whole(), at(6), OPTS, g)!;
    const t = headlineText(h, g);
    expect(headlineSpoken(t)).toBe([t.main, t.effect, t.goal].filter(Boolean).join(', '));
    expect(t.goalName).toBe(goalName(g));
  });

  it('leave the goal out when there is none', () => {
    const h = { ...headlineAt(whole(), at(6), OPTS, g)!, goal: null };
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
        const h = headlineAt(whole(compare), at(i, today), OPTS, TEST_GOAL)!;
        expect(JSON.stringify(headlineText(h, TEST_GOAL))).not.toMatch(/RHNA/);
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

describe('todayAt', () => {
  it('todayAt reads today as the header does: nothing added, approved or stopped yet', () => {
    const v = whole();
    const month0 = resultsAt(v, null, 0);
    expect(month0.pipeline).not.toBe(0);
    expect(month0.exitedUnits).not.toBe(0);
    const t = todayAt(month0);
    expect(t).toEqual({
      ...month0,
      pipeline: 0,
      fresh: 0,
      exitedUnits: 0,
      planCompleted: 0,
      planEntitled: 0
    });
    // The header at today agrees: 0 homes, +0 from your policy.
    const head = headlineAt(v, at(0, true), OPTS, TEST_GOAL)!;
    expect(t.pipeline + t.fresh).toBe(head.homes);
    expect(t.planCompleted).toBe(head.effect);
    // "Calculating" stays calculating.
    const pending = todayAt({ ...month0, planCompleted: null, planEntitled: null });
    expect(pending.planCompleted).toBeNull();
    expect(pending.planEntitled).toBeNull();
  });
});
