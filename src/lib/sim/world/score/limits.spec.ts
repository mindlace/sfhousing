// Rule 12: the money view as of `filledThrough`. `limits` come from the timeline's pools and every
// arrival in the window (seed-free, fixed as the forecast fills); `owed` and `perAddedHome` are
// today's quantities read at `filledThrough`, on world 1's money alone.
import { beforeAll, describe, expect, it } from 'vitest';
import { debtService, limitStatements } from '$lib/sim/finance';
import { buildFinance } from '$lib/sim/levers/finance';
import type { FinanceLevers } from '$lib/sim/levers/types';
import { addMonths, firstOfMonth } from '$lib/sim/scenario/dates';
import {
  addedBorrowing,
  cityOf,
  displacedShare,
  moneyOf,
  perAddedHome
} from '$lib/sim/scenario/finance-score';
import { miniCalibrationWithRoutes, miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { monthsOf } from '$lib/sim/scenario/score';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Effect, Policy } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { Pool, Programme } from '$lib/timelapse/types';
import { monthFirstDay } from '../months';
import { compileTimeline } from '../policy/compile';
import type { PolicyTimeline } from '../policy/frame';
import { miniCompileCtx } from '../policy/test/compile-fixtures';
import { miniDoc, span } from '../policy/test/fixtures';
import { staticsOf, type Statics } from '../statics';
import { readAll } from '../test/run';
import { frameOf, oneFrame } from '../test/timeline';
import type { World, WorldEvent } from '../types';
import { chunkOf } from './chunk';
import { createWorldSeries } from './series';
import { horizonOf, planFinanceOf, scoreStaticsOf } from './statics';
import { TEST_RHNA, feedFunded, feedWorld, testStatics, timelineStatics } from './test/feed';
import type { MoneyFeed, ScoreStatics, SeriesChunk, WorldSeries } from './types';
import { chunksBefore, viewOf } from './view';

type Finance = NonNullable<SimInput['finance']>;

/** Model months in the window (20 years). */
const W = 240;

const BOND_DEBT = { rate: 0.05, termYears: 20 };
const TIERS = { veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 };

/** The mini city's money with a baseline general-obligation pool (test values). */
function baseFinance(asOf: Day): Finance {
  const f = miniFinance(asOf);
  const bond: Pool = {
    id: 'm-bond',
    kind: 'goBond',
    label: 'Baseline bond',
    inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 5_000_000 }],
    uncapped: false,
    debt: BOND_DEBT,
    leverage: 1
  };
  return { ...f, pools: [...f.pools, bond] };
}

/** A policy on the mini city's dataset date over model-month ranges. */
function pol(id: string, where: Policy['where'], what: Effect, months: [number, number | null][]) {
  const asOf = INPUT.asOf;
  const p: Policy = {
    id,
    label: id,
    preset: null,
    on: true,
    where,
    spans: months.map(([a, b]) => span(asOf, a, b, what))
  };
  return p;
}

const CTX = miniCompileCtx({ finance: true, windowMonths: W });
const INPUT: SimInput = (() => {
  const finance = baseFinance(CTX.input.asOf);
  const prov = {
    tier: 4 as const,
    label: 'test',
    sources: [{ label: 'test', url: 'https://example.org/test' }],
    method: 'test'
  };
  return {
    ...CTX.input,
    calibration: {
      ...miniCalibrationWithRoutes(),
      // the dataset's baseline, so the document's scale on m-bond reconciles
      baselineFunding: {
        pools: structuredClone(finance.pools),
        programmes: structuredClone(finance.programmes),
        provenance: Array.from({ length: finance.pools.length + 1 }, () => ({ ...prov })),
        check: { impliedHomesPerYear: 20, observedHomesPerYear: 25, provenance: { ...prov } }
      }
    },
    finance
  };
})();

/** The added bond pool and its grant programme (test values). */
function addedBond(): { bond: Pool; grant: Programme } {
  const asOf = INPUT.asOf;
  const bond: Pool = {
    id: 'u-bond',
    kind: 'goBond',
    label: 'Added bond',
    inflows: [{ kind: 'yearly', from: asOf, to: null, dollarsPerYear: 12_000_000 }],
    uncapped: false,
    debt: { rate: 0.04, termYears: 30 },
    leverage: 1
  };
  const grant: Programme = {
    id: 'u-bond-grant',
    label: 'Added bond grant',
    pool: 'u-bond',
    reach: 'affordable',
    instrument: { kind: 'grant', share: 0.3 },
    from: asOf,
    to: null,
    minHomes: 2,
    tiers: { ...TIERS }
  };
  return { bond, grant };
}

