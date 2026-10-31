import { describe, expect, it } from 'vitest';
import { parseCalibration, typicalMonths } from '$lib/timelapse/model';
import { rescaleTransition } from '$lib/sim/levers/timers';
import type { Calibration } from '$lib/timelapse/types';
import type { TimedStage } from '$lib/sim/levers/types';
import fixture0CalibrationJson from '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import { changeText, reconcileTiming, type TimingChange } from './reconcile';
import {
  OBSERVED_TIMING,
  PRESETS,
  resolvePreset,
  setStageMonths,
  stageBounds,
  type SimTiming,
  type TimingSet
} from './timing';

const load = (): Calibration =>
  parseCalibration(structuredClone(fixture0CalibrationJson) as unknown);
const cal = load();
const t0 = typicalMonths(cal);
const typ = t0.discretionary.permitFiled!;
const observed = (): TimingSet => structuredClone(OBSERVED_TIMING.current);
const withEdit = (s: TimingSet, scale: number, stage: TimedStage = 'permitFiled'): TimingSet => ({
  ...s,
  edits: [...s.edits, { pathway: 'discretionary', stage, scale, reach: 'all' }]
});
const tamperedBenchmark = (): TimingSet => {
  const s = resolvePreset('benchmarkPermits', cal);
  s.presetTimers = s.presetTimers.map((t) => ({ ...t, scale: 0.3 }));
  return s;
};

