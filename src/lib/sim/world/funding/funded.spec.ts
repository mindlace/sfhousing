// world-funding Task 7: funded worlds end to end (spec rules 14, 15, 16, 21, "Tests that must
// pass"): the ledger identities after every step on random finances, no money offered is no
// money, a ledger changes nothing, the known limit, a cloned world, a permuted lot table, and
// world 1's calendar-month money series.
import { describe, expect, it } from 'vitest';
import { poolSeries } from '$lib/sim/scenario/finance-score';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { selectRows } from '$lib/sim/scenario/fixtures/select-rows';
import { tinyQueue, tinyStack } from '$lib/sim/scenario/fixtures/tiny-queue';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { monthsOf } from '$lib/sim/scenario/score';
import { checkMoneyIdentities } from '$lib/sim/scenario/test/money-identities';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import type { Inflow } from '$lib/timelapse/types';
import { monthLastDay } from '../months';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf, type Statics } from '../statics';
import { Recorder, runWorld } from '../test/run';
import { frameOf, oneFrame } from '../test/timeline';
import type { StepSink, World } from '../types';
import { withFunding } from '../world';
import { KIND_AFFORDABLE, fundOf } from './columns';
import { createFundingSystem } from './system';
import {
  fundedMini,
  oneMoneyTimeline,
  randomFinance,
  runFunded,
  type MonthEvent
} from './test/fixtures';
import { checkStep, type StepSums } from './test/identities';

type Finance = NonNullable<SimInput['finance']>;

/** 40 years of model months (the old engine's golden horizon is late 2066). */
const MONTHS = 480;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

const input = fundedMini();
const asOf = input.asOf;
const statics = staticsOf(input);
const fin = miniFinance(asOf);
const timeline = oneMoneyTimeline(input, fin);

/** One funded run with E1 to E7 checked after every step. */
function checked(
  s: Statics,
  t: PolicyTimeline,
  seed: number,
  through: number
): ReturnType<typeof runFunded> & { steps: number } {
  let prev: StepSums | null = null;
  let steps = 0;
  const got = runFunded(s, t, seed, through, {
    afterStep(w, m, ledger) {
      prev = checkStep(ledger, w, t.frameAt(m).finance!, prev);
      steps++;
    }
  });
  return { ...got, steps };
}

const awards = (events: readonly MonthEvent[]) => events.filter((e) => e.kind === 'award');

describe('the ledger identities', () => {
  it('E1-E7 after every step on 200 seeded random finances on the mini city', () => {
    let commits = 0;
    let steps = 0;
    for (let n = 1; n <= 200; n++) {
      const finance = randomFinance(n);
      const got = checked(statics, oneMoneyTimeline({ ...input, finance }, finance), n, MONTHS);
      steps += got.steps;
      commits += got.ledger.filter((e) => e.kind === 'commit').length;
    }
    expect(steps).toBe(200 * MONTHS);
    // The identities are not vacuous: the random finances award money.
    expect(commits).toBeGreaterThan(50);
  });
});

describe('rule 21: a timeline whose finance offers nothing gives the events of no finance', () => {
  // The mini money with every programme opening after the run: arrivals flow, nothing is offered.
  const never: Finance = {
    ...fin,
    programmes: fin.programmes.map((g) => ({ ...g, from: asOf + 100_000, to: null }))
  };
  const nothing = oneMoneyTimeline({ ...input, finance: never }, never);
  const plain = oneFrame(frameOf(input));

  it.each(seeds(20))('seed %i, 480 months: the same events as world-core unfunded', (seed) => {
    const got = runFunded(statics, nothing, seed, MONTHS);
    const rec = new Recorder();
    runWorld(statics, plain, seed, MONTHS, rec);
    expect(nothing.frameAt(MONTHS).finance!.offered.every((o) => o === 0)).toBe(true);
    expect(got.events.length).toBe(rec.events.length);
    expect(got.events).toEqual(rec.events);
    // Money arrived and nothing was committed: the funding system ran.
    const { pools, line } = fundOf(got.world);
    expect(pools.received[0]).toBeGreaterThan(0);
    expect(got.ledger.every((e) => e.kind === 'in')).toBe(true);
    expect(line.n).toBe(0);
    expect(got.events.some((e) => e.kind === 'start' && e.month > 0)).toBe(true);
  });
});

describe('rule 14: with and without a ledger, the same events', () => {
  it.each([1, 2, 3])('seed %i, 480 months: same events and the same world', (seed) => {
    const a = runFunded(statics, timeline, seed, MONTHS);
    const b = runFunded(statics, timeline, seed, MONTHS, { ledger: false });
    expect(awards(a.events).length).toBeGreaterThan(0);
    expect(b.ledger).toEqual([]);
    expect(b.events).toEqual(a.events);
    expect(b.world).toEqual(a.world);
  });
});

describe('rule 16: the known limit — an application waits on a spent pool', () => {
  const units = [10, 10, 10, 10, 10];
  const one = 300027 * 10;
  const city: Inflow[] = [{ kind: 'once', day: asOf, dollars: Math.round(one * 1.5) }];
  const tiny: SimInput = {
    ...tinyQueue({ logOdds: Array(5).fill(-12), units }),
    finance: tinyStack({ asOf, city })
  };
  const ts = staticsOf(tiny);
  const tt = oneMoneyTimeline(tiny, tiny.finance!);

  it.each(seeds(5))(
    'seed %i: one award spends the City once inflow; the rest wait in line at month 480',
    (seed) => {
      const got = checked(ts, tt, seed, MONTHS);
      expect(got.steps).toBe(MONTHS);
      expect(awards(got.events).length).toBe(1);
      const ins = got.ledger.filter((e) => e.kind === 'in' && e.pool === 't-city');
      expect(ins.length).toBe(1);
      const { line } = fundOf(got.world);
      // Five lots applied for affordable money in month 1; one was awarded, four still wait.
      expect(line.n).toBe(4);
      const lots = new Set<number>();
      for (let i = 0; i < line.n; i++) {
        expect(line.kind[i]).toBe(KIND_AFFORDABLE);
        expect(line.month[i]).toBe(1);
        expect(line.gone[i]).toBe(0);
        lots.add(line.lot[i]);
      }
      expect(lots.size).toBe(4);
      // No ordinary start: the only project started is the funded one.
      expect(got.events.filter((e) => e.kind === 'start').length).toBe(1);
    }
  );
});

