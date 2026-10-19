// The time-aware score (T8, spec §4.3 and §4.5, §6 `score.spec.ts`, AC 5–6): hand-built
// Schedules and Masters with known days give exact per-month deltas for every series; the mini
// fixture gives the phasing table, the split identity and demolished-once.
import { describe, expect, it } from 'vitest';
import { M1_TARGETS } from '$lib/scoreboard';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import {
  PATHWAYS,
  STAGE_ORDER,
  type Calibration,
  type Stage,
  type Transition
} from '$lib/timelapse/types';
import { dayOf, isoOf } from './dates';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import {
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_PROJECTS,
  miniProjectsJson
} from './fixtures/mini-projects';
import { buildSimInput } from './input';
import {
  REFERENCES,
  RHNA_DEADLINE,
  assembleScore,
  monthIndexer,
  monthsOf,
  netOf,
  phasingOf,
  planEffectOf,
  shownSeries,
  targetsOf
} from './score';
import { simulateDetailed, type Master } from './simulate';
import type { Schedule, SimInput, TimelineScore } from './types';

const AS_OF = MINI_AS_OF; // 2026-10-16
const H = MINI_HORIZON; // 2050-12-31
const MONTHS = monthsOf(AS_OF, H);
const N = MONTHS.length;
const d = dayOf;

type Shown = TimelineScore['shown'];
type Live = Exclude<Stage, 'complete'>;
const LIVE = STAGE_ORDER.filter((s): s is Live => s !== 'complete');
const SERIES = [
  'completedNet',
  'completedNetPipeline',
  'completedNetNew',
  'entitledNew',
  'exitedUnits'
] as const;
type Key = (typeof SERIES)[number] | Live;

/** A cumulative series from hand-computed per-month deltas `[i, delta]`. */
function steps(deltas: [number, number][]): number[] {
  const out = new Array<number>(N).fill(0);
  for (const [i, v] of deltas) out[i] += v;
  for (let i = 1; i < N; i++) out[i] += out[i - 1];
  return out;
}
const column = (shown: Shown, k: Key): number[] =>
  shown.map((r) => ((LIVE as string[]).includes(k) ? r.inProgress[k as Live] : r[k as never]));
/** Every series of `shown` equals its deltas in `expected`; a series not listed is all zero. */
function expectSeries(shown: Shown, expected: Partial<Record<Key, [number, number][]>>) {
  expect(shown).toHaveLength(N);
  const got: Partial<Record<Key, number[]>> = {};
  const want: Partial<Record<Key, number[]>> = {};
  for (const k of [...SERIES, ...LIVE]) {
    got[k] = column(shown, k);
    want[k] = steps(expected[k] ?? []);
  }
  expect(got).toEqual(want);
  for (const r of shown) expect(Object.keys(r.inProgress)).toEqual(LIVE);
}

const sched = (
  s: Pick<Schedule, 'projectId' | 'entered' | 'end' | 'revisions'> & Partial<Schedule>
): Schedule => ({
  origin: 'pipeline',
  parcelIds: [],
  pathway: 'discretionary',
  existingUnits: 0,
  multiPhase: false,
  phase: null,
  ...s
});
const rev = (day: number, units: number) => ({ day, units, stories: null });
const shownOf = (schedules: Schedule[], masters: Master[] = []) =>
  shownSeries({ schedules, masters }, AS_OF, H, MONTHS);

// Month indices (Oct 2026 = 0): Nov 26 = 1, Dec 26 = 2, Jan 27 = 3, Feb 27 = 4, Mar 27 = 5,
// May 27 = 7, Jun 27 = 8, Jul 27 = 9, Aug 27 = 10, Sep 27 = 11, Jan 28 = 15, Feb 28 = 16,
// Jan 29 = 27, Mar 29 = 29, Dec 50 = 290.

