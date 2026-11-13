// Policy-timeline Task 12, the acceptance round trip (spec, "Tests that must pass", first bullet):
// for a set of schema 3 documents, the frames of
// `compileTimeline(reconcilePolicy4(upgradePolicy(p, asOf), cal, asOf), …, 'plan')` reproduce what
// `applyLevers(compileLevers(p))` gives today, month by month.
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { applyLevers, type LeverInputs } from '$lib/sim/levers/apply';
import { fundingOnly } from '$lib/sim/levers/fixtures/finance';
import { allNeeds, fillNeeds, resolveEnvelopes } from '$lib/sim/levers/resolve';
import { sameScale, type StageScale } from '$lib/sim/levers/timers';
import { MAX_SCALE, MIN_SCALE, type TimedStage } from '$lib/sim/levers/types';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { miniFunding, miniMarket } from '$lib/sim/scenario/fixtures/mini-market';
import { financeIndexOf, inflowArrivals, isOff, isOffered } from '$lib/sim/scenario/funding';
import { precomputeOf, type Precompute } from '$lib/sim/scenario/input';
import type { SimInput } from '$lib/sim/scenario/types';
import {
  compileLevers,
  DEFAULT_POLICY,
  parseSimPolicy,
  queryKey,
  ruleQueries,
  customQuery,
  type CustomBrush,
  type SimPolicy,
  type ZoningRule
} from '$lib/sim-page/policy';
import { reconcileTiming } from '$lib/sim-page/reconcile';
import { PRESETS, resolvePreset, setStageMonths, type TimingSet } from '$lib/sim-page/timing';
import { reconcilePolicy4 } from '$lib/timeline/reconcile4';
import { upgradePolicy } from '$lib/timeline/upgrade';
import type { Day } from '$lib/timelapse/time';
import type { Pathway, Pool, Programme } from '$lib/timelapse/types';
import { monthFirstDay, monthLastDay, monthOfDay } from '../months';
import { compileTimeline, type CompileCtx } from './compile';
import { firstDifference } from './compare';
import type { PolicyFrame, PolicyTimeline, ZoningView } from './frame';
import { lookupsAt } from './lookups';
import { fakeRows, miniCompileCtx } from './test/compile-fixtures';

const W = 120;
const ROUTES: Pathway[] = ['discretionary', 'streamlined', 'permitOnly'];
const IDENTITY: StageScale = { discretionary: {}, streamlined: {}, permitOnly: {} };

/**
 * The mini city with `miniFinance()` and a market step, on 120 months. The calibration carries a
 * market model and a `baselineFunding` naming `miniFinance()`'s pools and programmes, so money
 * reconciles without drops and is usable (the mini calibration has neither).
 */
function ctxOf(): CompileCtx {
  const base = miniCompileCtx({ finance: true, market: true, windowMonths: W });
  const fin = base.input.finance!;
  const input: SimInput = {
    ...base.input,
    calibration: {
      ...base.input.calibration,
      market: miniMarket(),
      baselineFunding: {
        ...miniFunding(),
        pools: structuredClone(fin.pools),
        programmes: structuredClone(fin.programmes)
      }
    }
  };
  return { ...base, input };
}

const CTX = ctxOf();
const ASOF: Day = CTX.input.asOf;
const CAL = CTX.input.calibration;

// ---- lots ----

const stroke = (lng: number, radiusM: number) => ({
  path: [[lng, 37.7] as [number, number]],
  radiusM
});
const PAINT_A: CustomBrush = {
  id: 'paint-a',
  kind: 'paint',
  strokes: [stroke(-122.4, 50)],
  stories: 7
};
const ERASE: CustomBrush = { id: 'erase', kind: 'erase', strokes: [stroke(-122.41, 60)] };
const PAINT_B: CustomBrush = {
  id: 'paint-b',
  kind: 'paint',
  strokes: [stroke(-122.42, 70)],
  stories: 9
};
const PAINT_P: CustomBrush = {
  id: 'paint-p',
  kind: 'paint',
  strokes: [stroke(-122.43, 80)],
  stories: 8
};

