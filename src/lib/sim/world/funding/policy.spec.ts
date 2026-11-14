// world-funding Task 9: a change of policy (spec rules 17, 18, 19, and rule 5 in a stepped world):
// waiting applications re-made or lapsed under the new frame, a lapsed kind's new spell, and what
// a change leaves alone.
import { describe, expect, it } from 'vitest';
import { lineKey } from '$lib/sim/scenario/funded';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import { tinyQueue, tinyStack } from '$lib/sim/scenario/fixtures/tiny-queue';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { SimInput } from '$lib/sim/scenario/types';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import type { Inflow, Pool, Programme } from '$lib/timelapse/types';
import { lotRow } from '../columns';
import type { DueList } from '../due';
import { monthFirstDay, monthLastDay } from '../months';
import type { PolicyFrame, PolicyTimeline } from '../policy/frame';
import { frameIdOf } from '../policy/intern';
import { lotEntity } from '../rates';
import { staticsOf, type Statics } from '../statics';
import { IDENTITY } from '../test/timeline';
import type { FundingSystem, StepSink } from '../types';
import { withFunding } from '../world';
import { spellsOf } from './apply';
import { kindClock } from './clocks';
import { KIND_AFFORDABLE, fundOf, spellOf, type FundLine } from './columns';
import { frameMoney, sameMoney } from './frame-money';
import { createFundingSystem } from './system';
import {
  MONEY_MONTHS,
  fundedMini,
  moneyTimeline,
  oneMoneyTimeline,
  randomFinance,
  type MonthEvent
} from './test/fixtures';

type Finance = NonNullable<SimInput['finance']>;

const MONTHS = 480;
const TIERS = { veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 };

/** An application as it joined the line: the month of the `apply` that added it. */
interface Joined {
  month: number;
  lot: number;
  kind: number;
  applied: Day;
  bundle: string;
  level: number;
  key: number;
}

/** One `policyChanged` call: the line just before and just after it. */
interface Change {
  month: number;
  before: FundLine;
  after: FundLine;
}

/** A funding system that records each application joining and each `policyChanged` call. */
function spied(): { sys: FundingSystem; joined: Joined[]; changes: Change[] } {
  const sys = createFundingSystem();
  const joined: Joined[] = [];
  const changes: Change[] = [];
  const apply = sys.apply;
  const policyChanged = sys.policyChanged;
  sys.apply = (ctx, lots) => {
    const from = 'gone' in ctx.world.line ? fundOf(ctx.world).line.n : 0;
    apply(ctx, lots);
    const { line } = fundOf(ctx.world);
    for (let i = from; i < line.n; i++) {
      const { lot, kind, applied, bundle, level, key } = line;
      joined.push({
        month: ctx.month,
        lot: lot[i],
        kind: kind[i],
        applied: applied[i],
        bundle: bundle[i],
        level: level[i],
        key: key[i]
      });
    }
  };
  sys.policyChanged = (ctx) => {
    const before = structuredClone(fundOf(ctx.world).line);
    policyChanged(ctx);
    changes.push({ month: ctx.month, before, after: structuredClone(fundOf(ctx.world).line) });
  };
  return { sys, joined, changes };
}

/** A funded world under `sys`: created, planned through `MONTHS`, stepped on request. */
function worldOf(sys: FundingSystem, s: Statics, t: PolicyTimeline, seed: number) {
  const core = withFunding(sys);
  const events: MonthEvent[] = [];
  const ledger: LedgerEvent[] = [];
  let month = 0;
  const out: StepSink = {
    event: (e) => events.push({ ...e, month }),
    ledger: (e) => ledger.push(e)
  };
  const world = core.createWorld(s, t, seed, out);
  let due: DueList = core.planDue(world, s, t, seed, MONTHS);
  let now = t;
  return {
    world,
    events,
    ledger,
    /** Steps through month `to`. */
    stepTo(to: number) {
      while (world.month < to) {
        month = world.month + 1;
        core.step(world, due, s, now, seed, out);
      }
    },
    /** Goes on under `t2` from here, its due list planned afresh (a resumed world). */
    resume(t2: PolicyTimeline) {
      now = t2;
      due = core.planDue(world, s, t2, seed, MONTHS);
    }
  };
}