/** Pipeline, history before asOf, every later stage drawn, two revisions, completes. */
const P1 = sched({
  projectId: 'PRJ:p1',
  entered: {
    filed: d(2025, 1, 10),
    entitled: d(2026, 12, 5),
    permitFiled: d(2027, 2, 1),
    permitIssued: d(2027, 3, 15),
    construction: d(2027, 5, 20),
    complete: d(2029, 1, 10)
  },
  end: { kind: 'complete', day: d(2029, 1, 10) },
  revisions: [rev(d(2025, 1, 10), 100), rev(d(2027, 2, 1), 120), rev(d(2027, 3, 15), 110)],
  existingUnits: 4
});
/** Pipeline in construction since before asOf: no subtraction. */
const P2 = sched({
  projectId: 'PRJ:p2',
  entered: { construction: d(2024, 6, 3), complete: d(2027, 1, 15) },
  end: { kind: 'complete', day: d(2027, 1, 15) },
  revisions: [rev(d(2024, 6, 3), 50)],
  existingUnits: 7
});
/** Pipeline open at the horizon at preApplication. */
const P3 = sched({
  projectId: 'PPA:p3',
  entered: { preApplication: d(2026, 9, 1) },
  end: { kind: 'open' },
  revisions: [rev(d(2026, 9, 1), 8)]
});
/** Simulated: a revision on the entitled day (24) and a later one (26); exits at permitFiled. */
const S1 = sched({
  projectId: 'sim:a:0',
  origin: 'simulated',
  entered: { filed: d(2027, 1, 3), entitled: d(2027, 6, 30), permitFiled: d(2027, 8, 1) },
  end: { kind: 'exit', stage: 'permitFiled', reason: 'expired', day: d(2028, 2, 14) },
  revisions: [rev(d(2027, 1, 3), 30), rev(d(2027, 6, 30), 24), rev(d(2027, 8, 1), 26)],
  existingUnits: 2
});
/** Simulated permitOnly: month boundaries (2026-10-20, 2026-11-01, 2050-12-31). */
const S2 = sched({
  projectId: 'sim:b:0',
  origin: 'simulated',
  pathway: 'permitOnly',
  entered: {
    permitFiled: d(2026, 10, 20),
    permitIssued: d(2026, 11, 1),
    construction: d(2026, 11, 30),
    complete: d(2050, 12, 31)
  },
  end: { kind: 'complete', day: d(2050, 12, 31) },
  revisions: [rev(d(2026, 10, 20), 10)],
  existingUnits: 3
});

describe('score: months (§4.3)', () => {
  it('runs from asOf’s month to the horizon’s month: 291 firsts of the month', () => {
    const m = monthsOf(d(2026, 10, 16), d(2050, 12, 31));
    expect(m).toHaveLength(291);
    expect(m[0]).toBe(d(2026, 10, 1));
    expect(m[1]).toBe(d(2026, 11, 1));
    expect(m[290]).toBe(d(2050, 12, 1));
    expect(m.every((x) => isoOf(x).endsWith('-01'))).toBe(true);
    for (let i = 1; i < m.length; i++) expect(m[i]).toBeGreaterThan(m[i - 1]);
    expect(monthsOf(d(2026, 10, 1), d(2026, 10, 1))).toEqual([d(2026, 10, 1)]);
  });

  it('idx(d) is the i with months[i] ≤ d < T_i (T_last = horizon + 1), O(1) by table', () => {
    const idx = monthIndexer(MONTHS, H);
    expect(idx(d(2026, 10, 1))).toBe(0);
    expect(idx(AS_OF)).toBe(0);
    expect(idx(d(2026, 10, 20))).toBe(0);
    expect(idx(d(2026, 10, 31))).toBe(0);
    expect(idx(d(2026, 11, 1))).toBe(1);
    expect(idx(d(2027, 5, 20))).toBe(7);
    expect(idx(d(2050, 12, 1))).toBe(290);
    expect(idx(d(2050, 12, 31))).toBe(290);
    for (let day = MONTHS[0]; day <= H; day++) {
      const i = idx(day);
      const T = i + 1 < N ? MONTHS[i + 1] : H + 1;
      if (!(MONTHS[i] <= day && day < T)) throw new Error(`idx(${isoOf(day)}) = ${i}`);
    }
    expect(() => idx(MONTHS[0] - 1)).toThrow(RangeError);
    expect(() => idx(H + 1)).toThrow(RangeError);
  });
});

