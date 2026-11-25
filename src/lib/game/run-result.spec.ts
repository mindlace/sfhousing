import { describe, expect, it, vi } from 'vitest';
import { GOAL_BASE, readGoal, type Goal } from '$lib/goal/goal';
import type { TimelineView } from '$lib/sim/world/score/types';
import { dayFromUtc } from '$lib/fzp/time';
import {
  deadlineIndex,
  readRun,
  resultOf,
  settle,
  type RunReading,
  type RunResult
} from './run-result';
import type { RunTake } from './run-result';
import { NEW_GAME, type GameState, type MetRung } from './state';

const TUNING = vi.hoisted(() => ({
  'policy-homes-1': { target: 1000, reward: { home: 500 } },
  'collect-share-1': { target: 50, reward: { home: 300 } },
  'approved-homes': { target: 2000, reward: { home: 400 } },
  'collect-run': { target: 10000, reward: { home: 500 } },
  'policy-homes-2': { target: 10000, reward: { home: 1000 } },
  'new-money': { target: 100, reward: { home: 800 } },
  'funded-homes': { target: 15000, reward: { home: 800 } },
  'collect-share-2': { target: 90, reward: { home: 600 } },
  'building-homes': { target: 10000, reward: { home: 800 } },
  'affordable-homes': { target: 20000, reward: { home: 1200 } },
  'policy-homes-3': { target: 25000, reward: { home: 1500 } }
}));

vi.mock('./catalogue/tuning', () => ({ RUNG_LUMP: { home: 2000 }, SIDE_TUNING: TUNING }));

const STAGES = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };

interface Opts {
  filledThrough?: number;
  waitingMoney?: (number | null)[] | null;
  planEffect?: number;
}

function view(o: Opts = {}): TimelineView {
  const v: Record<string, unknown> = {
    months: Array.from({ length: 12 }, (_, i) => dayFromUtc(2026, 1 + i, 1)),
    lastIndex: 11,
    filledThrough: o.filledThrough ?? 11,
    baseline: { completedNet: 50000 },
    compare: 'current',
    rows: Array.from({ length: 12 }, (_, i) => ({
      completedNet: 1000 * i,
      inProgress: { ...STAGES }
    })),
    planEffect: Array.from({ length: 12 }, () => ({
      completedNetNew: o.planEffect ?? 0,
      entitledNew: o.planEffect ?? 0
    })),
    money: null,
    tiers: null
  };
  if (o.waitingMoney !== undefined) v.waitingMoney = o.waitingMoney;
  return v as unknown as TimelineView;
}

const goal: Goal = { ...GOAL_BASE, amount: 55000, deadline: dayFromUtc(2026, 8, 31) };

const met = (rung: number): MetRung => ({
  rung,
  reachedOn: dayFromUtc(2026, 6, 1),
  datasetVersion: 'v',
  at: 'earlier'
});

const state = (o: Partial<GameState> = {}): GameState => ({ ...NEW_GAME, ...o });

const reading = (o: Partial<RunReading> = {}): RunReading => ({
  homes: 57000,
  reachedOn: dayFromUtc(2026, 6, 1),
  stages: { ...STAGES } as unknown as RunReading['stages'],
  waitingMoney: null,
  ...o
});

const take = (dropped = 10000, got = 10000): RunTake => ({
  dropped: dropped ? { home: dropped } : {},
  collected: { home: got }
});

const META = { amount: 55000, datasetVersion: 'dv', at: 'now' };

describe('deadlineIndex', () => {
  it('counts calendar months from months[0] and clamps', () => {
    const v = view();
    expect(deadlineIndex(dayFromUtc(2026, 8, 31), v)).toBe(7);
    expect(deadlineIndex(dayFromUtc(2025, 6, 30), v)).toBe(0);
    expect(deadlineIndex(dayFromUtc(2030, 1, 31), v)).toBe(11);
  });
});

describe('readRun', () => {
  it('is null before the deadline month is filled', () => {
    expect(readRun(view({ filledThrough: -1 }), goal)).toBeNull();
    expect(readRun(view({ filledThrough: 6 }), goal)).toBeNull();
  });

  it('reads homes, reachedOn and a copy of the stages', () => {
    const v = view({ filledThrough: 7 });
    const r = readRun(v, goal)!;
    expect(r.homes).toBe(57000);
    expect(r.reachedOn).toBe(readGoal(goal, v, 7)!.reachedOn);
    expect(r.reachedOn).toBe(v.months[5]);
    expect(r.stages).toEqual(v.rows[7].inProgress);
    expect(r.stages).not.toBe(v.rows[7].inProgress);
  });

  it('reads waitingMoney at the month, or null', () => {
    expect(readRun(view({ filledThrough: 7 }), goal)!.waitingMoney).toBeNull();
    expect(readRun(view({ filledThrough: 7, waitingMoney: null }), goal)!.waitingMoney).toBeNull();
    const wm = Array.from({ length: 12 }, () => 0);
    wm[7] = 42;
    expect(readRun(view({ filledThrough: 7, waitingMoney: wm }), goal)!.waitingMoney).toBe(42);
  });
});