const RULE_METRO: ZoningRule = {
  id: 'metro',
  kind: 'transit',
  stopTypes: ['metro'],
  bands: [
    { maxM: 402, stories: 9 },
    { maxM: 805, stories: 6 }
  ]
};
const RULE_BUS: ZoningRule = {
  id: 'bus',
  kind: 'transit',
  stopTypes: ['frequentBus'],
  bands: [{ maxM: 402, stories: 12 }]
};

// District-1 lots outside the Local Program with no base cap, and lots with protected
// buildings (as zoning-view.spec.ts uses them).
const [m805, m402] = ruleQueries(RULE_METRO).map(queryKey);
const LOTS: Record<string, ParcelId[]> = {
  [m805]: ['0026T001A', '2999A001', '3512005', '3600014'],
  [m402]: ['0026T001A', '2999A001'],
  [queryKey(ruleQueries(RULE_BUS)[0])]: ['2999A001', '3600014'],
  [queryKey(customQuery(PAINT_A))]: ['2999A001', '2999A013', '3512005', '3600014', '3600016'],
  [queryKey(customQuery(ERASE))]: ['2999A013', '3600014'],
  [queryKey(customQuery(PAINT_B))]: ['3512005', '3600016', '0026T002'],
  [queryKey(customQuery(PAINT_P))]: ['0026T009', '2999A009', '3512014']
};
const lots = (k: string) => LOTS[k];

// ---- documents ----

const doc3 = (patch: Partial<SimPolicy>): SimPolicy => ({
  ...structuredClone(DEFAULT_POLICY),
  ...patch
});
const timing = (current: TimingSet): Partial<SimPolicy> => ({ timing: { current, saved: null } });

const AVAILABLE = PRESETS.filter((p) => p.available).map((p) => p.id);
const SB423 = resolvePreset('sb423Clock', CAL);

/** sb423Clock's `new` timer on streamlined `filed`, with `all` edits beside it on other stages. */
function customTimers(): TimingSet {
  let s = SB423;
  s = setStageMonths(CAL, s, 'discretionary', 'filed', 3).set;
  s = setStageMonths(CAL, s, 'streamlined', 'permitFiled', 2).set;
  return s;
}

const RATE_CUT = { guaranteeRateCut: 0.01 };

const cityGrant: Programme = {
  id: 'u-city-grant',
  label: 'Extra city grant',
  pool: 'm-city',
  reach: 'affordable',
  instrument: { kind: 'grant', share: 0.2 },
  from: ASOF + 365,
  to: null,
  minHomes: 2,
  tiers: { veryLow: 0.4, low: 0.4, moderate: 0.2, aboveModerate: 0 }
};

/**
 * An added pool whose money arrives inside the window (`fundingOnly()`'s inflow is dated before
 * the mini city's asOf): once on the last day of month 1 (asOf + 30) and the first day of month 2
 * (asOf + 31), and yearly from asOf + 60. With a programme on it.
 */
const latePool: Pool = {
  id: 'u-pool-late',
  kind: 'generalRevenue',
  label: 'Late pool',
  inflows: [
    { kind: 'once', day: ASOF + 30, dollars: 300_000 },
    { kind: 'once', day: ASOF + 31, dollars: 310_000 },
    { kind: 'yearly', from: ASOF + 60, to: null, dollarsPerYear: 2_000_000 }
  ],
  uncapped: false,
  debt: null,
  leverage: 1
};
const lateGrant: Programme = { ...cityGrant, id: 'u-late-grant', pool: 'u-pool-late', from: ASOF };

interface Case {
  name: string;
  p: SimPolicy;
  /** Money levers that must reach `buildFinance` (no case is vacuous). */
  money?: boolean;
}

