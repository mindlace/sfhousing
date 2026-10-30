// Plan 2 Task 8: the engine's per-project calibration (ruling 3, "Policy start date") and the
// in-flight remaining-time rescale (ruling 3, "Remaining-time rescale for in-flight stages").
import { describe, expect, it } from 'vitest';
import { sampleTransition } from '$lib/timelapse/model';
import { MONTH_DAYS, monthsIn, type Day } from '$lib/timelapse/time';
import { STAGE_ORDER, type Calibration, type Pathway, type Stage } from '$lib/timelapse/types';
import { routeSharesOp, scaleTable, timersOp, type StageScale } from '../levers/timers';
import { inFlightMonths, isSkipped, nextStage } from './engine';
import { P, drawOn, jobEntity, seedHash, stageRedraw, streamOf } from './rng';
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

function timed(cal: Calibration, input: SimInput, scale: StageScale): Calibration {
  return timersOp(scale)(cal, input.parcels).cal;
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
    for (const seed of [1, 2, 3]) {
      expect(simulateDetailed(input, seed, H)).toEqual(simulateDetailed(base, seed, H));
    }
  });
});

describe('engine levers: newProjects', () => {
  const base = goldenInput();
  const scale = scaleOf('discretionary', 'filed', 0.5);
  const input: SimInput = {
    ...base,
    newProjects: { calibration: timed(base.calibration, base, scale), scale }
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
        expect(nowPipe.get(s.projectId), `${seed} ${s.projectId}`).toEqual(s);
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
    console.log('RATIO', median(now) / median(was));
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
  it('inFlightMonths', () => {
    expect(inFlightMonths(7, 1)).toBe(7);
    expect(inFlightMonths(7, 0.5)).toBe(4);
    expect(inFlightMonths(0, 0.5)).toBe(0);
  });

  const base = goldenInput();
  const stage = 'permitFiled';
  const rows = base.projects
    .filter((p) => p.pathway === 'permitOnly' && p.stage === stage && !isSkipped(p))
    .map((p) => p.id);
  const withScale = (s: number): SimInput => {
    const scale = scaleOf('permitOnly', stage, s);
    return { ...base, calibration: timed(base.calibration, base, scale), inFlightScale: scale };
  };

  // The redraw loop is unchanged (ruling 3), so a rescaled first draw that lands on or before
  // asOf is redrawn independently and can land later than the base draw. That happens only when
  // the base leaves within the redraw window just after asOf (measured over seeds 1-2000: every
  // later leave had a base leave <= asOf + 47 days). Outside a 1/s-month window the rescale never
  // makes a row leave later, and the remaining time shrinks with s.
  it('scale 0.5 makes in-flight rows leave their stage no later, seeds 1-20', () => {
    expect(rows.length).toBeGreaterThan(1);
    const s = 0.5;
    const input = withScale(s);
    const window = base.asOf + Math.ceil(MONTH_DAYS / s);
    const was: number[] = [];
    const now: number[] = [];
    let outside = 0;
    for (const seed of seeds(20)) {
      const a0 = byId(simulateDetailed(base, seed, H).schedules);
      const b0 = byId(simulateDetailed(input, seed, H).schedules);
      for (const id of rows) {
        const a = leaveDay(a0.get(id)!, stage);
        const b = leaveDay(b0.get(id)!, stage);
        expect(b, `${seed} ${id}`).toBeGreaterThan(base.asOf);
        if (a > window) {
          expect(b, `${seed} ${id}`).toBeLessThanOrEqual(a);
          outside++;
        }
        was.push(a - base.asOf);
        now.push(b - base.asOf);
      }
    }
    expect(outside).toBeGreaterThan(20);
    expect(now.filter((d, i) => d <= was[i]).length).toBeGreaterThanOrEqual(0.9 * was.length);
    expect(median(now)).toBeLessThanOrEqual(0.75 * median(was));
  });

  // Pins ruling 3's mapping: condition the rescaled transition on m' = round(m·s) months, then
  // shift the draw back onto the real m months (not "condition on m": that ages the row to m/s).
  it('samples the rescaled stage on m′ months and maps the day back, seeds 1-20', () => {
    const s = 0.5;
    const input = withScale(s);
    const t = input.calibration.transitions.permitOnly[stage]!;
    const idx = STAGE_ORDER.indexOf(stage);
    for (const seed of seeds(20)) {
      const got = byId(simulateDetailed(input, seed, H).schedules);
      for (const id of rows) {
        const e = base.projects.find((p) => p.id === id)!.history[stage] ?? base.asOf;
        const m = monthsIn(e, base.asOf);
        const m2 = inFlightMonths(m, s);
        const stream = streamOf(seedHash(seed), jobEntity(id), 0);
        let want: Day = base.asOf + 1;
        for (let j = 0; j <= 7; j++) {
          const purpose = j === 0 ? P.STAGE : stageRedraw(j as 1 | 2 | 3 | 4 | 5 | 6 | 7);
          const r = sampleTransition(t, drawOn(stream, purpose, idx), m2);
          const day =
            e + Math.floor(r.days) - Math.ceil(m2 * MONTH_DAYS) + Math.ceil(m * MONTH_DAYS);
          if (day > base.asOf) {
            want = day;
            break;
          }
        }
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
