import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { FILL_LEVELS, readScenarioParcels, type ScenarioParcels } from '$lib/data/scenario-codec';
import { packTimedCell } from '$lib/map/pack-timed';
import { cumulativeIncidence, parseCalibration, sampleTransition } from '$lib/timelapse/model';
import { parseProjectsFile, type InFlightProject } from '$lib/timelapse/projects';
import { MONTH_DAYS, monthsIn } from '$lib/timelapse/time';
import {
  EXIT_ORDER,
  PATHWAYS,
  STAGE_ORDER,
  type Calibration,
  type ExitReason,
  type Stage,
  type Transition
} from '$lib/timelapse/types';
import { dayOf } from './dates';
import { addHold, nextStage, pushRevision, revisionRatio, type Holds } from './engine';
import { miniBin } from './fixtures/mini-bin';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import {
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_PROJECTS,
  miniProjectsJson
} from './fixtures/mini-projects';
import { buildSimInput } from './input';
import { P, draw, jobEntity, stageRedraw } from './rng';
import { simulate, simulateDetailed } from './simulate';
import type { Schedule, SimInput } from './types';

const AS_OF = MINI_AS_OF;
const H = MINI_HORIZON;
const F = FILL_LEVELS.length;
const SEEDS = Array.from({ length: 40 }, (_, i) => 1 + i * 7919);

const miniCalibration = (): Calibration =>
  parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const miniFiles = () => ({
  parcels: miniCity().parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: miniCalibration()
});
const miniInput = (): SimInput => buildSimInput(miniFiles());
const withProjects = (
  inp: SimInput,
  f: (ps: InFlightProject[]) => InFlightProject[]
): SimInput => ({
  ...inp,
  projects: f(structuredClone(inp.projects))
});
const withCalibration = (inp: SimInput, cal: Calibration): SimInput => ({
  ...inp,
  calibration: cal
});
const find = (ss: Schedule[], id: string): Schedule => {
  const s = ss.find((x) => x.projectId === id);
  if (!s) throw new Error(`no schedule ${id}`);
  return s;
};
const isSkipped = (p: InFlightProject) =>
  p.stage === 'complete' ||
  (p.pathway === 'permitOnly' && (p.stage === 'filed' || p.stage === 'entitled'));
const isPhased = (p: InFlightProject) => p.multiPhase && p.phases !== null;

/** Σ yield[F − 1] and max envelope stories over the project's parcels present in T11. */
function capsOf(parcels: ScenarioParcels, ids: string[]): { y: number; env: number } {
  let y = 0;
  let env = 0;
  for (const id of ids) {
    const i = parcels.index.get(id);
    if (i === undefined) continue;
    y += parcels.yield[i * F + F - 1];
    env = Math.max(env, parcels.envelopeStories[i]);
  }
  return { y, env };
}

/** The day and kind of the first event after the current stage of a pipeline schedule. */
function firstEvent(
  s: Schedule,
  stage: Stage
): { kind: 'advance' | ExitReason; day: number } | null {
  const n = nextStage(s.pathway, stage);
  const d = s.entered[n];
  if (d !== undefined) return { kind: 'advance', day: d };
  if (s.end.kind === 'exit') return { kind: s.end.reason, day: s.end.day };
  return null;
}

const PROVENANCE = miniCalibration().transitions.discretionary.filed!.provenance;
/** A transition whose whole mass is in month 1 (days 0..30), always an advance. */
const MONTH_ONE: Transition = {
  months: 1,
  advance: [1],
  exit: {},
  tail: { advance: 0.5, exit: {} },
  provenance: PROVENANCE,
  tailProvenance: PROVENANCE
};

/**
 * Every transition advances within a month, and every listed stage revises with probability 1 at
 * a ratio in [r, r + 1e-4): the ratios below map 9 units to known values.
 */