describe('resultOf', () => {
  const index = 7;
  const input = (t: RunTake, v = view()) => ({ view: v, index, take: t });

  it('gives the lump on the first run to meet the rung, else null', () => {
    const t = take();
    expect(resultOf(state(), reading(), t, input(t), META).lump).toEqual({ home: 2000 });
    expect(resultOf(state({ met: [met(0)] }), reading(), t, input(t), META).lump).toBeNull();
    expect(resultOf(state(), reading({ reachedOn: null }), t, input(t), META).lump).toBeNull();
  });

  it('takes its fields from the state and meta, and copies the rest', () => {
    const t = take();
    const rd = reading();
    const r = resultOf(state({ rung: 1 }), rd, t, input(t), META);
    expect(r.rung).toBe(1);
    expect(r.amount).toBe(55000);
    expect(r.datasetVersion).toBe('dv');
    expect(r.at).toBe('now');
    expect(r.dropped).toEqual(t.dropped);
    expect(r.dropped).not.toBe(t.dropped);
    expect(r.collected).not.toBe(t.collected);
    expect(r.stages).toEqual(rd.stages);
    expect(r.stages).not.toBe(rd.stages);
  });

  it('lists the shown side goals at their target', () => {
    const t = take();
    const r = resultOf(state(), reading(), t, input(t), META);
    expect(r.side).toEqual([{ id: 'collect-share-1', reward: { home: 300 } }]);
  });

  it('leaves out one already met', () => {
    const t = take();
    const r = resultOf(state({ side: { 'collect-share-1': 'x' } }), reading(), t, input(t), META);
    expect(r.side.map((e) => e.id)).not.toContain('collect-share-1');
  });

  it('leaves out one whose read is null', () => {
    const t = take(0, 0);
    const r = resultOf(state(), reading(), t, input(t), META);
    expect(r.side.map((e) => e.id)).not.toContain('collect-share-1');
  });

  it('lists a policy goal at its target', () => {
    const t = take();
    const r = resultOf(state(), reading(), t, input(t, view({ planEffect: 2000 })), META);
    expect(r.side.map((e) => e.id)).toEqual([
      'policy-homes-1',
      'collect-share-1',
      'approved-homes'
    ]);
  });
});

describe('settle', () => {
  const result = (o: Partial<RunResult> = {}): RunResult => ({
    ...reading(),
    rung: 0,
    amount: 55000,
    datasetVersion: 'dv',
    at: 'now',
    dropped: { home: 100 },
    collected: { home: 30 },
    lump: { home: 2000 },
    side: [{ id: 'collect-run', reward: { home: 500 } }],
    ...o
  });

  it('credits collected, lump and side; records rung and side once', () => {
    const s = state({ units: { home: 100 }, bought: { n: 1 }, firstWinAt: 'f', phase: 'runs' });
    const r = result();
    const out = settle(s, r);
    expect(out.units).toEqual({ home: 2630 });
    expect(out.met).toEqual([
      { rung: r.rung, reachedOn: r.reachedOn, datasetVersion: r.datasetVersion, at: r.at }
    ]);
    expect(out.side['collect-run']).toBe(r.at);
    expect(out.runs).toBe(1);
    expect(out.last).toBe(r);
    expect(out.phase).toBe('runs');
    expect(out.rung).toBe(0);
    expect(out.bought).toEqual({ n: 1 });
    expect(out.firstWinAt).toBe('f');

    const again = settle(out, r);
    expect(again.units).toEqual({ home: 2660 });
    expect(again.met).toEqual(out.met);
    expect(again.side).toEqual(out.side);
    expect(again.runs).toBe(2);
  });

  it('keeps met after a miss', () => {
    const s = state({ met: [met(0)] });
    const out = settle(s, result({ reachedOn: null, lump: null, side: [] }));
    expect(out.met).toEqual(s.met);
  });

  it('keeps met ascending', () => {
    const out = settle(state({ met: [met(1)] }), result());
    expect(out.met.map((m) => m.rung)).toEqual([0, 1]);
  });

  it('records the result rung, not the state rung', () => {
    const out = settle(state({ rung: 1 }), result());
    expect(out.met.map((m) => m.rung)).toEqual([0]);
    expect(out.rung).toBe(1);
  });

  it('does not throw on frozen inputs', () => {
    const t = Object.freeze({
      dropped: Object.freeze({ home: 10000 }),
      collected: Object.freeze({ home: 10000 })
    });
    const rd = Object.freeze({ ...reading(), stages: Object.freeze({ ...STAGES }) as never });
    const s = Object.freeze({ ...NEW_GAME });
    let r!: RunResult;
    expect(() => {
      r = resultOf(s, rd, t, { view: view(), index: 7, take: t }, META);
    }).not.toThrow();
    expect(() => settle(s, Object.freeze(r))).not.toThrow();
  });
});
