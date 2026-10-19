// Determinism and invariance properties of the engine (spec §6 `simulate.property.spec.ts`,
// AC 1), and the fast path: `simulateNet` must equal the score of `simulateDetailed` exactly
// (§4.4.7) on every month of all three net series.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { FILL_LEVELS, type ScenarioParcels } from '$lib/data/scenario-codec';
import { parseCalibration } from '$lib/timelapse/model';
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
import { MINI_AS_OF, MINI_HORIZON, miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput } from './input';
import { applyPolicies, baseZoning } from './policy';
import { monthsOf, netOf, shownSeries, type NetSeries } from './score';
import { simulateDetailed, simulateNet } from './simulate';
import type { Schedule, SimInput } from './types';

const H = MINI_HORIZON;
const F = FILL_LEVELS.length;
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

const miniCalibration = (): Calibration =>
  parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const miniFiles = () => ({
  parcels: miniCity().parcels,
  projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
  calibration: miniCalibration()
});
const miniInput = (): SimInput => buildSimInput(miniFiles());
const withCalibration = (inp: SimInput, calibration: Calibration): SimInput => ({
  ...inp,
  calibration
});
const withProjects = (inp: SimInput, projects: InFlightProject[]): SimInput => ({
  ...inp,
  projects
});

const baseTwin = (input: SimInput): SimInput => applyPolicies([baseZoning], input);

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
/** Construction always exits within a month: every project demolishes, then dies building. */
const EXIT_AT_BUILD: Transition = {
  months: 1,
  advance: [0],
  exit: { cancelled: [1] },
  tail: { advance: 0.01, exit: { cancelled: 0.99 } },
  provenance: PROVENANCE,
  tailProvenance: PROVENANCE
};

/**
 * Every transition advances within a month (so 0-day steps put two stage entries on one day),
 * and every listed stage revises with probability 1 at a ratio in [r, r + 1e-4) (as in
 * simulate.spec.ts).
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
function withHazard(cal: Calibration, z: number): Calibration {
  cal.initiation = { ...cal.initiation, intercept: z, terms: [] };
  return cal;
}
/** The demolished-once rig of simulate.spec.ts: construction always exits; 0026T011 has 5. */
function demolishInput(): SimInput {
  const files = miniFiles();
  files.parcels.existingUnits[files.parcels.index.get('0026T011')!] = 5;
  const cal = withHazard(rigged({}), 0);
  for (const p of PATHWAYS) cal.transitions[p].construction = structuredClone(EXIT_AT_BUILD);
  return buildSimInput({ ...files, calibration: cal });
}

const reference = (inp: SimInput, seed: number, months: number[]): NetSeries =>
  netOf(shownSeries(simulateDetailed(inp, seed, H), inp.asOf, H, months));

const SERIES = ['completedNet', 'completedNetNew', 'entitledNew'] as const;