/** The waiting rows of `line`, as (lot, kind, bundle). */
function waiting(line: FundLine): { lot: number; kind: number; bundle: string }[] {
  const out: { lot: number; kind: number; bundle: string }[] = [];
  for (let i = 0; i < line.n; i++)
    if (line.gone[i] === 0)
      out.push({ lot: line.lot[i], kind: line.kind[i], bundle: line.bundle[i] });
  return out;
}

/**
 * A money policy adding `pool` and `programmes`, in force over `months` (to null: no end); with
 * `mini`, also the mini money's `guaranteeRateCut` (its guarantee needs it), always in force.
 */
function fundDoc(
  asOf: Day,
  pool: Pool,
  programmes: Programme[],
  months: [number, number | null][],
  mini = false
): SimPolicy4 {
  return {
    schema: 4,
    kinds: {
      zoning: [],
      permitting: [],
      money: [
        {
          id: `fund-${pool.id}`,
          label: pool.id,
          preset: null,
          on: true,
          where: { tag: 'fund', pool: pool.id },
          spans: months.map(([a, b]) => ({
            from: monthFirstDay(asOf, a),
            to: b === null ? null : monthLastDay(asOf, b),
            what: {
              tag: 'fund',
              pool: structuredClone(pool),
              programmes: structuredClone(programmes)
            }
          }))
        },
        ...(mini
          ? [
              {
                id: 'terms',
                label: 'terms',
                preset: null,
                on: true,
                where: { tag: 'terms' as const },
                spans: [
                  {
                    from: asOf,
                    to: null,
                    what: { tag: 'terms' as const, terms: { guaranteeRateCut: 0.01 } }
                  }
                ]
              }
            ]
          : [])
      ]
    }
  };
}

const poolOf = (id: string, inflows: Inflow[]): Pool => ({
  id,
  kind: 'generalRevenue',
  label: id,
  inflows,
  uncapped: false,
  debt: null,
  leverage: 1
});

const grantOf = (id: string, pool: string, share: number, from: Day, minHomes = 1): Programme => ({
  id,
  label: id,
  pool,
  reach: 'affordable',
  instrument: { kind: 'grant', share },
  from,
  to: null,
  minHomes,
  tiers: { ...TIERS }
});

/**
 * The five-lot queue city (each lot one 10-home level, initiation log-odds -12, so ordinary
 * starts are rare) whose base money offers nothing: the tiny stack's programmes open after the run.
 */
const tinyIn: SimInput = (() => {
  const q = tinyQueue({ logOdds: Array(5).fill(-12), units: [10, 10, 10, 10, 10] });
  const stack = tinyStack({ asOf: q.asOf });
  const never: Finance = {
    ...stack,
    programmes: stack.programmes.map((g) => ({ ...g, from: q.asOf + 100_000 }))
  };
  return { ...q, finance: never };
})();
const tAsOf = tinyIn.asOf;
const ts = staticsOf(tinyIn);
/** Dollars a year that award about one of the tiny lots a year at a share-1 grant. */
const ONE_A_YEAR = 9_000_000;

/** Pool `x` with one award's money a year and a certain grant `gx` on it, over `months`. */
const xDoc = (months: [number, number | null][]) =>
  fundDoc(
    tAsOf,
    poolOf('u-x', [{ kind: 'yearly', from: tAsOf, to: null, dollarsPerYear: ONE_A_YEAR }]),
    [grantOf('gx', 'u-x', 1, tAsOf)],
    months
  );

const commitsTo = (ledger: readonly LedgerEvent[], pool: string) =>
  ledger.filter((e) => e.kind === 'commit' && e.pool === pool);