const CASES: Case[] = [
  { name: 'the default', p: doc3({}) },
  ...AVAILABLE.map((id): Case => ({
    name: `preset ${id}`,
    p: doc3(timing(resolvePreset(id, CAL)))
  })),
  { name: 'two rules', p: doc3({ rules: [RULE_METRO, RULE_BUS] }) },
  { name: 'paint, erase, paint', p: doc3({ custom: [PAINT_A, ERASE, PAINT_B] }) },
  {
    name: 'all three protections',
    p: doc3({
      custom: [PAINT_P],
      protect: { rentControl: true, historic: true, newerThanYears: 15 }
    })
  },
  { name: 'custom timers beside a new preset', p: doc3(timing(customTimers())) },
  {
    name: 'custom route shares',
    p: doc3(
      timing({
        ...structuredClone(SB423),
        routeShares: { discretionary: 20, streamlined: 70, permitOnly: 10 }
      })
    )
  },
  {
    name: 'baseline scales',
    money: true,
    p: doc3({
      funding: {
        baselineScale: [
          { pool: 'm-bank', from: ASOF + 200, scale: 2 },
          { pool: 'm-city', from: ASOF - 30, scale: 1.5 },
          { pool: 'm-city', from: ASOF + 800, scale: 0 }
        ],
        pools: [],
        programmes: [],
        terms: { ...RATE_CUT }
      }
    })
  },
  {
    name: 'fundingOnly plus a programme on a baseline pool',
    money: true,
    p: doc3({
      funding: {
        // fundingOnly's scale names a pool the mini finance lacks; the scales case covers scales
        baselineScale: [],
        pools: [...fundingOnly().pools, latePool],
        programmes: [...fundingOnly().programmes, lateGrant, cityGrant],
        terms: { ...RATE_CUT }
      }
    })
  },
  {
    name: 'typed terms',
    money: true,
    p: doc3({
      funding: {
        baselineScale: [],
        pools: [],
        programmes: [],
        terms: { ...RATE_CUT, constructionRate: 0.07, requiredReturn: 0.08, lossOnExit: 0.5 }
      }
    })
  },
  {
    name: 'everything at once',
    money: true,
    p: doc3({
      rules: [RULE_METRO, RULE_BUS],
      custom: [PAINT_A, ERASE, PAINT_B, PAINT_P],
      protect: { rentControl: true, historic: true, newerThanYears: 15 },
      ...timing(customTimers()),
      funding: {
        baselineScale: [
          { pool: 'm-bank', from: ASOF + 200, scale: 0 },
          { pool: 'm-city', from: ASOF - 30, scale: 1.5 }
        ],
        pools: [...fundingOnly().pools, latePool],
        programmes: [...fundingOnly().programmes, lateGrant, cityGrant],
        terms: { ...RATE_CUT, constructionRate: 0.07 }
      }
    })
  }
];

// ---- the two paths ----

/** Today: `applyLevers(compileLevers(p))` with the needs filled by the fake yields. */
function today(p: SimPolicy): LeverInputs {
  const levers = compileLevers(p, lots)!;
  expect(levers).not.toBeNull();
  const r = resolveEnvelopes(CTX.layers, levers, ASOF);
  return applyLevers(CTX.input, CTX.layers, levers, fillNeeds(r, fakeRows(allNeeds(r))));
}

function compileAll(p: SimPolicy): PolicyTimeline {
  const { doc, report } = reconcilePolicy4(upgradePolicy(p, ASOF), CAL, ASOF);
  expect(report).toEqual({
    timing: [],
    funding: { droppedScales: [], droppedProgrammes: [], unusable: false },
    spans: []
  });
  const c = compileTimeline(doc, LOTS, CTX, 'plan');
  expect(c.step(Infinity)).toBe(true);
  expect(c.missingLots()).toEqual([]);
  return c.result();
}

const months = Array.from({ length: W }, (_, k) => k + 1);

/** A precompute's data, its closures applied to fixed arguments. */
function preData(pre: Precompute) {
  const { parcelIndexOf, skipAbove, ...data } = pre;
  return { ...data, index: parcelIndexOf('2999A001'), skip: skipAbove(monthLastDay(ASOF, W)) };
}

