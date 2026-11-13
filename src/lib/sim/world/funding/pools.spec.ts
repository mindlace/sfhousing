// world-funding Task 5: pools, arrivals and money events (spec rules 12, 13, 14, 16).
import { describe, expect, it } from 'vitest';
import type { BundleFunding, ItemFunding } from '$lib/sim/finance';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { financeIndexOf, type Award } from '$lib/sim/scenario/funding';
import { Treasury, type LedgerEvent } from '$lib/sim/scenario/money';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { STAGE_ORDER } from '$lib/timelapse/types';
import { monthFirstDay, monthLastDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { benchInput } from '../test/cities.node';
import { NO_DAY, type StepCtx, type StepSink, type World, type WorldEvent } from '../types';
import { withFunding } from '../world';
import { fundOf, moneyRowsOf, poolRowOf, type FundPools } from './columns';
import { frameMoney } from './frame-money';
import { availableOf, commitAward, moneyOnEvent } from './pools';
import { createFundingSystem } from './system';
import { benchFunded, fundedMini, oneMoneyTimeline } from './test/fixtures';

type Finance = NonNullable<SimInput['finance']>;

const CONSTRUCTION = STAGE_ORDER.indexOf('construction');
const LAMBDA = 0.37;

const input = fundedMini();
const statics = staticsOf(input);
/** The mini money with a loss on exit that rounds (λ = 0.37). */
const fin: Finance = (() => {
  const f = miniFinance(input.asOf);
  return { ...f, terms: { ...f.terms, lossOnExit: LAMBDA } };
})();
const timeline = oneMoneyTimeline(input, fin);
const NOWHERE: StepSink = { event() {} };

/** A hand-made `StepCtx` for `month` (no starts, no displacement). */
function ctxOf(
  world: World,
  month: number,
  out: StepSink,
  t: PolicyTimeline = timeline,
  s: Statics = statics
): StepCtx {
  return {
    world,
    due: {
      take() {
        throw new Error('no take');
      },
      put() {},
      drop() {}
    },
    statics: s,
    timeline: t,
    frame: t.frameAt(month),
    month,
    seed: 1,
    out,
    firstDay: monthFirstDay(s.asOf, month),
    lastDay: monthLastDay(s.asOf, month),
    startProject() {
      throw new Error('no starts here');
    },
    displace() {
      throw new Error('no displacement here');
    }
  };
}

const item = (o: Partial<ItemFunding>): ItemFunding => ({
  grantEquivalent: 0,
  granted: 0,
  lent: 0,
  guaranteed: 0,
  reserve: 0,
  ...o
});

/** An award of every mini programme: two grants (one uncapped), a loan and a guarantee. */
const UNITS = 37;
const AWARD: Award = {
  set: [0, 1, 2, 3],
  priced: {
    items: [
      item({ granted: 12_345.67 }),
      item({ granted: 50_000.3 }),
      item({ lent: 98_765.4 }),
      item({ guaranteed: 210_000.9, reserve: 21_000.1 })
    ],
    grantEquivalent: 0,
    coverage: 0,
    certain: false
  } satisfies BundleFunding,
  asks: new Map()
};

const AWARD_MONTH = 2;
const ENTER_MONTH = 5;
const END_MONTH = 20;
const dayIn = (m: number, d: number): Day => monthFirstDay(input.asOf, m) + d;

/** Today's ledger for one awarded project: `Treasury.award`, then `settle` on each event day. */
function treasuryLedger(entered: Day | undefined, end: Schedule['end']) {
  const events: LedgerEvent[] = [];
  const t = new Treasury(
    financeIndexOf(fin),
    input.asOf,
    input.asOf + 100_000,
    LAMBDA,
    (e) => events.push(e),
    () => {}
  );
  const s = { entered: entered === undefined ? {} : { construction: entered }, end };
  t.award(dayIn(AWARD_MONTH, 4), AWARD, UNITS, s as unknown as Schedule);
  const days = new Set<Day>();
  if (entered !== undefined) days.add(entered);
  if (end.kind !== 'open') days.add(end.day);
  for (const d of [...days].sort((a, b) => a - b)) t.settle(d);
  return { events, state: t.state };
}

/**
 * The same project in a world: `commitAward`, then (when it enters construction) the `'enter'`,
 * then the `'end'`, each through `moneyOnEvent` in its own month.
 */
function worldLedger(entered: Day | undefined, how: 'complete' | 'exit', withLedger = true) {
  const events: LedgerEvent[] = [];
  const out: StepSink = withLedger ? { event() {}, ledger: (e) => events.push(e) } : NOWHERE;
  const world = withFunding(createFundingSystem()).createWorld(statics, timeline, 1, NOWHERE);
  const row = world.projects.n - 1;
  const p = world.projects;
  p.entered[row * 7 + CONSTRUCTION] = NO_DAY;
  const c2 = ctxOf(world, AWARD_MONTH, out);
  commitAward(c2, frameMoney(timeline, c2.frame), row, dayIn(AWARD_MONTH, 4), AWARD, UNITS);
  const rowsAfterAward = moneyRowsOf(fundOf(world).pools, row);
  if (entered !== undefined) {
    p.entered[row * 7 + CONSTRUCTION] = entered;
    const e: WorldEvent = { kind: 'enter', row, day: entered, stage: 'construction' };
    moneyOnEvent(ctxOf(world, ENTER_MONTH, out), e);
  }
  const end: WorldEvent = { kind: 'end', row, day: dayIn(END_MONTH, 9), how };
  moneyOnEvent(ctxOf(world, END_MONTH, out), end);
  return { events, world, row, rowsAfterAward };
}

/** The pool counters of `pools` by pool id, as `PoolState`s. */
function statesOf(pools: FundPools) {
  return Object.fromEntries(
    Array.from({ length: pools.n }, (_, q) => [
      pools.id[q],
      {
        received: pools.received[q],
        committed: pools.committed[q],
        spentGrant: pools.spentGrant[q],
        outLoan: pools.outLoan[q],
        lostLoan: pools.lostLoan[q],
        lostGuarantee: pools.lostGuarantee[q]
      }
    ])
  );
}

function treasuryStates(state: { received: number }[]) {
  return Object.fromEntries(fin.pools.map((p, q) => [p.id, state[q]]));
}

describe('pools, arrivals and money events', () => {
  it("rule 12: under the bench baseline, after month 1 every capped baseline pool has received its first year's inflow", () => {
    const bench = benchFunded(benchInput());
    const money = bench.finance!;
    const bt = oneMoneyTimeline(bench, money);
    const bs = staticsOf(bench);
    const ledger: LedgerEvent[] = [];
    const out: StepSink = { event() {}, ledger: (e) => ledger.push(e) };
    const core = withFunding(createFundingSystem());
    const world = core.createWorld(bs, bt, 1, out);
    const due = core.planDue(world, bs, bt, 1, 1);
    core.step(world, due, bs, bt, 1, out);
    expect(world.month).toBe(1);

    const { pools } = fundOf(world);
    let capped = 0;
    for (const p of money.pools) {
      const q = poolRowOf(pools, p.id);
      if (p.uncapped) {
        expect(pools.received[q]).toBe(0);
        continue;
      }
      capped++;
      const fl = p.inflows[0];
      expect(fl.kind).toBe('yearly');
      if (fl.kind !== 'yearly') continue;
      expect(fl.from).toBe(bench.asOf);
      expect(pools.received[q]).toBe(fl.dollarsPerYear);
      expect(pools.moneyDay[q]).toBe(bench.asOf);
      expect(pools.moneyMonth[q]).toBe(1);
      expect(availableOf(pools, q, p)).toBe(fl.dollarsPerYear);
    }
    expect(capped).toBe(7);
    const ins = ledger.filter((e) => e.kind === 'in');
    expect(ins).toEqual(
      money.pools
        .filter((p) => !p.uncapped)
        .map((p) => ({
          day: bench.asOf,
          pool: p.id,
          programme: null,
          kind: 'in',
          dollars: p.inflows[0].kind === 'yearly' ? p.inflows[0].dollarsPerYear : -1
        }))
    );
    const federal = poolRowOf(pools, 'federal');
    expect(
      availableOf(
        pools,
        federal,
        money.pools.find((p) => p.id === 'federal')!
      )
    ).toBe(Infinity);
  });

  it('rule 14: one world stepped with and without a ledger gives the same events and pool columns', () => {
    let ins = 0;
    for (const seed of [1, 2, 3]) {
      const runs = [true, false].map((withLedger) => {
        const events: WorldEvent[] = [];
        const ledger: LedgerEvent[] = [];
        const out: StepSink = withLedger
          ? { event: (e) => events.push(e), ledger: (e) => ledger.push(e) }
          : { event: (e) => events.push(e) };
        const core = withFunding(createFundingSystem());
        const world = core.createWorld(statics, timeline, seed, out);
        const due = core.planDue(world, statics, timeline, seed, 48);
        for (let m = 1; m <= 48; m++) core.step(world, due, statics, timeline, seed, out);
        return { events, ledger, world };
      });
      expect(runs[0].events).toEqual(runs[1].events);
      expect(runs[0].world).toEqual(runs[1].world);
      expect(runs[1].ledger).toEqual([]);
      // The ledger's arrivals add up to each pool's `received`.
      const { pools } = fundOf(runs[0].world);
      for (let q = 0; q < pools.n; q++) {
        const sum = runs[0].ledger
          .filter((e) => e.kind === 'in' && e.pool === pools.id[q])
          .reduce((a, e) => a + e.dollars, 0);
        expect(pools.received[q]).toBe(sum);
      }
      ins += runs[0].ledger.length;
    }
    expect(ins).toBeGreaterThan(0);

    // Money events too: the same award, entry and exit with and without a ledger.
    const C = dayIn(ENTER_MONTH, 2);
    const a = worldLedger(C, 'exit', true);
    const b = worldLedger(C, 'exit', false);
    expect(a.events.length).toBeGreaterThan(0);
    expect(b.events).toEqual([]);
    expect(a.world.pools).toEqual(b.world.pools);
  });

  it('money events: for a funded row that enters construction and completes, the ledger matches money.ts amounts', () => {
    const C = dayIn(ENTER_MONTH, 2);
    const E = dayIn(END_MONTH, 9);
    const ours = worldLedger(C, 'complete');
    const today = treasuryLedger(C, { kind: 'complete', day: E });
    expect(ours.events).toEqual(today.events);

    // Explicitly: G spent on the construction day, P spent then repaid, H released.
    const G0 = Math.round(12_345.67 * UNITS);
    const G1 = Math.round(50_000.3 * UNITS);
    const P = Math.round(98_765.4 * UNITS);
    const H = Math.round(21_000.1 * UNITS);
    const at = (d: Day) => ours.events.filter((e) => e.day === d);
    expect(at(C).map((e) => [e.programme, e.kind, e.dollars])).toEqual([
      ['m-city-grant', 'spend', G0],
      ['federal-grant', 'spend', G1],
      ['m-bank-loan', 'spend', P]
    ]);
    expect(at(E).map((e) => [e.programme, e.kind, e.dollars])).toEqual([
      ['m-bank-loan', 'repay', P],
      ['m-city-guarantee', 'release', H]
    ]);

    const { pools } = fundOf(ours.world);
    expect(statesOf(pools)).toEqual(treasuryStates(today.state));
    // The award made one money row per programme; the end dropped them.
    expect(ours.rowsAfterAward[1] - ours.rowsAfterAward[0]).toBe(4);
    expect(moneyRowsOf(pools, ours.row)).toEqual([0, 0]);
    expect(pools.mN).toBe(0);
    // A repayment or release to a capped pool dates its money; the uncapped pool is untouched.
    for (const id of ['m-bank', 'm-city']) {
      const q = poolRowOf(pools, id);
      expect([pools.moneyDay[q], pools.moneyMonth[q]]).toEqual([E, END_MONTH]);
    }
    expect(pools.moneyMonth[poolRowOf(pools, 'federal')]).toBe(0);
  });

  it('an exit after construction books loss and repayment as money.ts does, guarantee release before its loss', () => {
    const C = dayIn(ENTER_MONTH, 2);
    const E = dayIn(END_MONTH, 9);
    const ours = worldLedger(C, 'exit');
    const today = treasuryLedger(C, {
      kind: 'exit',
      stage: 'construction',
      reason: 'cancelled',
      day: E
    });
    expect(ours.events).toEqual(today.events);
    expect(statesOf(fundOf(ours.world).pools)).toEqual(treasuryStates(today.state));

    const G0 = Math.round(12_345.67 * UNITS);
    const G1 = Math.round(50_000.3 * UNITS);
    const P = Math.round(98_765.4 * UNITS);
    const H = Math.round(21_000.1 * UNITS);
    const Q = Math.round(210_000.9 * UNITS);
    const L = Math.round(LAMBDA * P);
    expect(
      ours.events.filter((e) => e.day === E).map((e) => [e.programme, e.kind, e.dollars])
    ).toEqual([
      ['m-bank-loan', 'repay', P - L],
      ['m-city-grant', 'loss', Math.round(LAMBDA * G0)],
      ['federal-grant', 'loss', Math.round(LAMBDA * G1)],
      ['m-bank-loan', 'loss', L],
      ['m-city-guarantee', 'release', H],
      ['m-city-guarantee', 'loss', Math.min(Math.round(LAMBDA * Q), H)]
    ]);

    // Before construction: every commitment is released, nothing spent or lost.
    const before = worldLedger(undefined, 'exit');
    const todayBefore = treasuryLedger(undefined, {
      kind: 'exit',
      stage: 'filed',
      reason: 'withdrawn',
      day: E
    });
    expect(before.events).toEqual(todayBefore.events);
    expect(before.events.filter((e) => e.day === E).map((e) => e.kind)).toEqual([
      'release',
      'release',
      'release',
      'release'
    ]);
    const pools = fundOf(before.world).pools;
    expect(statesOf(pools)).toEqual(treasuryStates(todayBefore.state));
    for (let q = 0; q < pools.n; q++) expect(pools.committed[q]).toBe(0);
  });

  it('nothing reads pools[q].inflows', () => {
    const frames = new Map<number, PolicyFrame>();
    const guarded: PolicyTimeline = {
      ...timeline,
      frameAt(m) {
        let f = frames.get(m);
        if (f === undefined) {
          const base = timeline.frameAt(m);
          const pools = base.finance!.pools.map((p) => {
            const copy = { ...p };
            Object.defineProperty(copy, 'inflows', {
              enumerable: false,
              get() {
                throw new Error(`pools[${p.id}].inflows was read`);
              }
            });
            return copy;
          });
          f = { ...base, finance: { ...base.finance!, pools } };
          frames.set(m, f);
        }
        return f;
      }
    };
    const ledger: LedgerEvent[] = [];
    const out: StepSink = { event() {}, ledger: (e) => ledger.push(e) };
    const core = withFunding(createFundingSystem());
    const world = core.createWorld(statics, guarded, 1, out);
    const due = core.planDue(world, statics, guarded, 1, 24);
    for (let m = 1; m <= 24; m++) core.step(world, due, statics, guarded, 1, out);
    expect(world.month).toBe(24);
    expect(ledger.some((e) => e.kind === 'in')).toBe(true);
    expect(() => guarded.frameAt(1).finance!.pools[0].inflows).toThrow(/inflows was read/);
  });
});