describe('rule 17: a change that leaves money and view alone', () => {
  const input = fundedMini();
  const s = staticsOf(input);
  const base = oneMoneyTimeline(input, miniFinance(input.asOf));
  const M = 30;
  // The same frames with two stages twice as long from month M: a permitting change only.
  const slow = (() => {
    const memo = new Map<number, PolicyFrame>();
    const frameAt = (m: number): PolicyFrame => {
      if (m < M) return base.frameAt(m);
      const hit = memo.get(m);
      if (hit !== undefined) return hit;
      const g = base.frameAt(m);
      const speed = { ...IDENTITY, discretionary: { entitled: 2 }, permitOnly: { filed: 2 } };
      const f: PolicyFrame = { ...g, id: frameIdOf(`policy-spec-slow|${g.id}`), speed };
      memo.set(m, f);
      return f;
    };
    const changes = [...new Set([...base.changes(), M])].sort((a, b) => a - b);
    return {
      frameAt,
      changes: () => changes,
      touched: () => new Int32Array(0),
      readyThrough: () => Number.MAX_SAFE_INTEGER
    } satisfies PolicyTimeline;
  })();

  it('a permitting-speed change at month 30: the line before and after policyChanged is equal', () => {
    let rows = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const { sys, changes } = spied();
      const w = worldOf(sys, s, slow, seed);
      w.stepTo(M);
      const at = changes.filter((c) => c.month === M);
      expect(at.length).toBe(1);
      expect(at[0].after).toEqual(at[0].before);
      rows += waiting(at[0].before).length;
    }
    // Not vacuous: applications were waiting when the frame changed.
    expect(rows).toBeGreaterThan(0);
  });
});

describe('a pool switched off from month m', () => {
  const m = 40;
  const off = moneyTimeline(tinyIn, xDoc([[1, m - 1]]));

  it.each([1, 2, 3])(
    'seed %i: no award from it on or after m; emptied applications lapse and are planned again',
    (seed) => {
      const { sys, changes } = spied();
      const w = worldOf(sys, ts, off, seed);
      w.stepTo(m - 1);
      const was = waiting(fundOf(w.world).line);
      // Some awards from x before m, and applications still waiting on it.
      expect(commitsTo(w.ledger, 'u-x').length).toBeGreaterThan(0);
      expect(was.length).toBeGreaterThan(0);
      for (const a of was) expect(a.bundle).toBe('gx');
      w.stepTo(MONTHS);
      expect(changes.map((c) => c.month)).toEqual([m]);
      const first = monthFirstDay(tAsOf, m);
      expect(commitsTo(w.ledger, 'u-x').filter((e) => e.day >= first)).toEqual([]);
      expect(w.events.filter((e) => e.kind === 'award' && e.month >= m)).toEqual([]);
      // Every waiting application lapsed at m, and its kind's new spell starts on m's first day.
      expect(waiting(changes[0].after)).toEqual([]);
      const { line } = fundOf(w.world);
      for (const a of was) {
        const li = lotRow(w.world.lots, a.lot);
        const k = li < 0 ? 0 : w.world.lots.k[li];
        expect(spellOf(line, a.lot, KIND_AFFORDABLE, k)).toBe(first - 1);
      }
      expect(waiting(line)).toEqual([]);
    }
  );

  it.each([1, 2, 3])('seed %i: opened again at m + 12, the lapsed lots apply again', (seed) => {
    const back = moneyTimeline(
      tinyIn,
      xDoc([
        [1, m - 1],
        [m + 12, null]
      ])
    );
    const { sys, joined } = spied();
    const w = worldOf(sys, ts, back, seed);
    w.stepTo(m - 1);
    const was = waiting(fundOf(w.world).line);
    expect(was.length).toBeGreaterThan(0);
    w.stepTo(m + 12);
    const again = joined.filter((j) => j.month === m + 12);
    expect(again.map((j) => j.lot).sort()).toEqual(was.map((a) => a.lot).sort());
    for (const j of again) expect(j.bundle).toBe('gx');
    // Nothing joined while the programme was off.
    expect(joined.filter((j) => j.month >= m && j.month < m + 12)).toEqual([]);
  });
});