describe('reconcileTiming', () => {
  it('reconcile of a resolved set is identity', () => {
    for (const p of PRESETS.filter((x) => x.available)) {
      const timing: SimTiming = { current: resolvePreset(p.id, cal), saved: null };
      const r = reconcileTiming(timing, cal);
      expect(r.timing).toBe(timing);
      expect(r.changes).toEqual([]);
      const edited: SimTiming = {
        current: setStageMonths(cal, timing.current, 'discretionary', 'preApplication', 6).set,
        saved: null
      };
      const r2 = reconcileTiming(edited, cal);
      expect(r2.timing).toBe(edited);
      expect(r2.changes).toEqual([]);
    }
  });

  it('reconcile is idempotent', () => {
    const timing: SimTiming = {
      current: withEdit({ ...tamperedBenchmark(), preset: 'ceqaInfill' }, 0.1 / typ),
      saved: null
    };
    const once = reconcileTiming(timing, cal);
    expect(once.changes.length).toBeGreaterThan(0);
    const twice = reconcileTiming(once.timing, cal);
    expect(twice.timing).toBe(once.timing);
    expect(twice.changes).toEqual([]);
  });

  it('a tampered preset scale is re-resolved', () => {
    const r = reconcileTiming({ current: tamperedBenchmark(), saved: null }, cal);
    expect(r.timing.current.presetTimers).toEqual(
      resolvePreset('benchmarkPermits', cal).presetTimers
    );
    expect(r.changes).toEqual([
      { set: 'current', kind: 'preset-refit', preset: 'benchmarkPermits' }
    ]);
  });

  it('a retired preset becomes observed', () => {
    const cur = withEdit({ ...observed(), preset: 'ceqaInfill' }, 0.1 / typ);
    const r = reconcileTiming({ current: cur, saved: null }, cal);
    expect(r.timing.current.preset).toBe('observed');
    expect(r.timing.current.edits).toHaveLength(1);
    expect(r.changes.filter((c) => c.kind === 'preset-unavailable')).toEqual([
      { set: 'current', kind: 'preset-unavailable', preset: 'ceqaInfill' }
    ]);
  });

  it('an edit below the floor is raised and reported', () => {
    const cur = withEdit(observed(), 0.1 / typ);
    const r = reconcileTiming({ current: cur, saved: null }, cal);
    const b = stageBounds(cal, cur, 'discretionary', 'permitFiled');
    expect(r.changes).toEqual([
      {
        set: 'current',
        kind: 'edit-clamped',
        pathway: 'discretionary',
        stage: 'permitFiled',
        months: b.min,
        bound: 'min'
      }
    ]);
    expect(r.timing.current.edits[0].scale * typ).toBeCloseTo(b.min, 9);
  });

  it('an edit on a missing table is dropped', () => {
    const cur: TimingSet = {
      ...observed(),
      edits: [{ pathway: 'permitOnly', stage: 'filed', scale: 0.5, reach: 'all' }]
    };
    const r = reconcileTiming({ current: cur, saved: null }, cal);
    expect(r.timing.current.edits).toEqual([]);
    expect(r.changes).toEqual([
      { set: 'current', kind: 'edit-dropped', pathway: 'permitOnly', stage: 'filed' }
    ]);
  });

  it('on another calibration, edits keep their scale', () => {
    const slow = rescaleTransition(cal.transitions.discretionary.permitFiled!, 2);
    const other: Calibration = {
      ...cal,
      transitions: {
        ...cal.transitions,
        discretionary: { ...cal.transitions.discretionary, permitFiled: slow }
      }
    };
    expect(typicalMonths(other).discretionary.permitFiled!).toBeGreaterThan(typ * 1.5);
    const cur = setStageMonths(cal, observed(), 'discretionary', 'permitFiled', typ * 0.5).set;
    expect(cur.edits).toHaveLength(1);
    const r = reconcileTiming({ current: cur, saved: null }, other);
    expect(r.changes).toEqual([]);
    expect(Math.abs(r.timing.current.edits[0].scale - cur.edits[0].scale)).toBeLessThan(1e-9);
  });

  const scaledCal = (factor: number): Calibration => ({
    ...cal,
    transitions: {
      ...cal.transitions,
      discretionary: {
        ...cal.transitions.discretionary,
        permitFiled: rescaleTransition(cal.transitions.discretionary.permitFiled!, factor)
      }
    }
  });

  it('on another calibration, an in-bounds edit keeps its exact scale', () => {
    const other = scaledCal(1.37);
    const t1 = typicalMonths(other).discretionary.permitFiled!;
    const scale = 0.5714;
    expect((scale * t1 * 2) % 1).toBeGreaterThan(0.05); // 0.5-month rounding would move it
    const cur = withEdit(observed(), scale);
    const r = reconcileTiming({ current: cur, saved: null }, other);
    expect(r.changes).toEqual([]);
    expect(Math.abs(r.timing.current.edits[0].scale - scale)).toBeLessThan(1e-12);
    const again = reconcileTiming(r.timing, other);
    expect(again.timing).toBe(r.timing);
    expect(again.changes).toEqual([]);
  });

  it('an edit at the bound is not reported on reload', () => {
    // An edit stored at the bound can recompute a rounding error below it (7.499999999999999).
    const other = scaledCal(149 / typ);
    const t1 = typicalMonths(other).discretionary.permitFiled!;
    const min = stageBounds(other, observed(), 'discretionary', 'permitFiled').min;
    const cur = withEdit(observed(), (min - 1e-12) / t1);
    expect(cur.edits[0].scale * t1).toBeLessThan(min);
    const timing: SimTiming = { current: cur, saved: null };
    const r = reconcileTiming(timing, other);
    expect(r.timing).toBe(timing);
    expect(r.changes).toEqual([]);
  });

  it('reconciling cross-calibration and at-bound output again changes nothing', () => {
    const other = scaledCal(1.37);
    const t1 = typicalMonths(other).discretionary.permitFiled!;
    const min = stageBounds(other, observed(), 'discretionary', 'permitFiled').min;
    const timing: SimTiming = {
      current: withEdit(withEdit(observed(), 0.5714), 0.0001, 'preApplication'),
      saved: { label: 'x', set: withEdit(observed(), (min - 1) / t1) }
    };
    const once = reconcileTiming(timing, other);
    expect(once.changes.length).toBeGreaterThan(0);
    const twice = reconcileTiming(once.timing, other);
    expect(twice.timing).toBe(once.timing);
    expect(twice.changes).toEqual([]);
  });

  it('the snapshot is reconciled too', () => {
    const timing: SimTiming = {
      current: observed(),
      saved: { label: 'Mine', set: tamperedBenchmark() }
    };
    const r = reconcileTiming(timing, cal);
    expect(r.changes).toEqual([{ set: 'saved', kind: 'preset-refit', preset: 'benchmarkPermits' }]);
    expect(r.timing.saved!.label).toBe('Mine');
    expect(r.timing.current).toBe(timing.current);
  });

  it('changeText gives the copy for each kind', () => {
    const text = (c: TimingChange) => changeText(c);
    expect(text({ set: 'current', kind: 'preset-unavailable', preset: 'ceqaInfill' })).toBe(
      'SF as observed is used: CEQA infill exemption (AB 130 / SB 131, 2025) is no longer offered'
    );
    expect(text({ set: 'current', kind: 'preset-refit', preset: 'benchmarkPermits' })).toBe(
      "Permits at San Diego's pace was re-computed for this data"
    );
    expect(
      text({ set: 'current', kind: 'edit-dropped', pathway: 'permitOnly', stage: 'filed' })
    ).toBe('Filed to entitled, Permit only: removed (this route has no such stage in this data)');
    const c = {
      set: 'current',
      pathway: 'discretionary',
      stage: 'permitFiled',
      months: 2
    } as const;
    expect(text({ ...c, kind: 'edit-clamped', bound: 'min' })).toBe(
      'Permit review, Discretionary: raised to the minimum, 2 months'
    );
    expect(text({ ...c, kind: 'edit-clamped', bound: 'max' })).toBe(
      'Permit review, Discretionary: lowered to the maximum, 2 months'
    );
  });
});
