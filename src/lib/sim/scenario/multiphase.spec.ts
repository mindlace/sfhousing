// Multi-phase masters and their phase sub-projects (spec §4.4.3a, §6 `multiphase.spec.ts`,
// AC 18), on the mini fixture's phased rows: the entitled 3-phase master (plan dates after asOf,
// overdue and null; a fourth DA parcel in no phase), the unentitled 2-phase master (phase 1
// planned asOf + 45) and the entitled single-phase master (P = 1).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILL_LEVELS, type ScenarioParcels } from '$lib/data/scenario-codec';
import { parseCalibration, sampleTransition } from '$lib/timelapse/model';
import { parseProjectsFile, type InFlightProject } from '$lib/timelapse/projects';
import {
  PATHWAYS,
  STAGE_ORDER,
  type Calibration,
  type Stage,
  type Transition
} from '$lib/timelapse/types';
import { dayOf } from './dates';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import {
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_PROJECTS,
  miniProjectsJson
} from './fixtures/mini-projects';
import { buildSimInput } from './input';
import { applyPolicies, baseZoning } from './policy';
import { P, draw, jobEntity } from './rng';
import { monthIndexer, monthsOf, shownSeries } from './score';
import { simulate, simulateDetailed, type Master } from './simulate';
import type { Schedule, SimInput } from './types';

const AS_OF = MINI_AS_OF;
const H = MINI_HORIZON;
const F = FILL_LEVELS.length;
const SEEDS = Array.from({ length: 40 }, (_, i) => 1 + i * 7919);
const SEEDS_50 = Array.from({ length: 50 }, (_, i) => 3 + i * 104729);
const E3 = MINI_PROJECTS.entitled3;
const U2 = MINI_PROJECTS.unentitled2;
const S1 = MINI_PROJECTS.singlePhase;
const PHASED = [E3, U2, S1].sort();
const PLANNING: Stage[] = ['preApplication', 'filed', 'entitled'];

const miniCalibration = (): Calibration =>
  parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const miniInput = (cal: Calibration = miniCalibration()): SimInput =>
  buildSimInput({
    parcels: miniCity().parcels,
    projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
    calibration: cal
  });
const withProjects = (
  inp: SimInput,
  f: (ps: InFlightProject[]) => InFlightProject[]
): SimInput => ({ ...inp, projects: f(structuredClone(inp.projects)) });
const editRow = (inp: SimInput, id: string, f: (p: InFlightProject) => InFlightProject) =>
  withProjects(inp, (ps) => ps.map((p) => (p.id === id ? f(p) : p)));
const row = (inp: SimInput, id: string): InFlightProject => inp.projects.find((p) => p.id === id)!;
const masterOf = (ms: Master[], id: string): Master => {
  const m = ms.find((x) => x.masterId === id);
  if (!m) throw new Error(`no master ${id}`);
  return m;
};
const phasesOf = (ss: Schedule[], id: string) =>
  ss.filter((s) => s.phase?.masterId === id).sort((a, b) => a.phase!.index - b.phase!.index);
const gap = (seed: number, masterId: string, i: number, days: number[]) =>
  days[Math.floor(draw(seed, jobEntity(masterId), i, P.PHASE_GAP, 0) * days.length)];
/** E of an entitled master. */
const eOf = (m: Master): number => {
  if (m.end.kind !== 'entitled') throw new Error(`${m.masterId} is not entitled`);
  return m.end.day;
};

/** The §4.4.3a filing days F_i from E, with the PHASE_GAP draws keyed by master and index. */
function expectedFiled(seed: number, p: InFlightProject, E: number, days: number[]): number[] {
  const out: number[] = [];
  for (const [j, ph] of p.phases!.entries()) {
    const i = j + 1;
    const plan = ph.plannedPermitFiled;
    if (plan !== null && plan > AS_OF) out.push(Math.max(plan, E + 1));
    else out.push(Math.max(i === 1 ? E : out[j - 1], AS_OF) + 1 + gap(seed, p.id, i, days));
  }
  return out;
}

/** T11 assessor units over the parcels present in T11. */
function t11Existing(parcels: ScenarioParcels, ids: readonly string[]): number {
  let n = 0;
  for (const id of ids) {
    const i = parcels.index.get(id);
    if (i !== undefined) n += parcels.existingUnits[i];
  }
  return n;
}