describe("rule 18: a lapsed kind's new spell", () => {
  const m = 40;
  const back = moneyTimeline(
    tinyIn,
    xDoc([
      [1, m - 1],
      [m + 12, null]
    ])
  );

  it.each([1, 2, 3])('seed %i: starts on the first day of month m, on the same draws', (seed) => {
    const { sys, joined } = spied();
    const w = worldOf(sys, ts, back, seed);
    w.stepTo(m - 1);
    const was = waiting(fundOf(w.world).line);
    expect(was.length).toBeGreaterThan(0);
    w.stepTo(m + 12);
    const sh = seedHash(seed);
    const r = monthFirstDay(tAsOf, m) - 1;
    for (const a of was) {
      const li = lotRow(w.world.lots, a.lot);
      const k = li < 0 ? 0 : w.world.lots.k[li];
      const stream = streamOf(sh, lotEntity(ts, a.lot), k);
      const spell = { lot: a.lot, k, stream, r, existing: 0 };
      const c = kindClock(ts, back, m + 12, sh, spell, 'affordable');
      const j = joined.find((x) => x.lot === a.lot && x.month === m + 12);
      expect(j).toBeDefined();
      expect(c.day).not.toBeNull();
      expect(j!.applied).toBe(c.day);
      expect(j!.applied).toBeGreaterThanOrEqual(monthFirstDay(tAsOf, m + 12));
      // Its key comes from the new spell too.
      const key = lineKey(c.keyDay, ts.rank[a.lot], 'affordable');
      expect(j!.key).toBe(key);
    }
  });
});

describe('an arrival raised from month m', () => {
  const input = fundedMini();
  const s = staticsOf(input);
  const m = 36;
  const prog = grantOf('gx', 'u-x', 0.3, input.asOf, 2);
  const yearly: Inflow = { kind: 'yearly', from: input.asOf, to: null, dollarsPerYear: 4_000_000 };
  const raised: Inflow = { kind: 'once', day: monthFirstDay(input.asOf, m), dollars: 60_000_000 };
  const a = moneyTimeline(
    input,
    fundDoc(input.asOf, poolOf('u-x', [yearly]), [prog], [[1, null]], true)
  );
  const b = moneyTimeline(
    input,
    fundDoc(input.asOf, poolOf('u-x', [yearly, raised]), [prog], [[1, null]], true)
  );

  it('the two timelines have the same frame ids: arrivals are not money identity', () => {
    for (let k = 1; k <= MONEY_MONTHS; k++) expect(b.frameAt(k).id).toBe(a.frameAt(k).id);
    expect(b.frameAt(m).finance!.arrivals).not.toEqual(a.frameAt(m).finance!.arrivals);
  });

  it.each([1, 2, 3])(
    'seed %i: every event and ledger entry before month m is identical',
    (seed) => {
      const wa = worldOf(createFundingSystem(), s, a, seed);
      const wb = worldOf(createFundingSystem(), s, b, seed);
      wa.stepTo(MONTHS);
      wb.stepTo(MONTHS);
      const first = monthFirstDay(input.asOf, m);
      const before = (ev: MonthEvent[]) => ev.filter((e) => e.month < m);
      expect(before(wb.events).length).toBeGreaterThan(0);
      expect(before(wb.events)).toEqual(before(wa.events));
      const early = (l: LedgerEvent[]) => l.filter((e) => e.day < first);
      expect(early(wb.ledger)).toEqual(early(wa.ledger));
      // The raised arrival itself is the first difference.
      expect(wb.ledger).not.toEqual(wa.ledger);
      const ins = (l: LedgerEvent[]) => l.filter((e) => e.kind === 'in' && e.pool === 'u-x');
      expect(ins(wb.ledger).length).toBe(ins(wa.ledger).length + 1);
    }
  );
});