const TERMS = { guaranteeRateCut: 0.01 };
const SCALE = () => [{ pool: 'm-bond', from: monthFirstDay(INPUT.asOf, 13), scale: 2 }];

/**
 * The plan: the baseline bond doubled from month 13, and an added bond pool with a grant
 * programme, in force for months 1-24 and from month 37 (so months 25-36 drop its arrivals).
 */
function planDoc() {
  const { bond, grant } = addedBond();
  return miniDoc(
    pol('t', { tag: 'terms' }, { tag: 'terms', terms: TERMS }, [[1, null]]),
    pol('b', { tag: 'baseline' }, { tag: 'scales', entries: SCALE() }, [[13, null]]),
    pol('f', { tag: 'fund', pool: 'u-bond' }, { tag: 'fund', pool: bond, programmes: [grant] }, [
      [1, 24],
      [37, null]
    ])
  );
}

/** The same money with constant levers: every policy in force from month 1. */
function constantDoc() {
  const { bond, grant } = addedBond();
  return miniDoc(
    pol('t', { tag: 'terms' }, { tag: 'terms', terms: TERMS }, [[1, null]]),
    pol('b', { tag: 'baseline' }, { tag: 'scales', entries: SCALE() }, [[1, null]]),
    pol('f', { tag: 'fund', pool: 'u-bond' }, { tag: 'fund', pool: bond, programmes: [grant] }, [
      [1, null]
    ])
  );
}

function compiled(doc = planDoc()): PolicyTimeline {
  const c = compileTimeline(doc, {}, { ...CTX, input: INPUT }, 'plan');
  expect(c.step(Infinity)).toBe(true);
  return c.result();
}

/** The last day of calendar month `i` from the dataset month. */
const lastDay = (asOf: Day, i: number): Day => addMonths(firstOfMonth(asOf), i + 1) - 1;

interface Run {
  series: WorldSeries;
  world: World;
  feed: MoneyFeed;
  /** Every 'displaced' event. */
  displaced: Extract<WorldEvent, { kind: 'displaced' }>[];
}

let statics: Statics;
let timeline: PolicyTimeline;
let score: ScoreStatics;
let plan: Finance;
const runs = new Map<number, Run>();

function run(seed: number): Run {
  let r = runs.get(seed);
  if (r === undefined) {
    const series = createWorldSeries(score);
    const displaced: Run['displaced'] = [];
    const got = feedFunded(statics, timeline, seed, W, series, (e) => {
      if (e.kind === 'displaced') displaced.push(e);
    });
    const feed: MoneyFeed = {
      ledger: got.ledger,
      finance: timeline.frameAt(1).finance!,
      world: got.world,
      statics
    };
    r = { series, world: got.world, feed, displaced };
    runs.set(seed, r);
  }
  return r;
}

/** An unfunded twin world under one frame, its series on statics without money. */
function twin(seed: number): WorldSeries {
  let series = twins.get(seed);
  if (series === undefined) {
    series = createWorldSeries(testStatics(INPUT, W));
    feedWorld(statics, oneFrame(frameOf(INPUT)), seed, W, series, 'live');
    twins.set(seed, series);
  }
  return series;
}
const twins = new Map<number, WorldSeries>();

const chunk = (r: Run, t: WorldSeries, from: number, through: number): SeriesChunk =>
  chunkOf([r.series], [t], r.feed, from, through);

beforeAll(() => {
  statics = staticsOf(INPUT);
  timeline = compiled();
  score = timelineStatics(INPUT, timeline, W);
  plan = planFinanceOf(timeline, INPUT.asOf, W)!;
});

