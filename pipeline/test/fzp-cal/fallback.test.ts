// The fallback ladder and every transition cell (stage-calibration spec §4.4, §4.5, §6
// fallback.test.ts): rung 3's literature synthetic, rung selection, tiers and method text.
import { describe, expect, it } from 'vitest';
import { LIVE_CAL, FIXTURE_CAL } from '../../lib/fzp-cal/config';
import { LITERATURE, rung3 } from '../../lib/fzp-cal/fallback';
import { fitTransitions, type FitContext } from '../../lib/fzp-cal/transitions';
import { windowStart } from '../../lib/fzp-cal/window';
import type { CalProfile, CalStage, Spell, UnobservedAdvance } from '../../lib/fzp-cal/types';
import { isoToDay } from '../../project-records/multiphase';
import calibrationSmall from '../../../src/lib/timelapse/fixtures/calibration-small.json';
import { mulberry32 } from '../../../src/lib/generator/seed';
import { exp, log } from '../../../src/lib/timelapse/math';
import { cumulativeTotal, parseCalibration, typicalMonths } from '../../../src/lib/timelapse/model';
import { MONTH_DAYS } from '../../../src/lib/timelapse/time';
import {
  EXIT_ORDER,
  PATHWAYS,
  STAGE_ORDER,
  pathwayStages,
  type Calibration,
  type Pathway,
  type Transition
} from '../../../src/lib/timelapse/types';

const M = MONTH_DAYS;
const AS_OF = isoToDay('2026-06-30');
const LIVE: CalProfile = { ...LIVE_CAL, coverageGuard: false };
const NO_CTX: FitContext = {
  purge: { windows: [], windowed: { fired: 0, of: 0, sample: [] } },
  gapImpute: { ids: new Set() },
  permitOnlyPre2015: { fired: 0, of: 0 }
};

const pathwayRank = (p: Spell['pathway']) => (p === null ? 3 : PATHWAYS.indexOf(p));
const sorted = <T extends Pick<Spell, 'pathway' | 'stage' | 'projectId'>>(spells: T[]): T[] =>
  [...spells].sort(
    (p, q) =>
      pathwayRank(p.pathway) - pathwayRank(q.pathway) ||
      STAGE_ORDER.indexOf(p.stage) - STAGE_ORDER.indexOf(q.stage) ||
      (p.projectId < q.projectId ? -1 : p.projectId > q.projectId ? 1 : 0)
  );

/** A spell entered on `entry`, cut at the stage's pooled window start. */
function spell(
  pathway: Spell['pathway'],
  stage: CalStage,
  id: string,
  months: number,
  outcome: Spell['outcome'],
  entry: string
): Spell {
  const e = isoToDay(entry);
  return {
    pathway,
    stage,
    a: Math.max(0, windowStart(stage, 'pooled') - e),
    e,
    x: Math.round(months * M),
    outcome,
    projectId: id
  };
}

/**
 * `n` spells of one cell: the first `events` end (`advance`, every fifth a withdrawal) after
 * 2..31 months, the rest are censored at 60 months. Entries cycle over 2015..2024.
 */
function cell(
  pathway: Spell['pathway'],
  stage: CalStage,
  prefix: string,
  n: number,
  events: number,
  exitReason: Spell['outcome'] = 'withdrawn'
): Spell[] {
  const out: Spell[] = [];
  for (let i = 0; i < n; i++) {
    const outcome = i >= events ? 'censored' : i % 5 === 4 ? exitReason : 'advance';
    const months = i >= events ? 60 : 2 + (i % 30);
    const year = 2015 + (i % 10);
    out.push(
      spell(
        pathway,
        stage,
        `${prefix}${String(i).padStart(4, '0')}`,
        months,
        outcome,
        `${year}-02-01`
      )
    );
  }
  return out;
}

/** Rung-3 values are `v` rounded up to 1e-6. */
function expectUp6(got: number, v: number): void {
  expect(got).toBeGreaterThanOrEqual(v);
  expect(got - v).toBeLessThan(1e-6);
  expect(Math.round(got * 1e6)).toBeCloseTo(got * 1e6, 6);
}