describe('rule 16 continued: ending the spent programme', () => {
  const m = 24;
  const one = 300027 * 10;
  const tiny: SimInput = {
    ...tinyQueue({ logOdds: Array(5).fill(-6), units: [10, 10, 10, 10, 10] }),
    finance: tinyStack({
      asOf: tAsOf,
      city: [{ kind: 'once', day: tAsOf, dollars: Math.round(one * 1.5) }],
      cityTo: monthLastDay(tAsOf, m - 1)
    })
  };
  const s = staticsOf(tiny);
  const t = oneMoneyTimeline(tiny, tiny.finance!);

  it.each([1, 2, 3])(
    'seed %i: lapses the waiting applications and redraws them on the other shares',
    (seed) => {
      const { sys, joined, changes } = spied();
      const w = worldOf(sys, s, t, seed);
      w.stepTo(m - 1);
      const was = waiting(fundOf(w.world).line);
      expect(was.length).toBeGreaterThan(0);
      for (const a of was) expect(a.bundle).toBe('t-fed,t-state,t-city');
      w.stepTo(MONTHS);
      const at = changes.find((c) => c.month === m)!;
      expect(at).toBeDefined();
      expect(waiting(at.after)).toEqual([]);
      // Redrawn on the federal and state shares: they apply again and the state money awards them.
      const again = joined.filter((j) => j.month >= m);
      expect(again.length).toBeGreaterThan(0);
      for (const j of again) {
        expect(j.bundle).toBe('t-fed,t-state');
        expect(was.some((a) => a.lot === j.lot)).toBe(true);
      }
      expect(
        commitsTo(w.ledger, 't-state').filter((e) => e.day >= monthFirstDay(tAsOf, m)).length
      ).toBeGreaterThan(0);
      expect(commitsTo(w.ledger, 't-city').filter((e) => e.day >= monthFirstDay(tAsOf, m))).toEqual(
        []
      );
    }
  );
});

describe('Review Focus 4: a resumed world under an edited timeline', () => {
  const M = 12;
  const tA = moneyTimeline(tinyIn, xDoc([[1, null]]));
  const tB = moneyTimeline(
    tinyIn,
    fundDoc(
      tAsOf,
      poolOf('u-y', [{ kind: 'yearly', from: tAsOf, to: null, dollarsPerYear: 1e12 }]),
      [grantOf('gy', 'u-y', 0.8, tAsOf)],
      [[1, null]]
    )
  );

  it.each([1, 2, 3])(
    'seed %i: gets rows for new pool ids and lapses applications naming unknown programmes',
    (seed) => {
      const { sys, joined, changes } = spied();
      const w = worldOf(sys, ts, tA, seed);
      w.stepTo(M);
      const was = waiting(fundOf(w.world).line);
      expect(was.length).toBeGreaterThan(0);
      for (const a of was) expect(a.bundle).toBe('gx');
      expect(fundOf(w.world).pools.id).not.toContain('u-y');
      w.resume(tB);
      w.stepTo(M + 1);
      // The edited timeline has no change at M + 1, but the world last stepped another frame.
      expect(tB.changes()).not.toContain(M + 1);
      expect(changes.map((c) => c.month)).toEqual([M + 1]);
      const { pools, line } = fundOf(w.world);
      expect(pools.id).toContain('u-y');
      expect(pools.id).toContain('u-x');
      expect(
        line.bundle.slice(0, line.n).filter((b, i) => line.gone[i] === 0 && b.includes('gx'))
      ).toEqual([]);
      for (const a of was) {
        const li = lotRow(w.world.lots, a.lot);
        const k = li < 0 ? 0 : w.world.lots.k[li];
        expect(spellOf(line, a.lot, KIND_AFFORDABLE, k)).toBe(monthFirstDay(tAsOf, M + 1) - 1);
      }
      w.stepTo(MONTHS);
      // Nothing is drawn on the programme the edited timeline lacks; what joins later names gy.
      expect(commitsTo(w.ledger, 'u-x').filter((e) => e.day > monthLastDay(tAsOf, M))).toEqual([]);
      for (const j of joined.filter((x) => x.month > M)) expect(j.bundle).toBe('gy');
    }
  );
});