describe('limits (rule 12)', () => {
  it('summing the frames’ arrivals per debt pool equals addedBorrowing of the plan finance', () => {
    const asOf = INPUT.asOf;
    const H = horizonOf(score);
    const sums = new Map<string, number>();
    for (let m = 1; m <= W; m++) {
      const f = timeline.frameAt(m).finance!;
      for (const a of f.arrivals) {
        if (a.day > H) continue;
        const id = f.pools[a.pool].id;
        sums.set(id, (sums.get(id) ?? 0) + a.dollars);
      }
    }
    const gross = addedBorrowing(plan, [], asOf, H);
    expect(gross.map((b) => b.pool)).toEqual(['m-bond', 'u-bond']);
    for (const b of gross) expect(b.principal).toBe(sums.get(b.pool));
    // Not degenerate: the frames drop u-bond's months 25-36 and double m-bond from month 13, so
    // month W's pool definitions without off spans give other sums.
    expect(plan.off.some((o) => o.pool === 'u-bond')).toBe(true);
    const naive = addedBorrowing({ ...timeline.frameAt(W).finance!, off: [] }, [], asOf, H);
    expect(naive).not.toEqual(gross);

    // The engine agrees: world 1's received through the last month is the same sum.
    const view = viewOf([chunk(run(1), twin(1), 0, score.lastIndex)], score);
    for (const id of ['m-bond', 'u-bond']) {
      const p = view.money!.pools.find((q) => q.id === id)!;
      expect(p.received[score.lastIndex]).toBe(sums.get(id));
    }
  });

  it('limits are limitStatements of the borrowing added over the default document’s pools', () => {
    const H = horizonOf(score);
    const want = limitStatements(addedBorrowing(plan, INPUT.finance!.pools, INPUT.asOf, H));
    expect(want.length).toBeGreaterThan(0);
    expect(score.limits).toEqual(want);
    // m-bond adds only its doubling over the baseline's own arrivals
    const added = addedBorrowing(plan, INPUT.finance!.pools, INPUT.asOf, H);
    const gross = addedBorrowing(plan, [], INPUT.asOf, H);
    const m = (xs: typeof added) => xs.find((b) => b.pool === 'm-bond')!.principal;
    expect(m(added)).toBeGreaterThan(0);
    expect(m(added)).toBeLessThan(m(gross));
  });

  it('limits at filledThrough 10 equal limits at lastIndex', () => {
    const r = run(1);
    const t = twin(1);
    const early = viewOf([chunk(r, t, 0, 10)], score);
    const all = viewOf([chunk(r, t, 0, 10), chunk(r, t, 11, score.lastIndex)], score);
    expect(early.filledThrough).toBe(10);
    expect(all.filledThrough).toBe(score.lastIndex);
    expect(early.money!.limits).toEqual(all.money!.limits);
    expect(all.money!.limits).toEqual(score.limits);
    expect(score.limits!.length).toBeGreaterThan(0);
  });

  it('limits are equal for two seeds', () => {
    const a = viewOf([chunk(run(1), twin(1), 0, score.lastIndex)], score);
    const b = viewOf([chunk(run(2), twin(2), 0, score.lastIndex)], score);
    expect(a.money!.publicSpent).not.toEqual(b.money!.publicSpent);
    expect(a.money!.limits).toEqual(b.money!.limits);
    // seed-free: built again, the same
    expect(scoreStaticsOf(INPUT, timeline, 'plan', W, TEST_RHNA(INPUT.asOf)).limits).toEqual(
      score.limits
    );
  });

  it("with constant levers, limits are today's (OD-2)", () => {
    const asOf = INPUT.asOf;
    const { bond, grant } = addedBond();
    const levers: FinanceLevers = {
      baselineScale: SCALE(),
      pools: [bond],
      programmes: [grant],
      terms: TERMS
    };
    const s = timelineStatics(INPUT, compiled(constantDoc()), W);
    // as scenario-host.ts:1194-1202: the plan's finance against the twin's (the base's) pools
    const plan = buildFinance(INPUT.finance, levers, asOf)!;
    const want = limitStatements(addedBorrowing(plan, INPUT.finance!.pools, asOf, horizonOf(s)));
    expect(want.length).toBeGreaterThan(0);
    expect(s.limits).toEqual(want);
    expect(s.debts).toEqual([
      { pool: 'm-bond', debt: BOND_DEBT },
      { pool: 'u-bond', debt: { rate: 0.04, termYears: 30 } }
    ]);
  });

  it('scoreStaticsOf without finance gives limits null', () => {
    const { finance: _f, ...bare } = INPUT;
    void _f;
    const s = testStatics(bare, W);
    expect(s.limits).toBeNull();
    expect(s.debts).toBeNull();
  });
});

