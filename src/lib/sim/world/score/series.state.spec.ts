// `WorldSeries` state: `finalThrough` against the steps, saving and restoring, and the order checks.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SimInput } from '$lib/sim/scenario/types';
import { staticsOf, type Statics } from '../statics';
import { benchInput, fixtureInput } from '../test/cities.node';
import { horizonMonth } from '../test/run';
import { frameOf, oneFrame } from '../test/timeline';
import { monthOfDay } from '../months';
import { ORIGIN_MASTER, type WorldEvent } from '../types';
import { createWorldSeries, extrasOf } from './series';
import { finalTable, horizonOf } from './statics';
import { feedWorld, testStatics } from './test/feed';
import type { ScoreStatics, WorldSeries, WorldSeriesData } from './types';

let input: SimInput;
let statics: Statics;
beforeAll(async () => {
  input = await fixtureInput();
  statics = staticsOf(input);
});

/** Runs seed `seed` and returns a series restored at month `at` and one fed straight through. */
function splitRun(
  inp: SimInput,
  st: Statics,
  seed: number,
  at: number
): { restored: WorldSeries; straight: WorldSeries; last: number } {
  const W = horizonMonth(inp.asOf);
  const s = testStatics(inp, W);
  const tl = oneFrame(frameOf(inp));
  const straight = createWorldSeries(s);
  let saved: WorldSeriesData | null = null;
  feedWorld(st, tl, seed, W, straight, 'live', {
    saveAt: at,
    onSave: (d) => (saved = structuredClone(d))
  });
  expect(saved).not.toBeNull();
  // The same run again, its events going to a stand-in until month `at`, then to the restored one.
  let target: WorldSeries = createWorldSeries(s);
  let restored: WorldSeries | null = null;
  const proxy: WorldSeries = {
    add: (e, w, x) => target.add(e, w, x),
    stepped(m) {
      target.stepped(m);
      if (m === at) target = restored = createWorldSeries(s, saved!);
    },
    finalThrough: () => target.finalThrough(),
    rows: (a, b) => target.rows(a, b),
    data: () => target.data()
  };
  feedWorld(st, tl, seed, W, proxy, 'live');
  return { restored: restored!, straight, last: s.lastIndex };
}

describe('finalThrough', () => {
  it('never runs ahead of the steps', () => {
    const W = 480;
    const s = testStatics(input, W);
    const table = finalTable(s);
    const series = createWorldSeries(s);
    expect(series.finalThrough()).toBe(-1);
    for (let m = 1; m <= W; m++) {
      series.stepped(m);
      const f = series.finalThrough();
      if (f >= 0) expect(monthOfDay(s.asOf, lastDay(s, f))).toBeLessThanOrEqual(m);
      if (f < s.lastIndex) expect(monthOfDay(s.asOf, lastDay(s, f + 1))).toBeGreaterThan(m);
      if (f < s.lastIndex) expect(table[f + 1]).toBeGreaterThan(m);
      expect(f >= 0 ? table[f] : -1).toBeLessThanOrEqual(m);
    }
    expect(series.finalThrough()).toBe(s.lastIndex);
  });

  it('stepped out of order throws', () => {
    const s = testStatics(input, 24);
    const series = createWorldSeries(s);
    expect(() => series.stepped(2)).toThrow(/stepped/);
    series.stepped(1);
    expect(() => series.stepped(1)).toThrow(/stepped/);
    expect(() => series.stepped(3)).toThrow(/stepped/);
  });
});

/** The last day of calendar month `i`: the day before the next month's first. */
function lastDay(s: ScoreStatics, i: number): number {
  return i + 1 < s.months.length ? s.months[i + 1] - 1 : horizonOf(s);
}

describe('data and restore', () => {
  it('saved at month 100 and restored equals one fed straight through (fixture)', () => {
    for (const seed of [1, 2, 3]) {
      const { restored, straight, last } = splitRun(input, statics, seed, 100);
      expect(restored.rows(0, last)).toEqual(straight.rows(0, last));
      expect(restored.data()).toEqual(straight.data());
    }
  });

  it('saved at month 100 and restored equals one fed straight through (bench seed 1)', () => {
    const bench = benchInput();
    const { restored, straight, last } = splitRun(bench, staticsOf(bench), 1, 100);
    expect(restored.rows(0, last)).toEqual(straight.rows(0, last));
    expect(restored.data()).toEqual(straight.data());
  });

  it('the restored series and the original share no state', () => {
    const s = testStatics(input, 120);
    const a = createWorldSeries(s);
    feedWorld(statics, oneFrame(frameOf(input)), 1, 60, a, 'live');
    const d = a.data();
    const b = createWorldSeries(s, d);
    expect(b.data()).toEqual(d);
    d.delta.fill(7);
    d.stage.fill(3);
    a.data().sum.fill(9);
    expect(b.data().delta.some((v) => v === 7)).toBe(false);
    expect(b.data().stage.some((v) => v === 3)).toBe(false);
    expect(a.data().delta.some((v) => v === 7)).toBe(false);
    expect(b.finalThrough()).toBe(a.finalThrough());
  });

  it('saved data of an older layout is rejected', () => {
    const s = testStatics(input, 24);
    const d = createWorldSeries(s).data();
    for (const version of [1, 2]) {
      const old = { ...d, version } as unknown as WorldSeriesData;
      expect(() => createWorldSeries(s, old)).toThrow(`saved series version ${version}`);
    }
  });

  it("extras' range errors name homes, not rows", () => {
    const s = testStatics(input, 24);
    const series = createWorldSeries(s);
    expect(() => extrasOf(series).homes(0, 0)).toThrow(/^world-score: homes\(0, 0\)/);
  });

  it('a phase filed twice throws', () => {
    const bench = benchInput();
    const bStatics = staticsOf(bench);
    const s = testStatics(bench, 120);
    const series = createWorldSeries(s);
    const w = feedWorld(bStatics, oneFrame(frameOf(bench)), 1, 0, series, 'live');
    let row = -1;
    for (let r = 0; r < w.projects.n && row < 0; r++) {
      if (w.projects.origin[r] === ORIGIN_MASTER) row = r;
    }
    expect(row).toBeGreaterThanOrEqual(0);
    const e: WorldEvent = { kind: 'phaseFiled', row, day: s.asOf + 1, phase: 1 };
    series.add(e, w, bStatics);
    expect(() => series.add(e, w, bStatics)).toThrow(/filed twice/);
  });
});
