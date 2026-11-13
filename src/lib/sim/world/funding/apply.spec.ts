// world-funding Task 4: the funding system, `planLot` and applications (spec rules 5, 6, 8, 9).
import { describe, expect, it } from 'vitest';
import { lineKey } from '$lib/sim/scenario/funded';
import { seedHash } from '$lib/sim/scenario/rng';
import type { ProjectKind } from '$lib/timelapse/types';
import { lotRow } from '../columns';
import { monthFirstDay, monthLastDay } from '../months';
import type { PolicyTimeline } from '../policy/frame';
import { staticsOf } from '../statics';
import {
  LOT_FREE,
  ORIGIN_SIM,
  type FundingSystem,
  type StepCtx,
  type StepSink,
  type World,
  type WorldEvent
} from '../types';
import { withFunding } from '../world';
import { applyLots, joinLine, leaveLine, planLotMonth, spellsOf, type Application } from './apply';
import { kindClock } from './clocks';
import { KIND_AFFORDABLE, KIND_MARKET, fundOf, initFunding } from './columns';
import { createFundingSystem } from './system';
import { fundedMini, oneMoneyTimeline } from './test/fixtures';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';

const input = fundedMini();
const statics = staticsOf(input);
const timeline = oneMoneyTimeline(input, miniFinance(input.asOf));
const KINDS: readonly ProjectKind[] = ['market', 'affordable'];
const NOWHERE: StepSink = { event() {} };

/** A hand-made `StepCtx` for `month` (no starts, no displacement). */
function ctxOf(world: World, seed: number, month: number, t: PolicyTimeline = timeline): StepCtx {
  return {
    world,
    due: {
      take() {
        throw new Error('no take');
      },
      put() {},
      drop() {}
    },
    statics,
    timeline: t,
    frame: t.frameAt(month),
    month,
    seed,
    out: NOWHERE,
    firstDay: monthFirstDay(statics.asOf, month),
    lastDay: monthLastDay(statics.asOf, month),
    startProject() {
      throw new Error('no starts here');
    },
    displace() {
      throw new Error('no displacement here');
    }
  };
}

/** Every free lot of `world` (rowless lots included). */
function freeLots(world: World): number[] {
  const out: number[] = [];
  for (let lot = 0; lot < statics.parcelId.length; lot++) {
    const i = lotRow(world.lots, lot);
    if (i < 0 || world.lots.state[i] === LOT_FREE) out.push(lot);
  }
  return out;
}

/** One application row read back, line order. */
function rowsOf(world: World) {
  const { line } = fundOf(world);
  return Array.from({ length: line.n }, (_, i) => ({
    lot: line.lot[i],
    kind: line.kind[i],
    month: line.month[i],
    applied: line.applied[i],
    keyDay: line.keyDay[i],
    key: line.key[i],
    bundle: line.bundle[i],
    f: line.f[i],
    units: line.units[i],
    stories: line.stories[i],
    level: line.level[i],
    viewMonth: line.viewMonth[i],
    gone: line.gone[i]
  }));
}

function application(lot: number, kind: number, keyDay: number): Application {
  return {
    lot,
    kind,
    applied: keyDay,
    keyDay,
    key: lineKey(keyDay, statics.rank[lot], kind === KIND_AFFORDABLE ? 'affordable' : 'market'),
    bundle: 'p',
    f: 0,
    units: 1,
    stories: 1,
    level: 1,
    viewMonth: 1
  };
}

const CODE: Record<ProjectKind, number> = { market: KIND_MARKET, affordable: KIND_AFFORDABLE };

/** A free lot of `world` whose two kinds apply in different months under `t`, earlier first. */
function twoMonths(world: World, seed: number, t: PolicyTimeline) {
  const sh = seedHash(seed);
  for (const lot of freeLots(world)) {
    const spells = spellsOf(ctxOf(world, seed, 1, t), lot);
    const mk = kindClock(statics, t, 1, sh, spells.market, 'market');
    const af = kindClock(statics, t, 1, sh, spells.affordable, 'affordable');
    if (mk.day === null || af.day === null || mk.month === af.month) continue;
    const [first, second] = mk.month < af.month ? [mk, af] : [af, mk];
    return { lot, first, second };
  }
  return null;
}