describe('score: shown series by hand (§4.5)', () => {
  it('a pipeline project: −existing at construction after asOf, +final units at completion', () => {
    expectSeries(shownOf([P1]), {
      completedNet: [
        [7, -4],
        [27, 110]
      ],
      completedNetPipeline: [
        [7, -4],
        [27, 110]
      ],
      filed: [
        [0, 100],
        [2, -100]
      ],
      entitled: [
        [2, 100],
        [4, -100]
      ],
      permitFiled: [
        [4, 120],
        [5, -120]
      ],
      permitIssued: [
        [5, 110],
        [7, -110]
      ],
      construction: [
        [7, 110],
        [27, -110]
      ]
    });
  });

  it('no subtraction for a construction start before asOf', () => {
    expectSeries(shownOf([P2]), {
      completedNet: [[3, 50]],
      completedNetPipeline: [[3, 50]],
      construction: [
        [0, 50],
        [3, -50]
      ]
    });
  });

  it('an open project stays in its stage to the horizon', () => {
    expectSeries(shownOf([P3]), { preApplication: [[0, 8]] });
  });

  it('net entitledNew uses the revision current on the entitled day; exits count their units', () => {
    expectSeries(shownOf([S1]), {
      entitledNew: [[8, 24 - 2]],
      exitedUnits: [[16, 26]],
      filed: [
        [3, 30],
        [8, -30]
      ],
      entitled: [
        [8, 24],
        [10, -24]
      ],
      permitFiled: [
        [10, 26],
        [16, -26]
      ]
    });
  });

  it('end-of-month state: 2026-10-20 at i = 0, 2026-11-01 at i = 1, 2050-12-31 last', () => {
    expectSeries(shownOf([S2]), {
      completedNet: [
        [1, -3],
        [290, 10]
      ],
      completedNetNew: [
        [1, -3],
        [290, 10]
      ],
      permitFiled: [
        [0, 10],
        [1, -10]
      ],
      construction: [
        [1, 10],
        [290, -10]
      ]
    });
  });

  it('a pipeline project entering entitled never counts in entitledNew', () => {
    const p = sched({ ...S1, projectId: 'PRJ:s1', origin: 'pipeline' });
    const shown = shownOf([p]);
    expect(column(shown, 'entitledNew')).toEqual(steps([]));
    expect(column(shown, 'exitedUnits')).toEqual(steps([[16, 26]]));
  });

  it('a revision inside a stage changes inProgress at its month', () => {
    const s = sched({
      projectId: 'sim:c:0',
      origin: 'simulated',
      entered: { filed: d(2026, 11, 5), entitled: d(2027, 9, 9) },
      end: { kind: 'open' },
      revisions: [rev(d(2026, 11, 5), 40), rev(d(2027, 1, 31), 44), rev(d(2027, 2, 1), 42)]
    });
    expectSeries(shownOf([s]), {
      entitledNew: [[11, 42]],
      filed: [
        [1, 40],
        [3, 4],
        [4, -2],
        [11, -42]
      ],
      entitled: [[11, 42]]
    });
  });

  it('series add over schedules, and completedNet = completedNetPipeline + completedNetNew', () => {
    const all = shownOf([P1, P2, P3, S1, S2]);
    const parts = [P1, P2, P3, S1, S2].map((s) => shownOf([s]));
    for (const k of [...SERIES, ...LIVE]) {
      const sum = MONTHS.map((_, i) => parts.reduce((a, p) => a + column(p, k)[i], 0));
      expect(column(all, k)).toEqual(sum);
    }
    for (const r of all) expect(r.completedNet).toBe(r.completedNetPipeline + r.completedNetNew);
  });
});