function rigged(ratios: Partial<Record<Stage, number>>): Calibration {
  const cal = miniCalibration();
  for (const p of PATHWAYS) {
    for (const s of Object.keys(cal.transitions[p]) as Exclude<Stage, 'complete'>[]) {
      cal.transitions[p][s] = structuredClone(MONTH_ONE);
    }
  }
  cal.revision.at = (Object.entries(ratios) as [Stage, number][]).map(([stage, r]) => ({
    stage,
    probability: 1,
    ratio:
      r > 1
        ? { edges: [1, r, r + 1e-4], probs: [0, 1] }
        : { edges: [r, r + 1e-4, 1], probs: [1, 0] }
  }));
  return cal;
}

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('nextStage', () => {
  it('follows STAGE_ORDER, with permitOnly going from preApplication to permitFiled', () => {
    expect(nextStage('discretionary', 'preApplication')).toBe('filed');
    expect(nextStage('streamlined', 'preApplication')).toBe('filed');
    expect(nextStage('permitOnly', 'preApplication')).toBe('permitFiled');
    for (const p of PATHWAYS) {
      expect(nextStage(p, 'filed')).toBe('entitled');
      expect(nextStage(p, 'entitled')).toBe('permitFiled');
      expect(nextStage(p, 'permitFiled')).toBe('permitIssued');
      expect(nextStage(p, 'permitIssued')).toBe('construction');
      expect(nextStage(p, 'construction')).toBe('complete');
    }
    expect(() => nextStage('discretionary', 'complete')).toThrow();
  });
});

describe('revisionRatio', () => {
  it('picks the bin by cumulative mass and places the residual uniformly in it', () => {
    const h = { edges: [0.5, 1, 2], probs: [0.25, 0.75] };
    expect(revisionRatio(h, 0.1)).toBeCloseTo(0.7, 12);
    expect(revisionRatio(h, 0.25)).toBe(1);
    expect(revisionRatio(h, 0.625)).toBeCloseTo(1.5, 12);
    expect(revisionRatio({ edges: [1, 2, 3], probs: [0, 1] }, 0.3)).toBeCloseTo(2.3, 12);
    // u above a sum that rounded below 1: the top of the last bin with mass
    expect(revisionRatio({ edges: [1, 2, 3], probs: [0.5, 0.4999999] }, 0.99999995)).toBe(3);
    expect(revisionRatio({ edges: [1], probs: [] }, 0.5)).toBe(1);
  });
});

describe('pushRevision (same-day merge)', () => {
  it('appends a later day, replaces a same-day entry and drops a merge back to its predecessor', () => {
    const revs = [{ day: 10, units: 9, stories: 6 }];
    pushRevision(revs, 20, 18, 12);
    expect(revs).toEqual([
      { day: 10, units: 9, stories: 6 },
      { day: 20, units: 18, stories: 12 }
    ]);
    pushRevision(revs, 20, 27, 14);
    expect(revs).toEqual([
      { day: 10, units: 9, stories: 6 },
      { day: 20, units: 27, stories: 14 }
    ]);
    pushRevision(revs, 20, 9, 6);
    expect(revs).toEqual([{ day: 10, units: 9, stories: 6 }]);
    // revisions[0] keeps its day and is never removed
    pushRevision(revs, 10, 9, null);
    expect(revs).toEqual([{ day: 10, units: 9, stories: null }]);
  });
});

describe('addHold', () => {
  it('records, per T11 row, the latest holder exit, a blocking end and the first construction', () => {
    const { parcels } = miniCity();
    const holds: Holds = new Map();
    const a = parcels.index.get('3512012')!;
    const b = parcels.index.get('3512005')!;
    addHold(
      holds,
      parcels,
      ['3512012', '9900001'],
      { construction: 500 },
      {
        kind: 'exit',
        stage: 'construction',
        reason: 'cancelled',
        day: 900
      }
    );
    expect(holds.get(a)).toEqual({ lastExit: 900, blocked: false, demolished: 500 });
    addHold(
      holds,
      parcels,
      ['3512012'],
      { construction: 400 },
      {
        kind: 'exit',
        stage: 'construction',
        reason: 'cancelled',
        day: 800
      }
    );
    expect(holds.get(a)).toEqual({ lastExit: 900, blocked: false, demolished: 400 });
    addHold(holds, parcels, ['3512012', '3512005'], {}, { kind: 'open' });
    expect(holds.get(a)).toEqual({ lastExit: 900, blocked: true, demolished: 400 });
    expect(holds.get(b)).toEqual({ lastExit: null, blocked: true, demolished: null });
    expect(holds.size).toBe(2); // the absent parcel holds nothing
  });
});