/** A calibration with the fitted transitions in place of the small fixture's. */
function withTransitions(transitions: Calibration['transitions']): unknown {
  const base = structuredClone(calibrationSmall) as unknown as Calibration;
  return { ...base, transitions };
}

/**
 * Spells in every year of each stage's pooled window (preApplication entries end in 2023), for
 * every pathway the stage has plus pathway unknown, with seeded durations and outcomes.
 */
function world(seed: number): { spells: Spell[]; unobserved: UnobservedAdvance[] } {
  const rand = mulberry32(seed);
  const spells: Spell[] = [];
  for (const stage of STAGE_ORDER) {
    if (stage === 'complete') continue;
    const fromYear = Number(new Date(windowStart(stage, 'pooled') * 86400000).getUTCFullYear());
    const toYear = stage === 'preApplication' ? 2023 : 2026;
    const ps: Spell['pathway'][] = [
      ...PATHWAYS.filter((p) => pathwayStages(p).includes(stage)),
      null
    ];
    for (let y = fromYear; y <= toYear; y++) {
      for (const p of ps) {
        for (const mo of ['01', '03', '05']) {
          const e = isoToDay(`${y}-${mo}-15`);
          const dur = Math.round(-log(1 - rand()) * 9 * M);
          const r = rand();
          const z = e + dur;
          const outcome: Spell['outcome'] =
            z > AS_OF ? 'censored' : r < 0.8 ? 'advance' : r < 0.92 ? 'expired' : 'withdrawn';
          const x = (outcome === 'censored' ? AS_OF : z) - e;
          spells.push({
            pathway: p,
            stage,
            a: 0,
            e,
            x,
            outcome,
            projectId: `${stage}:${p ?? 'null'}:${y}${mo}`
          });
        }
      }
    }
  }
  const unobserved: UnobservedAdvance[] = [];
  for (let i = 0; i < 12; i++) {
    const complete = isoToDay(`${2010 + i}-06-01`);
    for (const stage of ['permitIssued', 'construction'] as const) {
      unobserved.push({
        projectId: `NOFCD${i}`,
        pathway: i % 2 ? 'discretionary' : null,
        stage,
        complete,
        enteredPermitIssued: complete - 700
      });
    }
  }
  return { spells: sorted(spells), unobserved: sorted(unobserved) };
}

