// The time-aware score (T8, spec §4.3 and §4.5, §6 `score.spec.ts`, AC 5–6): hand-built
// Schedules and Masters with known days give exact per-month deltas for every series; the mini
// fixture gives the phasing table.
import { describe, expect, it } from 'vitest';
import { M1_TARGETS, RHNA_TIER_TARGETS } from '$lib/scoreboard';
import { parseProjectsFile } from '$lib/timelapse/projects';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import { dayOf, isoOf } from '../dates';
import {
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_PROJECTS,
  miniProjectsJson
} from '../fixtures/mini-projects';
import {
  REFERENCES,
  RHNA_DEADLINE,
  monthIndexer,
  monthsOf,
  phasingOf,
  targetsOf,
  tierTargetsOf
} from './targets';
import { tierBaselineOf } from './finance';
import { shownSeries } from '$lib/sim/world/score/test/oracles';
import type { Master } from '$lib/sim/world/read';
import type { Schedule, TimelineScore } from '../input/types';

const T0 = { veryLow: 0, low: 0, moderate: 0, aboveModerate: 0, unrecorded: 0 };
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

  it('REFERENCES keeps its ids, units, dates and measures', () => {
    expect(REFERENCES.map((r) => r.id)).toEqual([
      'planning-citywide',
      'controller-high',
      'controller-low'
    ]);
    expect(REFERENCES.map((r) => r.units)).toEqual([39000, 14646, 8504]);
    expect(REFERENCES.map((r) => r.from)).toEqual([d(2026, 1, 12), d(2026, 1, 12), d(2026, 1, 12)]);
    expect(REFERENCES.map((r) => r.by)).toEqual([d(2031, 1, 12), d(2045, 12, 31), d(2045, 12, 31)]);
    expect(REFERENCES.map((r) => r.measure)).toEqual([
      'planEffect.entitledNew',
      'planEffect.completedNetNew',
      'planEffect.completedNetNew'
    ]);
  });

  it('REFERENCES are the §4.5 table', () => {
    const PLANNING_URL =
      'https://sfplanning.org/sites/default/files/documents/citywide/fzp_land_use_committee_presentation-111725.pdf';
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
          "Controller's Office of Economic Analysis: 14,646 net additional units from the rezoning by 2045, high growth",
        units: 14646,
        from: d(2026, 1, 12),
        by: d(2045, 12, 31),
        measure: 'planEffect.completedNetNew'
      },
      {
        id: 'controller-low',
        label:
          "Controller's Office of Economic Analysis: 8,504 net additional units from the rezoning by 2045, conservative",
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
      expect(r.provenance.sources.map((s) => s.url)).toEqual([
        'https://newspack-missionlocal.s3.amazonaws.com/mission/wp-content/uploads/2025/10/250700_economic_impact_final.pdf'
      ]);
      expect(r.provenance.sources[0].label).toContain('slide 18');
      expect(r.provenance.label).not.toContain('KQED');
      expect(r.provenance.method).toContain('slide 18');
      expect(r.provenance.method).toContain("holds today's market");
      expect(r.provenance.method).toContain('2026-01-12');
      expect(r.provenance.method).toContain('end of 2045');
      const text = JSON.stringify(r);
      expect(text).not.toContain('press');
      expect(text).not.toContain('KQED');
    }
  });
});

// ---- mini fixture ----

const miniProjects = () => parseProjectsFile(miniProjectsJson(), { onInvalid() {} });
describe('score: tier targets and baseline (finance-score spec 6 test 12)', () => {
  const byTier = { veryLow: 100, low: 200, moderate: 300, aboveModerate: 634, unrecorded: 7 };
  const base = miniProjects().rhnaCompletedNet;
  const rhna = { ...base, units: 1241, byTier };

  const shown = shownOf([P1, S2]);
  const completed = shown.map((r) => ({
    veryLow: 1,
    low: 2,
    moderate: 3,
    aboveModerate: r.completedNet - 11,
    unrecorded: 5
  }));

  it('adds four tier targets in RHNA_TIER_TARGETS order', () => {
    const tiers = tierTargetsOf(byTier, completed);
    expect(tiers.map((t) => t.target.id)).toEqual(RHNA_TIER_TARGETS.map((t) => t.id));
    expect(tiers).toHaveLength(4);
    for (const x of tiers) {
      expect(x.deadline).toBe(d(2031, 1, 31));
      const t = x.target.tier!;
      expect(x.fraction).toEqual(completed.map((c) => (byTier[t] + c[t]) / x.target.units));
    }
  });

  it('weights to the total less the unrecorded homes', () => {
    const total = targetsOf(rhna.units, shown)[0];
    const tiers = tierTargetsOf(byTier, completed);
    for (const i of [0, 100, 290, N - 1]) {
      const weighted = tiers.reduce((sum, x) => sum + x.fraction[i] * x.target.units, 0);
      expect(Math.abs(weighted - (82069 * total.fraction[i] - 12))).toBeLessThan(1e-6);
    }
  });

  it('tierTargetsOf is uncapped and a negative aboveModerate gives a negative fraction', () => {
    const t = tierTargetsOf(T0, [{ ...T0, aboveModerate: -7 }]);
    expect(t[3].fraction).toEqual([-7 / 35471]);
    expect(t[0].fraction).toEqual([0]);
  });

  it('tierBaselineOf: all zeros without byTier, the object with it', () => {
    expect(tierBaselineOf({ ...base, units: 5 })).toEqual(T0);
    expect(tierBaselineOf(rhna)).toEqual(byTier);
  });
});

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
});