describe('score: multi-phase masters (§4.5 master bucket)', () => {
  const master = (m: Partial<Master> & Pick<Master, 'masterId' | 'entered' | 'end'>): Master => ({
    pathway: 'discretionary',
    phaseUnits: [],
    phaseFiled: [],
    ...m
  });
  const phase = (masterId: string, index: number, of: number, s: Partial<Schedule>): Schedule =>
    sched({
      projectId: `${masterId}:phase:${index}`,
      entered: {},
      end: { kind: 'open' },
      revisions: [],
      multiPhase: true,
      phase: { masterId, index, of, start: 'estimated' },
      ...s
    });

  // Already entitled (E before asOf); phase 1 files Jun 2027 and stays open, phase 2 files
  // Jan 2028 and dies at permitFiled Mar 2029, phase 3 never files by the horizon.
  const M1 = master({
    masterId: 'CASE:m1',
    entered: { filed: d(2010, 1, 1), entitled: d(2012, 6, 15) },
    end: { kind: 'entitled', day: d(2012, 6, 15) },
    phaseUnits: [300, 350, 250],
    phaseFiled: [d(2027, 6, 1), d(2028, 1, 10), null]
  });
  const M1P1 = phase('CASE:m1', 1, 3, {
    entered: { permitFiled: d(2027, 6, 1) },
    revisions: [rev(d(2027, 6, 1), 300)]
  });
  const M1P2 = phase('CASE:m1', 2, 3, {
    entered: { permitFiled: d(2028, 1, 10) },
    end: { kind: 'exit', stage: 'permitFiled', reason: 'expired', day: d(2029, 3, 1) },
    revisions: [rev(d(2028, 1, 10), 350)]
  });

  it('unfiled phases sit in inProgress.entitled; each moves to its own Schedule at F_i', () => {
    expectSeries(shownOf([], [M1]), {
      entitled: [
        [0, 900],
        [8, -300],
        [15, -350]
      ]
    });
    const shown = shownOf([M1P1, M1P2], [M1]);
    expectSeries(shown, {
      exitedUnits: [[29, 350]],
      entitled: [
        [0, 900],
        [8, -300],
        [15, -350]
      ],
      permitFiled: [
        [8, 300],
        [15, 350],
        [29, -350]
      ]
    });
    // no double count: the master's 900 units are in exactly one place at every month
    for (const r of shown) {
      expect(LIVE.reduce((a, s) => a + r.inProgress[s], 0) + r.exitedUnits).toBe(900);
    }
  });

  it('a drawn entitlement moves the bucket from the Planning stage to entitled at E', () => {
    const m = master({
      masterId: 'CASE:m2',
      entered: { filed: d(2023, 4, 1), entitled: d(2027, 3, 10) },
      end: { kind: 'entitled', day: d(2027, 3, 10) },
      phaseUnits: [150, 250],
      phaseFiled: [d(2027, 3, 11), null]
    });
    const p1 = phase('CASE:m2', 1, 2, {
      entered: { permitFiled: d(2027, 3, 11) },
      revisions: [rev(d(2027, 3, 11), 150)]
    });
    expectSeries(shownOf([p1], [m]), {
      filed: [
        [0, 400],
        [5, -400]
      ],
      entitled: [[5, 250]],
      permitFiled: [[5, 150]]
    });
  });

  it('a master exit before entitlement sends Σ phaseUnits to exitedUnits on the exit day', () => {
    const m = master({
      masterId: 'CASE:m3',
      entered: { preApplication: d(2026, 5, 1), filed: d(2027, 2, 2) },
      end: { kind: 'exit', stage: 'filed', reason: 'withdrawn', day: d(2027, 9, 9) },
      phaseUnits: [40, 60],
      phaseFiled: [null, null]
    });
    expectSeries(shownOf([], [m]), {
      exitedUnits: [[11, 100]],
      preApplication: [
        [0, 100],
        [4, -100]
      ],
      filed: [
        [4, 100],
        [11, -100]
      ]
    });
  });

  it('an open master keeps its units at its current Planning stage to the horizon', () => {
    const m = master({
      masterId: 'CASE:m4',
      entered: { filed: d(2025, 12, 1) },
      end: { kind: 'open' },
      phaseUnits: [70],
      phaseFiled: [null]
    });
    expectSeries(shownOf([], [m]), { filed: [[0, 70]] });
  });

  it('a permitOnly master (no entered.entitled) moves to entitled at E', () => {
    const m = master({
      masterId: 'CASE:m5',
      pathway: 'permitOnly',
      entered: { preApplication: d(2026, 1, 1) },
      end: { kind: 'entitled', day: d(2027, 1, 20) },
      phaseUnits: [20],
      phaseFiled: [null]
    });
    expectSeries(shownOf([], [m]), {
      preApplication: [
        [0, 20],
        [3, -20]
      ],
      entitled: [[3, 20]]
    });
  });
});

