// Plan 2 Task 8: the engine's per-project calibration (ruling 3, "Policy start date") and the
// time-in-stage scale (paired-draw fix: the engine samples the unscaled transition and scales the
// time in stage of every step by the cohort's scale).
import { describe, expect, it } from 'vitest';
import { type Day } from '$lib/timelapse/time';
import { STAGE_ORDER, type Pathway, type Stage } from '$lib/timelapse/types';
import { routeSharesOp, scaleTable, type StageScale } from '../levers/timers';
import { isSkipped, nextStage, scaledTransition } from './engine';
import { P, drawOn, jobEntity, seedHash, streamOf } from './rng';
import golden from './fixtures/golden-seed1.json';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import { simulateDetailed } from './simulate';
import type { Schedule, SimInput } from './types';

const H = GOLDEN_HORIZON;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function scaleOf(pathway: Pathway, stage: keyof StageScale[Pathway], s: number): StageScale {
  const out = scaleTable([], 'new');
  out[pathway][stage] = s;
  return out;
}

const byId = (ss: Schedule[]) => new Map(ss.map((s) => [s.projectId, s]));

function median(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  const n = a.length;
  return n % 2 === 1 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}

/** The day a schedule leaves `stage` (entering the next or exiting there); open = Infinity. */
function leaveDay(s: Schedule, stage: Stage): Day {
  if (s.end.kind === 'exit' && s.end.stage === stage) return s.end.day;
  const d = s.entered[nextStage(s.pathway, stage)];
  return d ?? Infinity;
}

describe('engine levers: neither field set', () => {
  it('simulateDetailed equals the golden', () => {
    const run = simulateDetailed(goldenInput(), 1, H).schedules;
    expect(JSON.parse(JSON.stringify(run))).toEqual(golden.schedules);
  });

  it('identity newProjects and inFlightScale give the base run', () => {
    const base = goldenInput();
    const identity = scaleTable([], 'new');
    const input: SimInput = {
      ...base,
      newProjects: { calibration: base.calibration, scale: identity },
      inFlightScale: identity
    };
    // the in-flight cohort flag (Call 15) is the one difference newProjects makes
    const unflag = (r: ReturnType<typeof simulateDetailed>) => ({
      ...r,
      schedules: r.schedules.map(({ inFlight: _, ...s }) => s)
    });
    for (const seed of [1, 2, 3]) {
      expect(unflag(simulateDetailed(input, seed, H))).toEqual(simulateDetailed(base, seed, H));
    }
  });
});