const PROVENANCE = miniCalibration().transitions.discretionary.filed!.provenance;
const transition = (t: Omit<Transition, 'provenance' | 'tailProvenance'>): Transition => ({
  ...t,
  provenance: PROVENANCE,
  tailProvenance: PROVENANCE
});
/** Always advances within month 1 (days 0..30). */
const MONTH_ONE = transition({
  months: 1,
  advance: [1],
  exit: {},
  tail: { advance: 0.5, exit: {} }
});
/** Always exits (withdrawn): in month 1 when fresh, at a 0.5 monthly hazard when in flight. */
const ALWAYS_EXIT = transition({
  months: 1,
  advance: [0],
  exit: { withdrawn: [1] },
  tail: { advance: 0, exit: { withdrawn: 0.5 } }
});
/** Always exits (cancelled) in construction. */
const EXIT_AT_BUILD = transition({
  months: 1,
  advance: [0],
  exit: { cancelled: [1] },
  tail: { advance: 0.01, exit: { cancelled: 0.99 } }
});

/** Every transition advances within a month; the listed stages revise with probability 1 at r. */
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
function withHazard(cal: Calibration, z: number): Calibration {
  cal.initiation = { ...cal.initiation, intercept: z, terms: [] };
  return cal;
}

/** Simulated schedules by parcel id. */
function simsOn(ss: Schedule[]): Map<string, Schedule[]> {
  const out = new Map<string, Schedule[]>();
  for (const s of ss) {
    if (s.origin !== 'simulated') continue;
    out.set(s.parcelIds[0], [...(out.get(s.parcelIds[0]) ?? []), s]);
  }
  return out;
}
const firstDay = (s: Schedule) => s.revisions[0].day;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('multi-phase masters (§4.4.3a)', () => {
  it('a master is never a Schedule; phased rows give one Master each, sorted', () => {
    const inp = miniInput();
    for (const seed of SEEDS.slice(0, 10)) {
      const { schedules, masters } = simulateDetailed(inp, seed, H);
      expect(masters.map((m) => m.masterId)).toEqual(PHASED);
      for (const id of PHASED) expect(schedules.some((s) => s.projectId === id)).toBe(false);
      for (const m of masters) {
        const p = row(inp, m.masterId);
        expect(m.pathway).toBe(p.pathway);
        expect(m.phaseUnits).toEqual(p.phases!.map((ph) => ph.units));
        expect(m.phaseFiled).toHaveLength(p.phases!.length);
        for (const st of Object.keys(m.entered) as Stage[]) expect(PLANNING).toContain(st);
      }
    }
  });

  it('an unphased row stays a single project, and the score-only master too', () => {
    const inp = miniInput();
    for (const seed of SEEDS.slice(0, 10)) {
      const { schedules, masters } = simulateDetailed(inp, seed, H);
      for (const id of [MINI_PROJECTS.unphased, MINI_PROJECTS.scoreOnly]) {
        const p = row(inp, id);
        const own = schedules.filter((s) => s.projectId === id || s.phase?.masterId === id);
        expect(own).toHaveLength(1);
        expect(own[0]).toMatchObject({
          projectId: id,
          origin: 'pipeline',
          multiPhase: true,
          phase: null,
          parcelIds: p.parcelIds
        });
        expect(masters.some((m) => m.masterId === id)).toBe(false);
      }
    }
  });

  it('an already-entitled master ends at E: history.entitled, else the first permit-side day, else asOf', () => {
    const base = miniInput();
    const filed = row(base, E3).history.filed!;
    const pf = dayOf(2013, 1, 7);
    const cases: { inp: SimInput; E: number }[] = [
      { inp: base, E: dayOf(2012, 6, 15) },
      {
        inp: editRow(base, E3, (p) => ({
          ...p,
          stage: 'permitIssued',
          history: { filed, permitFiled: pf, permitIssued: pf + 200 }
        })),
        E: pf
      },
      { inp: editRow(base, E3, (p) => ({ ...p, history: { filed } })), E: AS_OF }
    ];
    for (const { inp, E } of cases) {
      for (const seed of SEEDS.slice(0, 5)) {
        const m = masterOf(simulateDetailed(inp, seed, H).masters, E3);
        expect(m.end).toEqual({ kind: 'entitled', day: E });
        expect(m.entered).toEqual({ filed, entitled: E });
      }
    }
    const s1 = masterOf(simulateDetailed(base, 1, H).masters, S1);
    expect(s1.end).toEqual({ kind: 'entitled', day: dayOf(2011, 2, 1) });
  });

  it('an unentitled master steps like its row (entity j:masterId, in-flight) and stops at entitled', () => {
    const inp = miniInput();
    // the same row, unphased: an ordinary pipeline row with the same entity and k = 0
    const single = editRow(inp, U2, (p) => ({ ...p, multiPhase: false, phases: null }));
    const kinds = new Set<string>();
    for (const seed of SEEDS) {
      const m = masterOf(simulateDetailed(inp, seed, H).masters, U2);
      const s = simulate(single, seed, H).find((x) => x.projectId === U2)!;
      kinds.add(m.end.kind);
      expect(m.entered.filed).toBe(row(inp, U2).history.filed);
      if (s.entered.entitled !== undefined) {
        expect(m.end).toEqual({ kind: 'entitled', day: s.entered.entitled });
        expect(m.entered).toEqual({ filed: s.entered.filed, entitled: s.entered.entitled });
      } else {
        expect(m.end).toEqual(s.end);
        expect(m.entered).toEqual({ filed: s.entered.filed });
      }
    }
    expect(kinds.has('entitled')).toBe(true);
  });

  it('F_i follows the plan date, the overdue and null rules and the first-phase rule (PHASE_GAP by master and index)', () => {
    const inp = miniInput();
    const days = inp.calibration.phaseGap.days;
    const gaps = new Set<number>();
    let checked = 0;
    for (const seed of SEEDS) {
      const { schedules, masters } = simulateDetailed(inp, seed, H);
      for (const id of PHASED) {
        const m = masterOf(masters, id);
        if (m.end.kind !== 'entitled') continue;
        const want = expectedFiled(seed, row(inp, id), eOf(m), days);
        expect(m.phaseFiled).toEqual(want.map((d) => (d > H ? null : d)));
        for (const s of phasesOf(schedules, id)) {
          expect(s.entered.permitFiled).toBe(want[s.phase!.index - 1]);
          checked++;
        }
      }
      // literal values on the entitled 3-phase master: the plan date after asOf is used as is,
      // and phases 2 (overdue) and 3 (null) each file one empirical gap after their predecessor
      const f = masterOf(masters, E3).phaseFiled as number[];
      expect(f[0]).toBe(dayOf(2027, 6, 1));
      expect(days).toContain(f[1] - f[0] - 1);
      expect(days).toContain(f[2] - f[1] - 1);
      gaps.add(f[1] - f[0] - 1);
      // P = 1, entitled 2011: one gap after asOf
      expect(days).toContain(masterOf(masters, S1).phaseFiled[0]! - AS_OF - 1);
    }
    expect(checked).toBeGreaterThan(100);
    expect(gaps.size).toBeGreaterThan(2);
  });

  it('a phase that would file after the horizon has no Schedule and a null phaseFiled', () => {
    const inp = miniInput(withHazard(miniCalibration(), -2));
    const h = dayOf(2027, 6, 1) + 10; // phase 1 files on its plan date; phase 2 is ≥ 91 days later
    let elsewhere = 0;
    for (const seed of SEEDS.slice(0, 10)) {
      const { schedules, masters } = simulateDetailed(inp, seed, h);
      const m = masterOf(masters, E3);
      expect(m.phaseFiled).toEqual([dayOf(2027, 6, 1), null, null]);
      expect(phasesOf(schedules, E3).map((s) => s.projectId)).toEqual([`${E3}:phase:1`]);
      // a phase that never files keeps its parcels blocked
      const sims = simsOn(schedules);
      for (const pid of ['3600004', '3600005']) expect(sims.get(pid)).toBeUndefined();
      elsewhere += sims.size;
      for (const s of schedules) {
        for (const d of Object.values(s.entered) as number[]) {
          if (d > AS_OF) expect(d).toBeLessThanOrEqual(h);
        }
      }
    }
    expect(elsewhere).toBeGreaterThan(5); // simulated starts do happen on free parcels
  });

  it('phase Schedules: ids, 1-based index, entered from permitFiled only, T3 and T11 fields', () => {
    const inp = miniInput();
    const p = inp.parcels;
    let n = 0;
    for (const seed of SEEDS) {
      const { schedules, masters } = simulateDetailed(inp, seed, H);
      for (const id of PHASED) {
        const r = row(inp, id);
        const m = masterOf(masters, id);
        const ps = phasesOf(schedules, id);
        const filed = m.phaseFiled.flatMap((d, j) => (d === null ? [] : [j + 1]));
        expect(ps.map((s) => s.phase!.index)).toEqual(filed);
        for (const s of ps) {
          n++;
          const i = s.phase!.index;
          const ph = r.phases![i - 1];
          expect(s).toMatchObject({
            projectId: `${id}:phase:${i}`,
            origin: 'pipeline',
            pathway: r.pathway,
            parcelIds: ph.parcelIds,
            multiPhase: true,
            existingUnits: t11Existing(p, ph.parcelIds),
            phase: { masterId: id, index: i, of: r.phases!.length }
          });
          for (const st of PLANNING) expect(s.entered[st]).toBeUndefined();
          const first = STAGE_ORDER.find((st) => s.entered[st] !== undefined);
          expect(first).toBe('permitFiled');
          expect(s.entered.permitFiled).toBe(m.phaseFiled[i - 1]);
          expect(s.revisions[0]).toEqual({
            day: m.phaseFiled[i - 1],
            units: ph.units,
            stories: null
          });
        }
      }
      // T5: strictly ascending revision days, none after construction; a revision due on the
      // construction-entry day (a 0-day step from permitIssued) is the as-built proposal
      for (const s of schedules.filter((x) => x.phase !== null)) {
        const built = s.entered.construction ?? Infinity;
        for (let j = 1; j < s.revisions.length; j++) {
          expect(s.revisions[j].day).toBeGreaterThan(s.revisions[j - 1].day);
          expect(s.revisions[j].day).toBeLessThanOrEqual(built);
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  it('phase existingUnits are the T11 sums of their own disjoint parcels; P = 1 gives one phase', () => {
    const inp = miniInput();
    const p = inp.parcels;
    const e3 = row(inp, E3);
    expect(e3.phases!.map((ph) => t11Existing(p, ph.parcelIds))).toEqual([0, 0, 5]);
    // N8 / V24: phase parcels are disjoint from each other and from every other row's parcels
    const phaseParcels = inp.projects.flatMap((q) =>
      (q.phases ?? []).flatMap((ph) => ph.parcelIds)
    );
    expect(new Set(phaseParcels).size).toBe(phaseParcels.length);
    const others = new Set(inp.projects.filter((q) => !q.phases).flatMap((q) => q.parcelIds));
    for (const id of phaseParcels) expect(others.has(id)).toBe(false);
    for (const seed of SEEDS.slice(0, 10)) {
      const ps = phasesOf(simulate(inp, seed, H), S1);
      expect(ps).toHaveLength(1);
      expect(ps[0].phase).toMatchObject({ index: 1, of: 1, start: 'estimated' });
      expect(ps[0].existingUnits).toBe(t11Existing(p, ['3600009']));
    }
  });

  it("phase.start is 'scheduled' exactly when F_i is the plan date, including the pushed-to-E + 1 case", () => {
    const inp = miniInput();
    const plan = row(inp, U2).phases![0].plannedPermitFiled!;
    let scheduled = 0;
    let pushed = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const { schedules, masters } = simulateDetailed(inp, seed, H);
      for (const s of schedules) {
        if (s.phase === null) continue;
        const ph = row(inp, s.phase.masterId).phases![s.phase.index - 1];
        const F_i = s.entered.permitFiled!;
        const isPlan =
          ph.plannedPermitFiled !== null &&
          ph.plannedPermitFiled > AS_OF &&
          F_i === ph.plannedPermitFiled;
        expect(s.phase.start).toBe(isPlan ? 'scheduled' : 'estimated');
      }
      const e3 = phasesOf(schedules, E3);
      expect(e3.map((s) => s.phase!.start)).toEqual(
        ['scheduled', 'estimated', 'estimated'].slice(0, e3.length)
      );
      const m = masterOf(masters, U2);
      const p1 = phasesOf(schedules, U2).find((s) => s.phase!.index === 1);
      if (m.end.kind !== 'entitled' || p1 === undefined) continue;
      if (eOf(m) + 1 > plan) {
        pushed++;
        expect(p1.entered.permitFiled).toBe(eOf(m) + 1);
        expect(p1.phase!.start).toBe('estimated');
      } else {
        scheduled++;
        expect(p1.entered.permitFiled).toBe(plan);
        expect(p1.phase!.start).toBe('scheduled');
      }
    }
    expect(pushed).toBeGreaterThan(0);
    expect(scheduled).toBeGreaterThan(0);
  });

  it('twins share E, every F_i, phase stage timing, ends and start (common random numbers)', () => {
    const fzp = miniInput();
    const twin = applyPolicies([baseZoning], fzp);
    for (const seed of SEEDS.slice(0, 20)) {
      const a = simulateDetailed(fzp, seed, H);
      const b = simulateDetailed(twin, seed, H);
      expect(b.masters).toEqual(a.masters);
      const pa = a.schedules.filter((s) => s.phase !== null);
      const pb = b.schedules.filter((s) => s.phase !== null);
      expect(pb.map((s) => [s.projectId, s.entered, s.end, s.phase])).toEqual(
        pa.map((s) => [s.projectId, s.entered, s.end, s.phase])
      );
    }
  });

  it('an unentitled master that exits gives no phases; its parcels are at risk from the exit day', () => {
    const cal = withHazard(miniCalibration(), -2);
    cal.transitions.discretionary.filed = structuredClone(ALWAYS_EXIT);
    const inp = miniInput(cal);
    const parcels = row(inp, U2).parcelIds;
    let after = 0;
    for (const seed of SEEDS) {
      const { schedules, masters } = simulateDetailed(inp, seed, H);
      const m = masterOf(masters, U2);
      expect(m.end).toMatchObject({ kind: 'exit', stage: 'filed', reason: 'withdrawn' });
      expect(m.phaseFiled).toEqual([null, null]);
      expect(m.phaseUnits).toEqual([150, 250]);
      expect(phasesOf(schedules, U2)).toEqual([]);
      const exit = m.end.kind === 'exit' ? m.end.day : NaN;
      // the score: Σ phaseUnits (400) go to exitedUnits on the exit day (§4.5 master bucket)
      const months = monthsOf(AS_OF, H);
      const withM = shownSeries({ schedules, masters }, AS_OF, H, months);
      const others = masters.filter((x) => x !== m);
      const without = shownSeries({ schedules, masters: others }, AS_OF, H, months);
      const at = monthIndexer(months, H)(exit);
      expect(withM.map((r, i) => r.exitedUnits - without[i].exitedUnits)).toEqual(
        months.map((_, i) => (i >= at ? 400 : 0))
      );
      const sims = simsOn(schedules);
      for (const id of parcels) {
        const list = sims.get(id) ?? [];
        after += list.length;
        if (list.length > 0) expect(firstDay(list[0])).toBeGreaterThanOrEqual(exit + 1);
      }
    }
    expect(after).toBeGreaterThan(0);
  });

  it('phases stall and die independently (entity j:<phaseId>, fresh from F_i)', () => {
    const inp = miniInput();
    let mixed = 0;
    for (const seed of SEEDS_50) {
      const ps = phasesOf(simulate(inp, seed, H), E3);
      expect(ps).toHaveLength(3);
      if (new Set(ps.map((s) => s.end.kind)).size > 1) mixed++;
      for (const s of ps) {
        // the first step from permitFiled: one fresh draw on the phase's own entity
        const t = inp.calibration.transitions[s.pathway].permitFiled!;
        const u = draw(
          seed,
          jobEntity(s.projectId),
          0,
          P.STAGE,
          STAGE_ORDER.indexOf('permitFiled')
        );
        const r = sampleTransition(t, u, 0);
        const day = s.entered.permitFiled! + Math.floor(r.days);
        if (day > H) expect(s.end).toEqual({ kind: 'open' });
        else if (r.kind === 'advance') expect(s.entered.permitIssued).toBe(day);
        else expect(s.end).toEqual({ kind: 'exit', stage: 'permitFiled', reason: r.kind, day });
      }
    }
    expect(mixed).toBeGreaterThan(0);
  });

  it('revises phases by the pipeline rule on their own parcels, with stories null', () => {
    // permitIssued is the only revising entry a phase can make (it starts at permitFiled)
    const cap = (inp: SimInput, s: Schedule, units: number) =>
      Math.max(
        units,
        s.parcelIds.reduce(
          (n, id) => n + inp.parcels.yield[inp.parcels.index.get(id)! * F + F - 1],
          0
        )
      );
    let revised = 0;
    let capped = 0;
    for (const ratio of [0.5, 4]) {
      const inp = miniInput(rigged({ permitIssued: ratio }));
      for (const seed of SEEDS.slice(0, 15)) {
        for (const s of simulate(inp, seed, H).filter((x) => x.phase !== null)) {
          const units = row(inp, s.phase!.masterId).phases![s.phase!.index - 1].units;
          const F_i = s.entered.permitFiled!;
          const at = s.entered.permitIssued;
          const r0 = { day: F_i, units, stories: null };
          if (at === undefined) {
            expect(s.revisions).toEqual([r0]);
            continue;
          }
          const u = Math.min(Math.max(1, Math.round(ratio * units)), cap(inp, s, units));
          if (u === units) {
            expect(s.revisions).toEqual([r0]); // e.g. an upsize the parcel's yield cap forbids
            continue;
          }
          revised++;
          if (ratio > 1) capped++;
          const next = { day: at, units: u, stories: null };
          // a permitIssued entry on the filing day merges into revisions[0]
          expect(s.revisions).toEqual(at === F_i ? [{ ...next, day: F_i }] : [r0, next]);
        }
      }
    }
    expect(revised).toBeGreaterThan(20);
    expect(capped).toBeGreaterThan(0); // unentitled2 phase 1: 150 × 4 capped at Σ yield 208
  });
});

describe('multi-phase risk set', () => {
  it('blocks master parcels until the master ends, then holds each phase’s parcels by that phase', () => {
    const inp = miniInput(withHazard(miniCalibration(), -2));
    const e3 = row(inp, E3);
    const noPhase = e3.parcelIds.filter(
      (id) => !e3.phases!.some((ph) => ph.parcelIds.includes(id))
    );
    expect(noPhase).toEqual(['3600006']);
    let freed = 0;
    let blocked = 0;
    for (const seed of SEEDS) {
      const { schedules, masters } = simulateDetailed(inp, seed, H);
      const sims = simsOn(schedules);
      // a master parcel in no phase stays blocked while the master is entitled
      expect(sims.get('3600006')).toBeUndefined();
      for (const id of PHASED) {
        const r = row(inp, id);
        const m = masterOf(masters, id);
        if (m.end.kind === 'exit') continue;
        for (const [j, ph] of r.phases!.entries()) {
          const s = schedules.find((x) => x.projectId === `${id}:phase:${j + 1}`);
          for (const pid of ph.parcelIds) {
            const list = sims.get(pid) ?? [];
            if (s === undefined || s.end.kind !== 'exit') {
              // unfiled, open, complete, or master still open: never at risk
              expect(list).toEqual([]);
              blocked++;
            } else if (list.length > 0) {
              freed++;
              expect(firstDay(list[0])).toBeGreaterThanOrEqual(s.end.day + 1);
            }
          }
        }
      }
    }
    expect(freed).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
  });

  it('an unentitled master still open at the horizon blocks all its parcels', () => {
    const inp = miniInput(withHazard(miniCalibration(), -2));
    const h = AS_OF + 90;
    let open = 0;
    for (const seed of SEEDS) {
      const { schedules, masters } = simulateDetailed(inp, seed, h);
      const m = masterOf(masters, U2);
      if (m.end.kind !== 'open') continue;
      open++;
      expect(m.phaseFiled).toEqual([null, null]);
      const sims = simsOn(schedules);
      for (const pid of row(inp, U2).parcelIds) expect(sims.get(pid)).toBeUndefined();
    }
    expect(open).toBeGreaterThan(0);
  });

  it('a phase that enters construction demolishes its parcel once', () => {
    const cal = withHazard(rigged({}), 0);
    for (const p of PATHWAYS) cal.transitions[p].construction = structuredClone(EXIT_AT_BUILD);
    const inp = miniInput(cal);
    let after = 0;
    for (const seed of SEEDS.slice(0, 10)) {
      const out = simulate(inp, seed, H);
      const p3 = out.find((s) => s.projectId === `${E3}:phase:3`)!;
      expect(p3.existingUnits).toBe(5); // T11 units on 3600005
      expect(p3.end).toMatchObject({ kind: 'exit', stage: 'construction' });
      for (const s of simsOn(out).get('3600005') ?? []) {
        after++;
        expect(s.existingUnits).toBe(0);
        expect(firstDay(s)).toBeGreaterThanOrEqual(p3.end.kind === 'exit' ? p3.end.day + 1 : NaN);
      }
    }
    expect(after).toBeGreaterThan(0);
  });
});