describe('simulate: pipeline projects', () => {
  it('gives the same output across runs and after a JSON round trip of the files', async () => {
    const a = simulate(miniInput(), 42, H);
    expect(simulate(miniInput(), 42, H)).toEqual(a);
    const files = miniFiles();
    const again = buildSimInput({
      parcels: await readScenarioParcels(miniBin()),
      projects: parseProjectsFile(JSON.parse(JSON.stringify(miniProjectsJson())), {
        onInvalid() {}
      }),
      calibration: parseCalibration(JSON.parse(JSON.stringify(files.calibration)))
    });
    expect(simulate(again, 42, H)).toEqual(a);
    expect(simulate(miniInput(), 43, H)).not.toEqual(a);
  });

  it('simulate is simulateDetailed(...).schedules, pipeline first, sorted by projectId', () => {
    const inp = miniInput();
    const d = simulateDetailed(inp, 5, H);
    expect(simulate(inp, 5, H)).toEqual(d.schedules);
    const ids = d.schedules.map((s) => s.projectId);
    expect(ids).toEqual([...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    expect(d.schedules.every((s) => s.origin === 'pipeline')).toBe(true);
    expect(d.masters).toEqual([]);
  });

  it('covers every runnable unphased row, skips complete and invalid rows, copies T3 fields', () => {
    const inp = miniInput();
    const out = simulate(inp, 3, H);
    const expected = inp.projects
      .filter((p) => !isSkipped(p) && !isPhased(p))
      .map((p) => p.id)
      .sort();
    expect(out.map((s) => s.projectId)).toEqual(expected);
    expect(out.some((s) => s.projectId === MINI_PROJECTS.invalid)).toBe(false);
    expect(out.some((s) => s.projectId === MINI_PROJECTS.complete)).toBe(false);
    for (const s of out) {
      const p = inp.projects.find((q) => q.id === s.projectId)!;
      expect(s).toMatchObject({
        origin: 'pipeline',
        parcelIds: p.parcelIds,
        pathway: p.pathway,
        existingUnits: p.existingUnits,
        multiPhase: p.multiPhase,
        phase: null
      });
      expect(s.revisions[0]).toEqual({
        day: Math.min(...Object.values(p.history)),
        units: p.units,
        stories: p.stories
      });
    }
    // the score-only last-resort master and the drawn one are ordinary rows here
    expect(find(out, MINI_PROJECTS.scoreOnly).parcelIds).toEqual([]);
    expect(find(out, MINI_PROJECTS.unphased).multiPhase).toBe(true);
  });

  it('logs the skipped count once per input', () => {
    const inp = withProjects(miniInput(), (ps) => {
      const p = ps.find((q) => q.id === MINI_PROJECTS.permitFiled)!;
      return [...ps, { ...p, id: 'BP:999', stage: 'filed', history: { filed: AS_OF - 10 } }];
    });
    simulate(inp, 1, H);
    simulate(inp, 2, H);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('skipped 2 ');
    simulate(miniInput(), 1, H);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain('skipped 1 ');
    expect(simulate(inp, 1, H).some((s) => s.projectId === 'BP:999')).toBe(false);
  });

  it('keeps history days, puts every future day and end in (asOf, horizon]', () => {
    const inp = withProjects(miniInput(), (ps) =>
      ps.map((p) => (p.id === MINI_PROJECTS.filedPair ? { ...p, history: {} } : p))
    );
    const bad: string[] = [];
    for (const seed of SEEDS) {
      for (const s of simulate(inp, seed, H)) {
        const p = inp.projects.find((q) => q.id === s.projectId)!;
        let prev = -Infinity;
        for (const st of STAGE_ORDER) {
          const d = s.entered[st];
          if (d === undefined) continue;
          if (d < prev) bad.push(`${seed} ${s.projectId} ${st} before its predecessor`);
          prev = d;
          const h = p.history[st];
          if (h !== undefined) {
            if (d !== h) bad.push(`${seed} ${s.projectId} history ${st} ${d} != ${h}`);
          } else if (st === p.stage) {
            if (d !== AS_OF) bad.push(`${seed} ${s.projectId} missing ${st} not asOf`);
          } else if (!(d > AS_OF && d <= H)) bad.push(`${seed} ${s.projectId} ${st} ${d}`);
        }
        if (s.end.kind !== 'open' && !(s.end.day > AS_OF && s.end.day <= H)) {
          bad.push(`${seed} ${s.projectId} end ${s.end.day}`);
        }
        if (s.end.kind === 'complete' && s.end.day !== s.entered.complete) {
          bad.push(`${seed} ${s.projectId} complete day`);
        }
      }
      const fp = find(simulate(inp, seed, H), MINI_PROJECTS.filedPair);
      expect(fp.entered.filed).toBe(AS_OF);
      expect(fp.revisions[0].day).toBe(AS_OF);
    }
    expect(bad).toEqual([]);
  });

  it('revises only on a future entry of a revising stage, before construction', () => {
    const inp = miniInput();
    const revStages = inp.calibration.revision.at.map((a) => a.stage);
    const bad: string[] = [];
    let later = 0;
    for (const seed of SEEDS) {
      for (const s of simulate(inp, seed, H)) {
        const entered = Object.values(s.entered) as number[];
        if (s.revisions[0].day !== Math.min(...entered)) bad.push(`${s.projectId} [0] day`);
        for (let i = 0; i < s.revisions.length; i++) {
          const r = s.revisions[i];
          if (!(Number.isInteger(r.units) && r.units >= 1)) bad.push(`${s.projectId} units`);
          if (i === 0) continue;
          later++;
          if (r.day <= s.revisions[i - 1].day) bad.push(`${s.projectId} not ascending`);
          if (!(r.day > AS_OF)) bad.push(`${s.projectId} revision at ${r.day} <= asOf`);
          if (!revStages.some((st) => s.entered[st] === r.day)) {
            bad.push(`${s.projectId} revision ${r.day} not on a revising stage entry`);
          }
          const c = s.entered.construction;
          if (c !== undefined && r.day >= c) bad.push(`${s.projectId} revision on/after build`);
          if (r.units === s.revisions[i - 1].units) bad.push(`${s.projectId} no-op revision`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(later).toBeGreaterThan(20);
  });

  it('never revises on entering construction, even if a calibration lists it', () => {
    // parseCalibration rejects such an entry; the engine does not rely on that.
    const inp = withCalibration(miniInput(), rigged({ construction: 0.5 }));
    let built = 0;
    for (const seed of SEEDS.slice(0, 10)) {
      for (const s of simulate(inp, seed, H)) {
        if (s.entered.construction !== undefined && s.entered.construction > AS_OF) built++;
        expect(s.revisions).toHaveLength(1);
      }
    }
    expect(built).toBeGreaterThan(0);
  });

  it('permitOnly schedules never enter filed or entitled', () => {
    const inp = miniInput();
    let n = 0;
    for (const seed of SEEDS) {
      for (const s of simulate(inp, seed, H)) {
        if (s.pathway !== 'permitOnly') continue;
        n++;
        expect(s.entered.filed).toBeUndefined();
        expect(s.entered.entitled).toBeUndefined();
      }
    }
    expect(n).toBeGreaterThan(0);
  });

  it('caps pipeline upsizes at max(units, Σ yield[F − 1]) and the envelope; null stories stay null', () => {
    const base = miniInput();
    const inp = withCalibration(
      base,
      rigged({ filed: 4, entitled: 4, permitFiled: 4, permitIssued: 4 })
    );
    const bad: string[] = [];
    let atCap = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      for (const s of simulate(inp, seed, H)) {
        const p = inp.projects.find((q) => q.id === s.projectId)!;
        const { y, env } = capsOf(inp.parcels, p.parcelIds);
        for (let i = 1; i < s.revisions.length; i++) {
          const r = s.revisions[i];
          const prev = s.revisions[i - 1];
          if (r.units > Math.max(p.units, y)) bad.push(`${s.projectId} ${r.units} > cap`);
          if (p.stories === null && r.stories !== null) bad.push(`${s.projectId} stories`);
          if (r.units > prev.units && prev.stories !== null && r.stories !== null) {
            if (r.stories > Math.max(prev.stories, env)) bad.push(`${s.projectId} storeys cap`);
          }
          if (r.units === y && y > p.units) atCap++;
        }
        if (y === 0 && s.revisions.length !== 1) bad.push(`${s.projectId} grew with no parcel`);
      }
      const es = find(simulate(inp, seed, H), MINI_PROJECTS.entitledStreamlined);
      expect(es.revisions.at(-1)!.units).toBe(109); // 9 → 36 → 144, capped at Σ yield 109
    }
    expect(bad).toEqual([]);
    expect(atCap).toBeGreaterThan(0);
  });

  it('a parcel id absent from T11 is ignored, not thrown on (Review Focus 1)', () => {
    const out = simulate(miniInput(), 9, H);
    expect(find(out, MINI_PROJECTS.absentOnly).parcelIds).toEqual(['9900001']);
    expect(find(out, MINI_PROJECTS.absentMixed).parcelIds).toEqual(['3600014', '9900002']);
  });

  it('clamps a history day after asOf to asOf (Review Focus 5)', () => {
    const inp = withProjects(miniInput(), (ps) =>
      ps.map((p) =>
        p.id === MINI_PROJECTS.sharedExisting ? { ...p, history: { filed: AS_OF + 30 } } : p
      )
    );
    for (const seed of SEEDS.slice(0, 10)) {
      const s = find(simulate(inp, seed, H), MINI_PROJECTS.sharedExisting);
      expect(s.entered.filed).toBe(AS_OF);
      expect(s.revisions[0].day).toBe(AS_OF);
      const ev = firstEvent(s, 'filed');
      if (ev) expect(ev.day).toBeGreaterThan(AS_OF);
      else expect(s.end).toEqual({ kind: 'open' });
    }
  });
});

describe('simulate: same-day revisions (IA-4)', () => {
  const ES = MINI_PROJECTS.entitledStreamlined; // 9 units, 6 storeys, Σ yield 109, envelope 14
  const seeds = Array.from({ length: 600 }, (_, i) => i);
  const massings = (s: Schedule) =>
    s.revisions.map(() => ({
      footprint: [
        [-122.4, 37.7],
        [-122.4, 37.7001],
        [-122.3999, 37.7001],
        [-122.3999, 37.7]
      ] as [number, number][]
    }));
  const packAll = (ss: Schedule[]) =>
    packTimedCell(
      'all',
      ss.map((s) => ({ schedule: s, massings: massings(s), pickParcelId: s.parcelIds[0] ?? '' }))
    );

  function split(inp: SimInput) {
    const same: Schedule[] = [];
    const apart: Schedule[] = [];
    for (const seed of seeds) {
      const out = simulate(inp, seed, H);
      for (const s of out) {
        for (let i = 1; i < s.revisions.length; i++) {
          expect(s.revisions[i].day).toBeGreaterThan(s.revisions[i - 1].day);
        }
      }
      expect(() => packAll(out)).not.toThrow();
      const s = find(out, ES);
      expect(s.entered.permitIssued).toBeDefined();
      (s.entered.permitFiled === s.entered.permitIssued ? same : apart).push(s);
    }
    expect(same.length).toBeGreaterThan(0);
    expect(apart.length).toBeGreaterThan(0);
    return { same, apart };
  }

  it('merges a same-day revision into the last entry: the last wins', () => {
    const inp = withCalibration(miniInput(), rigged({ permitFiled: 2, permitIssued: 1.5 }));
    const { same, apart } = split(inp);
    const r0 = { day: dayOf(2024, 2, 1), units: 9, stories: 6 };
    for (const s of apart) {
      expect(s.revisions).toEqual([
        r0,
        { day: s.entered.permitFiled, units: 18, stories: 12 },
        { day: s.entered.permitIssued, units: 27, stories: 14 }
      ]);
    }
    for (const s of same) {
      expect(s.revisions).toEqual([r0, { day: s.entered.permitFiled, units: 27, stories: 14 }]);
    }
  });

  it('removes a merged entry that returns to its predecessor', () => {
    const inp = withCalibration(miniInput(), rigged({ permitFiled: 2, permitIssued: 0.5 }));
    const { same, apart } = split(inp);
    const r0 = { day: dayOf(2024, 2, 1), units: 9, stories: 6 };
    for (const s of apart) {
      expect(s.revisions).toEqual([
        r0,
        { day: s.entered.permitFiled, units: 18, stories: 12 },
        { day: s.entered.permitIssued, units: 9, stories: 6 }
      ]);
    }
    for (const s of same) expect(s.revisions).toEqual([r0]);
  });
});

describe('simulate: in-flight redraw (§4.4.2)', () => {
  const FP = MINI_PROJECTS.filedPair;
  const FILED = STAGE_ORDER.indexOf('filed');

  it('redraws a first draw that lands on or before asOf and accepts a day after asOf', () => {
    const inp = miniInput();
    const t = inp.calibration.transitions.discretionary.filed!;
    const e = dayOf(2025, 11, 20);
    const m = monthsIn(e, AS_OF);
    expect(m).toBe(10);
    const ent = jobEntity(FP);
    const attempt = (seed: number, j: number) =>
      sampleTransition(
        t,
        draw(seed, ent, 0, j === 0 ? P.STAGE : stageRedraw(j as 1 | 2 | 3 | 4 | 5 | 6 | 7), FILED),
        m
      );
    const seed = Array.from({ length: 5000 }, (_, i) => i).find(
      (s) => e + attempt(s, 0).days <= AS_OF
    );
    expect(seed).toBeDefined();
    let accepted: { kind: string; days: number } | null = null;
    for (let j = 1; j <= 7 && !accepted; j++) {
      const r = attempt(seed!, j);
      if (e + r.days > AS_OF) accepted = r;
    }
    expect(accepted).not.toBeNull();
    const s = find(simulate(inp, seed!, H), FP);
    const ev = firstEvent(s, 'filed')!;
    expect(ev.day).toBeGreaterThan(AS_OF);
    expect(ev).toEqual({ kind: accepted!.kind, day: e + accepted!.days });
  });

  it('falls back to asOf + 1 when all 8 attempts land on or before asOf', () => {
    const cal = miniCalibration();
    cal.transitions.discretionary.filed = structuredClone(MONTH_ONE);
    const e = AS_OF - 30; // m = 0, and the whole month-1 mass (days 0..30) is on or before asOf
    expect(monthsIn(e, AS_OF)).toBe(0);
    expect(Math.ceil(MONTH_DAYS) - 1).toBe(30);
    const inp = withProjects(withCalibration(miniInput(), cal), (ps) =>
      ps.map((p) => (p.id === FP ? { ...p, history: { filed: e } } : p))
    );
    for (const seed of SEEDS) {
      expect(find(simulate(inp, seed, H), FP).entered.entitled).toBe(AS_OF + 1);
    }
  });

  it('20,000 in-flight projects match the incidence conditioned on survival to asOf', () => {
    const base = miniInput();
    const t = base.calibration.transitions.discretionary.filed!;
    const N = 20000;
    const e = AS_OF - 330; // like filedPair: m = 10, 26 of month 11's days on or before asOf
    const m = monthsIn(e, AS_OF);
    expect(m).toBe(10);
    const template = base.projects.find((p) => p.id === FP)!;
    const inp: SimInput = {
      ...base,
      projects: Array.from({ length: N }, (_, i) => ({
        ...template,
        id: `PRJ:syn-${i}`,
        parcelIds: [],
        history: { filed: e }
      }))
    };
    const events = simulate(inp, 2026, AS_OF + 400 * 365).map((s) => firstEvent(s, 'filed'));
    expect(events.every((ev) => ev !== null && ev.day > AS_OF)).toBe(true);

    // F_j at asOf: month 11's integer days are equally likely, so interpolate by rejected days.
    const first = Math.ceil(m * MONTH_DAYS);
    const end = Math.ceil((m + 1) * MONTH_DAYS);
    const frac = (AS_OF - e - first + 1) / (end - first);
    const kinds = ['advance', ...EXIT_ORDER.filter((r) => t.exit[r] !== undefined)] as const;
    const Fk = (k: number, j: string) => {
      const c = cumulativeIncidence(t, k);
      return j === 'advance' ? c.advance : (c.exit[j as ExitReason] ?? 0);
    };
    const Fa = (j: string) => Fk(m, j) + frac * (Fk(m + 1, j) - Fk(m, j));
    const Ca = kinds.reduce((acc, j) => acc + Fa(j), 0);
    for (const k of [11, 12, 14, 18, 24, 36]) {
      for (const j of kinds) {
        const expected = (Fk(k, j) - Fa(j)) / (1 - Ca);
        const got = events.filter((ev) => ev!.kind === j && monthsIn(e, ev!.day) < k).length / N;
        const se = Math.sqrt((expected * (1 - expected)) / N);
        expect(Math.abs(got - expected), `${j} by month ${k}`).toBeLessThanOrEqual(4 * se + 1 / N);
      }
    }
  });
});