describe('engine levers: newProjects', () => {
  const base = goldenInput();
  const scale = scaleOf('discretionary', 'filed', 0.5);
  const input: SimInput = {
    ...base,
    newProjects: { calibration: base.calibration, scale }
  };
  const stageOf = new Map(base.projects.map((p) => [p.id, p.stage]));

  it('leaves pipeline rows not at preApplication unchanged, seeds 1-20', () => {
    let compared = 0;
    for (const seed of seeds(20)) {
      const was = simulateDetailed(base, seed, H);
      const now = simulateDetailed(input, seed, H);
      expect(now.masters).toEqual(was.masters);
      const wasPipe = was.schedules.filter((s) => s.origin === 'pipeline');
      const nowPipe = byId(now.schedules.filter((s) => s.origin === 'pipeline'));
      for (const s of wasPipe) {
        if (stageOf.get(s.projectId) === 'preApplication') continue;
        // the same schedule, flagged in flight (Call 15)
        expect(nowPipe.get(s.projectId), `${seed} ${s.projectId}`).toEqual({
          ...s,
          inFlight: true
        });
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20 * 10);
  });

  it('speeds simulated discretionary filed -> entitled: median <= 0.6 x base, seeds 1-50', () => {
    const spans = (inp: SimInput) => {
      const out: number[] = [];
      for (const seed of seeds(50)) {
        for (const s of simulateDetailed(inp, seed, H).schedules) {
          if (s.origin !== 'simulated' || s.pathway !== 'discretionary') continue;
          const { filed, entitled } = s.entered;
          if (filed !== undefined && entitled !== undefined) out.push(entitled - filed);
        }
      }
      return out;
    };
    const was = spans(base);
    const now = spans(input);
    expect(was.length).toBeGreaterThan(20);
    expect(now.length).toBeGreaterThan(20);
    expect(median(now)).toBeLessThanOrEqual(0.6 * median(was));
  });

  it('a pipeline row at preApplication reads newProjects', () => {
    const ppa = base.projects.filter((p) => p.stage === 'preApplication').map((p) => p.id);
    expect(ppa.length).toBeGreaterThan(0);
    let differs = false;
    for (const seed of seeds(20)) {
      const was = byId(simulateDetailed(base, seed, H).schedules);
      const now = byId(simulateDetailed(input, seed, H).schedules);
      for (const id of ppa) {
        if (now.get(id)?.entered.entitled !== was.get(id)?.entered.entitled) differs = true;
      }
    }
    expect(differs).toBe(true);
  });

  it('pathwayForNew all streamlined makes every simulated non-Local-Program project streamlined', () => {
    const shares = { discretionary: 0, streamlined: 1, permitOnly: 0 };
    const all: SimInput = {
      ...base,
      newProjects: {
        calibration: routeSharesOp(shares)(base.calibration, base.parcels).cal,
        scale: scaleTable([], 'new')
      }
    };
    const lp = (s: Schedule) => base.parcels.localProgram[base.parcels.index.get(s.parcelIds[0])!];
    let wasOther = 0;
    let checked = 0;
    for (const seed of seeds(20)) {
      for (const s of simulateDetailed(base, seed, H).schedules) {
        if (s.origin === 'simulated' && lp(s) !== 1 && s.pathway !== 'streamlined') wasOther++;
      }
      for (const s of simulateDetailed(all, seed, H).schedules) {
        if (s.origin !== 'simulated' || lp(s) === 1) continue;
        expect(s.pathway).toBe('streamlined');
        checked++;
      }
    }
    expect(wasOther).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(0);
  });
});

describe('engine levers: in-flight remaining time', () => {
  const base = goldenInput();
  const stage = 'permitFiled';
  const rows = base.projects
    .filter((p) => p.pathway === 'permitOnly' && p.stage === stage && !isSkipped(p))
    .map((p) => p.id);
  const withScale = (s: number): SimInput => ({
    ...base,
    inFlightScale: scaleOf('permitOnly', stage, s)
  });

  // The kind and the time are drawn apart (P.STAGE, P.STAGE_TIME), so the scale moves only the
  // time: every row leaves no later, and every row ends the same way.
  it('scale 0.5: every in-flight row leaves no later, with the same outcome, seeds 1-20', () => {
    expect(rows.length).toBeGreaterThan(1);
    const input = withScale(0.5);
    const was: number[] = [];
    const now: number[] = [];
    let earlier = 0;
    for (const seed of seeds(20)) {
      const a0 = byId(simulateDetailed(base, seed, H).schedules);
      const b0 = byId(simulateDetailed(input, seed, H).schedules);
      for (const id of rows) {
        const sa = a0.get(id)!;
        const sb = b0.get(id)!;
        const a = leaveDay(sa, stage);
        const b = leaveDay(sb, stage);
        expect(b, `${seed} ${id}`).toBeGreaterThan(base.asOf);
        expect(b, `${seed} ${id}`).toBeLessThanOrEqual(a);
        if (b < a) earlier++;
        const endOf = (x: Schedule) =>
          x.end.kind === 'exit'
            ? { kind: x.end.kind, stage: x.end.stage, reason: x.end.reason }
            : { kind: x.end.kind };
        expect(endOf(sb), `${seed} ${id}`).toEqual(endOf(sa));
        was.push(a - base.asOf);
        now.push(b - base.asOf);
      }
    }
    expect(earlier).toBeGreaterThanOrEqual(20);
    expect(median(now)).toBeLessThanOrEqual(0.75 * median(was));
  });

  it('the in-flight step is scaledTransition on P.STAGE, P.STAGE_TIME and asOf + 1 − e', () => {
    const s = 0.5;
    const input = withScale(s);
    const t = base.calibration.transitions.permitOnly[stage]!;
    const idx = STAGE_ORDER.indexOf(stage);
    for (const seed of seeds(20)) {
      const got = byId(simulateDetailed(input, seed, H).schedules);
      for (const id of rows) {
        const e = base.projects.find((p) => p.id === id)!.history[stage] ?? base.asOf;
        const stream = streamOf(seedHash(seed), jobEntity(id), 0);
        const r = scaledTransition(
          t,
          drawOn(stream, P.STAGE, idx),
          drawOn(stream, P.STAGE_TIME, idx),
          base.asOf + 1 - e,
          s
        );
        const want: Day = e + r.days;
        expect(leaveDay(got.get(id)!, stage), `${seed} ${id}`).toBe(want > H ? Infinity : want);
      }
    }
  });

  it('scale 1 is the base run', () => {
    const input = withScale(1);
    for (const seed of seeds(20)) {
      expect(simulateDetailed(input, seed, H)).toEqual(simulateDetailed(base, seed, H));
    }
  });
});
