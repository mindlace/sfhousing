// Rules 2, 9 and 11 for tiers: world 1's homes by income tier, filed by calendar month as
// `tierSeries` files them, each funded project split by the programme definitions in force in the
// month of its award (design 3.4).
import { beforeAll, describe, expect, it } from 'vitest';
import { tierContext, tierSeries, tiersOf, type TierCtx } from '$lib/sim/scenario/finance-score';
import { targetsOf, tierTargetsOf } from '$lib/sim/scenario/score';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';
import type { TierUnits } from '$lib/timelapse/types';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { benchFunded } from '../funding/test/cities.node';
import { benchMoney, fundedMini, oneMoneyTimeline } from '../funding/test/fixtures';
import { monthOfDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { scheduleAt } from '../read';
import { staticsOf, type Statics } from '../statics';
import { fixtureInput, liveDir, liveInput } from '../test/cities.node';
import type { World } from '../types';
import { chunkOf } from './chunk';
import { createWorldSeries, extrasOf } from './series';
import { horizonOf } from './statics';
import { TEST_RHNA, feedFunded, testStatics, timelineStatics, type FeedMode } from './test/feed';
import type { MoneyFeed, ScoreStatics, WorldSeries } from './types';
import { chunksBefore, viewOf } from './view';

type Finance = NonNullable<SimInput['finance']>;

interface City {
  input: SimInput;
  fin: Finance;
  statics: Statics;
  timeline: PolicyTimeline;
  score: ScoreStatics;
  months: number;
}

interface Run {
  series: WorldSeries;
  world: World;
  feed: MoneyFeed;
  /** Each awarded row's award day. */
  awards: Map<number, number>;
}

function cityOf(input: SimInput, months: number, timeline?: PolicyTimeline): City {
  const fin = input.finance!;
  const tl = timeline ?? oneMoneyTimeline(input, fin);
  return {
    input,
    fin,
    statics: staticsOf(input),
    timeline: tl,
    score: timelineStatics(input, tl, months),
    months
  };
}

function run(c: City, seed: number, mode: FeedMode = 'live'): Run {
  const series = createWorldSeries(c.score);
  const awards = new Map<number, number>();
  const got = feedFunded(
    c.statics,
    c.timeline,
    seed,
    c.months,
    series,
    (e) => {
      if (e.kind === 'award') awards.set(e.row, e.day);
    },
    mode
  );
  const feed: MoneyFeed = {
    ledger: got.ledger,
    finance: c.timeline.frameAt(1).finance!,
    world: got.world,
    statics: c.statics
  };
  return { series, world: got.world, feed, awards };
}

/** Every schedule row read at the horizon, with its row. */
function schedulesAt(c: City, w: World): { row: number; sc: Schedule }[] {
  const H = horizonOf(c.score);
  const out: { row: number; sc: Schedule }[] = [];
  for (let row = 0; row < w.projects.n; row++) {
    const sc = scheduleAt(w, c.statics, row, H);
    if (sc) out.push({ row, sc });
  }
  return out;
}

const want = (c: City, schedules: Schedule[], ctx: TierCtx): TierUnits[] =>
  tierSeries(schedules, ctx, c.input.asOf, horizonOf(c.score), c.score.months);

const sumOf = (t: TierUnits) => t.veryLow + t.low + t.moderate + t.aboveModerate + t.unrecorded;

/** The referee: `tierSeries` of the horizon's schedules, one ctx for all (programmes unchanged). */
function checkTiers(c: City, r: Run): TierUnits[] {
  const last = c.score.lastIndex;
  expect(r.series.finalThrough()).toBe(last);
  const got = extrasOf(r.series).tiers(0, last);
  const schedules = schedulesAt(c, r.world).map((x) => x.sc);
  expect(got).toEqual(want(c, schedules, tierContext(c.input)));
  // Each month's tiers sum to world 1's completedNet.
  const rows = r.series.rows(0, last);
  for (let i = 0; i <= last; i++) expect(sumOf(got[i])).toBe(rows[i].completedNet);
  return got;
}

describe('tiers, funded mini', () => {
  let c: City;
  const runs = new Map<number, Run>();
  const runOf = (seed: number) => {
    let r = runs.get(seed);
    if (r === undefined) runs.set(seed, (r = run(c, seed)));
    return r;
  };
  beforeAll(() => {
    c = cityOf(fundedMini(), 480);
  });

  it('scoreStaticsOf gives the tier baseline with finance', () => {
    expect(c.score.tierBaseline).toEqual(TEST_RHNA(c.input.asOf).byTier);
    // with finance, limits are set (rule 12); the mini city's money borrows nothing
    expect(c.score.limits).toEqual([]);
  });

  it.each([1, 2, 3])('seed %i: tiers equal tierSeries of the schedules at the horizon', (seed) => {
    const got = checkTiers(c, runOf(seed));
    // Not degenerate: funded affordable homes and inclusionary homes in the low tiers.
    const end = got[got.length - 1];
    expect(end.veryLow + end.low).toBeGreaterThan(0);
    expect(end.aboveModerate).toBeGreaterThan(0);
  });

  it('live, buffered and after feeds give equal data', () => {
    const last = c.score.lastIndex;
    // Each summed through the last month, so `sum` and `summed` compare too.
    const summed = (r: Run) => (r.series.rows(0, last), r.series.data());
    const live = summed(runOf(1));
    for (const mode of ['buffered', 'after'] as const) {
      expect(summed(run(c, 1, mode))).toEqual(live);
    }
  });

  it("a funded row completing without its 'award' throws", () => {
    const series = createWorldSeries(c.score);
    const dropAward: WorldSeries = {
      ...series,
      add: (e, w, s) => {
        if (e.kind !== 'award') series.add(e, w, s);
      }
    };
    expect(() => feedFunded(c.statics, c.timeline, 1, c.months, dropAward)).toThrow(
      /without an 'award'/
    );
  });

  it("tierTargets use world 1's tiers, targets the mean", () => {
    const [a, b] = [runOf(1), runOf(2)];
    const last = c.score.lastIndex;
    const chunk = chunkOf([a.series, b.series], [a.series, b.series], a.feed, 0, last);
    const view = viewOf([chunk], c.score);
    const mine = extrasOf(a.series).tiers(0, last);
    expect(chunk.tiers).toEqual(mine);
    expect(view.tiers).toEqual(mine);
    expect(view.tierTargets).toEqual(tierTargetsOf(c.score.tierBaseline!, mine));
    expect(view.targets).toEqual(targetsOf(c.score.baseline.units, chunk.mean));
    // World 1 and the mean differ, so the two rows describe different things.
    expect(chunk.mean.some((m, i) => m.completedNet !== sumOf(mine[i]))).toBe(true);
    // Another world 1 gives other tiers.
    const other = chunkOf([b.series, a.series], [a.series, b.series], b.feed, 0, last);
    expect(other.tiers).toEqual(extrasOf(b.series).tiers(0, last));
    expect(other.tiers).not.toEqual(mine);
    expect(chunkOf([a.series], [a.series], null, 0, last).tiers).toBeNull();
  });

  it('chunksBefore trims sd, money and tiers of a funded chunk', () => {
    const a = runOf(1);
    const chunk = chunkOf([a.series, runOf(2).series], [a.series, a.series], a.feed, 0, 40);
    const [cut] = chunksBefore([chunk], 6);
    expect(cut.sd).toEqual(chunk.sd.slice(0, 6));
    expect(cut.money).toEqual(chunk.money!.slice(0, 6));
    expect(cut.tiers).toEqual(chunk.tiers!.slice(0, 6));
    expect(cut.sd).toHaveLength(6);
    expect(cut.money).toHaveLength(6);
    expect(cut.tiers).toHaveLength(6);
  });

  it('restore round-trips award days and tier deltas', () => {
    const r = runOf(2);
    const last = c.score.lastIndex;
    extrasOf(r.series).tiers(0, last);
    const data = r.series.data();
    const awarded = [...r.awards.keys()];
    expect(awarded.length).toBeGreaterThan(0);
    for (const row of awarded) expect(data.award[row]).toBe(r.awards.get(row));
    const back = createWorldSeries(c.score, structuredClone(data));
    expect(back.data()).toEqual(data);
    expect(extrasOf(back).tiers(0, last)).toEqual(extrasOf(r.series).tiers(0, last));
    // Saved at month 200, restored, fed the rest: the same as one never saved.
    const mid = 200;
    let into: WorldSeries = createWorldSeries(c.score);
    const proxy: WorldSeries = {
      add: (e, w, s) => into.add(e, w, s),
      stepped(m) {
        into.stepped(m);
        if (m === mid) into = createWorldSeries(c.score, structuredClone(into.data()));
      },
      finalThrough: () => into.finalThrough(),
      rows: (a, b) => into.rows(a, b),
      data: () => into.data()
    };
    feedFunded(c.statics, c.timeline, 2, c.months, proxy);
    expect(extrasOf(into).tiers(0, last)).toEqual(extrasOf(r.series).tiers(0, last));
    expect(into.data()).toEqual(r.series.data());
  });

  it('a ScoreStatics copy without its tier context throws', () => {
    expect(() => createWorldSeries(structuredClone(c.score))).toThrow(
      'world-score: ScoreStatics without its tier context; pass the object scoreStaticsOf returned'
    );
  });

  it('a series without finance has no tiers', () => {
    const s = createWorldSeries(testStatics(c.input, 24));
    expect(() => extrasOf(s).tiers(0, 0)).toThrow(/tiers/);
  });
});

/** Programme tiers every affordable programme takes from month `m` (test values). */
const LATER_TIERS = { veryLow: 0, low: 0, moderate: 1, aboveModerate: 0 };

/**
 * The money timeline of `fin`, with every affordable programme's `tiers` replaced by
 * `LATER_TIERS` from month `m` on (a new frame id from then). Tiers do not move the world.
 */
function tiersChangingAt(input: SimInput, fin: Finance, m: number): PolicyTimeline {
  const base = oneMoneyTimeline(input, fin);
  const later = fin.programmes.map((g) => (g.tiers ? { ...g, tiers: { ...LATER_TIERS } } : g));
  const frames = new Map<number, PolicyFrame>();
  const frameAt = (month: number): PolicyFrame => {
    if (month < m) return base.frameAt(month);
    let f = frames.get(month);
    if (f === undefined) {
      const b = base.frameAt(month);
      f = {
        ...b,
        id: frameIdOf(`tiers-later|${b.id}`),
        finance: { ...b.finance!, programmes: later }
      };
      frames.set(month, f);
    }
    return f;
  };
  const changes = [...new Set([...base.changes(), m])].sort((a, b) => a - b);
  return {
    frameAt,
    changes: () => changes,
    touched: (month) => base.touched(month),
    readyThrough: () => Number.MAX_SAFE_INTEGER
  };
}

describe('award-month programme definitions', () => {
  it("a funded project's tiers use the definitions in force in its award month", () => {
    const M = 48;
    const input = fundedMini();
    const fin = input.finance!;
    const c = cityOf(input, 480, tiersChangingAt(input, fin, M));
    const before = tierContext(input);
    const after = tierContext({
      projects: input.projects,
      finance: {
        ...fin,
        programmes: fin.programmes.map((g) => (g.tiers ? { ...g, tiers: { ...LATER_TIERS } } : g))
      }
    });
    let straddling = 0;
    for (const seed of [1, 2, 3]) {
      const r = run(c, seed);
      const early: Schedule[] = [];
      const late: Schedule[] = [];
      for (const { row, sc } of schedulesAt(c, r.world)) {
        const award = r.awards.get(row);
        const awardMonth = award === undefined ? Infinity : monthOfDay(c.input.asOf, award);
        (awardMonth < M ? early : late).push(sc);
        if (
          sc.kind === 'affordable' &&
          awardMonth < M &&
          sc.end.kind === 'complete' &&
          monthOfDay(c.input.asOf, sc.end.day) >= M &&
          sumOf(tiersOf(sc, before)) > 0
        ) {
          const a = tiersOf(sc, before);
          const b = tiersOf(sc, after);
          if (a.moderate !== b.moderate) straddling++;
        }
      }
      const e = want(c, early, before);
      const l = want(c, late, after);
      const expected = e.map((t, i) => ({
        veryLow: t.veryLow + l[i].veryLow,
        low: t.low + l[i].low,
        moderate: t.moderate + l[i].moderate,
        aboveModerate: t.aboveModerate + l[i].aboveModerate,
        unrecorded: t.unrecorded + l[i].unrecorded
      }));
      expect(extrasOf(r.series).tiers(0, c.score.lastIndex)).toEqual(expected);
    }
    // Some project was awarded before the change and completed after it, with a split it moves.
    expect(straddling).toBeGreaterThan(0);
  });
});

/** A bench city's funded world takes seconds (world-funding's cost, not the series'). */
const SLOW = 120_000;

describe('tiers, funded bench', () => {
  it(
    'seed 1: tiers equal tierSeries of the schedules at the horizon',
    () => {
      const c = cityOf(benchFunded('baseline').input, 240);
      const got = checkTiers(c, run(c, 1));
      const end = got[got.length - 1];
      expect(end.veryLow + end.low).toBeGreaterThan(0);
    },
    SLOW
  );
});

/**
 * A dataset city with the bench calibration and `miniFinance` as money: the bench baseline's
 * programmes award nothing on the fixture in 480 months, the mini city's do.
 */
async function fundedCity(input: SimInput, months: number): Promise<City> {
  const base = benchMoney(input);
  return cityOf({ ...base, finance: miniFinance(base.asOf) }, months);
}

describe('tiers, funded fixture', () => {
  it('seeds 1-3: tiers equal tierSeries of the schedules at the horizon', async () => {
    const c = await fundedCity(await fixtureInput(), 480);
    let low = 0;
    for (const seed of [1, 2, 3]) {
      const got = checkTiers(c, run(c, seed));
      low += got[got.length - 1].veryLow + got[got.length - 1].low;
    }
    expect(low).toBeGreaterThan(0);
  });
});

const LIVE = liveDir();
describe.skipIf(LIVE === null)('tiers, funded live city', () => {
  it('seed 1: tiers equal tierSeries of the schedules at the horizon', async () => {
    const c = await fundedCity(await liveInput(LIVE!), 240);
    checkTiers(c, run(c, 1));
  }, 300_000); // The live city's funded world takes over a minute.
});