describe('score: netOf and planEffect (§4.5)', () => {
  it('netOf copies the three net series', () => {
    const shown = shownOf([P1, S1, S2]);
    const net = netOf(shown);
    expect(net.completedNet).toBeInstanceOf(Int32Array);
    expect(Array.from(net.completedNet)).toEqual(column(shown, 'completedNet'));
    expect(Array.from(net.completedNetNew)).toEqual(column(shown, 'completedNetNew'));
    expect(Array.from(net.entitledNew)).toEqual(column(shown, 'entitledNew'));
  });

  it('planEffect is the FZP run minus its twin, both cumulative net units', () => {
    const fzp = netOf(shownOf([P1, S1, S2]));
    const twin = netOf(
      shownOf([
        P1,
        sched({ ...S1, revisions: [rev(d(2027, 1, 3), 12), rev(d(2027, 6, 30), 10)] }),
        sched({ ...S2, revisions: [rev(d(2026, 10, 20), 6)] })
      ])
    );
    const pe = planEffectOf(fzp, twin);
    expect(pe.map((r) => r.entitledNew)).toEqual(steps([[8, 22 - 8]]));
    expect(pe.map((r) => r.completedNetNew)).toEqual(steps([[290, 10 - 6]]));
    expect(Object.keys(pe[0])).toEqual(['entitledNew', 'completedNetNew']);
  });
});

describe('score: targets, references, assembly (§4.5)', () => {
  it('fractions are (baseline + completedNet) / units, uncapped, deadline 2031-01-31', () => {
    expect(RHNA_DEADLINE).toBe(d(2031, 1, 31));
    const shown = shownOf([P1, S2]);
    const t = targetsOf(1234, shown);
    expect(t.map((x) => x.target)).toEqual([...M1_TARGETS]);
    expect(t[0].target).toBe(M1_TARGETS[0]);
    expect(t.map((x) => x.target.units)).toEqual([82069, 94379]);
    for (const x of t) {
      expect(x.deadline).toBe(d(2031, 1, 31));
      expect(x.fraction).toEqual(shown.map((r) => (1234 + r.completedNet) / x.target.units));
    }
    expect(t[0].fraction[0]).toBe(1234 / 82069);
    expect(t[0].fraction[290]).toBe((1234 + 106 + 7) / 82069);
    const big = targetsOf(200000, shown);
    expect(big[0].fraction[0]).toBe(200000 / 82069);
    expect(big[0].fraction[0]).toBeGreaterThan(1);
    const one = { id: 'x', label: 'X', units: 1000, source: { label: 'L', url: 'https://x.org' } };
    expect(targetsOf(10, shown, [one]).map((x) => x.fraction[290])).toEqual([(10 + 113) / 1000]);
  });

  it('REFERENCES are the §4.5 table', () => {
    const PLANNING_URL =
      'https://sfplanning.org/sites/default/files/documents/citywide/fzp_land_use_committee_presentation-111725.pdf';
    const KQED_URL = 'https://www.kqed.org/news/12062042';
    expect(
      REFERENCES.map(({ id, label, units, from, by, measure }) => ({
        id,
        label,
        units,
        from,
        by,
        measure
      }))
    ).toEqual([
      {
        id: 'planning-citywide',
        label:
          'SF Planning: ~39,000 net units approved because of the rezoning within 5 years (citywide method)',
        units: 39000,
        from: d(2026, 1, 12),
        by: d(2031, 1, 12),
        measure: 'planEffect.entitledNew'
      },
      {
        id: 'controller-high',
        label:
          "Controller's Office of Economic Analysis: 14,646 net additional units from the rezoning by 2045, high growth (via press coverage)",
        units: 14646,
        from: d(2026, 1, 12),
        by: d(2045, 12, 31),
        measure: 'planEffect.completedNetNew'
      },
      {
        id: 'controller-low',
        label:
          "Controller's Office of Economic Analysis: 8,504 net additional units from the rezoning by 2045, conservative (via press coverage)",
        units: 8504,
        from: d(2026, 1, 12),
        by: d(2045, 12, 31),
        measure: 'planEffect.completedNetNew'
      }
    ]);
    for (const r of REFERENCES) expect(r.provenance.tier).toBe(1);
    expect(REFERENCES[0].provenance.sources.map((s) => s.url)).toEqual([PLANNING_URL]);
    expect(REFERENCES[0].provenance.label).toContain('slide 6');
    expect(REFERENCES[0].provenance.label).toContain('2025-11-17');
    for (const r of REFERENCES.slice(1)) {
      expect(r.provenance.sources.map((s) => s.url)).toEqual([KQED_URL]);
      expect(r.provenance.label).toContain('via secondary');
      expect(r.provenance.method).toContain('beyond what existing zoning might produce');
      expect(r.provenance.method).toContain('over the next 20 years');
      expect(r.provenance.method).toContain('inferred');
      expect(r.provenance.method).toContain('2026-01-12');
      expect(r.provenance.method).toContain('end of 2045');
    }
  });

  it('assembleScore passes months, series and bands through and derives targets', () => {
    const shown = shownOf([P1]);
    const baseline = miniProjects().rhnaCompletedNet;
    const phasing = phasingOf(miniProjects().projects, AS_OF);
    const band = MONTHS.map(() => ({ p10: 1, p50: 2, p90: 3 }));
    const score = assembleScore({
      months: MONTHS,
      shown,
      planEffect: [],
      planEffectBand: [],
      band,
      baseline,
      phasing
    });
    expect(score).toEqual({
      months: MONTHS,
      shown,
      planEffect: [],
      planEffectBand: [],
      band,
      baseline: {
        completedNet: 1234,
        since: d(2022, 6, 30),
        provenance: baseline.provenance
      },
      phasing,
      targets: targetsOf(1234, shown),
      references: REFERENCES
    });
    const one = { id: 'x', label: 'X', units: 10, source: { label: 'L', url: 'https://x.org' } };
    const custom = assembleScore({
      months: MONTHS,
      shown,
      planEffect: [],
      planEffectBand: [],
      band,
      baseline,
      phasing,
      targets: [one]
    });
    expect(custom.targets).toEqual(targetsOf(1234, shown, [one]));
  });
});

