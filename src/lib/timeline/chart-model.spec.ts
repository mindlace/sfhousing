import { describe, expect, it } from 'vitest';
import type { TimelineView } from '$lib/sim/world/score/types';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from './chunk-log';
import {
  chartPoints,
  gapPath,
  lensOf,
  linePath,
  posDay,
  posOf,
  runningMax,
  runningMin,
  yBottom,
  yLabels,
  yTop
} from './chart-model';
import { filledEndDay } from './playhead';
import { currentLawHomes } from './results';
import { calendarMonths, chunk, cut, statics } from './test/fixtures';

function whole(): TimelineView {
  const v = viewOfLog(logFilled(logCompiled(EMPTY_LOG, statics()), chunk(0, 24)))!;
  return calendarMonths(v);
}

describe('chart-model', () => {
  it('starts at zero at today; then each month at its end', () => {
    const v = whole();
    const p = chartPoints(v, false);
    expect(p.policy[0]).toBe(0);
    expect(p.policy).toHaveLength(v.rows.length + 1);
    for (const i of [0, 5, 23]) expect(p.policy[i + 1]).toBe(v.rows[i].completedNet);
    expect(p.law).toBeNull();
    const asOf = v.months[0] + 9;
    expect(posDay(v, 0, asOf)).toBe(asOf);
    expect(posDay(v, 3, asOf)).toBe(filledEndDay(v.months, 2, asOf));
    expect(posDay(v, 3, asOf)).toBe(v.months[3] - 1);
    // Only the filled months are points.
    expect(chartPoints(cut(v, 4), true).policy).toHaveLength(6);
  });

  it('the current-law line is the plan world less the effect, only with a policy in force', () => {
    const v = whole();
    const p = chartPoints(v, true);
    expect(p.law![0]).toBe(0);
    for (const i of [0, 6, 23]) {
      expect(p.law![i + 1]).toBe(currentLawHomes(v, i));
      expect(p.law![i + 1]).toBe(v.rows[i].completedNet - v.planEffect[i].completedNetNew);
    }
    expect(chartPoints(v, false).law).toBeNull();
  });

  it('source: policy is completedNet, law is completedNetPipeline, with or without a policy', () => {
    const v = whole();
    for (const inForce of [true, false]) {
      const p = chartPoints(v, inForce, 'source');
      expect(p.policy[0]).toBe(0);
      expect(p.law![0]).toBe(0);
      expect(p.policy).toHaveLength(v.rows.length + 1);
      expect(p.law).toHaveLength(v.rows.length + 1);
      for (const i of [0, 6, 23]) {
        expect(p.policy[i + 1]).toBe(v.rows[i].completedNet);
        expect(p.law![i + 1]).toBe(v.rows[i].completedNetPipeline);
      }
    }
    // Only the filled months, as every lens.
    expect(chartPoints(cut(v, 4), false, 'source').law).toHaveLength(6);
    // homes is the default and as before.
    expect(chartPoints(v, true, 'homes')).toEqual(chartPoints(v, true));
  });

  it('effect: one line of planEffect completedNetNew, no law; falls back to homes without a policy', () => {
    const v = whole();
    const p = chartPoints(v, true, 'effect');
    expect(p.law).toBeNull();
    expect(p.policy[0]).toBe(0);
    expect(p.policy).toHaveLength(v.rows.length + 1);
    for (const i of [0, 9, 23]) expect(p.policy[i + 1]).toBe(v.planEffect[i].completedNetNew);
    expect(chartPoints(v, false, 'effect')).toEqual(chartPoints(v, false, 'homes'));
    expect(lensOf('effect', false)).toBe('homes');
    expect(lensOf('effect', true)).toBe('effect');
    expect(lensOf('source', false)).toBe('source');
    expect(lensOf('homes', true)).toBe('homes');
  });

  it('runningMin keeps a negative effect inside the plot', () => {
    const v = whole();
    const planEffect = v.planEffect.map((p, i) => ({ ...p, completedNetNew: -7 * i }));
    const p = chartPoints({ ...v, planEffect }, true, 'effect');
    const min = runningMin(p);
    expect(min[0]).toBe(0);
    expect(min[5]).toBe(-28);
    expect(min.at(-1)).toBe(-7 * 23);
    // The floor reads only what is reached: at position 5, -28 rounds to -50.
    expect(yBottom(min, 5)).toBe(-50);
    expect(yBottom(min, 0)).toBe(0);
    // An effect that is all below zero still tops out at 1, never at the goal (none is drawn).
    expect(yTop(null, runningMax(p), 5)).toBe(1);
  });

  it('the scale grows only with the months reached, in 1-2-5 steps, and never below the goal', () => {
    const p = { policy: [0, 3, 40, 12, 180, 90], law: [0, 1, 2, 3, 4, 300] };
    const run = runningMax(p);
    expect(run).toEqual([0, 3, 40, 40, 180, 300]);
    expect([0, 1, 2, 3, 4, 5].map((pos) => yTop(null, run, pos))).toEqual([1, 5, 50, 50, 200, 500]);
    // Past the last point the last maximum holds.
    expect(yTop(null, run, 99)).toBe(500);
    // Never below the goal.
    expect(yTop(73_346, run, 2)).toBe(100_000);
    expect(yTop(30, run, 1)).toBe(50);
    // A falling line: the floor follows the lowest value reached.
    const fall = runningMin({ policy: [0, -3, -40, 2], law: null });
    expect(fall).toEqual([0, -3, -40, -40]);
    expect(yBottom(fall, 0)).toBe(0);
    expect(yBottom(fall, 2)).toBe(-50);
  });

  it('linePath and gapPath close over the two series', () => {
    const x = (j: number) => j * 10;
    const y = (v: number) => 100 - v;
    expect(linePath([0, 5, 20], x, y)).toBe('M0.00,100.00L10.00,95.00L20.00,80.00');
    expect(gapPath([0, 5, 20], [0, 2, 8], x, y)).toBe(
      'M0.00,100.00L10.00,95.00L20.00,80.00L20.00,92.00L10.00,98.00L0.00,100.00Z'
    );
    expect(linePath([], x, y)).toBe('');
    expect(gapPath([], [], x, y)).toBe('');
  });

  it('yLabels halves the top', () => {
    // One format for both: compact when the top is, else both in full.
    expect(yLabels(100_000)).toEqual([
      { value: 50_000, label: '50K' },
      { value: 100_000, label: '100K' }
    ]);
    expect(yLabels(500_000).map((l) => l.label)).toEqual(['250K', '500K']);
    expect(yLabels(50_000).map((l) => l.label)).toEqual(['25,000', '50,000']);
    expect(yLabels(50)).toEqual([
      { value: 25, label: '25' },
      { value: 50, label: '50' }
    ]);
  });

  it('posOf reads today as 0 and month i as i + 1', () => {
    expect(posOf({ index: 0, atToday: true })).toBe(0);
    expect(posOf({ index: 0, atToday: false })).toBe(1);
    expect(posOf({ index: 7, atToday: false })).toBe(8);
  });
});
