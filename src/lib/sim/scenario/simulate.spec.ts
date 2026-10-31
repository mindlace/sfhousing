import { describe, expect, it, vi } from 'vitest';
import {
  FILL_LEVELS,
  fillStories,
  readScenarioParcels,
  type ScenarioParcels
} from '$lib/data/scenario-codec';
import { packTimedCell } from '$lib/map/pack-timed';
import { log } from '$lib/timelapse/math';
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
import {
  addHold,
  isSkipped as engineSkips,
  nextStage,
  pushRevision,
  revisionRatio,
  type Holds
} from './engine';
import { miniBin } from './fixtures/mini-bin';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import {
  MINI_INELIGIBLE_ID,
  MINI_NO_ENVELOPE_ID,
  MINI_NO_GAIN_ID,
  miniCity
} from './fixtures/mini-parcels';
import {
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_PROJECTS,
  miniProjectsJson
} from './fixtures/mini-projects';
import { scaleTable } from '../levers/timers';
import { buildSimInput, precomputeOf } from './input';
import { P, draw, jobEntity, simEntity, stageRedraw } from './rng';
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
const pipelineOf = (ss: Schedule[]) => ss.filter((s) => s.origin === 'pipeline');
/** Pipeline Schedules of T3 rows themselves (not phase sub-projects of a master). */
const rowsOf = (ss: Schedule[]) => pipelineOf(ss).filter((s) => s.phase === null);
const simulatedOf = (ss: Schedule[]) => ss.filter((s) => s.origin === 'simulated');

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

  it('throws on a day before the last entry, leaving the list unchanged', () => {
    const revs = [
      { day: 10, units: 9, stories: 6 },
      { day: 20, units: 18, stories: 12 }
    ];
    expect(() => pushRevision(revs, 19, 27, 14)).toThrow(/before/);
    expect(revs).toEqual([
      { day: 10, units: 9, stories: 6 },
      { day: 20, units: 18, stories: 12 }
    ]);
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
    const n = d.schedules.findIndex((s) => s.origin === 'simulated');
    expect(n).toBeGreaterThan(0);
    const pipe = d.schedules.slice(0, n);
    const sim = d.schedules.slice(n);
    expect(pipe.every((s) => s.origin === 'pipeline')).toBe(true);
    expect(sim.every((s) => s.origin === 'simulated')).toBe(true);
    for (const block of [pipe, sim]) {
      const ids = block.map((s) => s.projectId);
      expect(ids).toEqual([...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    }
    // the phased rows are Masters, never Schedules (multiphase.spec.ts covers them)
    const phased = inp.projects.filter((p) => isPhased(p)).map((p) => p.id);
    expect(d.masters.map((m) => m.masterId)).toEqual([...phased].sort());
    expect(d.schedules.some((s) => phased.includes(s.projectId))).toBe(false);
  });

  it('covers every runnable unphased row, skips complete and invalid rows, copies T3 fields', () => {
    const inp = miniInput();
    const d = simulateDetailed(inp, 3, H);
    const out = rowsOf(d.schedules);
    const expected = inp.projects
      .filter((p) => !isSkipped(p) && !isPhased(p))
      .map((p) => p.id)
      .sort();
    expect(out.map((s) => s.projectId)).toEqual(expected);
    // the only other pipeline Schedules are the phases that filed by the horizon
    const phases = d.masters
      .flatMap((m) =>
        m.phaseFiled.flatMap((f, j) => (f === null ? [] : [`${m.masterId}:phase:${j + 1}`]))
      )
      .sort();
    expect(phases.length).toBeGreaterThan(0);
    expect(
      pipelineOf(d.schedules)
        .filter((s) => s.phase !== null)
        .map((s) => s.projectId)
    ).toEqual(phases);
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

  it('runs no skipped row and writes nothing to the console (the load logs the count)', () => {
    const inp = withProjects(miniInput(), (ps) => {
      const p = ps.find((q) => q.id === MINI_PROJECTS.permitFiled)!;
      return [...ps, { ...p, id: 'BP:999', stage: 'filed', history: { filed: AS_OF - 10 } }];
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const out = simulate(inp, 1, H);
      simulate(inp, 2, H);
      expect(out.some((s) => s.projectId === 'BP:999')).toBe(false);
      // the predicate load.ts counts with is the engine's own, and matches §4.4.3
      const skipped = inp.projects.filter(engineSkips).map((p) => p.id);
      expect(skipped).toEqual([MINI_PROJECTS.complete, 'BP:999']);
      expect(skipped).toEqual(inp.projects.filter(isSkipped).map((p) => p.id));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps history days, puts every future day and end in (asOf, horizon]', () => {
    const inp = withProjects(miniInput(), (ps) =>
      ps.map((p) => (p.id === MINI_PROJECTS.filedPair ? { ...p, history: {} } : p))
    );
    const bad: string[] = [];
    for (const seed of SEEDS) {
      for (const s of rowsOf(simulate(inp, seed, H))) {
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
          // T5: none after construction; a revision due on the construction-entry day (a 0-day
          // step from the revising stage) is the as-built proposal.
          const c = s.entered.construction;
          if (c !== undefined && r.day > c) bad.push(`${s.projectId} revision after build`);
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
      for (const s of rowsOf(simulate(inp, seed, H))) {
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
    const events = pipelineOf(simulate(inp, 2026, AS_OF + 400 * 365)).map((s) =>
      firstEvent(s, 'filed')
    );
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

/** The calibration with a constant monthly initiation hazard 1 / (1 + exp(−z)) on every parcel. */
function withHazard(cal: Calibration, z: number): Calibration {
  cal.initiation = { ...cal.initiation, intercept: z, terms: [] };
  return cal;
}
const firstDay = (s: Schedule) => s.revisions[0].day;
const firstStage = (s: Schedule) => STAGE_ORDER.find((st) => s.entered[st] !== undefined)!;

/** Simulated schedules by parcel, in k order; checks the id, k sequence and fixed fields. */
function simsByParcel(ss: Schedule[]): Map<string, Schedule[]> {
  const out = new Map<string, Schedule[]>();
  const bad: string[] = [];
  for (const s of simulatedOf(ss)) {
    const m = /^sim:(.+):(\d+)$/.exec(s.projectId);
    if (!m) throw new Error(`bad simulated id ${s.projectId}`);
    if (s.parcelIds.length !== 1 || s.parcelIds[0] !== m[1]) bad.push(`${s.projectId} parcels`);
    if (s.multiPhase || s.phase !== null) bad.push(`${s.projectId} phase fields`);
    out.set(m[1], [...(out.get(m[1]) ?? []), s]);
  }
  for (const [pid, list] of out) {
    const k = (s: Schedule) => Number(s.projectId.slice(`sim:${pid}:`.length));
    list.sort((a, b) => k(a) - k(b));
    list.forEach((s, j) => {
      if (k(s) !== j) bad.push(`${s.projectId} is not k = ${j}`);
    });
  }
  expect(bad).toEqual([]);
  return out;
}

/** The smallest level whose yield reaches `units` (the simulated revision's stories rule). */
function levelFor(parcels: ScenarioParcels, i: number, units: number): number {
  for (let f = 0; f < F; f++) if (parcels.yield[i * F + f] >= units) return f;
  return -1;
}

describe('simulate: simulated initiation (§4.4.4)', () => {
  it('initiates only on hostable parcels with a hazard; a Local Program parcel is streamlined', () => {
    const inp = withCalibration(miniInput(), withHazard(miniCalibration(), -2));
    const pre = precomputeOf(inp);
    const p = inp.parcels;
    const bad: string[] = [];
    const nonLp = new Set<string>();
    const starts = new Set<string>();
    let lp = 0;
    let n = 0;
    for (const seed of SEEDS.slice(0, 20)) {
      for (const [pid, list] of simsByParcel(simulate(inp, seed, H))) {
        const i = p.index.get(pid)!;
        if (p.hostable[i] !== 1 || !(pre.hazard[i] > 0)) bad.push(`${pid} initiated`);
        for (const s of list) {
          n++;
          starts.add(`${s.pathway} ${firstStage(s)}`);
          if (p.localProgram[i] === 1) {
            lp++;
            if (s.pathway !== 'streamlined') bad.push(`${s.projectId} ${s.pathway}`);
          } else nonLp.add(s.pathway);
          if (firstDay(s) !== s.entered[firstStage(s)]) bad.push(`${s.projectId} revisions[0]`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(n).toBeGreaterThan(500);
    expect(lp).toBeGreaterThan(0);
    expect([...nonLp].sort()).toEqual(['discretionary', 'permitOnly', 'streamlined']);
    // ppaShare: discretionary 0.1, the others 0
    expect([...starts].sort()).toEqual([
      'discretionary filed',
      'discretionary preApplication',
      'permitOnly permitFiled',
      'streamlined filed'
    ]);
    for (const id of [MINI_NO_GAIN_ID, MINI_NO_ENVELOPE_ID, MINI_INELIGIBLE_ID]) {
      expect(pre.hazard[p.index.get(id)!]).toBe(0);
    }
  });

  it('follows the risk set: held parcels wait for the last exit, k + 1 after an exit, done after a completion', () => {
    const inp = withCalibration(miniInput(), withHazard(miniCalibration(), -2));
    // rows the engine does not run hold their parcels for the whole horizon
    const skippedParcels = new Set(inp.projects.filter(isSkipped).flatMap((p) => p.parcelIds));
    expect(skippedParcels.has('2999A007')).toBe(true); // the complete row, on a hostable parcel
    const bad: string[] = [];
    let freed = 0;
    let reinit = 0;
    let heldOut = 0;
    for (const seed of SEEDS) {
      const out = simulate(inp, seed, H);
      const holders = new Map<string, Schedule[]>();
      for (const s of pipelineOf(out)) {
        for (const id of s.parcelIds) holders.set(id, [...(holders.get(id) ?? []), s]);
      }
      const sims = simsByParcel(out);
      for (const [pid, hs] of holders) {
        if (hs.some((h) => h.end.kind !== 'exit') && inp.parcels.index.has(pid)) heldOut++;
      }
      for (const [pid, list] of sims) {
        if (skippedParcels.has(pid)) bad.push(`${seed} ${pid} held by a skipped row`);
        const hs = holders.get(pid) ?? [];
        if (hs.some((h) => h.end.kind !== 'exit')) bad.push(`${seed} ${pid} held to the horizon`);
        const exits = hs.map((h) => (h.end.kind === 'exit' ? h.end.day : AS_OF));
        const from = Math.max(AS_OF, ...exits);
        if (hs.length > 0) freed++;
        if (!(firstDay(list[0]) >= from + 1)) bad.push(`${seed} ${pid} starts before ${from + 1}`);
        for (let j = 0; j < list.length; j++) {
          const s = list[j];
          for (const d of Object.values(s.entered) as number[]) {
            if (!(d > AS_OF && d <= H)) bad.push(`${s.projectId} day ${d}`);
          }
          if (j === list.length - 1) continue;
          if (s.end.kind !== 'exit') {
            bad.push(`${s.projectId} ended ${s.end.kind} but ${list[j + 1].projectId} follows`);
            continue;
          }
          reinit++;
          if (!(firstDay(list[j + 1]) >= s.end.day + 1)) bad.push(`${list[j + 1].projectId} day`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(freed).toBeGreaterThan(0);
    expect(reinit).toBeGreaterThan(0);
    expect(heldOut).toBeGreaterThan(0);
  });

  it('never draws a size at or below existingUnits; revisions keep the floor, the cap and the level stories', () => {
    const down = withHazard(
      rigged({ filed: 0.1, entitled: 0.1, permitFiled: 0.1, permitIssued: 0.1 }),
      -2
    );
    const up = withHazard(rigged({ filed: 4, entitled: 4, permitFiled: 4, permitIssued: 4 }), -2);
    const bad: string[] = [];
    const seen = { floor: 0, cap: 0, revised: 0 };
    for (const cal of [down, up, withHazard(miniCalibration(), -2)]) {
      const inp = withCalibration(miniInput(), cal);
      const p = inp.parcels;
      for (const seed of SEEDS.slice(0, 15)) {
        for (const [pid, list] of simsByParcel(simulate(inp, seed, H))) {
          const i = p.index.get(pid)!;
          const env = p.envelopeStories[i];
          const top = Math.max(...p.yield.subarray(i * F, i * F + F)); // the ruled cap
          for (const s of list) {
            const ex = s.existingUnits;
            const r0 = s.revisions[0];
            const level = FILL_LEVELS.findIndex(
              (fill, f) => p.yield[i * F + f] === r0.units && fillStories(fill, env) === r0.stories
            );
            // a revision on a stage entered the same day as the first stage merges into [0]
            const merged = STAGE_ORDER.some(
              (st) => st !== firstStage(s) && s.entered[st] === r0.day
            );
            if (level < 0 && !merged) bad.push(`${s.projectId} size ${r0.units} is no level`);
            if (!(r0.units > ex)) bad.push(`${s.projectId} size ${r0.units} <= ${ex}`);
            // [0] is the size draw, or (merged, no level) a revision held to the same rules
            for (const r of level < 0 ? s.revisions : s.revisions.slice(1)) {
              seen.revised++;
              if (r.units < ex + 1) bad.push(`${s.projectId} ${r.units} below the floor`);
              if (r.units > top) bad.push(`${s.projectId} ${r.units} above max yield`);
              const f = levelFor(p, i, r.units);
              if (r.stories !== fillStories(FILL_LEVELS[f], env))
                bad.push(`${s.projectId} stories`);
              if (cal === down && r.units === ex + 1 && ex > 0) seen.floor++;
              if (cal === up && r.units === top) seen.cap++;
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
    expect(seen.floor).toBeGreaterThan(0);
    expect(seen.cap).toBeGreaterThan(0);
    expect(seen.revised).toBeGreaterThan(100);
  });

  it('caps at the largest level on non-monotone yields: no forced downsize, never net-negative', () => {
    // Ruling: spec §4.4.5's simulated cap is max_f yield[f], not yield[F − 1]. On the free LP
    // parcel 0026T007, yields [4, 48, 90, 76, 60] with 70 existing units: the size draw allows only
    // level 2 (90) and level 3 (76); a yield[F − 1] cap would force every revision down to 60.
    const files = miniFiles();
    const i = files.parcels.index.get('0026T007')!;
    files.parcels.yield.set([4, 48, 90, 76, 60], i * F);
    files.parcels.existingUnits[i] = 70;
    const env = files.parcels.envelopeStories[i];
    const up = withHazard(rigged({ entitled: 1.5, permitFiled: 1.5, permitIssued: 1.5 }), -2);
    const down = withHazard(rigged({ entitled: 0.1, permitFiled: 0.1, permitIssued: 0.1 }), -2);
    const bad: string[] = [];
    let fromLevel2 = 0;
    for (const cal of [up, down]) {
      const inp = buildSimInput({ ...files, calibration: cal });
      for (const seed of SEEDS.slice(0, 15)) {
        for (const s of simsByParcel(simulate(inp, seed, H)).get('0026T007') ?? []) {
          if (s.existingUnits !== 70) bad.push(`${s.projectId} existing ${s.existingUnits}`);
          for (const [j, r] of s.revisions.entries()) {
            if (r.units <= 70) bad.push(`${s.projectId} ${r.units} <= existingUnits`);
            if (r.units > 90) bad.push(`${s.projectId} ${r.units} above the cap`);
            const f = levelFor(files.parcels, i, r.units);
            if (j > 0 && r.stories !== fillStories(FILL_LEVELS[f], env)) bad.push(`${s.projectId}`);
            if (cal === up && j > 0 && r.units < s.revisions[j - 1].units) {
              bad.push(`${s.projectId} upsize forced down to ${r.units}`);
            }
          }
          const last = s.revisions.at(-1)!;
          if (cal === up) {
            // from 90: ×1.5 is capped at 90, no change; from 76: ×1.5 → 90 (level 2 stories)
            if (last.units !== 90) bad.push(`${s.projectId} ends at ${last.units}`);
            // drawn at level 2 (no same-day merge into [0]), revised on entering entitled
            const r0 = s.revisions[0];
            if (r0.units === 90 && s.entered.entitled !== r0.day) fromLevel2++;
          } else if (last.units !== 71) bad.push(`${s.projectId} downsized to ${last.units}`);
        }
      }
    }
    expect(bad).toEqual([]);
    expect(fromLevel2).toBeGreaterThan(0);
  });
});

describe('simulate: demolished once (§4.4.6)', () => {
  // Every stage advances within a month except construction, which always exits: each simulated
  // project demolishes its parcel, dies in construction, and the parcel is at risk again.
  const EXIT_AT_BUILD: Transition = {
    months: 1,
    advance: [0],
    exit: { cancelled: [1] },
    tail: { advance: 0.01, exit: { cancelled: 0.99 } },
    provenance: PROVENANCE,
    tailProvenance: PROVENANCE
  };
  const RAISED = '0026T011'; // yields [4, 11, 11, 11, 11]; existing raised from 2 to 5 below
  const BUILT = '2999A005'; // the pipeline project in construction since 2024 (existing 3)

  function demolishInput(): SimInput {
    const files = miniFiles();
    files.parcels.existingUnits[files.parcels.index.get(RAISED)!] = 5;
    const cal = withHazard(rigged({}), 0);
    for (const p of PATHWAYS) cal.transitions[p].construction = structuredClone(EXIT_AT_BUILD);
    return buildSimInput({ ...files, calibration: cal });
  }

  it('a re-initiated project takes 0 existing units, and only one schedule subtracts them', () => {
    const inp = demolishInput();
    const p = inp.parcels;
    expect(inp.projects.find((q) => q.id === MINI_PROJECTS.construction)!.parcelIds).toEqual([
      BUILT
    ]);
    const bad: string[] = [];
    let again = 0;
    let smallAfter = 0;
    let builtSims = 0;
    for (const seed of SEEDS.slice(0, 10)) {
      const out = simulate(inp, seed, H);
      const pipeParcels = new Set(pipelineOf(out).flatMap((s) => s.parcelIds));
      const sims = simsByParcel(out);
      for (const [pid, list] of sims) {
        const ex = p.existingUnits[p.index.get(pid)!];
        if (pid === BUILT) {
          builtSims += list.length;
          // demolished at the pipeline project's construction start, before asOf
          if (list.some((s) => s.existingUnits !== 0)) bad.push(`${seed} ${pid} not demolished`);
          continue;
        }
        if (pipeParcels.has(pid)) continue;
        if (list[0].existingUnits !== ex) bad.push(`${list[0].projectId} existing`);
        let subtracted = 0;
        for (const [j, s] of list.entries()) {
          if (s.entered.construction !== undefined) subtracted += s.existingUnits;
          if (j === 0) continue;
          again++;
          if (s.existingUnits !== 0) bad.push(`${s.projectId} existing ${s.existingUnits}`);
          if (pid === RAISED && s.revisions[0].units === 4) smallAfter++;
        }
        if (list[0].entered.construction !== undefined && subtracted !== ex) {
          bad.push(`${seed} ${pid} subtracted ${subtracted} of ${ex}`);
        }
        if (list.length > 1 && list[0].entered.construction === undefined) {
          bad.push(`${seed} ${pid} re-initiated without a demolition`);
        }
        // level 0 (4 units) is not a gain over 5 existing units, so only a later project uses it
        if (pid === RAISED && list[0].revisions[0].units <= 5) bad.push(`${pid} k = 0 size`);
      }
    }
    expect(bad).toEqual([]);
    expect(again).toBeGreaterThan(100);
    expect(builtSims).toBeGreaterThan(0);
    expect(smallAfter).toBeGreaterThan(0);
  });

  it('pins the §4.4.1 draw keys of the k = 0 and k = 1 projects on a free parcel', () => {
    // The rig has no revisions, so revisions[0] is the size draw; construction always exits.
    const inp = demolishInput();
    const p = inp.parcels;
    const cal = inp.calibration;
    // even PPA odds on every pathway, so a wrong PPA key changes the first stage often
    cal.ppaShare = { ...cal.ppaShare, discretionary: 0.5, streamlined: 0.5, permitOnly: 0.5 };
    const id = '3512002'; // free, hostable, not Local Program, 0 existing units
    const i = p.index.get(id)!;
    expect(p.localProgram[i]).toBe(0);
    const pre = precomputeOf(inp);
    const ent = simEntity(id);
    const l1mh = log(1 - pre.hazard[i]);
    const dayOfK = (seed: number, k: number, r: number) => {
      const T = Math.max(1, Math.ceil(log(1 - draw(seed, ent, k, P.INIT, 0)) / l1mh));
      return r + 1 + Math.floor((T - 1 + draw(seed, ent, k, P.INIT_DAY, 0)) * MONTH_DAYS);
    };
    const pathwayOfK = (seed: number, k: number) => {
      const w = cal.pathwayForNew;
      const x = draw(seed, ent, k, P.PATHWAY, 0) * PATHWAYS.reduce((a, q) => a + w[q], 0);
      let acc = 0;
      return PATHWAYS.find((q) => x < (acc += w[q]))!;
    };
    const expected = (seed: number, k: number, r: number) => {
      const pathway = pathwayOfK(seed, k);
      const first =
        draw(seed, ent, k, P.PPA, 0) < cal.ppaShare[pathway]
          ? 'preApplication'
          : pathway === 'permitOnly'
            ? 'permitFiled'
            : 'filed';
      const u = draw(seed, ent, k, P.SIZE, 0);
      const f = FILL_LEVELS.findIndex((_, g) => u < pre.sizeCum[i * F + g]);
      const day = dayOfK(seed, k, r);
      return {
        day,
        pathway,
        first,
        r0: {
          day,
          units: p.yield[i * F + f],
          stories: fillStories(FILL_LEVELS[f], p.envelopeStories[i])
        }
      };
    };
    for (const seed of SEEDS.slice(0, 16)) {
      const out = simulate(inp, seed, H);
      let r = AS_OF;
      for (const k of [0, 1]) {
        const s = find(out, `sim:${id}:${k}`);
        const e = expected(seed, k, r);
        expect({
          day: firstDay(s),
          pathway: s.pathway,
          first: firstStage(s),
          r0: s.revisions[0]
        }).toEqual({ day: e.day, pathway: e.pathway, first: e.first, r0: e.r0 });
        expect(s.end.kind).toBe('exit');
        if (s.end.kind === 'exit') r = s.end.day;
      }
    }
  });
});

describe('simulate: score-only master (DQ-3)', () => {
  it('has a Schedule with no parcels and blocks no parcel', () => {
    const inp = withCalibration(miniInput(), withHazard(miniCalibration(), -2));
    const without = withProjects(inp, (ps) => ps.filter((q) => q.id !== MINI_PROJECTS.scoreOnly));
    for (const seed of SEEDS.slice(0, 10)) {
      const out = simulate(inp, seed, H);
      const so = find(out, MINI_PROJECTS.scoreOnly);
      expect(so.origin).toBe('pipeline');
      expect(so.parcelIds).toEqual([]);
      expect(simulatedOf(out)).toEqual(simulatedOf(simulate(without, seed, H)));
    }
  });
});

describe('simulate: in-flight cohort flag (Call 15)', () => {
  it('no newProjects, no inFlight flag', () => {
    for (const seed of [1, 2, 3]) {
      const ss = simulate(miniInput(), seed, H);
      expect(ss.length).toBeGreaterThan(0);
      for (const s of ss) expect('inFlight' in s, s.projectId).toBe(false);
    }
  });

  it('with newProjects, flags pipeline rows past preApplication and phases, nothing else', () => {
    const base = miniInput();
    const input: SimInput = {
      ...base,
      newProjects: { calibration: base.calibration, scale: scaleTable([], 'new') }
    };
    const stageOf = new Map(base.projects.map((p) => [p.id, p.stage]));
    let flagged = 0;
    let ppa = 0;
    let phases = 0;
    for (const seed of [1, 2, 3]) {
      const ss = simulate(input, seed, H);
      expect(simulatedOf(ss).length).toBeGreaterThan(0);
      for (const s of simulatedOf(ss)) expect('inFlight' in s, s.projectId).toBe(false);
      for (const s of pipelineOf(ss)) {
        if (s.phase !== null) {
          expect(s.inFlight, s.projectId).toBe(true);
          phases++;
        } else if (stageOf.get(s.projectId) === 'preApplication') {
          expect('inFlight' in s, s.projectId).toBe(false);
          ppa++;
        } else {
          expect(s.inFlight, s.projectId).toBe(true);
          flagged++;
        }
      }
    }
    expect(flagged).toBeGreaterThan(0);
    expect(ppa).toBeGreaterThan(0);
    expect(phases).toBeGreaterThan(0);
  });
});