/** `speed` times every `speedNew` scale, per route and stage, clamped. */
function newScaleOf(f: PolicyFrame): StageScale {
  const out: StageScale = { discretionary: {}, streamlined: {}, permitOnly: {} };
  for (const r of ROUTES) {
    const stages = new Set<TimedStage>(Object.keys(f.speed[r]) as TimedStage[]);
    for (const n of f.speedNew)
      for (const s of Object.keys(n.scale[r])) stages.add(s as TimedStage);
    for (const s of stages) {
      let x = f.speed[r][s] ?? 1;
      for (const n of f.speedNew) x *= n.scale[r][s] ?? 1;
      out[r][s] = Math.min(MAX_SCALE, Math.max(MIN_SCALE, x));
    }
  }
  return out;
}

type Arrival = { pool: string; day: Day; dollars: number };

/**
 * Today's arrivals by month: `inflowArrivals` from `asOf` over the window of the capped pools of
 * `li.plan.finance`, off days skipped, each in the month holding its day (`asOf` in month 1).
 * Within a month: by day, then the frame's pool order, then inflow order.
 */
function arrivalsByMonth(fin: NonNullable<SimInput['finance']>, poolOrder: string[]) {
  const idx = financeIndexOf(fin);
  const out = new Map<number, Arrival[]>(months.map((m) => [m, []]));
  fin.pools.forEach((p, q) => {
    if (p.uncapped) return;
    for (const fl of p.inflows) {
      const dollars = fl.kind === 'once' ? fl.dollars : fl.dollarsPerYear;
      for (const day of inflowArrivals(fl, ASOF, monthLastDay(ASOF, W))) {
        if (isOff(idx, q, day)) continue;
        out.get(Math.max(1, monthOfDay(ASOF, day)))!.push({ pool: p.id, day, dollars });
      }
    }
  });
  const rank = (id: string) => poolOrder.indexOf(id);
  for (const a of out.values()) a.sort((x, y) => x.day - y.day || rank(x.pool) - rank(y.pool));
  return out;
}