describe('the money view at filledThrough (rule 12)', () => {
  it('owed is read at filledThrough', () => {
    const r = run(1);
    const t = twin(1);
    const seen: number[] = [];
    for (const ft of [10, 60, score.lastIndex]) {
      const v = viewOf([chunk(r, t, 0, ft)], score);
      const money = v.money!;
      const want = plan.pools.flatMap((p) => {
        if (p.debt === null) return [];
        const principal = money.pools.find((q) => q.id === p.id)!.received[ft];
        return [
          { pool: p.id, principal, repayment: debtService(principal, p.debt).total, nominal: true }
        ];
      });
      expect(money.owed).toEqual(want);
      seen.push(money.owed[1].principal);
    }
    // the principal grows as the forecast fills
    expect(seen[0]).toBeLessThan(seen[1]);
    expect(seen[1]).toBeLessThan(seen[2]);
  });

  it('is today’s money at filledThrough, its series cut there and limits from the statics', () => {
    const r = run(1);
    const ft = 120;
    const v = viewOf([chunk(r, twin(1), 0, ft)], score);
    const horizon = lastDay(INPUT.asOf, ft);
    const today = moneyOf({
      ledger: r.feed.ledger,
      schedules: readAll(r.world, statics, horizon).schedules,
      finance: plan,
      baseline: INPUT.finance!.pools,
      asOf: INPUT.asOf,
      horizon,
      months: monthsOf(INPUT.asOf, horizon)
    });
    expect(Object.keys(v.money!).sort()).toEqual(Object.keys(today).sort());
    // `displacedHomes` counts each 'displaced' event in its own month (rule 2), not at the funded
    // project's completion as `moneyOf` does: money.spec.ts checks it against the events.
    const strip = (m: typeof today) => ({ ...m, limits: [], displacedHomes: [] });
    expect(strip(v.money!)).toEqual(strip(today));
    const upTo = r.displaced.filter((e) => e.day <= horizon).reduce((a, e) => a + e.units, 0);
    expect(v.money!.displacedHomes[ft]).toBe(upTo);
    expect(v.money!.limits).toEqual(score.limits);
    for (const p of v.money!.pools) expect(p.received).toHaveLength(ft + 1);
  });

  it('a structuredClone of the statics and chunks gives the same view', () => {
    const r = run(1);
    const t = twin(1);
    const chunks = [chunk(r, t, 0, 10), chunk(r, t, 11, 60), chunk(r, t, 61, score.lastIndex)];
    const a = viewOf(chunks, score);
    // Not degenerate: a funded view with every part the page reads.
    expect(a.tiers).not.toBeNull();
    expect(a.tierTargets).not.toBeNull();
    expect(a.money!.owed.length).toBeGreaterThan(0);
    expect(a.money!.limits.length).toBeGreaterThan(0);
    const copy = structuredClone(score);
    const b = viewOf(structuredClone(chunks), copy);
    expect(b.money!.owed).toEqual(a.money!.owed);
    expect(b).toEqual(a);
    // and refilled from a copy, as the page refills
    const before = chunksBefore(structuredClone(chunks), 30);
    expect(viewOf(before, copy)).toEqual(viewOf(chunksBefore(chunks, 30), score));
  });

  it("perAddedHome divides by world 1's funded minus displaced homes at filledThrough", () => {
    const r = run(1);
    let some = 0;
    let none = 0;
    let differ = 0;
    let displacing = 0;
    for (let ft = 0; ft <= score.lastIndex; ft += 6) {
      const a = viewOf([chunk(r, twin(1), 0, ft)], score);
      const b = viewOf([chunk(r, twin(7), 0, ft)], score);
      const m = a.money!;
      const d = m.fundedHomes[ft] - m.displacedHomes[ft];
      const all = d <= 0 ? null : Math.round(m.publicSpent[ft] / d);
      const city = d <= 0 ? null : Math.round(cityOf(m, ft) / d);
      expect(perAddedHome(m, a.filledThrough, 'all')).toBe(all);
      expect(perAddedHome(m, a.filledThrough, 'city')).toBe(city);
      const f = m.fundedHomes[ft];
      expect(displacedShare(m, a.filledThrough)).toBe(f <= 0 ? null : m.displacedHomes[ft] / f);
      if (all !== null && m.displacedHomes[ft] > 0) displacing++;
      // the plan effect does not enter: another twin leaves the money as it was
      if (JSON.stringify(a.planEffect) !== JSON.stringify(b.planEffect)) differ++;
      expect(b.money).toEqual(a.money);
      if (all === null) none++;
      else some++;
    }
    expect(differ).toBeGreaterThan(0);
    expect(some).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(0);
    // Displacement is non-zero at some of the months checked: it enters the denominator.
    expect(displacing).toBeGreaterThan(0);
  });
});
