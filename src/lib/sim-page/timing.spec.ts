import { describe, expect, it } from 'vitest';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { parseCalibration, typicalMonths } from '$lib/timelapse/model';
import { MONTH_DAYS } from '$lib/timelapse/time';
import { PATHWAYS, pathwayStages, type Calibration, type Pathway } from '$lib/timelapse/types';
import { rescaleTransition, scaleTable, timersOp } from '$lib/sim/levers/timers';
import { MIN_SCALE, type TimedStage, type TimerEdit } from '$lib/sim/levers/types';
import fixture0CalibrationJson from '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import {
  EDITABLE_STAGES,
  OBSERVED_TIMING,
  PRESETS,
  compileTiming,
  exitMonth,
  isCustom,
  resolvePreset,
  revertTarget,
  routeView,
  setRouteShare,
  setStageMonths,
  shownRouteShares,
  stageBounds,
  timingLabel,
  type SimTiming,
  type TimingSet
} from './timing';
import { SB423_DEADLINE_DAYS, SB423_SMALL_SHARE, STAGE_FLOORS } from './timing-sources';

const PARCELS = { count: 0 } as unknown as ScenarioParcels;
const load = (): Calibration =>
  parseCalibration(structuredClone(fixture0CalibrationJson) as unknown);
const sum = (r: Record<Pathway, number>) => PATHWAYS.reduce((a, p) => a + r[p], 0);
const observed = (): TimingSet => structuredClone(OBSERVED_TIMING.current);

/** The fixture with one transition's table shortened to `months` (a short permit review). */
function withShortPermitFiled(cal: Calibration): Calibration {
  const t = cal.transitions.discretionary.permitFiled!;
  const short = rescaleTransition(t, 1 / typicalMonths(cal).discretionary.permitFiled!);
  return {
    ...cal,
    transitions: {
      ...cal.transitions,
      discretionary: { ...cal.transitions.discretionary, permitFiled: short }
    }
  };
}

describe('presets', () => {
  it('observed compiles to no timers', () => {
    expect(compileTiming(OBSERVED_TIMING.current)).toEqual({
      timers: [],
      routeShares: null,
      localProgramStreamlined: true
    });
    expect(PRESETS.map((p) => p.id)).toEqual([
      'observed',
      'sb423Clock',
      'noDiscretionary',
      'ceqaInfill',
      'benchmarkPermits'
    ]);
  });

  it('benchmark permits scale permitFiled on every pathway by 134/280 for everyone', () => {
    const s = resolvePreset('benchmarkPermits', load());
    expect(s.presetTimers).toHaveLength(3);
    for (const t of s.presetTimers) {
      expect(t.stage).toBe('permitFiled');
      expect(t.scale).toBeCloseTo(0.4786, 4);
      expect(t.reach).toBe('all');
    }
    expect(new Set(s.presetTimers.map((t) => t.pathway))).toEqual(new Set(PATHWAYS));
    expect(s.presetRouteShares).toBeNull();
  });

  it("the SB 423 clock puts streamlined filed's 90th percentile at the deadline", () => {
    const cal = load();
    const p = SB423_SMALL_SHARE.value!;
    const { small, large } = SB423_DEADLINE_DAYS.value;
    const D = (small * p + large * (1 - p)) / MONTH_DAYS;
    const t = cal.transitions.streamlined.filed!;
    const s = resolvePreset('sb423Clock', cal);
    expect(s.presetRouteShares).toBeNull();
    const timer = s.presetTimers.find((x) => x.pathway === 'streamlined' && x.stage === 'filed');
    if (exitMonth(t, 0.9) <= D) {
      expect(timer).toBeUndefined();
    } else {
      expect(timer).toBeDefined();
      expect(timer!.scale).toBeLessThanOrEqual(1);
      expect(timer!.reach).toBe('new');
      expect(Math.abs(exitMonth(rescaleTransition(t, timer!.scale), 0.9) - D)).toBeLessThanOrEqual(
        1
      );
    }
    expect(s.presetTimers).toHaveLength(timer ? 1 : 0);
  });

  it('no discretionary review moves the discretionary share to streamlined', () => {
    const cal = load();
    const before = shownRouteShares(OBSERVED_TIMING.current, cal);
    const s = resolvePreset('noDiscretionary', cal);
    expect(s.presetTimers).toEqual([]);
    expect(s.presetRouteShares).toEqual({
      discretionary: 0,
      streamlined: before.discretionary + before.streamlined,
      permitOnly: before.permitOnly
    });
    expect(sum(s.presetRouteShares!)).toBe(100);
    for (const p of PATHWAYS) expect(Number.isInteger(s.presetRouteShares![p])).toBe(true);
  });

  it('an unavailable preset cannot be resolved', () => {
    const ceqa = PRESETS.find((p) => p.id === 'ceqaInfill')!;
    expect(ceqa.available).toBe(false);
    expect(ceqa.unavailableReason).toMatch(/\S/);
    expect(() => resolvePreset('ceqaInfill', load())).toThrow(/not available/);
  });

  it('every available preset carries provenance, and every preset keeps the Local Program', () => {
    const cal = load();
    for (const p of PRESETS.filter((x) => x.available)) {
      expect(p.provenance.length).toBeGreaterThan(0);
      for (const pr of p.provenance) expect(pr.tier).toBeLessThanOrEqual(4);
      expect(resolvePreset(p.id, cal).localProgramStreamlined).toBe(true);
    }
    expect(PRESETS.find((p) => p.id === 'sb423Clock')!.summary).toMatch(/route shares/i);
  });

  it('a preset never goes below a floor', () => {
    const short = withShortPermitFiled(load());
    expect(typicalMonths(short).discretionary.permitFiled).toBe(1);
    for (const cal of [load(), short]) {
      const typ = typicalMonths(cal);
      let limited = 0;
      for (const preset of PRESETS.filter((x) => x.available)) {
        const s = resolvePreset(preset.id, cal);
        for (const p of PATHWAYS) {
          for (const v of routeView(cal, s, p)) {
            const floor = v.floor?.value ?? null;
            const touched = s.presetTimers.some((t) => t.pathway === p && t.stage === v.stage);
            if (!touched || floor === null) {
              expect(v.presetLimitedByFloor).toBe(false);
              continue;
            }
            expect(v.months).toBeGreaterThanOrEqual(Math.min(floor, typ[p][v.stage]!));
            if (v.presetLimitedByFloor) limited++;
          }
        }
      }
      // The short calibration's discretionary permit review hits the floor under benchmarkPermits.
      if (cal === short) expect(limited).toBeGreaterThan(0);
    }
  });
});

