// world-funding Task 6: serving and the award (spec rules 10, 11).
import { describe, expect, it } from 'vitest';
import { FILL_LEVELS, fillStories } from '$lib/data/scenario-codec';
import { MARKET_TERMS, projectDollars, prototypeFor, resolveTerms } from '$lib/sim/finance';
import { pathwayFrom } from '$lib/sim/scenario/engine';
import { lineKey } from '$lib/sim/scenario/funded';
import { awardSet, coverageLevel, type Award } from '$lib/sim/scenario/funding';
import { miniFinance } from '$lib/sim/scenario/fixtures/mini-finance';
import type { LedgerEvent } from '$lib/sim/scenario/money';
import { seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { SimInput } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import { PATHWAYS, type Pathway, type ProjectKind } from '$lib/timelapse/types';
import { addProject, ensureLot } from '../columns';
import { monthFirstDay, monthLastDay } from '../months';
import type { PolicyTimeline } from '../policy/frame';
import { lotEntity } from '../rates';
import { staticsOf } from '../statics';
import { runWorld } from '../test/run';
import {
  LOT_DONE,
  ORIGIN_SIM,
  type FundedStart,
  type StepCtx,
  type StepSink,
  type World,
  type WorldEvent
} from '../types';
import { withFunding } from '../world';
import { joinLine, type Application } from './apply';
import { KIND_AFFORDABLE, KIND_MARKET, fundOf, poolRowOf, type FundLine } from './columns';
import { frameMoney } from './frame-money';
import { moneyOnEvent } from './pools';
import { awardDay, fundedStartOf, serveLine } from './serve';
import { createFundingSystem } from './system';
import { fundedMini, oneMoneyTimeline } from './test/fixtures';

type Finance = NonNullable<SimInput['finance']>;

const input = fundedMini();
const statics = staticsOf(input);
const fin = miniFinance(input.asOf);
const timeline = oneMoneyTimeline(input, fin);
const F = FILL_LEVELS.length;
const AFF = 'm-city-grant,federal-grant';
const SEED = 7;

/** Every log line of one serve: starts, awards, other events and ledger events, in order. */
type Line =
  | { what: 'start'; lot: number; row: number; day: Day; funded: FundedStart | null }
  | { what: 'event'; e: WorldEvent }
  | { what: 'ledger'; e: LedgerEvent };

interface Harness {
  ctx: StepCtx;
  log: Line[];
  starts: () => { lot: number; row: number; day: Day; funded: FundedStart | null }[];
}

/**
 * A hand-made `StepCtx` for `month` whose `startProject` appends a row (as a funded start does)
 * and then runs `chain` for it, standing in for the start's chain.
 */
function harness(
  world: World,
  month: number,
  o: {
    t?: PolicyTimeline;
    seed?: number;
    chain?: (ctx: StepCtx, row: number, lot: number, day: Day) => void;
    result?: (row: number) => number;
  } = {}
): Harness {
  const log: Line[] = [];
  const t = o.t ?? timeline;
  const out: StepSink = {
    event: (e) => log.push({ what: 'event', e }),
    ledger: (e) => log.push({ what: 'ledger', e })
  };
  const ctx: StepCtx = {
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
    seed: o.seed ?? SEED,
    out,
    firstDay: monthFirstDay(statics.asOf, month),
    lastDay: monthLastDay(statics.asOf, month),
    startProject(lot, day, funded) {
      const p = world.projects;
      const row = addProject(p);
      p.origin[row] = ORIGIN_SIM;
      p.src[row] = lot;
      p.funded[row] = funded === null ? 0 : 1;
      log.push({ what: 'start', lot, row, day, funded });
      o.chain?.(ctx, row, lot, day);
      return o.result ? o.result(row) : row;
    },
    displace() {
      throw new Error('no displacement here');
    }
  };
  return {
    ctx,
    log,
    starts: () =>
      log.flatMap((l) =>
        l.what === 'start' ? [{ lot: l.lot, row: l.row, day: l.day, funded: l.funded }] : []
      )
  };
}

function freshWorld(t: PolicyTimeline = timeline): World {
  return withFunding(createFundingSystem()).createWorld(statics, t, SEED, { event() {} });
}

/** Free lots (no row in the new world) whose top level has at least 2 homes, in rank order. */
const LOTS = (() => {
  const w = freshWorld();
  const has = new Set(Array.from(w.lots.lot.subarray(0, w.lots.n)));
  const out: number[] = [];
  const y = input.parcels.yield;
  for (let lot = 0; lot < statics.parcelId.length; lot++) {
    if (has.has(lot) || y[lot * F + F - 1] < 2) continue;
    out.push(lot);
  }
  return out.sort((a, b) => statics.rank[a] - statics.rank[b]);
})();

/** An application of `lot` at its top level, applied on `applied`. */
function app(lot: number, kind: ProjectKind, applied: Day, bundle: string, keyDay = applied) {
  const f = F - 1;
  const units = input.parcels.yield[lot * F + f];
  return {
    lot,
    kind: kind === 'market' ? KIND_MARKET : KIND_AFFORDABLE,
    applied,
    keyDay,
    key: lineKey(keyDay, statics.rank[lot], kind),
    bundle,
    f,
    units,
    stories: fillStories(FILL_LEVELS[f], input.parcels.envelopeStories[lot]),
    level: 1,
    viewMonth: 1
  } satisfies Application;
}

const day = (m: number, d: number): Day => monthFirstDay(statics.asOf, m) + d;
const kindOf = (line: FundLine, i: number): ProjectKind =>
  line.kind[i] === KIND_AFFORDABLE ? 'affordable' : 'market';

/** The award line row `i` would get with unlimited money, under `month`'s frame. */
function awardOf(line: FundLine, i: number, month: number, t = timeline): Award {
  const fm = frameMoney(t, t.frameAt(month));
  const units = line.units[i];
  const a = awardSet(
    fm.bundleIds(line.bundle[i])!,
    kindOf(line, i),
    prototypeFor(line.stories[i], units).id,
    units,
    () => Infinity,
    fm.index
  );
  if (a === null) throw new Error('no award');
  return a;
}

/** What row `i` asks of capped pool `id`. */
function askOf(line: FundLine, i: number, id: string, month: number): number {
  const fm = frameMoney(timeline, timeline.frameAt(month));
  return awardOf(line, i, month).asks.get(fm.pool.get(id)!) ?? 0;
}

describe('serveLine', () => {
  it('serves once a month in line order; money released after the scan waits a month', () => {
    // Line order: month applied, then key. C applied in month 2 with a key before A's.
    const w = freshWorld();
    const { line, pools } = fundOf(w);
    const [a, b, c] = LOTS;
    joinLine(line, 1, [app(a, 'affordable', day(1, 3), AFF)]);
    joinLine(line, 2, [
      app(b, 'affordable', day(2, 9), AFF),
      app(c, 'affordable', day(2, 2), AFF, day(1, 0))
    ]);
    expect(Array.from(line.lot.subarray(0, 3))).toEqual([a, c, b]);
    const q = poolRowOf(pools, 'm-city');

    // Ample money: every row is awarded, in line order.
    pools.received[q] = 1e12;
    const h = harness(w, 2);
    serveLine(h.ctx);
    expect(h.starts().map((s) => s.lot)).toEqual([a, c, b]);
    const awards = h.log.flatMap((l) =>
      l.what === 'event' && l.e.kind === 'award' ? [l.e.row] : []
    );
    expect(awards).toEqual(h.starts().map((s) => s.row));
    expect(Array.from(line.gone.subarray(0, 3))).toEqual([1, 1, 1]);

    // Money for the first only: A is awarded, B waits.
    const w2 = freshWorld();
    const fl = fundOf(w2);
    joinLine(fl.line, 2, [
      app(a, 'affordable', day(2, 3), AFF),
      app(b, 'affordable', day(2, 9), AFF)
    ]);
    const askA = askOf(fl.line, 0, 'm-city', 2);
    const askB = askOf(fl.line, 1, 'm-city', 2);
    expect(askA).toBeGreaterThan(0);
    expect(askB).toBeGreaterThan(0);
    const q2 = poolRowOf(fl.pools, 'm-city');
    fl.pools.received[q2] = askA + askB - 1;
    const h2 = harness(w2, 2);
    const sys = createFundingSystem();
    sys.serve(h2.ctx);
    expect(h2.starts().map((s) => s.lot)).toEqual([a]);
    const rowA = h2.starts()[0].row;
    // After the scan, A exits before construction: its grant is released this month.
    moneyOnEvent(h2.ctx, { kind: 'end', row: rowA, day: day(2, 20), how: 'exit' });
    expect(fl.pools.committed[q2]).toBe(0);
    expect(fl.pools.moneyMonth[q2]).toBe(2);
    // Nothing more is served in month 2, though B now fits.
    expect(h2.starts().map((s) => s.lot)).toEqual([a]);
    expect(fl.line.gone[1]).toBe(0);
    // Month 3's scan serves B, on the month's first day.
    const h3 = harness(w2, 3);
    sys.serve(h3.ctx);
    expect(h3.starts().map((s) => [s.lot, s.day])).toEqual([[b, monthFirstDay(statics.asOf, 3)]]);
  });

  it('T17: an award is dated no earlier than the latest money that reached a pool it draws on this month', () => {
    // m-city gets one inflow, on a day late in month 3; nothing before.
    const m = 3;
    const d = monthLastDay(statics.asOf, m) - 2;
    const f: Finance = {
      ...fin,
      pools: fin.pools.map((p) =>
        p.id === 'm-city' ? { ...p, inflows: [{ kind: 'once', day: d, dollars: 1e12 }] } : p
      )
    };
    const t = oneMoneyTimeline(input, f);
    const w = freshWorld(t);
    const { line, pools } = fundOf(w);
    const [a] = LOTS;
    joinLine(line, 2, [app(a, 'affordable', day(2, 5), AFF)]);
    const sys = createFundingSystem();
    // Month 2: no money in m-city, the application waits.
    const h2 = harness(w, 2, { t });
    sys.moneyIn(h2.ctx);
    sys.serve(h2.ctx);
    expect(h2.starts()).toEqual([]);
    // Month 3: the money arrives on d, and the award is dated d (after the first day).
    const h3 = harness(w, m, { t });
    sys.moneyIn(h3.ctx);
    const q = poolRowOf(pools, 'm-city');
    expect(pools.moneyDay[q]).toBe(d);
    sys.serve(h3.ctx);
    expect(d).toBeGreaterThan(h3.ctx.firstDay);
    expect(h3.starts().map((s) => s.day)).toEqual([d]);
    const commit = h3.log.find((l) => l.what === 'ledger' && l.e.kind === 'commit');
    expect(commit?.what === 'ledger' && commit.e.day).toBe(d);
    // awardDay: the latest of the applied-or-first day and the asked pools' money days this month.
    expect(awardDay(h3.ctx, line, 0, pools, [q])).toBe(d);
  });

  it('T17: a release earlier in the month, booked after a late arrival, does not date the award earlier', () => {
    // m-city gets one inflow, late in month 3. A is awarded in month 2 on money set by hand;
    // B waits for want of money.
    const m = 3;
    const d = monthLastDay(statics.asOf, m) - 2;
    const f: Finance = {
      ...fin,
      pools: fin.pools.map((p) =>
        p.id === 'm-city' ? { ...p, inflows: [{ kind: 'once', day: d, dollars: 1e12 }] } : p
      )
    };
    const t = oneMoneyTimeline(input, f);
    const w = freshWorld(t);
    const { line, pools } = fundOf(w);
    const [a, b] = LOTS;
    joinLine(line, 2, [app(a, 'affordable', day(2, 3), AFF), app(b, 'affordable', day(2, 9), AFF)]);
    const q = poolRowOf(pools, 'm-city');
    pools.received[q] = askOf(line, 0, 'm-city', 2);
    const sys = createFundingSystem();
    const h2 = harness(w, 2, { t });
    sys.serve(h2.ctx);
    expect(h2.starts().map((s) => s.lot)).toEqual([a]);
    const rowA = h2.starts()[0].row;

    // Month 3, in system order: the arrival on d (system 2), then A's exit on day e < d releases
    // its commitment (system 3), then the scan (system 5).
    const h3 = harness(w, m, { t });
    sys.moneyIn(h3.ctx);
    const e = day(m, 4);
    expect(e).toBeLessThan(d);
    moneyOnEvent(h3.ctx, { kind: 'end', row: rowA, day: e, how: 'exit' });
    expect(pools.committed[q]).toBe(0);
    expect(pools.moneyMonth[q]).toBe(m);
    expect(pools.moneyDay[q]).toBe(d);
    sys.serve(h3.ctx);
    expect(h3.starts().map((s) => [s.lot, s.day])).toEqual([[b, d]]);
  });

  it('FundedStart carries kind, view, size, applied, paying programme ids and fundingOf dollars', () => {
    const w = freshWorld();
    const { line, pools } = fundOf(w);
    const [a, b] = LOTS;
    joinLine(line, 2, [
      app(a, 'affordable', day(2, 4), AFF),
      app(b, 'market', day(2, 6), 'm-bank-loan,m-city-guarantee')
    ]);
    pools.received[poolRowOf(pools, 'm-city')] = 1e12;
    pools.received[poolRowOf(pools, 'm-bank')] = 1e12;
    const h = harness(w, 2);
    const fm = frameMoney(timeline, h.ctx.frame);
    const view = timeline.frameAt(1).view;
    const want = (i: number): FundedStart => {
      const award = awardOf(line, i, 2);
      const units = line.units[i];
      const fs = fundedStartOf(h.ctx, fm, line, i, award);
      // fundingOf: paying ids and summed project dollars.
      const ids: string[] = [];
      let granted = 0;
      let lent = 0;
      let guaranteed = 0;
      award.set.forEach((g, n) => {
        const it = award.priced.items[n];
        if (it.granted > 0 || it.lent > 0 || it.guaranteed > 0) ids.push(fm.fin.programmes[g].id);
        granted += projectDollars(it.granted, units);
        lent += projectDollars(it.lent, units);
        guaranteed += projectDollars(it.guaranteed, units);
      });
      const lot = line.lot[i];
      const certain = coverageLevel(award.priced.coverage) === 1;
      const stream = streamOf(seedHash(SEED), lotEntity(statics, lot), 0);
      const pathway: Pathway | null =
        view.parcels.localProgram[lot] === 1
          ? 'streamlined'
          : certain && kindOf(line, i) === 'affordable'
            ? pathwayFrom(h.ctx.frame.newCalibration.affordableRoutes!, stream)
            : null;
      expect(fs).toEqual({
        kind: kindOf(line, i),
        view,
        f: line.f[i],
        units,
        stories: line.stories[i],
        applied: line.applied[i],
        programmes: ids,
        granted,
        lent,
        guaranteed,
        certain,
        pathway
      });
      expect(fs.view).toBe(view);
      return fs;
    };
    const fa = want(0);
    const fb = want(1);
    expect(fa.kind).toBe('affordable');
    expect(fa.programmes).toEqual(['m-city-grant', 'federal-grant']);
    expect(fa.granted).toBeGreaterThan(0);
    expect(fa.certain).toBe(true);
    expect(fa.pathway).not.toBeNull();
    expect(fb.kind).toBe('market');
    expect(fb.lent).toBeGreaterThan(0);
    expect(fb.guaranteed).toBeGreaterThan(0);
    expect(fb.programmes).toEqual(['m-bank-loan', 'm-city-guarantee']);
    // The serve hands startProject exactly these.
    serveLine(h.ctx);
    expect(h.starts().map((s) => s.funded)).toEqual([fa, fb]);
  });

  it('rule 11: an award on a Local Program lot takes the streamlined route, whatever its kind', () => {
    const lp = timeline.frameAt(1).view.parcels.localProgram;
    const lot = LOTS.find((l) => lp[l] === 1);
    expect(lot).toBeDefined();
    const w = freshWorld();
    const { line, pools } = fundOf(w);
    // A market award that is not certain: off the Local Program its route would be null.
    joinLine(line, 2, [app(lot!, 'market', day(2, 6), 'm-bank-loan,m-city-guarantee')]);
    pools.received[poolRowOf(pools, 'm-city')] = 1e12;
    pools.received[poolRowOf(pools, 'm-bank')] = 1e12;
    const h = harness(w, 2);
    const fs = fundedStartOf(
      h.ctx,
      frameMoney(timeline, h.ctx.frame),
      line,
      0,
      awardOf(line, 0, 2)
    );
    expect(fs.kind).toBe('market');
    expect(fs.certain).toBe(false);
    expect(fs.pathway).toBe('streamlined');
    serveLine(h.ctx);
    expect(h.starts().map((s) => s.funded?.pathway)).toEqual(['streamlined']);
  });

  it('Review Focus 1: a lot removed from the line during the scan is skipped and the line is scanned once', () => {
    const w = freshWorld();
    const { line, pools } = fundOf(w);
    const [a, b, c] = LOTS;
    joinLine(line, 2, [
      app(a, 'affordable', day(2, 1), AFF),
      app(b, 'market', day(2, 2), 'm-bank-loan'),
      app(b, 'affordable', day(2, 3), AFF),
      app(c, 'affordable', day(2, 4), AFF)
    ]);
    expect(Array.from(line.lot.subarray(0, 4))).toEqual([a, b, b, c]);
    pools.received[poolRowOf(pools, 'm-city')] = 1e12;
    pools.received[poolRowOf(pools, 'm-bank')] = 1e12;
    const sys = createFundingSystem();
    // A's chain frees and ordinarily starts lot b: its 'start' reaches onProjectEvent.
    const h = harness(w, 2, {
      chain(ctx, _row, lot, d) {
        if (lot !== a) return;
        const p = ctx.world.projects;
        const r = addProject(p);
        p.origin[r] = ORIGIN_SIM;
        p.src[r] = b;
        sys.onProjectEvent(ctx, { kind: 'start', row: r, day: d });
      }
    });
    sys.serve(h.ctx);
    expect(h.starts().map((s) => s.lot)).toEqual([a, c]);
    expect(Array.from(line.gone.subarray(0, 4))).toEqual([1, 1, 1, 1]);
    // One award per start, each after its start: a single pass.
    const awards = h.log.flatMap((l) =>
      l.what === 'event' && l.e.kind === 'award' ? [l.e.row] : []
    );
    expect(awards).toEqual(h.starts().map((s) => s.row));
    expect(fundOf(w).pools.mN).toBe(2 * 2);
  });

  it('Review Focus 2: an award entering construction in its own month spends that month', () => {
    const w = freshWorld();
    const { line, pools } = fundOf(w);
    const [a] = LOTS;
    joinLine(line, 2, [app(a, 'affordable', day(2, 4), AFF)]);
    const q = poolRowOf(pools, 'm-city');
    pools.received[q] = 1e12;
    const sys = createFundingSystem();
    const h = harness(w, 2, {
      chain(ctx, row, _lot, d) {
        const e: WorldEvent = { kind: 'enter', row, day: d + 3, stage: 'construction' };
        ctx.out.event(e);
        sys.onProjectEvent(ctx, e);
      }
    });
    sys.serve(h.ctx);
    const row = h.starts()[0].row;
    const ask = askOf(line, 0, 'm-city', 2);
    expect(pools.committed[q]).toBe(0);
    expect(pools.spentGrant[q]).toBe(ask);
    const kinds = h.log.flatMap((l) =>
      l.what === 'ledger'
        ? [`${l.e.kind}:${l.e.pool}`]
        : l.what === 'event' && l.e.row === row
          ? [`ev:${l.e.kind}`]
          : []
    );
    expect(kinds).toEqual([
      'commit:m-city',
      'commit:federal',
      'ev:enter',
      'spend:m-city',
      'spend:federal',
      'ev:award'
    ]);
  });

  it('Review Focus 3: an award asking nothing of a capped pool is dated its applied day or the first day', () => {
    const w = freshWorld();
    const { line, pools } = fundOf(w);
    const [a, b] = LOTS;
    // federal-grant alone draws only the uncapped pool.
    joinLine(line, 1, [app(a, 'affordable', day(1, 6), 'federal-grant')]);
    joinLine(line, 2, [app(b, 'affordable', day(2, 8), 'federal-grant')]);
    // Every capped pool had money late this month.
    for (const id of ['m-city', 'm-bank']) {
      const q = poolRowOf(pools, id);
      pools.received[q] = 1e12;
      pools.moneyDay[q] = monthLastDay(statics.asOf, 2);
      pools.moneyMonth[q] = 2;
    }
    const h = harness(w, 2);
    expect(awardOf(line, 0, 2).asks.size).toBe(0);
    expect(awardDay(h.ctx, line, 0, pools, [])).toBe(h.ctx.firstDay);
    expect(awardDay(h.ctx, line, 1, pools, [])).toBe(day(2, 8));
    serveLine(h.ctx);
    expect(h.starts().map((s) => [s.lot, s.day])).toEqual([
      [a, h.ctx.firstDay],
      [b, day(2, 8)]
    ]);
  });

  it('a lot whose ordinary start gained no home leaves the line at serving: no award, no money', () => {
    const w = freshWorld();
    const { line, pools } = fundOf(w);
    const [a, b] = LOTS;
    joinLine(line, 2, [
      app(a, 'market', day(2, 1), 'm-bank-loan'),
      app(a, 'affordable', day(2, 2), AFF),
      app(b, 'affordable', day(2, 3), AFF)
    ]);
    pools.received[poolRowOf(pools, 'm-city')] = 1e12;
    pools.received[poolRowOf(pools, 'm-bank')] = 1e12;
    // Month 2's system 6: lot a's ordinary start gains no home, as startRow makes it
    // (world.ts:311-314): the lot is done, no row, no 'start'. Its rows stay on the line.
    const li = ensureLot(w.lots, a, statics.asOf);
    w.lots.state[li] = LOT_DONE;
    const rows = w.projects.n;
    expect(Array.from(line.gone.subarray(0, 3))).toEqual([0, 0, 0]);
    // Month 3: a's applications would pass, but a is not free.
    const before = structuredClone(pools);
    const h = harness(w, 3);
    const sys = createFundingSystem();
    expect(() => sys.serve(h.ctx)).not.toThrow();
    expect(h.starts().map((s) => s.lot)).toEqual([b]);
    expect(Array.from(line.gone.subarray(0, 3))).toEqual([1, 1, 1]);
    const bRow = h.starts()[0].row;
    expect(bRow).toBe(rows);
    // Only b's award moved money; nothing names lot a.
    const awards = h.log.flatMap((l) =>
      l.what === 'event' && l.e.kind === 'award' ? [l.e.row] : []
    );
    expect(awards).toEqual([bRow]);
    const ask = askOf(line, 2, 'm-city', 3);
    const q = poolRowOf(pools, 'm-city');
    expect(pools.committed[q] - before.committed[q]).toBe(ask);
    expect(pools.committed[poolRowOf(pools, 'm-bank')]).toBe(
      before.committed[poolRowOf(pools, 'm-bank')]
    );
    expect(Array.from(pools.mRow.subarray(0, pools.mN)).every((r) => r === bRow)).toBe(true);
    expect(
      h.log
        .filter((l) => l.what === 'ledger')
        .every((l) => l.what === 'ledger' && l.e.kind === 'commit')
    ).toBe(true);
    expect(h.log.filter((l) => l.what === 'ledger')).toHaveLength(2);
  });

  it('a funded startProject never returns -1; serve throws if the row is not the predicted one', () => {
    const w = freshWorld();
    const { line, pools } = fundOf(w);
    joinLine(line, 2, [app(LOTS[0], 'affordable', day(2, 4), AFF)]);
    pools.received[poolRowOf(pools, 'm-city')] = 1e12;
    const h = harness(w, 2, { result: () => -1 });
    expect(() => serveLine(h.ctx)).toThrow(/returned -1/);
    const w2 = freshWorld();
    const f2 = fundOf(w2);
    joinLine(f2.line, 2, [app(LOTS[0], 'affordable', day(2, 4), AFF)]);
    f2.pools.received[poolRowOf(f2.pools, 'm-city')] = 1e12;
    const h2 = harness(w2, 2, { result: (r) => r + 1 });
    expect(() => serveLine(h2.ctx)).toThrow(/predicted/);
  });
});

/** An uncapped federal 100% affordable grant on the mini city (as engine-finance.spec.ts:420). */
const ROUTE_FIN: Finance = {
  pools: [
    {
      id: 'fed',
      kind: 'federal',
      label: 'fed',
      inflows: [],
      uncapped: true,
      debt: null,
      leverage: 1
    }
  ],
  programmes: [
    {
      id: 'aff',
      label: 'aff',
      pool: 'fed',
      reach: 'affordable',
      instrument: { kind: 'grant', share: 1 },
      from: input.asOf,
      to: null,
      minHomes: 1,
      tiers: { veryLow: 0.5, low: 0.5, moderate: 0, aboveModerate: 0 }
    }
  ],
  off: [],
  slope: 3,
  terms: resolveTerms(MARKET_TERMS)
};
const ROUTE_INPUT = fundedMini(ROUTE_FIN);
const ROUTE_TIMELINE = oneMoneyTimeline(ROUTE_INPUT, ROUTE_FIN);
const ROUTE_MONTHS = 3;
const ROUTE_SEEDS = 500;

/** Pathway counts of certain affordable awards off the Local Program, seeds `from..to`. */
function routeCount(from: number, to: number): Record<Pathway, number> {
  const counts: Record<Pathway, number> = { discretionary: 0, streamlined: 0, permitOnly: 0 };
  const core = withFunding(createFundingSystem());
  const lp = ROUTE_TIMELINE.frameAt(1).view.parcels.localProgram;
  for (let seed = from; seed <= to; seed++) {
    const w = runWorld(
      statics,
      ROUTE_TIMELINE,
      seed,
      ROUTE_MONTHS,
      { event() {} },
      {
        create: core.createWorld,
        step: core.step,
        plan: core.planDue
      }
    );
    const p = w.projects;
    for (let row = 0; row < p.n; row++) {
      if (p.funded[row] !== 1 || p.kind[row] !== 1 || p.certain[row] !== 1) continue;
      if (lp[p.src[row]] === 1) continue;
      counts[PATHWAYS[p.pathway[row]]]++;
    }
  }
  return counts;
}

describe('the route of a certain affordable award', () => {
  it('a certain affordable award draws its route from affordableRoutes, within 3 standard errors over 500 seeds', () => {
    // 500 runs of the mini city through month 3 (well under a second).
    const counts = routeCount(1, ROUTE_SEEDS);
    const routes = ROUTE_INPUT.calibration.affordableRoutes!;
    const n = PATHWAYS.reduce((s, p) => s + counts[p], 0);
    expect(n).toBeGreaterThan(1000);
    for (const p of PATHWAYS) {
      const share = routes[p];
      const se = Math.sqrt((share * (1 - share)) / n);
      expect(Math.abs(counts[p] / n - share), p).toBeLessThanOrEqual(3 * se);
    }
  });
});