/** Two stage entries on one day: the condition for a same-day revision merge. */
const hasTie = (s: Schedule) => {
  const days = STAGE_ORDER.map((st) => s.entered[st]).filter((d) => d !== undefined);
  return new Set(days).size < days.length;
};

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe('simulateNet equals the score of simulateDetailed (§4.4.7)', () => {
  const months = monthsOf(MINI_AS_OF, H);
  const cases: [string, () => SimInput][] = [
    ['FZP', miniInput],
    [
      'same-day merge, the last wins',
      () =>
        withCalibration(
          miniInput(),
          withHazard(rigged({ filed: 1.5, entitled: 2, permitFiled: 2, permitIssued: 1.5 }), -2)
        )
    ],
    [
      'same-day merge back to the predecessor',
      () =>
        withCalibration(
          miniInput(),
          withHazard(rigged({ entitled: 2, permitFiled: 0.5, permitIssued: 2 }), -2)
        )
    ],
    ['demolished once', demolishInput]
  ];

  for (const [name, make] of cases) {
    for (const [variant, view] of [
      ['FZP', (i: SimInput) => i],
      ['baseZoning twin', baseTwin]
    ] as const) {
      it(`${name} (${variant}): all three series, every month, seeds 1..50`, () => {
        const inp = view(make());
        const bad: string[] = [];
        const finals = { completedNet: 0, completedNetNew: 0, entitledNew: 0 };
        for (const seed of SEEDS) {
          const net = simulateNet(inp, seed, H, months);
          const ref = reference(inp, seed, months);
          for (const k of SERIES) {
            expect(net[k]).toBeInstanceOf(Int32Array);
            expect(net[k].length).toBe(months.length);
            const a = Array.from(net[k]);
            const b = Array.from(ref[k]);
            const i = a.findIndex((v, j) => v !== b[j]);
            if (i >= 0) bad.push(`seed ${seed} ${k}[${i}]: ${a[i]} vs ${b[i]}`);
            if (ref[k][months.length - 1] !== 0) finals[k]++;
          }
        }
        expect(bad).toEqual([]);
        // not vacuous: every series moves in some run
        expect(finals.completedNet).toBeGreaterThan(0);
        expect(finals.completedNetNew).toBeGreaterThan(0);
        expect(finals.entitledNew).toBeGreaterThan(0);
      });
    }
  }

  it('the rigs exercise what they are named for', () => {
    const merged = withCalibration(
      miniInput(),
      withHazard(rigged({ filed: 1.5, entitled: 2, permitFiled: 2, permitIssued: 1.5 }), -2)
    );
    let ties = 0;
    let simTiesOnEntitled = 0;
    for (const seed of SEEDS.slice(0, 10)) {
      for (const s of simulateDetailed(merged, seed, H).schedules) {
        if (!hasTie(s)) continue;
        ties++;
        const e = s.entered.entitled;
        if (s.origin === 'simulated' && e !== undefined && s.revisions.some((r) => r.day === e))
          simTiesOnEntitled++;
      }
    }
    expect(ties).toBeGreaterThan(10);
    expect(simTiesOnEntitled).toBeGreaterThan(0);

    const dem = demolishInput();
    let again = 0;
    for (const seed of SEEDS.slice(0, 10)) {
      for (const s of simulateDetailed(dem, seed, H).schedules) {
        if (s.origin !== 'simulated') continue;
        const i = dem.parcels.index.get(s.parcelIds[0])!;
        if (dem.parcels.existingUnits[i] > 0 && s.existingUnits === 0) again++;
      }
    }
    expect(again).toBeGreaterThan(10);
  });

  it('the cached month table follows the months array and the horizon; outputs are fresh', () => {
    const inp = miniInput();
    const twin = baseTwin(inp);
    const short = dayOf(2035, 6, 30);
    const shortMonths = monthsOf(MINI_AS_OF, short);
    const first = simulateNet(inp, 7, H, months);
    const snapshot = SERIES.map((k) => Array.from(first[k]));
    simulateNet(twin, 8, H, months);
    simulateNet(inp, 9, short, shortMonths);
    const shortRef = netOf(
      shownSeries(simulateDetailed(inp, 9, short), MINI_AS_OF, short, shortMonths)
    );
    const shortNet = simulateNet(inp, 9, short, shortMonths);
    for (const k of SERIES) expect(Array.from(shortNet[k])).toEqual(Array.from(shortRef[k]));
    // one months array with an earlier horizon in its last month, then the later one: a table
    // kept from the earlier horizon would end on its day and throw on any later net event
    const end = dayOf(2028, 6, 30);
    const jun1 = dayOf(2028, 6, 1);
    const busy = withCalibration(miniInput(), withHazard(miniCalibration(), -2));
    let late = 0; // runs with a net event after jun1, which a stale table would reject
    for (const seed of SEEDS) {
      const fresh = monthsOf(MINI_AS_OF, end); // not yet cached: its first table is for jun1
      expect(monthsOf(MINI_AS_OF, jun1)).toEqual(fresh);
      const early = simulateNet(busy, seed, jun1, fresh);
      const earlyRef = netOf(
        shownSeries(simulateDetailed(busy, seed, jun1), MINI_AS_OF, jun1, fresh)
      );
      for (const k of SERIES) expect(Array.from(early[k])).toEqual(Array.from(earlyRef[k]));
      const full = simulateNet(busy, seed, end, fresh);
      const fullRef = netOf(shownSeries(simulateDetailed(busy, seed, end), MINI_AS_OF, end, fresh));
      for (const k of SERIES) expect(Array.from(full[k])).toEqual(Array.from(fullRef[k]));
      const n = fresh.length - 1;
      if (SERIES.some((k) => early[k][n] !== full[k][n])) late++;
    }
    expect(late).toBeGreaterThan(0);
    const again = simulateNet(inp, 7, H, months);
    expect(SERIES.map((k) => Array.from(again[k]))).toEqual(snapshot);
    // the arrays a caller holds are its own: a later run does not overwrite them
    expect(SERIES.map((k) => Array.from(first[k]))).toEqual(snapshot);
    expect(again.completedNet).not.toBe(first.completedNet);
  });

  it('the baseZoning twin differs from the FZP view, so both variants count', () => {
    const inp = miniInput();
    const twin = baseTwin(inp);
    const differs = (a: ArrayLike<number>, b: ArrayLike<number>) =>
      Array.from(a).some((v, i) => v !== b[i]);
    expect(differs(inp.parcels.hostable, twin.parcels.hostable)).toBe(true);
    expect(differs(inp.parcels.yield, twin.parcels.yield)).toBe(true);
    const runsDiffer = SEEDS.some((seed) => {
      const a = simulateNet(inp, seed, H, months);
      const b = simulateNet(twin, seed, H, months);
      return SERIES.some((k) => differs(a[k], b[k]));
    });
    expect(runsDiffer).toBe(true);
  });
});