describe('rung3 (literature synthetic)', () => {
  it('has the §4.5 table', () => {
    expect(LITERATURE.filed.D.discretionary).toMatchObject({ months: 17.2, tier: 1 });
    expect(LITERATURE.filed.D.streamlined).toMatchObject({ months: 3.42, tier: 1 });
    expect(LITERATURE.filed.D.permitOnly).toBeUndefined();
    expect(LITERATURE.entitled.D.all).toMatchObject({ months: 12, tier: 4 });
    expect(LITERATURE.construction.A).toMatchObject({ value: 0.98, tier: 4 });
    expect(LITERATURE.preApplication).toMatchObject({
      A: { value: 0.862, tier: 2 },
      primary: 'withdrawn'
    });
    for (const stage of Object.keys(LITERATURE) as CalStage[]) {
      for (const d of Object.values(LITERATURE[stage].D)) expect(d!.ref.url).toMatch(/^https:/);
      expect(LITERATURE[stage].A.ref.url).toMatch(/^https:/);
    }
  });

  it('D = 6 gives the median month 6 and advance[0] = A·q', () => {
    const t = rung3('preApplication', 'discretionary', null);
    const q = 1 - exp(-log(2) / 6);
    expect(t.months).toBe(1);
    expectUp6(t.advance[0], 0.862 * q);
    expect(t.tail.advance).toBe(t.advance[0]);
    const firstHalf = [1, 2, 3, 4, 5, 6, 7].find((k) => cumulativeTotal(t, k) >= 0.5);
    expect(firstHalf).toBe(6);
    const cal = structuredClone(calibrationSmall) as unknown as Calibration;
    cal.transitions.discretionary.preApplication = t;
    expect(typicalMonths(cal).discretionary.preApplication).toBe(6);
  });

  it('entitled is tier 4 (D made up), and no observed exit puts it all on the primary reason', () => {
    const t = rung3('entitled', 'discretionary', null);
    expect(t.provenance.tier).toBe(4);
    expect(Object.keys(t.exit)).toEqual(['expired']);
    expect(Object.keys(t.tail.exit)).toEqual(['expired']);
    const q = 1 - exp(-log(2) / 12);
    expectUp6(t.exit.expired![0], (1 - 0.66) * q);
    expect(t.provenance.method).toContain('D = 12 mo (tier 4, made up)');
    expect(t.provenance.method).toContain('all on expired (tier 4');
    const withExits = rung3(
      'entitled',
      'streamlined',
      { withdrawn: 3, expired: 1 },
      {
        n: 4,
        window: ['2015-01-01', '2026-06-30']
      }
    );
    expect(withExits.provenance.tier).toBe(4);
  });

  it('observed exits split 1 − A by their shares at tier 2; the tier is the worst of D, A, E', () => {
    const t = rung3(
      'permitIssued',
      'streamlined',
      { withdrawn: 1, expired: 3 },
      { n: 12, window: ['2007-01-01', '2026-06-30'] }
    );
    const q = 1 - exp(-log(2) / 3);
    expect(t.provenance.tier).toBe(2);
    expect(t.provenance).toMatchObject({ n: 12, window: ['2007-01-01', '2026-06-30'] });
    expect(Object.keys(t.exit)).toEqual(['withdrawn', 'expired']);
    expectUp6(t.exit.withdrawn![0], 0.26 * 0.25 * q);
    expectUp6(t.exit.expired![0], 0.26 * 0.75 * q);
    expect(t.tailProvenance.tier).toBe(2);
    expect(t.tailProvenance.sources).toEqual(t.provenance.sources);
    // No observed exit: E is tier 4.
    expect(rung3('permitIssued', 'streamlined', null).provenance.tier).toBe(4);
    // permitOnly never enters filed.
    expect(() => rung3('filed', 'permitOnly', null)).toThrow(/no rung-3 duration/);
  });
});