describe('a structuredClone of the world mid-run steps to the same events and ledger', () => {
  // Early enough that awards are still to come on the mini city.
  const M = 24;
  it.each([1, 2, 3])('seed %i: a copy at month 24 and the original agree to month 480', (seed) => {
    const core = withFunding(createFundingSystem());
    const run = (w: World, due: ReturnType<typeof core.planDue>, from: number) => {
      const events: MonthEvent[] = [];
      const ledger: LedgerEvent[] = [];
      let month = 0;
      const out: StepSink = {
        event: (e) => events.push({ ...e, month }),
        ledger: (e) => ledger.push(e)
      };
      for (let m = from; m <= MONTHS; m++) {
        month = m;
        core.step(w, due, statics, timeline, seed, out);
      }
      return { events, ledger };
    };
    const NOWHERE: StepSink = { event() {} };
    const world = core.createWorld(statics, timeline, seed, NOWHERE);
    const due = core.planDue(world, statics, timeline, seed, MONTHS);
    for (let m = 1; m <= M; m++) core.step(world, due, statics, timeline, seed, NOWHERE);
    expect(fundOf(world).pools.mN).toBeGreaterThan(0);
    const copy = structuredClone(world);
    expect(copy).toEqual(world);
    // The copy's due list is planned from the copy (a world holds no due list).
    const copyDue = core.planDue(copy, statics, timeline, seed, MONTHS);
    const a = run(world, due, M + 1);
    const b = run(copy, copyDue, M + 1);
    expect(awards(a.events).length).toBeGreaterThan(0);
    expect(a.ledger.some((e) => e.kind !== 'in')).toBe(true);
    expect(b.events).toEqual(a.events);
    expect(b.ledger).toEqual(a.ledger);
    expect(copy).toEqual(world);
  });
});

/** A seeded shuffle of 0 .. n - 1 (Fisher-Yates on a 32-bit LCG). */
function shuffle(n: number, seed: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe("permuting the lot table's rows gives the same events and ledger", () => {
  it.each([1, 2, 3])('seed %i, 480 months', (seed) => {
    const p = input.parcels;
    const rows = shuffle(p.count, 0x9e3779b9 ^ seed);
    expect(rows.some((v, i) => v !== i)).toBe(true);
    const parcels = selectRows(
      p,
      rows,
      rows.map((r) => p.id[r]),
      () => 'all'
    );
    const input2: SimInput = { ...input, parcels };
    const statics2 = staticsOf(input2);
    expect(statics2.parcelId).toEqual(rows.map((r) => statics.parcelId[r]));
    const a = runFunded(statics, timeline, seed, MONTHS);
    const b = runFunded(statics2, oneMoneyTimeline(input2, fin), seed, MONTHS);
    // Events name lots only in 'displaced': compare it by parcel id.
    const byId = (e: MonthEvent, ids: readonly string[]) =>
      e.kind === 'displaced' ? { ...e, lot: ids[e.lot] } : e;
    expect(awards(a.events).length).toBeGreaterThan(0);
    expect(b.events.map((e) => byId(e, statics2.parcelId))).toEqual(
      a.events.map((e) => byId(e, statics.parcelId))
    );
    expect(b.ledger).toEqual(a.ledger);
  });
});

describe("world 1's calendar-month money series satisfies I1-I6", () => {
  it('seed 1, 480 months: poolSeries of the ledger passes checkMoneyIdentities', () => {
    const got = checked(statics, timeline, 1, MONTHS);
    expect(got.steps).toBe(MONTHS);
    const horizon: Day = monthLastDay(asOf, MONTHS);
    const months = monthsOf(asOf, horizon);
    expect(got.ledger.every((e) => e.day <= horizon)).toBe(true);
    const kinds = new Set(got.ledger.map((e) => e.kind));
    // The mini money's awards are affordable grants: arrivals, commits and spends.
    for (const k of ['in', 'commit', 'spend'] as const) expect(kinds.has(k)).toBe(true);
    const pools = poolSeries(got.ledger, fin, months, horizon);
    checkMoneyIdentities({ pools }, fin.pools, {
      events: got.ledger,
      finance: fin,
      months,
      horizon
    });
  });

  it('so does the world of each of 50 random finances (loans, guarantees, losses)', () => {
    const horizon: Day = monthLastDay(asOf, MONTHS);
    const months = monthsOf(asOf, horizon);
    const kinds = new Set<string>();
    for (let n = 1; n <= 50; n++) {
      const finance = randomFinance(n);
      const got = runFunded(statics, oneMoneyTimeline({ ...input, finance }, finance), n, MONTHS);
      for (const e of got.ledger) kinds.add(e.kind);
      const pools = poolSeries(got.ledger, finance, months, horizon);
      checkMoneyIdentities({ pools }, finance.pools, {
        events: got.ledger,
        finance,
        months,
        horizon
      });
    }
    expect([...kinds].sort()).toEqual(['commit', 'in', 'loss', 'release', 'repay', 'spend']);
  });
});