/** Every Schedule by id. */
const byId = (ss: Schedule[]) => new Map(ss.map((s) => [s.projectId, s]));

/**
 * A copy of `p` with rows `rows` of the source (in that order) and the given ids: duplicating a
 * row under a new id adds a parcel. Every column is selected by row; `cells` collapses to the
 * single cell `cellOf` names per output row (the engine never reads cells).
 */
function selectRows(
  p: ScenarioParcels,
  rows: number[],
  ids: string[],
  cellOf: (j: number) => string
): ScenarioParcels {
  const n = rows.length;
  const pick = <
    T extends Float64Array | Float32Array | Uint8Array | Uint16Array | Uint32Array | Int16Array
  >(
    col: T,
    stride: number
  ): T => {
    const out = new (col.constructor as new (n: number) => T)(n * stride);
    for (let j = 0; j < n; j++)
      out.set(col.subarray(rows[j] * stride, (rows[j] + 1) * stride), j * stride);
    return out;
  };
  const cellIds = [...new Set(rows.map((_, j) => cellOf(j)))];
  const cell = new Uint16Array(n);
  for (let j = 0; j < n; j++) cell[j] = cellIds.indexOf(cellOf(j));
  const cells = cellIds.map((cellId, c) => {
    const start = cell.indexOf(c);
    return { cellId, start, count: cell.filter((x) => x === c).length };
  });
  const out: ScenarioParcels = {
    ...p,
    count: n,
    cells,
    id: ids,
    index: new Map(ids.map((id, j) => [id, j])),
    labelPoint: pick(p.labelPoint, 2),
    cell,
    district: pick(p.district, 1),
    envelopeStories: pick(p.envelopeStories, 1),
    baseStories: pick(p.baseStories, 1),
    localProgram: pick(p.localProgram, 1),
    hostable: pick(p.hostable, 1),
    eligible: pick(p.eligible, 1),
    split: pick(p.split, 1),
    imputed: pick(p.imputed, 1),
    baseCap: pick(p.baseCap, 1),
    existingUnits: pick(p.existingUnits, 1),
    existingFloorAreaM2: pick(p.existingFloorAreaM2, 1),
    existingStories: pick(p.existingStories, 1),
    lotAreaM2: pick(p.lotAreaM2, 1),
    yearBuilt: pick(p.yearBuilt, 1),
    improvementShare: pick(p.improvementShare, 1),
    rentControlLikely: pick(p.rentControlLikely, 1),
    landUseClass: pick(p.landUseClass, 1),
    hostableBase: pick(p.hostableBase, 1),
    baseYield: pick(p.baseYield, F),
    yield: pick(p.yield, F),
    potentialRatio: { fzp: pick(p.potentialRatio.fzp, 1), base: pick(p.potentialRatio.base, 1) },
    storiesGap: { fzp: pick(p.storiesGap.fzp, 1), base: pick(p.storiesGap.base, 1) }
  };
  // a column added to ScenarioParcels later and not listed above would keep the source's length
  // through `...p` and misalign every row: make that loud
  const columns = (o: object, at: string): [string, ArrayBufferView & { length: number }][] =>
    Object.entries(o).flatMap(([k, v]) =>
      ArrayBuffer.isView(v)
        ? [[`${at}${k}`, v as ArrayBufferView & { length: number }]]
        : v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Map)
          ? columns(v, `${at}${k}.`)
          : []
    );
  const src = new Map(columns(p, ''));
  for (const [k, col] of columns(out, '')) {
    const stride = src.get(k)!.length / p.count;
    if (col.length !== n * stride) throw new Error(`selectRows: column ${k} was not selected`);
  }
  return out;
}