describe('stage editing', () => {
  it('setStageMonths clamps to the floor and says which bound', () => {
    const cal = load();
    const s = observed();
    const b = stageBounds(cal, s, 'discretionary', 'permitFiled');
    expect(b.min).toBeGreaterThanOrEqual(STAGE_FLOORS.discretionary.permitFiled!.value!);
    expect(b.minBy).toBe('floor');
    const lo = setStageMonths(cal, s, 'discretionary', 'permitFiled', 0);
    expect(lo.clamped).toBe('min');
    expect(
      routeView(cal, lo.set, 'discretionary').find((v) => v.stage === 'permitFiled')!.months
    ).toBe(b.min);
    const hi = setStageMonths(cal, s, 'discretionary', 'permitFiled', 1e9);
    expect(hi.clamped).toBe('max');
    expect(hi.set.edits[0].scale).toBeLessThanOrEqual(10);
    const mid = setStageMonths(cal, s, 'discretionary', 'permitFiled', b.min + 1);
    expect(mid.clamped).toBeNull();
    expect(mid.set.edits).toEqual([
      expect.objectContaining({ pathway: 'discretionary', stage: 'permitFiled', reach: 'all' })
    ]);
    // A stage with no sourced floor has the numerical bound.
    const nb = stageBounds(cal, s, 'streamlined', 'filed');
    expect(nb.minBy).toBe('scale');
  });

  it('editing back to the preset value removes the edit', () => {
    const cal = load();
    const s0 = resolvePreset('benchmarkPermits', cal);
    const shown = routeView(cal, s0, 'streamlined').find((v) => v.stage === 'permitFiled')!.months;
    const a = setStageMonths(cal, s0, 'streamlined', 'permitFiled', shown + 2).set;
    expect(isCustom(a)).toBe(true);
    expect(a.edits).toHaveLength(1);
    const a2 = setStageMonths(cal, a, 'streamlined', 'permitFiled', shown + 3).set;
    expect(a2.edits).toHaveLength(1);
    const b = setStageMonths(cal, a2, 'streamlined', 'permitFiled', shown).set;
    expect(b.edits).toEqual([]);
    expect(isCustom(b)).toBe(false);
  });

  it('shown months track the engine', () => {
    const cal = load();
    for (const x of [0.3, 0.5, 2]) {
      const timers: TimerEdit[] = [];
      for (const p of PATHWAYS)
        for (const st of pathwayStages(p))
          if (st !== 'complete' && st !== 'construction' && cal.transitions[p][st])
            timers.push({ pathway: p, stage: st as TimedStage, scale: x, reach: 'new' });
      const s: TimingSet = { ...observed(), presetTimers: timers };
      const engine = typicalMonths(timersOp(scaleTable(timers, 'new'))(cal, PARCELS).cal);
      for (const p of PATHWAYS)
        for (const v of routeView(cal, s, p))
          expect(Math.abs(engine[p][v.stage]! - v.months)).toBeLessThanOrEqual(1);
    }
  });

  it('an in-flight clamp is reported', () => {
    // Under the replace ruling a valid set cannot stack scales: one preset timer per stage (the
    // parser rejects duplicates) and an edit replaces it. The clamp report is defensive, so it is
    // exercised with two preset timers on one stage, a set only a hand-built object can hold.
    const cal = load();
    const s: TimingSet = {
      ...observed(),
      presetTimers: [
        { pathway: 'discretionary', stage: 'filed', scale: 0.2, reach: 'all' },
        { pathway: 'discretionary', stage: 'filed', scale: 0.2, reach: 'all' }
      ]
    };
    const v = routeView(cal, s, 'discretionary').find((x) => x.stage === 'filed')!;
    expect(v.inFlightClamped).toBe(true);
    expect(v.inFlight).toBe(MIN_SCALE);
    expect(v.reach).toBe('all');
    const other = routeView(cal, s, 'discretionary').find((x) => x.stage === 'permitFiled')!;
    expect(other.inFlightClamped).toBe(false);
    expect(other.reach).toBeNull();
  });

  it('reach is mixed when new and all timers touch a stage', () => {
    const cal = load();
    const s: TimingSet = {
      ...observed(),
      presetTimers: [
        { pathway: 'streamlined', stage: 'filed', scale: 0.5, reach: 'new' },
        { pathway: 'streamlined', stage: 'filed', scale: 0.8, reach: 'all' }
      ]
    };
    const v = routeView(cal, s, 'streamlined').find((x) => x.stage === 'filed')!;
    expect(v.reach).toBe('mixed');
    expect(v.fresh).toBeCloseTo(0.4, 10);
    expect(v.inFlight).toBeCloseTo(0.8, 10);
  });

  it('a custom edit replaces the preset on its stage for every project', () => {
    const cal = load();
    const t0 = typicalMonths(cal).streamlined.filed!;
    const s0 = resolvePreset('sb423Clock', cal);
    expect(s0.presetTimers).toHaveLength(1);
    const before = routeView(cal, s0, 'streamlined').find((x) => x.stage === 'filed')!;
    expect(before.reach).toBe('new');
    expect(before.inFlight).toBe(1);
    const s = setStageMonths(cal, s0, 'streamlined', 'filed', 2).set;
    expect(s.edits).toEqual([
      { pathway: 'streamlined', stage: 'filed', scale: 2 / t0, reach: 'all' }
    ]);
    expect(compileTiming(s).timers).toEqual(s.edits);
    const v = routeView(cal, s, 'streamlined').find((x) => x.stage === 'filed')!;
    expect(v.fresh).toBeCloseTo(2 / t0, 12);
    expect(v.inFlight).toBeCloseTo(2 / t0, 12);
    expect(v.months).toBe(2);
    expect(v.reach).toBe('all');
    expect(v.presetLimitedByFloor).toBe(false);
    // Bounds no longer depend on the preset.
    expect(stageBounds(cal, s0, 'streamlined', 'filed')).toEqual(
      stageBounds(cal, observed(), 'streamlined', 'filed')
    );
  });

  it('an edit on one stage leaves the preset on the others', () => {
    const cal = load();
    const s0 = resolvePreset('benchmarkPermits', cal);
    const s = setStageMonths(cal, s0, 'discretionary', 'permitFiled', 5).set;
    const timers = compileTiming(s).timers;
    expect(timers.filter((t) => t.stage === 'permitFiled')).toHaveLength(3);
    expect(timers.find((t) => t.pathway === 'discretionary')!.scale).toBe(
      5 / typicalMonths(cal).discretionary.permitFiled!
    );
    const v = routeView(cal, s, 'streamlined').find((x) => x.stage === 'permitFiled')!;
    expect(v.fresh).toBeCloseTo(134 / 280, 12);
  });

  it('permitOnly has no filed or entitled stage', () => {
    const cal = load();
    const views = routeView(cal, observed(), 'permitOnly');
    expect(views.map((v) => v.stage)).toEqual([
      'preApplication',
      'permitFiled',
      'permitIssued',
      'construction'
    ]);
    const c = views.find((v) => v.stage === 'construction')!;
    expect(c.editable).toBe(false);
    expect(c.lockReason).toBe('Set mostly by the builder, financing and technology');
    expect(c.bounds).toBeNull();
    const d = routeView(cal, observed(), 'discretionary').find((v) => v.stage === 'entitled')!;
    expect(d.label).toBe('Entitled to permit filed');
    expect(d.lockReason).toBe("Set by the applicant's timing, not by the city");
    expect(EDITABLE_STAGES).toEqual(['preApplication', 'filed', 'permitFiled', 'permitIssued']);
  });

  it('a huge typical month gives a finite, capped width', () => {
    const base = load();
    const t = base.transitions.discretionary.filed!;
    const slow = {
      ...t,
      months: 1,
      advance: [0.01],
      exit: {},
      tail: { advance: 1e-12, exit: {} }
    };
    const cal: Calibration = {
      ...base,
      transitions: {
        ...base.transitions,
        discretionary: { ...base.transitions.discretionary, filed: slow }
      }
    };
    const v = routeView(cal, observed(), 'discretionary').find((x) => x.stage === 'filed')!;
    expect(Number.isFinite(v.months)).toBe(true);
    expect(Number.isFinite(v.bounds!.max)).toBe(true);
    expect(v.months).toBeLessThanOrEqual(typicalMonths(cal).discretionary.filed!);
    expect(Number.isFinite(exitMonth(slow, 0.9))).toBe(true);
  });
});