describe('round trip: dated policies reproduce today’s levers', () => {
  it('the fixtures are not vacuous', () => {
    expect(AVAILABLE).toContain('sb423Clock');
    expect(SB423.presetTimers.some((t) => t.reach === 'new')).toBe(true);
    const custom = customTimers();
    expect(custom.edits.length).toBe(2);
    expect(custom.edits.every((e) => e.reach === 'all')).toBe(true);
    expect(CTX.input.market!.length).toBeGreaterThan(0);
    for (const c of CASES) {
      // each is a valid schema 3 document
      expect(parseSimPolicy(JSON.parse(JSON.stringify(c.p)), { presetLayer: 'reconcile' })).toEqual(
        c.p
      );
      const f = compileLevers(c.p, lots)!.finance;
      const n = f.baselineScale.length + f.pools.length + f.programmes.length;
      if (c.money) {
        expect(n + Object.keys(f.terms).length, c.name).toBeGreaterThan(0);
        const fin = today(c.p).plan.finance!;
        expect(fin, c.name).not.toBe(CTX.input.finance);
        // what the levers add really reaches today's finance
        const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
        for (const pool of f.pools) expect(ids(fin.pools), c.name).toContain(pool.id);
        for (const g of f.programmes) expect(ids(fin.programmes), c.name).toContain(g.id);
        for (const [k, v] of Object.entries(f.terms))
          expect(fin.terms[k as keyof typeof fin.terms], `${c.name} ${k}`).toBe(v);
      }
    }
    // zoning and timing cases change what they claim to
    const plain = today(DEFAULT_POLICY).plan;
    const stories = (x: SimInput) => Array.from(x.parcels.envelopeStories);
    for (const name of ['two rules', 'paint, erase, paint', 'all three protections']) {
      const c = CASES.find((x) => x.name === name)!;
      expect(stories(today(c.p).plan), name).not.toEqual(stories(plain));
    }
    for (const name of ['custom timers beside a new preset', 'preset benchmarkPermits']) {
      const c = CASES.find((x) => x.name === name)!;
      expect(today(c.p).plan.inFlightScale, name).toBeDefined();
    }
    const shares = CASES.find((x) => x.name === 'custom route shares')!;
    expect(today(shares.p).plan.newProjects!.calibration).not.toEqual(plain.calibration);
    const added = CASES.find((x) => x.name.startsWith('fundingOnly'))!.p.funding;
    expect(added.pools.map((x) => x.id)).toEqual(['u-pool-1', 'u-pool-late']);
    expect(added.programmes.map((x) => x.id)).toEqual(['u-prog-1', 'u-late-grant', 'u-city-grant']);
    const typed = CASES.find((x) => x.name === 'typed terms')!.p.funding.terms;
    expect(Object.keys(typed).length).toBe(4);
    const scales = CASES.find((c) => c.name === 'baseline scales')!.p.funding.baselineScale;
    expect(scales.some((e) => e.from < ASOF)).toBe(true);
    expect(scales.some((e) => e.scale === 0)).toBe(true);
  });

  for (const c of CASES) {
    it(c.name, () => {
      const li = today(c.p);
      const t = compileAll(c.p);
      expect(t.readyThrough()).toBe(W);
      const plan = li.plan;
      const fin = plan.finance!;
      expect(fin).toBeDefined();
      const idx = financeIndexOf(fin);
      const wantPre = preData(precomputeOf(plan));
      const wantInFlight = plan.inFlightScale ?? IDENTITY;
      const seenViews = new Set<ZoningView>();
      const seenIds = new Set<number>();
      const poolIds = fin.pools.map((p) => p.id);
      const progIds = fin.programmes.map((g) => g.id);
      const arrivals = arrivalsByMonth(fin, poolIds);
      let total = 0;
      let addedArrivals = 0;
      const wantChanges: number[] = [];
      let prevOffered: string | null = null;

      for (const m of months) {
        const f = t.frameAt(m);
        if (!seenViews.has(f.view)) {
          seenViews.add(f.view);
          expect(f.view.parcels).toEqual(plan.parcels);
          expect(preData(f.view.pre)).toEqual(wantPre);
        }
        expect(f.calibration).toBe(plan.calibration);
        expect(f.newCalibration, `newCalibration, month ${m}`).toEqual(
          plan.newProjects!.calibration
        );
        if (!seenIds.has(f.id)) {
          seenIds.add(f.id);
          expect(lookupsAt(f)).toEqual(li.lookups);
        }
        expect(sameScale(f.speed, wantInFlight), `speed, month ${m}`).toBe(true);
        expect(sameScale(newScaleOf(f), plan.newProjects!.scale), `new, month ${m}`).toBe(true);
        expect(f.market).toBe(CTX.input.market![0].logOdds);

        const ff = f.finance!;
        expect(ff).not.toBeNull();
        expect(ff.pools.map((p) => p.id)).toEqual(poolIds);
        expect(ff.pools).toEqual(fin.pools);
        expect(ff.programmes.map((g) => g.id)).toEqual(progIds);
        expect(ff.programmes).toEqual(fin.programmes);
        expect(ff.terms).toEqual(fin.terms);
        expect(ff.slope).toBe(fin.slope);
        const first = monthFirstDay(ASOF, m);
        const offered = progIds.map((_, g) => (isOffered(idx, g, first) ? 1 : 0));
        expect(Array.from(ff.offered), `offered, month ${m}`).toEqual(offered);
        const got = ff.arrivals.map((a) => ({
          pool: ff.pools[a.pool].id,
          day: a.day,
          dollars: a.dollars
        }));
        expect(got, `arrivals, month ${m}`).toEqual(arrivals.get(m));
        total += got.length;
        addedArrivals += got.filter((a) => a.pool.startsWith('u-')).length;

        // Frames change only where today's offered set does (market and policies are constant).
        const key = offered.join('');
        if (prevOffered !== null && key !== prevOffered) wantChanges.push(m);
        prevOffered = key;
      }
      expect(total).toBeGreaterThan(0);
      // an added pool's money arrives in the window, as today's `inflowArrivals` gives it
      if (c.p.funding.pools.length > 0) expect(addedArrivals).toBeGreaterThan(0);
      expect(t.changes()).toEqual(wantChanges);
      expect(firstDifference(t, compileAll(c.p))).toBeNull();
    });
  }

  it('months are anchored on the day after asOf, independent of ../months', () => {
    // rule 4, design 3.3: month 1 begins the day after asOf; month 2 at asOf + floor(30.436875) + 1
    expect(monthFirstDay(ASOF, 1)).toBe(ASOF + 1);
    expect(monthFirstDay(ASOF, 2)).toBe(ASOF + 31);
    const c = CASES.find((x) => x.name.startsWith('fundingOnly'))!;
    const t = compileAll(c.p);
    const late = (m: number) => {
      const ff = t.frameAt(m).finance!;
      return ff.arrivals.filter((a) => ff.pools[a.pool].id === 'u-pool-late').map((a) => a.day);
    };
    expect(late(1)).toEqual([ASOF + 30]);
    // month 2 runs to asOf + floor(2 × 30.436875) = asOf + 60
    expect(late(2)).toEqual([ASOF + 31, ASOF + 60]);
    expect(late(3)).toEqual([]);
    // the policy is in force from month 1: its programme is offered on ASOF + 1
    const ff = t.frameAt(1).finance!;
    expect(ff.offered[ff.programmes.findIndex((g) => g.id === 'u-late-grant')]).toBe(1);
  });

  it('the default and the zoning-only documents give one frame on a dataset without dated money', () => {
    const fin = miniFinance(ASOF);
    // the mini finance's dated pieces: m-bank's off span (months 66 to 79)
    expect(fin.off.length).toBe(1);
    const plain: CompileCtx = { ...CTX, input: { ...CTX.input, finance: { ...fin, off: [] } } };
    for (const c of CASES.filter((x) => !x.money)) {
      const { doc } = reconcilePolicy4(upgradePolicy(c.p, ASOF), CAL, ASOF);
      const comp = compileTimeline(doc, LOTS, plain, 'plan');
      expect(comp.step(Infinity)).toBe(true);
      expect(comp.result().changes(), c.name).toEqual([]);
    }
  });
});

