import { describe, expect, it } from 'vitest';
import { dayFromUtc } from '$lib/fzp/time';
import { defaultGoal, GOAL_BASE } from '$lib/goal/goal';
import { LADDER_YEARS } from './catalogue/ladder-years';
import { finished, fitGame, goalAt, ladder, RUNGS, takeNext } from './ladder';
import type { SideGoal } from './side-goals';
import { NEW_GAME, type GameState, type MetRung } from './state';
import type { TreeNode } from './tree';

const Y = LADDER_YEARS[0];
const T = '2031-01-01T00:00:00.000Z';

function met(rung: number): MetRung {
  return { rung, reachedOn: 20000, datasetVersion: 'fixture-0', at: T };
}

function node(id: string, levels: number): TreeNode {
  return {
    id,
    branch: 'permitting',
    label: id,
    line: id,
    after: [],
    ring: 0,
    levels: Array.from({ length: levels }, () => ({
      price: {},
      grant: { tag: 'bands', max: 2 },
      step: ''
    })),
    source: null
  };
}

function goal(id: string): SideGoal {
  return { id, label: id, ring: 0, reward: {}, read: () => null };
}

describe('ladder', () => {
  const asOf = dayFromUtc(Y - 30, 6, 30);

  it('has RUNGS rungs, the first at the default deadline, none later than the one before', () => {
    const rungs = ladder(asOf);
    expect(rungs).toHaveLength(RUNGS);
    expect(rungs[0].deadline).toBe(defaultGoal(asOf).deadline);
    expect(rungs[1].deadline).toBe(dayFromUtc(Y, 12, 31));
    expect(rungs[1].label).toBe(`Dec ${Y}`);
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i].deadline).toBeLessThanOrEqual(rungs[i - 1].deadline);
    }
  });

  it('takes the rung before when the year is at or past the window end', () => {
    const late = dayFromUtc(Y - 41, 1, 1);
    expect(defaultGoal(late).deadline).toBeLessThan(dayFromUtc(Y, 12, 31));
    const rungs = ladder(late);
    expect(rungs[1].deadline).toBe(rungs[0].deadline);
  });

  it('takes the end of the dataset month when the year is already past', () => {
    const past = dayFromUtc(Y + 1, 3, 15);
    const rungs = ladder(past);
    expect(rungs[1].deadline).toBe(dayFromUtc(Y + 1, 3, 31));
    expect(rungs[1].label).toBe(`Mar ${Y + 1}`);
  });

  it('goalAt builds the goal on a rung', () => {
    expect(goalAt(asOf, 1)).toEqual({ ...GOAL_BASE, deadline: ladder(asOf)[1].deadline });
    expect(goalAt(asOf, 0, 5000).amount).toBe(5000);
    expect(goalAt(asOf, 0).amount).toBe(GOAL_BASE.amount);
  });

  it('goalAt throws for a rung that does not exist', () => {
    expect(() => goalAt(asOf, -1)).toThrow(RangeError);
    expect(() => goalAt(asOf, RUNGS)).toThrow(RangeError);
    expect(() => goalAt(asOf, 0.5)).toThrow(RangeError);
  });
});

describe('finished', () => {
  it('is true once the last rung is met', () => {
    expect(finished(NEW_GAME)).toBe(false);
    expect(finished({ ...NEW_GAME, met: [met(0)] })).toBe(RUNGS === 1);
    expect(finished({ ...NEW_GAME, met: [met(RUNGS - 1)] })).toBe(true);
  });
});

describe('takeNext', () => {
  it('moves to the next rung once this one is met', () => {
    const s: GameState = { ...NEW_GAME, met: [met(0)] };
    expect(takeNext(s).rung).toBe(RUNGS > 1 ? 1 : 0);
  });

  it('keeps the state when this rung is not met', () => {
    expect(takeNext(NEW_GAME)).toBe(NEW_GAME);
  });

  it('keeps the state on the last rung', () => {
    const s: GameState = { ...NEW_GAME, rung: RUNGS - 1, met: [met(RUNGS - 1)] };
    expect(takeNext(s)).toBe(s);
  });
});

describe('fitGame', () => {
  const nodes = [node('a', 2), node('b', 1), node('empty', 0)];
  const goals = [goal('g1')];
  const base: GameState = {
    ...NEW_GAME,
    phase: 'runs',
    firstWinAt: T,
    units: { home: 4 },
    runs: 7
  };

  it('drops what the build no longer has and keeps the rest', () => {
    const s: GameState = {
      ...base,
      bought: { a: 3, b: 1, gone: 1, empty: 1 },
      side: { g1: T, old: T },
      rung: RUNGS,
      met: [met(0), met(RUNGS), met(RUNGS + 1)]
    };
    const fit = fitGame(s, nodes, goals);
    expect(fit.bought).toEqual({ a: 2, b: 1 });
    expect(fit.side).toEqual({ g1: T });
    expect(fit.rung).toBe(RUNGS - 1);
    expect(fit.met).toEqual([met(0)]);
    expect(fit.units).toBe(s.units);
    expect(fit.runs).toBe(7);
    expect(fit.last).toBe(s.last);
    expect(fit.phase).toBe('runs');
    expect(fit.firstWinAt).toBe(T);
  });

  it.each([
    ['an unknown node', { bought: { gone: 1 } }],
    ['a level too high', { bought: { a: 3 } }],
    ['an unknown side id', { side: { old: T } }],
    ['a rung at RUNGS', { rung: RUNGS }],
    ['a met rung at RUNGS', { met: [met(RUNGS)] }]
  ] as [string, Partial<GameState>][])('returns a new object for %s', (_name, drift) => {
    const s: GameState = { ...base, ...drift };
    expect(fitGame(s, nodes, goals)).not.toBe(s);
  });

  it('returns the same object when nothing drifted', () => {
    const s: GameState = { ...base, bought: { a: 2, b: 1 }, side: { g1: T }, met: [met(0)] };
    expect(fitGame(s, nodes, goals)).toBe(s);
  });
});