describe('route shares', () => {
  it('shares always sum to 100', () => {
    const cal = load();
    const all = setRouteShare(observed(), cal, 'permitOnly', 100);
    expect(all.routeShares).toEqual({ discretionary: 0, streamlined: 0, permitOnly: 100 });
    expect(setRouteShare(all, cal, 'permitOnly', 40).routeShares).toEqual({
      discretionary: 30,
      streamlined: 30,
      permitOnly: 40
    });
    expect(setRouteShare(all, cal, 'discretionary', 40).routeShares).toEqual({
      discretionary: 40,
      streamlined: 0,
      permitOnly: 60
    });
    const s: TimingSet = {
      ...observed(),
      routeShares: { discretionary: 70, streamlined: 9, permitOnly: 21 }
    };
    const r = setRouteShare(s, cal, 'streamlined', 33).routeShares!;
    expect(r).toEqual({ discretionary: 52, streamlined: 33, permitOnly: 15 });
    expect(sum(r)).toBe(100);
    expect(sum(shownRouteShares(observed(), cal))).toBe(100);
  });

  it('setting the shares back to the preset clears the custom shares', () => {
    const cal = load();
    const s = resolvePreset('noDiscretionary', cal);
    const a = setRouteShare(s, cal, 'permitOnly', 50);
    expect(isCustom(a)).toBe(true);
    const b = setRouteShare(a, cal, 'permitOnly', s.presetRouteShares!.permitOnly);
    expect(b.routeShares).toBeNull();
    expect(compileTiming(a).routeShares).toEqual(a.routeShares);
  });
});