/**
 * A schema 3 document with `localProgramStreamlined: false` is not a valid document today: the
 * strict parser rejects it and `reconcileTiming` restores the preset's switch when it is opened.
 * The upgraded document reconciles the same way, and then matches today's reconciled levers.
 */
describe('round trip: localProgramStreamlined false reconciles as today', () => {
  it('reports the same preset refit and reproduces the reconciled schema 3 document', () => {
    const set: TimingSet = {
      ...structuredClone(SB423),
      routeShares: { discretionary: 20, streamlined: 70, permitOnly: 10 },
      localProgramStreamlined: false
    };
    const p = doc3(timing(set));
    const r3 = reconcileTiming(p.timing, CAL);
    const { doc, report } = reconcilePolicy4(upgradePolicy(p, ASOF), CAL, ASOF);
    expect(report.timing.map((x) => x.change)).toEqual(r3.changes);
    expect(r3.changes.length).toBeGreaterThan(0);
    const fixed = { ...p, timing: r3.timing };
    expect(fixed.timing.current.localProgramStreamlined).toBe(true);
    expect(fixed.timing.current.routeShares).toEqual(set.routeShares);
    const li = today(fixed);
    const c = compileTimeline(doc, LOTS, CTX, 'plan');
    expect(c.step(Infinity)).toBe(true);
    const t = c.result();
    for (const m of [1, W]) {
      const f = t.frameAt(m);
      expect(f.view.parcels).toEqual(li.plan.parcels);
      expect(f.newCalibration).toEqual(li.plan.newProjects!.calibration);
      expect(sameScale(newScaleOf(f), li.plan.newProjects!.scale)).toBe(true);
    }
  });
});