describe('fitTransitions: rung selection', () => {
  const filedOf = (spells: Spell[], cal: CalProfile = LIVE) =>
    fitTransitions(sorted(spells), [], AS_OF, cal, NO_CTX);
  const cellOf = (r: ReturnType<typeof filedOf>, p: Pathway, stage: CalStage) =>
    r.cells.find((c) => c.pathway === p && c.stage === stage)!;

  it('40 discretionary filed spells with 25 events: rung 1, tier 0', () => {
    const r = filedOf(cell('discretionary', 'filed', 'D', 40, 25));
    const c = cellOf(r, 'discretionary', 'filed');
    expect(c).toMatchObject({ rung: 1, tier: 0, n: 40, events: 25 });
    const t = r.transitions.discretionary.filed!;
    expect(t.provenance).toMatchObject({ tier: 0, n: 40, window: ['2015-01-01', '2026-06-30'] });
    expect(t.provenance.label).toBe('SF Planning records 2015–2026, discretionary (tier 0)');
    expect(t.provenance.method).toContain(
      'Aalen–Johansen cumulative incidence, right-censored at last observation, left-truncated at window start'
    );
    expect(Object.keys(t.exit)).toEqual(['withdrawn']);
    expect(r.spellsCount['calibration.spells.discretionary.filed']).toBe(40);
  });

  it('10 discretionary spells fall to the pooled rung 2, tier 2', () => {
    const r = filedOf([
      ...cell('discretionary', 'filed', 'D', 10, 10),
      ...cell('streamlined', 'filed', 'S', 40, 25)
    ]);
    expect(cellOf(r, 'discretionary', 'filed')).toMatchObject({ rung: 2, tier: 2, n: 50 });
    expect(cellOf(r, 'streamlined', 'filed')).toMatchObject({ rung: 1, tier: 0, n: 40 });
    const t = r.transitions.discretionary.filed!;
    expect(t.provenance.label).toBe(
      'SF Planning records 2015–2026, pooled across pathways (tier 2)'
    );
    expect(t.provenance.method).toContain('pooled across pathways');
    expect(r.spellsCount['calibration.spells.pooled.filed']).toBe(50);
    expect(r.spellsCount['calibration.spells.discretionary.filed']).toBe(10);
  });

  it('1 pooled spell goes to rung 3 and warns', () => {
    const r = filedOf(cell('discretionary', 'filed', 'D', 1, 1));
    expect(cellOf(r, 'discretionary', 'filed')).toMatchObject({ rung: 3, n: 1, events: 1 });
    expect(r.transitions.discretionary.filed!.months).toBe(1);
    expect(r.warnings).toContain('rung 3 (literature synthetic): discretionary filed');
    // With no other spells every one of the 16 cells is rung 3.
    expect(r.rung3).toBe(16);
  });

  it('a cell of 50 all-censored spells routes to rung 3 without throwing', () => {
    const r = filedOf(cell('discretionary', 'filed', 'D', 50, 0));
    const c = cellOf(r, 'discretionary', 'filed');
    expect(c).toMatchObject({ rung: 3, n: 50, events: 0, tier: 4 });
    expect(Object.keys(r.transitions.discretionary.filed!.exit)).toEqual(['withdrawn']);
  });

  it('preApplication is always pooled (tier 2) for all three pathways and counted', () => {
    const r = filedOf([
      ...cell('discretionary', 'preApplication', 'D', 30, 20),
      ...cell('permitOnly', 'preApplication', 'P', 20, 10)
    ]);
    expect(r.ppaPooled).toBe(50);
    for (const p of PATHWAYS) {
      expect(cellOf(r, p, 'preApplication')).toMatchObject({ rung: 2, tier: 2, n: 50 });
      expect(r.transitions[p].preApplication!.provenance.method).toContain(
        'calibration.method.ppaPooled'
      );
    }
    expect(r.spellsCount['calibration.spells.pooled.preApplication']).toBe(50);
    expect(r.spellsCount['calibration.spells.discretionary.preApplication']).toBeUndefined();
  });

  it('permit side: θ-scaled pooled table with the DQ-1 label and method', () => {
    const pooled = [
      ...cell(null, 'permitFiled', 'N', 40, 30),
      ...cell('discretionary', 'permitFiled', 'D', 35, 25, 'expired')
    ];
    const r = fitTransitions(sorted(pooled), [], AS_OF, LIVE, {
      ...NO_CTX,
      permitOnlyPre2015: { fired: 3, of: 10 }
    });
    const c = cellOf(r, 'discretionary', 'permitFiled');
    expect(c).toMatchObject({ rung: 'ph', tier: 2, n: 75, pathwaySpells: 35, thin: false });
    expect(c.theta?.advance).toBeGreaterThan(0);
    const t = r.transitions.discretionary.permitFiled!;
    expect(t.provenance.label).toBe(
      'SF permit records 2007–2026, pooled across pathways before 2015, scaled to discretionary 2015–2026 (tier 2)'
    );
    expect(t.provenance.window).toEqual(['2007-01-01', '2026-06-30']);
    expect(t.provenance.method).toContain('since 2007-01-01, the first assessor roll');
    expect(t.provenance.method).toContain('θ=');
    expect(t.provenance.method).toContain(
      'permit-only histories before 2015 count as pathway unknown: n = 3 of 10'
    );
    // streamlined has no 2015+ spells: thin, θ = 1.
    expect(cellOf(r, 'streamlined', 'permitFiled')).toMatchObject({ rung: 'ph', thin: true });
    expect(r.transitions.streamlined.permitFiled!.provenance.method).toContain(
      'θ = 1 (pure pooled)'
    );
  });

  it('weights permit-side advances for no-FCD completions and states X, A, w', () => {
    const pooled = cell(null, 'construction', 'N', 60, 50);
    const advances = pooled.filter((s) => s.outcome === 'advance').length;
    const unobserved: UnobservedAdvance[] = [];
    for (let i = 0; i < 10; i++) {
      unobserved.push({
        projectId: `X${i}`,
        pathway: null,
        stage: 'construction',
        complete: isoToDay('2020-01-01')
      });
    }
    const r = fitTransitions(sorted(pooled), unobserved, AS_OF, LIVE, NO_CTX);
    const c = cellOf(r, 'discretionary', 'construction');
    expect(c.noFcd?.pooled).toMatchObject({ X: 10, A: advances, flagged: false });
    expect(c.noFcd?.pooled.w).toBeCloseTo(1 + 10 / advances, 12);
    const m = r.transitions.discretionary.construction!.provenance.method;
    expect(m).toContain(
      'completions without a construction start (no FCD) kept in incidence, durations from histories with an FCD (rule sc.stages.no-fcd-duration)'
    );
    expect(m).toContain(`X=10, A=${advances}, w=`);
    expect(m).toContain('completion = first TCO/CFC, else permit `completed_date`');
    expect(r.warnings.some((w) => w.includes('flagged at pooled level: construction'))).toBe(false);
    // The empty permitIssued pooled cell (A = 0 < N_EVENTS_MIN) is flagged, but with X = 0 the
    // weighting is a no-op, so it is not escalated (ruling R24); it goes to rung 3 and its
    // CellReport keeps the no-FCD record.
    expect(r.noFcdFlaggedPooled).toBe(0);
    const empty = cellOf(r, 'discretionary', 'permitIssued');
    expect(empty).toMatchObject({ rung: 3, noFcd: { pooled: { X: 0, A: 0, flagged: true } } });
  });

  it('rung-3 permit-side cells keep the no-FCD, purge and imputation counts', () => {
    // 10 spells: below N_SPELLS_MIN, so the pooled cell fails; 2 expired exits observed.
    const pooled = cell(null, 'permitIssued', 'N', 10, 10, 'expired');
    const unobserved: UnobservedAdvance[] = [
      {
        projectId: 'X0',
        pathway: null,
        stage: 'permitIssued',
        complete: isoToDay('2020-01-01'),
        enteredPermitIssued: isoToDay('2018-01-01')
      }
    ];
    const r = fitTransitions(sorted(pooled), unobserved, AS_OF, LIVE, {
      ...NO_CTX,
      purge: { windows: [], windowed: { fired: 0, of: 0, sample: [] } },
      gapImpute: { ids: new Set(['N0000', 'N0001', 'N0002']) }
    });
    const c = cellOf(r, 'streamlined', 'permitIssued');
    expect(c).toMatchObject({ rung: 3, tier: 2, n: 10, events: 10, gapImputed: 3 });
    expect(c.noFcd?.pooled).toMatchObject({ X: 1, A: 8, flagged: true });
    // Observed exit shares make E tier 2; D (tier 1) and A (tier 2) keep the cell at tier 2.
    const t = r.transitions.streamlined.permitIssued!;
    expect(t.provenance).toMatchObject({ tier: 2, n: 10, window: ['2007-01-01', '2026-06-30'] });
    expect(Object.keys(t.exit)).toEqual(['expired']);
    // Flagged with X = 1 > 0: escalated.
    expect(r.noFcdFlaggedPooled).toBe(1);
  });

  it('states the spells of histories with an imputed stage date', () => {
    const spells = cell('discretionary', 'filed', 'D', 40, 25);
    const r = fitTransitions(sorted(spells), [], AS_OF, LIVE, {
      ...NO_CTX,
      gapImpute: { ids: new Set(['D0000', 'D0005', 'Q9999']) }
    });
    expect(r.transitions.discretionary.filed!.provenance.method).toContain(
      '2 spells from histories with an imputed stage date (rule sc.stages.gap-impute; bias toward zero-duration spells)'
    );
    expect(cellOf(r, 'discretionary', 'filed').gapImputed).toBe(2);
    expect(r.transitions.discretionary.entitled!.provenance.method).not.toContain('gap-impute');
  });

  it('a flagged pooled no-FCD cell warns and is counted (the controller escalates)', () => {
    const pooled = cell(null, 'permitIssued', 'N', 40, 25);
    const unobserved: UnobservedAdvance[] = [];
    for (let i = 0; i < 30; i++) {
      unobserved.push({
        projectId: `X${i}`,
        pathway: null,
        stage: 'permitIssued',
        complete: isoToDay('2020-01-01'),
        enteredPermitIssued: isoToDay('2018-01-01')
      });
    }
    const r = fitTransitions(sorted(pooled), unobserved, AS_OF, LIVE, NO_CTX);
    // permitIssued (w = 2.5) only: the empty construction cell (A = 0) has X = 0 (ruling R24).
    expect(r.noFcdFlaggedPooled).toBe(1);
    expect(r.warnings.filter((w) => w.includes('flagged at pooled level'))).toHaveLength(1);
    expect(r.warnings).toContain(
      'no-FCD weighting flagged at pooled level: permitIssued X=30 A=20 w=2.5'
    );
  });

  it('states purge-censored spells of a cell, with every window', () => {
    const spells = cell('discretionary', 'filed', 'D', 40, 25);
    const r = fitTransitions(sorted(spells), [], AS_OF, LIVE, {
      ...NO_CTX,
      purge: {
        windows: [
          {
            first: isoToDay('1996-05-22'),
            last: isoToDay('1996-05-22'),
            exits: 12,
            censored: 12,
            byReason: {},
            byStage: {},
            medianDays: 900
          },
          {
            first: isoToDay('2020-03-02'),
            last: isoToDay('2020-03-20'),
            exits: 11,
            censored: 2,
            byReason: {},
            byStage: {},
            medianDays: 800
          }
        ],
        windowed: { fired: 2, of: 30, sample: ['D0030:filed', 'D0031:filed', 'Z0001:entitled'] }
      }
    });
    expect(r.transitions.discretionary.filed!.provenance.method).toContain(
      '2 exits in administrative purge windows [1996-05-22, 2020-03-02 to 2020-03-20] censored (rule sc.exit.purge-censor: tier 2 detection, tier-4 thresholds)'
    );
    expect(cellOf(r, 'discretionary', 'filed').purgeCensored).toBe(2);
    // streamlined has no own spells: it takes the pooled cell, which holds the same two.
    expect(cellOf(r, 'streamlined', 'filed')).toMatchObject({ rung: 2, purgeCensored: 2 });
    expect(r.transitions.discretionary.entitled!.provenance.method).not.toContain('purge');
  });

  it('runs the coverage guard over each pooled window (preApplication to 2023-07-07)', () => {
    const { spells, unobserved } = world(7);
    const guarded: CalProfile = { ...LIVE_CAL, coverageGuard: true };
    const r = fitTransitions(spells, unobserved, AS_OF, guarded, NO_CTX);
    expect(Object.keys(r.coverage.preApplication!).map(Number)).toEqual([
      2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023
    ]);
    expect(Object.keys(r.coverage.permitFiled!).length).toBe(20);
    const gap = spells.filter(
      (s) =>
        !(s.stage === 'entitled' && s.e < isoToDay('2018-01-01') && s.e >= isoToDay('2017-01-01'))
    );
    expect(() => fitTransitions(gap, unobserved, AS_OF, guarded, NO_CTX)).toThrow(
      /coverage gap: entitled 2017/
    );
  });

  it('asserts full calendar years only and states partial years in method (ruling C4)', () => {
    const { spells, unobserved } = world(7);
    const guarded: CalProfile = { ...LIVE_CAL, coverageGuard: true };
    // No preApplication entry in 2023 H1 (the live case): the partial year is not asserted.
    const noPpa2023 = spells.filter(
      (s) => !(s.stage === 'preApplication' && s.e >= isoToDay('2023-01-01'))
    );
    const r = fitTransitions(noPpa2023, unobserved, AS_OF, guarded, NO_CTX);
    expect(r.coveragePartial.preApplication).toEqual([
      { year: 2023, to: '2023-07-07', entries: 0 }
    ]);
    expect(r.coveragePartial.permitFiled).toEqual([
      { year: 2026, to: '2026-06-30', entries: r.coverage.permitFiled![2026] }
    ]);
    for (const p of PATHWAYS) {
      expect(r.transitions[p].preApplication!.provenance.method).toContain(
        'partial year 2023 (to 2023-07-07): 0 entries, not asserted'
      );
    }
    expect(r.transitions.discretionary.filed!.provenance.method).toContain(
      `partial year 2026 (to 2026-06-30): ${r.coverage.filed![2026]} entries, not asserted`
    );
    // A rung-3 cell states it too.
    const thin = fitTransitions([], [], AS_OF, LIVE, NO_CTX);
    expect(thin.transitions.permitOnly.construction!.provenance.method).toContain(
      'partial year 2026 (to 2026-06-30): 0 entries, not asserted'
    );
  });
});