describe('unrelated input changes never alter another schedule (AC 1)', () => {
  // A high hazard, so most hostable parcels carry simulated projects the changes could disturb.
  const busy = () => withCalibration(miniInput(), withHazard(miniCalibration(), -2));
  const FEW = SEEDS.slice(0, 5);
  const isRunnable = (p: InFlightProject) =>
    !(
      p.stage === 'complete' ||
      (p.pathway === 'permitOnly' && (p.stage === 'filed' || p.stage === 'entitled'))
    );

  it('is deterministic: the same input and seed give the same run', () => {
    for (const seed of FEW) {
      expect(simulateDetailed(busy(), seed, H)).toEqual(simulateDetailed(busy(), seed, H));
    }
  });

  it('shuffling the projects leaves the run identical', () => {
    for (const seed of FEW) {
      const inp = busy();
      const base = simulateDetailed(inp, seed, H);
      const ps = inp.projects;
      for (const order of [[...ps].reverse(), ps.map((_, i) => ps[(i * 7 + seed) % ps.length])]) {
        expect(new Set(order).size).toBe(ps.length);
        expect(simulateDetailed(withProjects(inp, order), seed, H)).toEqual(base);
      }
    }
  });

  it('reordering the parcel rows leaves the run identical', () => {
    for (const seed of FEW) {
      const inp = busy();
      const p = inp.parcels;
      const rows = Array.from({ length: p.count }, (_, i) => p.count - 1 - i);
      const parcels = selectRows(
        p,
        rows,
        rows.map((r) => p.id[r]),
        () => 'all'
      );
      const run = simulateDetailed({ ...inp, parcels }, seed, H);
      expect(run).toEqual(simulateDetailed(inp, seed, H));
      expect(run.schedules.some((s) => s.origin === 'simulated')).toBe(true);
    }
  });

  it('adding an unrelated parcel in its own cell adds only its own projects', () => {
    const NEW = '9998A001';
    let added = 0;
    for (const seed of FEW) {
      const inp = busy();
      const p = inp.parcels;
      const donor = p.index.get('0026T011')!; // hostable, gains homes
      const rows = [...Array.from({ length: p.count }, (_, i) => i), donor];
      const parcels = selectRows(p, rows, [...p.id, NEW], (j) =>
        j < p.count ? p.cells[p.cell[j]].cellId : '99_99'
      );
      const base = byId(simulateDetailed(inp, seed, H).schedules);
      const now = simulateDetailed({ ...inp, parcels }, seed, H);
      const mine = now.schedules.filter((s) => s.parcelIds.includes(NEW));
      added += mine.length;
      expect(
        mine.every((s) => s.origin === 'simulated' && s.projectId.startsWith(`sim:${NEW}:`))
      ).toBe(true);
      const rest = now.schedules.filter((s) => !s.parcelIds.includes(NEW));
      expect(byId(rest)).toEqual(base);
    }
    expect(added).toBeGreaterThan(0);
  });

  it('removing an unrelated parcel removes only its own projects', () => {
    // 3512008: open space, not hostable; 0026T011: hostable and busy. Neither is on any project.
    let dropped = 0;
    for (const [id, hostable] of [
      ['3512008', 0],
      ['0026T011', 1]
    ] as const) {
      for (const seed of FEW) {
        const inp = busy();
        const p = inp.parcels;
        const gone = p.index.get(id)!;
        expect(p.hostable[gone]).toBe(hostable);
        expect(inp.projects.some((q) => q.parcelIds.includes(id))).toBe(false);
        const rows = Array.from({ length: p.count }, (_, i) => i).filter((i) => i !== gone);
        const parcels = selectRows(
          p,
          rows,
          rows.map((r) => p.id[r]),
          (j) => p.cells[p.cell[rows[j]]].cellId
        );
        expect(parcels.index.has(id)).toBe(false);
        const base = simulateDetailed(inp, seed, H);
        const now = simulateDetailed({ ...inp, parcels }, seed, H);
        const own = (s: Schedule) => s.projectId.startsWith(`sim:${id}:`);
        dropped += base.schedules.filter(own).length;
        expect(now.schedules.some((s) => s.parcelIds.includes(id))).toBe(false);
        expect(byId(now.schedules)).toEqual(byId(base.schedules.filter((s) => !own(s))));
        expect(now.masters).toEqual(base.masters);
      }
    }
    // not vacuous: the hostable parcel had projects to lose
    expect(dropped).toBeGreaterThan(0);
  });

  it('adding an unrelated project adds only its own schedule', () => {
    for (const seed of FEW) {
      const inp = busy();
      const donor = inp.projects.find((q) => isRunnable(q) && !q.multiPhase)!;
      const extra: InFlightProject = {
        ...structuredClone(donor),
        id: 'NEW:2026-999999PRJ',
        parcelIds: ['9998A101'] // absent from T11: holds nothing
      };
      const base = simulateDetailed(inp, seed, H);
      const now = simulateDetailed(withProjects(inp, [...inp.projects, extra]), seed, H);
      const mine = now.schedules.filter((s) => s.projectId === extra.id);
      expect(mine).toHaveLength(1);
      expect(byId(now.schedules.filter((s) => s.projectId !== extra.id))).toEqual(
        byId(base.schedules)
      );
      expect(now.masters).toEqual(base.masters);
    }
  });

  it('removing a project changes only it and the simulated projects on its parcels', () => {
    let freed = 0;
    for (const seed of FEW.slice(0, 3)) {
      const inp = busy();
      const base = simulateDetailed(inp, seed, H);
      for (const q of inp.projects) {
        const touched = new Set([
          ...q.parcelIds,
          ...(q.phases ?? []).flatMap((ph) => ph.parcelIds)
        ]);
        const own = (s: Schedule) =>
          s.projectId === q.id ||
          s.projectId.startsWith(`${q.id}:phase:`) ||
          (s.origin === 'simulated' && touched.has(s.parcelIds[0]));
        const now = simulateDetailed(
          withProjects(
            inp,
            inp.projects.filter((x) => x !== q)
          ),
          seed,
          H
        );
        expect(byId(now.schedules.filter((s) => !own(s)))).toEqual(
          byId(base.schedules.filter((s) => !own(s)))
        );
        expect(now.schedules.some((s) => s.projectId === q.id)).toBe(false);
        expect(now.masters).toEqual(base.masters.filter((m) => m.masterId !== q.id));
        const before = base.schedules.filter((s) => own(s) && s.origin === 'simulated').length;
        const after = now.schedules.filter((s) => own(s) && s.origin === 'simulated').length;
        if (after > before) freed++;
      }
    }
    // not vacuous: some removals free parcels that then host new projects
    expect(freed).toBeGreaterThan(0);
  });
});