/** Lots of rank 2, 4 and 6 (rank is a permutation of the lot rows). */
function lotOfRank(rank: number): number {
  const lot = statics.rank.indexOf(rank);
  expect(lot).toBeGreaterThanOrEqual(0);
  return lot;
}

describe('the funding line', () => {
  it('line order: (month applied, key day, parcel rank, market before affordable)', () => {
    const world = withFunding(createFundingSystem()).createWorld(statics, timeline, 1, NOWHERE);
    const { line } = fundOf(world);
    const [A, B, C] = [lotOfRank(2), lotOfRank(4), lotOfRank(6)];
    // A waits from month 1 with the larger key day.
    joinLine(line, 1, [application(A, KIND_MARKET, 900)]);
    // Month 2 brings B (rank 4, affordable) and C (rank 6, market), both key day 100, given C first.
    joinLine(line, 2, [application(C, KIND_MARKET, 100), application(B, KIND_AFFORDABLE, 100)]);
    const name = new Map([
      [A, 'A'],
      [B, 'B'],
      [C, 'C']
    ]);
    const rowsInOrder = rowsOf(world).map((r) => name.get(r.lot));
    expect(rowsInOrder).toEqual(['A', 'B', 'C']);
    expect(rowsOf(world).map((r) => r.month)).toEqual([1, 2, 2]);

    // One lot whose market and affordable both apply in month 3 with an equal key day.
    joinLine(line, 3, [application(B, KIND_AFFORDABLE, 50), application(B, KIND_MARKET, 50)]);
    const kinds = rowsOf(world)
      .filter((r) => r.month === 3)
      .map((r) => r.kind);
    expect(kinds).toEqual([KIND_MARKET, KIND_AFFORDABLE]);
  });

  it('applyLots appends a month after every waiting row, its own rows in key order', () => {
    let joined = 0;
    for (let seed = 1; seed <= 4 && joined < 2; seed++) {
      const world = withFunding(createFundingSystem()).createWorld(
        statics,
        timeline,
        seed,
        NOWHERE
      );
      const { line } = fundOf(world);
      // A row from month 1 whose key is past every real key: it must still come first.
      const A = lotOfRank(2);
      joinLine(line, 1, [application(A, KIND_MARKET, 0x3fffffff)]);
      for (let m = 2; m <= 60; m++) {
        const ctx = ctxOf(world, seed, m);
        const lots = freeLots(world).filter((lot) => planLotMonth(ctx, lot) === m);
        const before = line.n;
        applyLots(ctx, Int32Array.from(lots));
        if (line.n - before >= 2) {
          const rows = rowsOf(world);
          expect(rows[0].lot).toBe(A);
          const added = rows.slice(before);
          expect(added.every((r) => r.month === m)).toBe(true);
          const keys = added.map((r) => r.key);
          expect(keys).toEqual([...keys].sort((a, b) => a - b));
          expect(added.every((r) => r.key < rows[0].key)).toBe(true);
          joined++;
          break;
        }
      }
    }
    expect(joined).toBeGreaterThanOrEqual(1);
  });

  it("planLot gives the earlier kind's month, then the other once the first is waiting", () => {
    // One frame for the whole run, so a clock read in any month is the clock read in month 1.
    const t = oneMoneyTimeline(input, { ...miniFinance(input.asOf), off: [] });
    expect(t.changes()).toEqual([]);
    let found = 0;
    for (let seed = 1; seed <= 20 && found < 3; seed++) {
      const world = withFunding(createFundingSystem()).createWorld(statics, t, seed, NOWHERE);
      const sh = seedHash(seed);
      for (const lot of freeLots(world)) {
        const ctx1 = ctxOf(world, seed, 1, t);
        const spells = spellsOf(ctx1, lot);
        const mk = kindClock(statics, t, 1, sh, spells.market, 'market');
        const af = kindClock(statics, t, 1, sh, spells.affordable, 'affordable');
        if (mk.day === null || af.day === null || mk.month === af.month) continue;
        const [first, second] = mk.month < af.month ? [mk, af] : [af, mk];
        expect(planLotMonth(ctx1, lot)).toBe(first.month);
        const atFirst = ctxOf(world, seed, first.month, t);
        expect(planLotMonth(atFirst, lot)).toBe(first.month);
        applyLots(atFirst, Int32Array.of(lot));
        const mine = rowsOf(world).filter((r) => r.lot === lot);
        expect(mine.map((r) => r.kind)).toEqual([
          first.kind === 'market' ? KIND_MARKET : KIND_AFFORDABLE
        ]);
        expect(planLotMonth(atFirst, lot)).toBe(second.month);
        const atSecond = ctxOf(world, seed, second.month, t);
        expect(planLotMonth(atSecond, lot)).toBe(second.month);
        applyLots(atSecond, Int32Array.of(lot));
        expect(rowsOf(world).filter((r) => r.lot === lot)).toHaveLength(2);
        expect(planLotMonth(atSecond, lot)).toBe(0);
        found++;
        break;
      }
    }
    expect(found).toBeGreaterThanOrEqual(1);
  });

  it('apply records lot, kind, applied day inside the month, bundle ids, size, level and key', () => {
    let checked = 0;
    for (const seed of [1, 2, 3]) {
      const sys = createFundingSystem();
      const ctxs: StepCtx[] = [];
      const spy: FundingSystem = {
        ...sys,
        apply(ctx, lots) {
          ctxs.push(ctx);
          sys.apply(ctx, lots);
        }
      };
      const core = withFunding(spy);
      const world = core.createWorld(statics, timeline, seed, NOWHERE);
      const due = core.planDue(world, statics, timeline, seed, 48);
      const sh = seedHash(seed);
      for (let m = 1; m <= 48; m++) {
        const ctx = () => ctxs.find((c) => c.month === m)!;
        core.step(world, due, statics, timeline, seed, NOWHERE);
        const rows = rowsOf(world).filter((r) => r.month === m);
        if (rows.length === 0) continue;
        const c = ctx();
        for (const r of rows) {
          const kind: ProjectKind = r.kind === KIND_AFFORDABLE ? 'affordable' : 'market';
          expect(r.applied).toBeGreaterThanOrEqual(c.firstDay);
          expect(r.applied).toBeLessThanOrEqual(c.lastDay);
          expect(r.key).toBe(lineKey(r.keyDay, statics.rank[r.lot], kind));
          expect(r.gone).toBe(0);
          // The lot is still free on the same attempt, so its clock reads back the row.
          const spell = spellsOf(ctxOf(world, seed, m), r.lot)[kind];
          const k = kindClock(statics, timeline, m, sh, spell, kind);
          expect(k.day).toBe(r.applied);
          expect(k.month).toBe(m);
          expect(r.keyDay).toBe(k.keyDay);
          // Bundle indices are into the frame of the month whose view gave the size.
          const ids = timeline.frameAt(r.viewMonth).finance!.programmes.map((g) => g.id);
          expect(r.bundle).toBe(k.bundle.map((g) => ids[g]).join(','));
          expect(r.bundle.length).toBeGreaterThan(0);
          expect([r.f, r.units, r.stories, r.level, r.viewMonth]).toEqual([
            k.f,
            k.units,
            k.stories,
            k.level,
            k.viewMonth
          ]);
          expect(r.level).toBeGreaterThan(0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('rule 8: an ordinary start removes both applications of its lot', () => {
    // leaveLine itself: both kinds of the lot leave, another lot's row stays.
    const w0 = withFunding(createFundingSystem()).createWorld(statics, timeline, 1, NOWHERE);
    const l0 = fundOf(w0).line;
    const [A, B] = [lotOfRank(2), lotOfRank(4)];
    joinLine(l0, 1, [
      application(A, KIND_MARKET, 10),
      application(A, KIND_AFFORDABLE, 10),
      application(B, KIND_MARKET, 20)
    ]);
    leaveLine(l0, A);
    expect(rowsOf(w0).map((r) => [r.lot, r.gone])).toEqual([
      [A, 1],
      [A, 1],
      [B, 0]
    ]);

    // In a run: no lot that starts ordinarily keeps a row past its step.
    let started = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const core = withFunding(createFundingSystem());
      const events: WorldEvent[] = [];
      const out: StepSink = { event: (e) => events.push(e) };
      const world = core.createWorld(statics, timeline, seed, out);
      const due = core.planDue(world, statics, timeline, seed, 120);
      for (let m = 1; m <= 120; m++) {
        const waiting = new Set(rowsOf(world).map((r) => r.lot));
        events.length = 0;
        core.step(world, due, statics, timeline, seed, out);
        const p = world.projects;
        for (const e of events) {
          if (e.kind !== 'start' || p.origin[e.row] !== ORIGIN_SIM) continue;
          const lot = p.src[e.row];
          expect(rowsOf(world).some((r) => r.lot === lot)).toBe(false);
          if (waiting.has(lot)) started++;
        }
        expect(rowsOf(world).every((r) => r.gone === 0)).toBe(true);
      }
    }
    expect(started).toBeGreaterThan(0);
  });

  it("planLot is pure: asking twice, or from planDue's context, gives the same month", () => {
    let compared = 0;
    for (const seed of [1, 2]) {
      const sys = createFundingSystem();
      const core = withFunding(sys);
      const world = core.createWorld(statics, timeline, seed, NOWHERE);
      const due = core.planDue(world, statics, timeline, seed, 60);
      for (let m = 1; m <= 24; m++) core.step(world, due, statics, timeline, seed, NOWHERE);
      // Asking twice changes nothing and gives the same answer.
      const copy = structuredClone(world);
      const ctx = ctxOf(world, seed, world.month + 1);
      const lots = freeLots(world);
      const first = lots.map((lot) => sys.planLot(ctx, lot));
      const again = lots.map((lot) => sys.planLot(ctx, lot));
      expect(again).toEqual(first);
      expect(world).toEqual(copy);
      expect(first.some((m) => m > 0)).toBe(true);

      // planDue's context gives each lot the same month as a hand-made one for the same month.
      const fromPlan = new Map<number, number>();
      const spy: FundingSystem = {
        ...sys,
        planLot(c, lot) {
          const m = sys.planLot(c, lot);
          expect(c.month).toBe(world.month + 1);
          fromPlan.set(lot, m);
          return m;
        }
      };
      withFunding(spy).planDue(world, statics, timeline, seed, 60);
      expect(world).toEqual(copy);
      lots.forEach((lot, i) => {
        if (!fromPlan.has(lot)) return;
        expect(fromPlan.get(lot)).toBe(first[i]);
        compared++;
      });
      // And so does the step's own context before `apply` runs.
      const inStep = new Map<number, number>();
      let applied = false;
      const spy2: FundingSystem = {
        ...sys,
        apply(c, l) {
          applied = true;
          sys.apply(c, l);
        },
        planLot(c, lot) {
          const m = sys.planLot(c, lot);
          if (!applied && !inStep.has(lot)) inStep.set(lot, m);
          return m;
        }
      };
      withFunding(spy2).step(world, due, statics, timeline, seed, NOWHERE);
      for (const [lot, m] of inStep) {
        const i = lots.indexOf(lot);
        if (i < 0) continue;
        expect(m).toBe(first[i]);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('create gives the world one pool row per pool id of the frame', () => {
    const world = withFunding(createFundingSystem()).createWorld(statics, timeline, 1, NOWHERE);
    const { pools, line } = fundOf(world);
    expect(pools.id.slice(0, pools.n)).toEqual(timeline.frameAt(1).finance!.pools.map((p) => p.id));
    expect(line.n).toBe(0);
    // initFunding is idempotent in shape: a fresh one equals create's.
    const w2 = structuredClone(world);
    initFunding(
      w2,
      timeline.frameAt(1).finance!.pools.map((p) => p.id)
    );
    expect(w2).toEqual(world);
    for (const kind of KINDS) expect(spellsOf(ctxOf(world, 1, 1), 0)[kind].lot).toBe(0);
  });

  it('rows marked gone by leaveLine do not count as waiting', () => {
    const t = oneMoneyTimeline(input, { ...miniFinance(input.asOf), off: [] });
    const seed = 1;
    const world = withFunding(createFundingSystem()).createWorld(statics, t, seed, NOWHERE);
    const { line } = fundOf(world);
    const pair = twoMonths(world, seed, t);
    expect(pair).not.toBeNull();
    const { lot, first, second } = pair!;
    // The earlier kind waits (joined by hand, so no month counts as applied).
    joinLine(line, first.month, [application(lot, CODE[first.kind], first.keyDay)]);
    expect(planLotMonth(ctxOf(world, seed, first.month, t), lot)).toBe(second.month);
    leaveLine(line, lot);
    expect(planLotMonth(ctxOf(world, seed, first.month, t), lot)).toBe(first.month);
  });

  it('a kind whose day fell in a month already applied is lost but never hides the other kind', () => {
    // A lot left out of month m1's `apply` (as one freed after system 4 is) with one kind's day in
    // m1 and the other's in m2 > m1 + 1: the core's own replan after apply, a replan in month
    // m1 + 1 and a `planDue` rebuild from the world after m1 all give m2, and by m2 only the later
    // kind has applied.
    const t = oneMoneyTimeline(input, { ...miniFinance(input.asOf), off: [] });
    let found = 0;
    for (let seed = 1; seed <= 20 && found < 3; seed++) {
      const sys = createFundingSystem();
      const probe = withFunding(sys).createWorld(statics, t, seed, NOWHERE);
      const pair = twoMonths(probe, seed, t);
      if (pair === null || pair.second.month <= pair.first.month + 1) continue;
      const { lot, first, second } = pair;
      let month = 0;
      let applied = false;
      let carried = -1;
      const spy: FundingSystem = {
        ...sys,
        apply(c, lots) {
          month = c.month;
          applied = true;
          sys.apply(c, c.month === first.month ? lots.filter((l) => l !== lot) : lots);
        },
        moneyIn(c) {
          applied = false;
          sys.moneyIn(c);
        },
        planLot(c, l) {
          const m = sys.planLot(c, l);
          if (l === lot && applied && month === first.month) carried = m;
          return m;
        }
      };
      const core = withFunding(spy);
      const world = core.createWorld(statics, t, seed, NOWHERE);
      const due = core.planDue(world, statics, t, seed, second.month + 12);
      for (let m = 1; m <= first.month; m++) core.step(world, due, statics, t, seed, NOWHERE);
      const i = lotRow(world.lots, lot);
      if (i >= 0 && world.lots.state[i] !== LOT_FREE) continue; // started ordinarily first
      expect(rowsOf(world).filter((r) => r.lot === lot)).toEqual([]);
      expect(fundOf(world).line.appliedThrough).toBe(first.month);
      const replanned = sys.planLot(ctxOf(world, seed, first.month + 1, t), lot);
      let rebuilt = -1;
      const rebuildSpy: FundingSystem = {
        ...sys,
        planLot(c, l) {
          const m = sys.planLot(c, l);
          if (l === lot) rebuilt = m;
          return m;
        }
      };
      withFunding(rebuildSpy).planDue(structuredClone(world), statics, t, seed, second.month + 12);
      expect([carried, replanned, rebuilt]).toEqual([second.month, second.month, second.month]);
      for (let m = first.month + 1; m <= second.month; m++)
        core.step(world, due, statics, t, seed, NOWHERE);
      const j = lotRow(world.lots, lot);
      if (j >= 0 && world.lots.state[j] !== LOT_FREE) continue;
      expect(
        rowsOf(world)
          .filter((r) => r.lot === lot)
          .map((r) => r.kind)
      ).toEqual([CODE[second.kind]]);
      found++;
    }
    expect(found).toBeGreaterThanOrEqual(1);
  });
});