describe('rule 5 in a stepped world: a programme opening at month m', () => {
  const input = fundedMini();
  const s = staticsOf(input);
  const m = 48;
  // The mini money with its affordable programmes never offered, and an affordable grant from m.
  const fin = miniFinance(input.asOf);
  const noAffordable: Finance = {
    ...fin,
    programmes: fin.programmes.map((g) =>
      g.reach === 'affordable' ? { ...g, from: input.asOf + 100_000 } : g
    )
  };
  const base = { ...input, finance: noAffordable };
  const t = moneyTimeline(
    base,
    fundDoc(
      input.asOf,
      poolOf('u-x', [{ kind: 'yearly', from: input.asOf, to: null, dollarsPerYear: 1e9 }]),
      [grantOf('gx', 'u-x', 0.6, input.asOf, 1)],
      [[m, null]],
      true
    )
  );

  it('seeds 1 to 6: lots whose affordable total passed earlier (spell spent) never apply, from m on', () => {
    let spentAll = 0;
    let fromM = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { sys, joined } = spied();
      const w = worldOf(sys, s, t, seed);
      w.stepTo(m - 1);
      const sh = seedHash(seed);
      // Free lots on attempt 0 whose affordable pass fell before m, with nothing on offer.
      const spent: number[] = [];
      for (let lot = 0; lot < s.parcelId.length; lot++) {
        if (lotRow(w.world.lots, lot) >= 0) continue;
        const stream = streamOf(sh, lotEntity(s, lot), 0);
        const existing = input.parcels.existingUnits[lot];
        const spell = { lot, k: 0, stream, r: s.asOf, existing };
        const c = kindClock(s, t, m - 1, sh, spell, 'affordable');
        // The pass is in a lot-month that began before m (a later one is read on frames to come).
        const began = s.asOf + 1 + Math.floor((c.T - 1) * MONTH_DAYS);
        if (c.T > 0 && c.day === null && began < monthFirstDay(s.asOf, m)) spent.push(lot);
      }
      w.stepTo(m + 24);
      const aff = joined.filter((j) => j.kind === KIND_AFFORDABLE);
      expect(aff.filter((j) => j.month < m)).toEqual([]);
      for (const j of aff) expect(spent).not.toContain(j.lot);
      spentAll += spent.length;
      fromM += aff.length;
    }
    // Not vacuous: spells were spent before m, and the programme drew applications from m on.
    expect(spentAll).toBeGreaterThan(0);
    expect(fromM).toBeGreaterThan(0);
  });
});

describe('an application whose lot-month began before a change of money', () => {
  const input = fundedMini();
  const s = staticsOf(input);
  const kinds = ['market', 'affordable'] as const;

  it('seeds 1 to 120 of random finances: it joins re-made under the new frame, or lapses', () => {
    let stale = 0;
    let lapsed = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const finance = randomFinance(seed);
      const t = oneMoneyTimeline({ ...input, finance }, finance);
      const sys = createFundingSystem();
      const apply = sys.apply;
      sys.apply = (ctx, lots) => {
        const sh = seedHash(ctx.seed);
        // The applications whose size and bundle come from a frame other in money than this one.
        const want: { lot: number; kind: number }[] = [];
        for (const lot of lots) {
          const spells = spellsOf(ctx, lot);
          for (const kind of kinds) {
            const c = kindClock(s, t, ctx.month, sh, spells[kind], kind);
            if (c.day === null || c.month !== ctx.month) continue;
            if (sameMoney(t.frameAt(c.viewMonth), ctx.frame, t)) continue;
            want.push({ lot, kind: kind === 'affordable' ? KIND_AFFORDABLE : 0 });
          }
        }
        const from = fundOf(ctx.world).line.n;
        apply(ctx, lots);
        const { line } = fundOf(ctx.world);
        const fm = frameMoney(t, ctx.frame);
        for (const w of want) {
          let i = from;
          while (i < line.n && !(line.lot[i] === w.lot && line.kind[i] === w.kind)) i++;
          // Not joined: that kind was already waiting.
          if (i === line.n) continue;
          stale++;
          if (line.gone[i] === 1) {
            lapsed++;
            const li = lotRow(ctx.world.lots, w.lot);
            const k = li < 0 ? 0 : ctx.world.lots.k[li];
            expect(spellOf(line, w.lot, w.kind, k)).toBe(ctx.firstDay - 1);
          } else {
            expect(line.viewMonth[i]).toBe(ctx.month);
            expect(fm.bundleIds(line.bundle[i])).not.toBeNull();
          }
        }
      };
      worldOf(sys, s, t, seed).stepTo(MONTHS);
    }
    // Not vacuous: such applications occur, and some of them lapse.
    expect(stale).toBeGreaterThan(0);
    expect(lapsed).toBeGreaterThan(0);
  });
});