// ---- mini fixture ----

const miniCalibration = (): Calibration =>
  parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const miniProjects = () => parseProjectsFile(miniProjectsJson(), { onInvalid() {} });
const miniInput = (cal: Calibration = miniCalibration()): SimInput =>
  buildSimInput({ parcels: miniCity().parcels, projects: miniProjects(), calibration: cal });

describe('score: phasing (§4.5, seed-independent)', () => {
  it('counts masters and phases and lists unenriched rows by units, then id', () => {
    const phasing = phasingOf(miniProjects().projects, AS_OF);
    expect(phasing).toEqual({
      masters: 5,
      enrichedMasters: 3,
      phasesScheduled: 2, // entitled3 phase 1 (2027-06-01), unentitled2 phase 1 (asOf + 45)
      phasesEstimated: 4, // entitled3 overdue and null, unentitled2 null, singlePhase (no source)
      unenriched: [
        { projectId: MINI_PROJECTS.unphased, label: 'Mini Landing', units: 150, drawn: true },
        { projectId: MINI_PROJECTS.scoreOnly, label: 'Mini Basin', units: 75, drawn: false }
      ]
    });
  });

  it('orders equal units by projectId and needs a source and a plan date after asOf', () => {
    const ps = structuredClone(miniProjects().projects);
    const unphased = ps.find((p) => p.id === MINI_PROJECTS.unphased)!;
    const scoreOnly = ps.find((p) => p.id === MINI_PROJECTS.scoreOnly)!;
    scoreOnly.units = 150;
    const e3 = ps.find((p) => p.id === MINI_PROJECTS.entitled3)!;
    e3.phases![0].source = null; // plan date after asOf but no published schedule
    e3.phases![2].plannedPermitFiled = AS_OF; // not after asOf
    e3.phases![2].source = e3.phases![1].source;
    const phasing = phasingOf(ps, AS_OF);
    expect(phasing.unenriched.map((u) => u.projectId)).toEqual([unphased.id, scoreOnly.id].sort());
    expect(phasing.phasesScheduled).toBe(1);
    expect(phasing.phasesEstimated).toBe(5);
  });

  it('is identical for seeds 1 and 2 and agrees with the run’s masters', () => {
    const inp = miniInput();
    const phasing = phasingOf(inp.projects, inp.asOf);
    for (const seed of [1, 2]) {
      const run = simulateDetailed(inp, seed, H);
      expect(run.masters).toHaveLength(phasing.enrichedMasters);
      expect(run.masters.reduce((a, m) => a + m.phaseUnits.length, 0)).toBe(
        phasing.phasesScheduled + phasing.phasesEstimated
      );
      expect(phasingOf(inp.projects, inp.asOf)).toEqual(phasing);
    }
  });
});