describe('labels, save and revert', () => {
  it('the label follows the set', () => {
    const cal = load();
    expect(timingLabel(OBSERVED_TIMING.current)).toBe('SF as observed');
    const s = setStageMonths(cal, observed(), 'discretionary', 'filed', 2).set;
    expect(timingLabel(s)).toBe('Custom (from SF as observed)');
    const b = resolvePreset('benchmarkPermits', cal);
    expect(timingLabel(b)).toBe("Permits at San Diego's pace");
  });

  it('revert goes to the save, else the preset', () => {
    const cal = load();
    const preset = resolvePreset('benchmarkPermits', cal);
    const custom = setRouteShare(preset, cal, 'permitOnly', 60);
    expect(revertTarget({ current: preset, saved: null }, cal)).toBeNull();
    expect(revertTarget({ current: custom, saved: null }, cal)).toEqual({
      label: "Permits at San Diego's pace",
      set: preset
    });
    const saved = { label: 'Mine', set: custom };
    const later = setStageMonths(cal, custom, 'streamlined', 'filed', 1).set;
    expect(revertTarget({ current: later, saved }, cal)).toEqual(saved);
    expect(revertTarget({ current: custom, saved }, cal)).toBeNull();
  });

  it('choosing a preset keeps the save', () => {
    const cal = load();
    const custom = setRouteShare(observed(), cal, 'permitOnly', 60);
    const t: SimTiming = { current: custom, saved: { label: 'Mine', set: custom } };
    const next: SimTiming = { ...t, current: resolvePreset('noDiscretionary', cal) };
    expect(next.saved).toBe(t.saved);
    expect(next.current.edits).toEqual([]);
    expect(next.current.routeShares).toBeNull();
    expect(revertTarget(next, cal)!.set).toBe(custom);
  });
});