describe('fitTransitions: every cell', () => {
  const transitionsOf = (cal: Calibration['transitions']): [Pathway, CalStage, Transition][] =>
    PATHWAYS.flatMap((p) =>
      (Object.entries(cal[p]) as [CalStage, Transition][]).map(
        ([s, t]) => [p, s, t] as [Pathway, CalStage, Transition]
      )
    );

  it('fills the 16 occupiable cells, which parseCalibration accepts', () => {
    const { spells, unobserved } = world(11);
    for (const cal of [LIVE, FIXTURE_CAL]) {
      const r = fitTransitions(spells, unobserved, AS_OF, cal, NO_CTX);
      expect(transitionsOf(r.transitions)).toHaveLength(16);
      for (const p of PATHWAYS) {
        expect(Object.keys(r.transitions[p])).toEqual(
          pathwayStages(p).filter((s) => s !== 'complete')
        );
      }
      expect(() => parseCalibration(withTransitions(r.transitions))).not.toThrow();
      expect(r.cells).toHaveLength(16);
    }
  });

  it('gives every Transition a tier-2 tailProvenance except rung 3, which copies its own', () => {
    const { spells, unobserved } = world(11);
    const r = fitTransitions(spells, unobserved, AS_OF, LIVE, NO_CTX);
    expect(r.rung3).toBe(0);
    for (const c of r.cells)
      expect(c.rung).toBe(
        c.stage === 'filed' || c.stage === 'entitled' ? 1 : c.stage === 'preApplication' ? 2 : 'ph'
      );
    for (const [, , t] of transitionsOf(r.transitions)) {
      expect(t.tailProvenance.tier).toBe(2);
      expect(t.tailProvenance.window).toEqual(t.provenance.window);
      expect(t.tailProvenance.sources).toEqual(t.provenance.sources);
      expect(t.tailProvenance.method).toMatch(
        /^constant competing hazards, occurrence\/exposure over months k₀\+ \(k₀ = \d+\), applied beyond month \d+/
      );
      for (const r2 of Object.keys(t.exit)) expect(EXIT_ORDER).toContain(r2);
    }
    const thin = fitTransitions([], [], AS_OF, LIVE, NO_CTX);
    for (const [, , t] of transitionsOf(thin.transitions)) {
      expect(t.tailProvenance.tier).toBe(t.provenance.tier);
      expect(t.tailProvenance.sources).toEqual(t.provenance.sources);
    }
    expect(() => parseCalibration(withTransitions(thin.transitions))).not.toThrow();
  });

  it('is deterministic', () => {
    const { spells, unobserved } = world(3);
    const a = fitTransitions(spells, unobserved, AS_OF, LIVE, NO_CTX);
    const b = fitTransitions(spells, unobserved, AS_OF, LIVE, NO_CTX);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