describe('score: mini runs', () => {
  it('completedNet = completedNetPipeline + completedNetNew at every month', () => {
    const inp = miniInput();
    let moved = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const shown = shownSeries(simulateDetailed(inp, seed, H), AS_OF, H, MONTHS);
      for (const r of shown)
        expect(r.completedNet).toBe(r.completedNetPipeline + r.completedNetNew);
      if (shown[N - 1].completedNetPipeline !== 0 && shown[N - 1].completedNetNew !== 0) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('counts every phased master’s units once: master bucket plus its phases', () => {
    const inp = miniInput();
    for (const seed of [1, 2, 3]) {
      const run = simulateDetailed(inp, seed, H);
      for (const m of run.masters) {
        const phases = run.schedules.filter((s) => s.phase?.masterId === m.masterId);
        const bucket = shownSeries({ schedules: [], masters: [m] }, AS_OF, H, MONTHS);
        const total = m.phaseUnits.reduce((a, u) => a + u, 0);
        for (const [i, r] of bucket.entries()) {
          // units still in the master's bucket = the phases not yet filed (or all, until exit)
          const T = i + 1 < N ? MONTHS[i + 1] : H + 1;
          const left =
            m.end.kind === 'exit' && m.end.day < T
              ? 0
              : m.phaseUnits.reduce(
                  (a, u, j) => a + (m.phaseFiled[j] !== null && m.phaseFiled[j]! < T ? 0 : u),
                  0
                );
          expect(LIVE.reduce((a, s) => a + r.inProgress[s], 0)).toBe(left);
          expect(r.exitedUnits).toBe(m.end.kind === 'exit' && m.end.day < T ? total : 0);
        }
        expect(phases.map((s) => s.phase!.index)).toEqual(
          m.phaseFiled.flatMap((f, j) => (f === null ? [] : [j + 1]))
        );
      }
    }
  });
});

describe('score: demolished once (§4.4.6, Task 5 rig)', () => {
  const PROV = miniCalibration().transitions.discretionary.filed!.provenance;
  const MONTH_ONE: Transition = {
    months: 1,
    advance: [1],
    exit: {},
    tail: { advance: 0.5, exit: {} },
    provenance: PROV,
    tailProvenance: PROV
  };
  const EXIT_AT_BUILD: Transition = {
    months: 1,
    advance: [0],
    exit: { cancelled: [1] },
    tail: { advance: 0.01, exit: { cancelled: 0.99 } },
    provenance: PROV,
    tailProvenance: PROV
  };
  const RAISED = '0026T011'; // existing raised from 2 to 5

  function demolishInput(): SimInput {
    const cal = miniCalibration();
    for (const p of PATHWAYS) {
      for (const s of Object.keys(cal.transitions[p]) as Live[]) {
        cal.transitions[p][s] = structuredClone(s === 'construction' ? EXIT_AT_BUILD : MONTH_ONE);
      }
    }
    cal.revision.at = [];
    cal.initiation = { ...cal.initiation, intercept: 0, terms: [] };
    const parcels = miniCity().parcels;
    parcels.existingUnits[parcels.index.get(RAISED)!] = 5;
    return buildSimInput({ parcels, projects: miniProjects(), calibration: cal });
  }

  it('subtracts each parcel’s existing units once, however many projects demolish it', () => {
    const inp = demolishInput();
    const p = inp.parcels;
    let repeated = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = simulateDetailed(inp, seed, H);
      const shown = shownSeries(run, AS_OF, H, MONTHS);
      // Nothing completes (construction always exits), so completedNetNew is −(demolitions).
      const held = new Set(
        run.schedules
          .filter((s) => s.origin === 'pipeline' && s.entered.construction !== undefined)
          .flatMap((s) => s.parcelIds)
      );
      const demolished = new Map<string, number>();
      for (const s of run.schedules) {
        if (s.origin !== 'simulated' || s.entered.construction === undefined) continue;
        const id = s.parcelIds[0];
        demolished.set(id, (demolished.get(id) ?? 0) + 1);
      }
      let expected = 0;
      for (const [id, n] of demolished) {
        if (held.has(id)) continue;
        const ex = p.existingUnits[p.index.get(id)!];
        expected -= ex;
        if (n > 1 && ex > 0) repeated++;
      }
      expect(shown[N - 1].completedNetNew).toBe(expected);
    }
    expect(repeated).toBeGreaterThan(10);
  });
});
