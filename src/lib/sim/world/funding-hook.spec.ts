// The hook `world-funding` plugs into (S12; rules 15 to 18), driven by a stub `FundingSystem` on
// the mini city with a `FinanceFrame` that has no pools, no programmes and no arrivals.
import { describe, expect, it } from 'vitest';
import { FILL_LEVELS, fillStories } from '$lib/data/scenario-codec';
import { MARKET_TERMS, resolveTerms } from '$lib/sim/finance/terms';
import { P, drawOn, seedHash } from '$lib/sim/scenario/rng';
import { sampleAdvance } from '$lib/timelapse/model';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import { lotRow } from './columns';
import { initDraw, skipBound, startRates } from './rates';
import { scheduleAt } from './read';
import { withFunding } from './world';
import type { FinanceFrame, PolicyFrame, PolicyTimeline } from './policy/frame';
import { staticsOf } from './statics';
import { miniInput } from './test/mini';
import { Recorder, runWorld } from './test/run';
import { changingAt, everyStage, frameOf, oneFrame } from './test/timeline';
import {
  LOT_FREE,
  type FundedStart,
  type FundingSystem,
  type StepCtx,
  type World,
  type WorldEvent
} from './types';

const input = miniInput();
const statics = staticsOf(input);
const F = FILL_LEVELS.length;
const finance: FinanceFrame = {
  pools: [],
  programmes: [],
  offered: new Uint8Array(0),
  slope: 0,
  terms: resolveTerms(MARKET_TERMS),
  arrivals: []
};
const funded = frameOf(input, { id: 1, finance });
const unfunded = frameOf(input, { id: 2 });
const SEED = 3;
const LONG = 360;

type Hook = keyof FundingSystem;

/** A `FundingSystem` that logs each call (and each event its sink is sent) and does nothing else. */
class Stub implements FundingSystem {
  log: { month: number; name: string; row?: number }[] = [];
  month = 0;
  onServe: (ctx: StepCtx) => void = () => {};
  onShadow: (ctx: StepCtx) => void = () => {};
  onPlanLot: (ctx: StepCtx, lot: number) => number = () => 0;
  onEvent: (ctx: StepCtx, e: WorldEvent) => void = () => {};
  ctxs: StepCtx[] = [];
  applied: { month: number; lots: number[] }[] = [];
  private note(name: string) {
    this.log.push({ month: this.month, name });
  }
  create(): void {
    this.note('create');
  }
  policyChanged(ctx: StepCtx): void {
    this.month = ctx.month;
    this.note('policyChanged');
  }
  moneyIn(ctx: StepCtx): void {
    this.month = ctx.month;
    this.note('moneyIn');
  }
  onProjectEvent(ctx: StepCtx, e: WorldEvent): void {
    this.log.push({ month: this.month, name: `onProjectEvent:${e.kind}`, row: e.row });
    this.ctxs.push(ctx);
    this.onEvent(ctx, e);
  }
  apply(ctx: StepCtx, lots: Int32Array): void {
    this.note('apply');
    this.applied.push({ month: ctx.month, lots: [...lots] });
  }
  serve(ctx: StepCtx): void {
    this.note('serve');
    this.ctxs.push(ctx);
    this.onServe(ctx);
  }
  shadow(ctx: StepCtx): void {
    this.note('shadow');
    this.onShadow(ctx);
  }
  planLot(ctx: StepCtx, lot: number): number {
    this.note('planLot');
    return this.onPlanLot(ctx, lot);
  }
  names(month: number, drop: Hook[] = ['planLot']): string[] {
    return this.entries(month, drop).map((c) => c.name);
  }
  entries(month: number, drop: Hook[] = ['planLot']) {
    return this.log.filter((c) => c.month === month && !drop.includes(c.name as Hook));
  }
}

/**
 * Checks one month's calls against rule 16 as amended: `[policyChanged]`, `moneyIn`, each system 3
 * event followed by `onProjectEvent` for it, `apply`, `serve`, then each event of systems 5 and 6
 * followed by `onProjectEvent` for it except the `'start'` of a row in `funded` (started by the
 * funding system itself), `shadow`. Returns how many events of systems 3 and 5-6 were passed.
 */
function checkMonth(stub: Stub, m: number, changed: boolean, funded: Set<number>) {
  const items = stub.entries(m);
  const name = (i: number) => items[i]?.name;
  let i = 0;
  if (changed) expect(name(i++)).toBe('policyChanged');
  expect(name(i++), `month ${m}`).toBe('moneyIn');
  let sys3 = 0;
  while (name(i)?.startsWith('ev:')) {
    expect(items[i + 1]).toEqual({ ...items[i], name: `onProjectEvent:${name(i)!.slice(3)}` });
    i += 2;
    sys3++;
  }
  expect(name(i++)).toBe('apply');
  expect(name(i++)).toBe('serve');
  let later = 0;
  while (name(i)?.startsWith('ev:')) {
    const ev = items[i++];
    if (ev.name === 'ev:start' && funded.has(ev.row!)) continue;
    expect(items[i++], `month ${m}`).toEqual({ ...ev, name: `onProjectEvent:${ev.name.slice(3)}` });
    later++;
  }
  expect(name(i++)).toBe('shadow');
  expect(i, `month ${m}: ${items.map((c) => c.name).join(' ')}`).toBe(items.length);
  return { sys3, later };
}

/** A recorder whose events also land in the stub's log, in order with the hook calls. */
class Both extends Recorder {
  constructor(readonly stub: Stub) {
    super();
  }
  override event(e: WorldEvent): void {
    super.event(e);
    this.stub.month = this.month;
    this.stub.log.push({ month: this.month, name: `ev:${e.kind}`, row: e.row });
  }
}

function run(
  f: FundingSystem | null,
  timeline: PolicyTimeline,
  through: number,
  out = new Recorder(),
  rebuildEvery?: number
) {
  const core = withFunding(f);
  const w = runWorld(statics, timeline, SEED, through, out, {
    create: core.createWorld,
    step: core.step,
    plan: core.planDue,
    rebuildEvery
  });
  return { w, events: out.events };
}

const byRank = Array.from({ length: statics.parcelId.length }, (_, i) => i).sort(
  (a, b) => statics.rank[a] - statics.rank[b]
);

function isFree(w: World, lot: number): boolean {
  const i = lotRow(w.lots, lot);
  return i < 0 || w.lots.state[i] === LOT_FREE;
}

/** The highest level of the lot in the view that has homes, or -1. */
function topLevel(frame: PolicyFrame, lot: number): number {
  const y = frame.view.parcels.yield;
  for (let f = F - 1; f >= 0; f--) if (y[lot * F + f] > 0) return f;
  return -1;
}

function fundedStart(ctx: StepCtx, lot: number, certain: boolean): FundedStart {
  const parcels = ctx.frame.view.parcels;
  const f = topLevel(ctx.frame, lot);
  return {
    kind: 'market',
    view: ctx.frame.view,
    f,
    units: parcels.yield[lot * F + f],
    stories: fillStories(FILL_LEVELS[f], parcels.envelopeStories[lot]),
    applied: ctx.firstDay,
    programmes: ['bond', 'loan'],
    granted: 1000,
    lent: 2000,
    guaranteed: 3000,
    certain,
    pathway: null
  };
}

/** The lot, month and day of an ordinary start in the unfunded run, in month >= `from`. */
function ordinaryStartFrom(from: number): { lot: number; month: number; day: number } {
  const { w, events } = run(null, oneFrame(unfunded), LONG);
  const e = events.find(
    (e) => e.kind === 'start' && e.month >= from && w.projects.origin[e.row] === 3
  );
  if (!e) throw new Error('no ordinary start');
  return { lot: w.projects.src[e.row], month: e.month, day: e.day };
}

describe('withFunding', () => {
  it('calls the hooks in system order', () => {
    const stub = new Stub();
    const after = { ...funded, id: 5, speed: everyStage(0.8) };
    const T = 24;
    const out = new Both(stub);
    run(stub, changingAt(13, funded, after, new Int32Array(0)), T, out);
    const zero = stub.names(0);
    expect(zero.filter((n) => n === 'create')).toEqual(['create']);
    expect(zero.at(-1)).toBe('create');
    expect(zero.slice(0, -1).every((n) => n.startsWith('ev:'))).toBe(true);
    expect(stub.log.some((c) => c.month === 0 && c.name === 'planLot')).toBe(true);
    let sys3 = 0;
    let sys6 = 0;
    for (let m = 1; m <= T; m++) {
      const n = checkMonth(stub, m, m === 13, new Set());
      sys3 += n.sys3;
      sys6 += n.later;
    }
    expect(stub.log.filter((c) => c.name === 'policyChanged').map((c) => c.month)).toEqual([13]);
    expect(sys3).toBeGreaterThan(0);
    expect(sys6).toBeGreaterThan(0);
  });

  it("passes stage events of starts made in systems 5 and 6, but not an award's own start", () => {
    // Short stages, so starts leave their first stage in the month they begin.
    const fast = { ...funded, id: 8, speed: everyStage(0.05) };
    const stub = new Stub();
    const awarded = new Set<number>();
    stub.onServe = (ctx) => {
      const lot = byRank.find((l) => isFree(ctx.world, l) && topLevel(ctx.frame, l) >= 0);
      if (lot !== undefined)
        awarded.add(ctx.startProject(lot, ctx.firstDay, fundedStart(ctx, lot, false)));
    };
    const T = 60;
    const out = new Both(stub);
    run(stub, oneFrame(fast), T, out);
    for (let m = 1; m <= T; m++) checkMonth(stub, m, false, awarded);
    // Non-degeneracy: a row started in its month (award or ordinary) that also leaves its first
    // stage in that month, and so sends more than its start and first enter there.
    const sameMonth = (row: number) => {
      const start = out.events.find((e) => e.row === row && e.kind === 'start')!;
      return out.events.filter((e) => e.row === row && e.month === start.month).length;
    };
    const passed = (row: number) =>
      stub.log
        .filter((c) => c.row === row && c.name.startsWith('onProjectEvent'))
        .map((c) => c.name);
    const awardChain = [...awarded].filter((row) => sameMonth(row) > 2);
    expect(awardChain.length).toBeGreaterThan(0);
    for (const row of awarded) expect(passed(row)).not.toContain('onProjectEvent:start');
    const ordinary = out.events
      .filter((e) => e.kind === 'start' && e.month > 0 && !awarded.has(e.row))
      .map((e) => e.row);
    expect(ordinary.filter((row) => sameMonth(row) > 2).length).toBeGreaterThan(0);
    for (const row of ordinary) expect(passed(row)[0]).toBe('onProjectEvent:start');
  });

  it("does not pass back the start of an ordinary start the hook made in serve, but its chain's events", () => {
    const target = ordinaryStartFrom(2);
    const stub = new Stub();
    let row = -1;
    stub.onServe = (ctx) => {
      if (ctx.month !== target.month) return;
      row = ctx.startProject(target.lot, target.day, null);
    };
    const out = new Both(stub);
    run(stub, oneFrame(funded), target.month, out);
    expect(row).toBeGreaterThanOrEqual(0);
    const own = new Set([row]);
    for (let m = 1; m <= target.month; m++) checkMonth(stub, m, false, own);
    const passed = stub.log
      .filter((c) => c.row === row && c.name.startsWith('onProjectEvent'))
      .map((c) => c.name);
    expect(passed).not.toContain('onProjectEvent:start');
    expect(passed[0]).toBe('onProjectEvent:enter');
    // The same project as the unfunded run's, started once.
    const starts = out.events.filter((e) => e.kind === 'start' && e.month === target.month);
    expect(starts.filter((e) => e.row === row)).toEqual([
      { kind: 'start', row, day: target.day, month: target.month }
    ]);
  });

  it('hands the hooks a StepCtx and nothing more', () => {
    const stub = new Stub();
    stub.onServe = (ctx) => {
      const lot = byRank.find((l) => isFree(ctx.world, l) && topLevel(ctx.frame, l) >= 0);
      if (lot !== undefined) ctx.startProject(lot, ctx.firstDay, fundedStart(ctx, lot, false));
    };
    run(stub, oneFrame(funded), 12);
    const keys = [
      'due',
      'displace',
      'firstDay',
      'frame',
      'lastDay',
      'month',
      'out',
      'seed',
      'startProject',
      'statics',
      'timeline',
      'world'
    ].sort();
    expect(stub.ctxs.length).toBeGreaterThan(12);
    for (const ctx of stub.ctxs) expect(Object.keys(ctx).sort()).toEqual(keys);
  });

  it('refuses a start from onProjectEvent during system 3', () => {
    const stub = new Stub();
    let tried = 0;
    stub.onEvent = (ctx, e) => {
      if (tried > 0 || e.kind !== 'enter') return;
      tried++;
      const lot = byRank.find((l) => isFree(ctx.world, l) && topLevel(ctx.frame, l) >= 0)!;
      expect(() => ctx.startProject(lot, ctx.firstDay, fundedStart(ctx, lot, true))).toThrow(
        /system 3/
      );
    };
    run(stub, oneFrame(funded), 24);
    expect(tried).toBe(1);
  });

  it('calls no hook without a FundingSystem or when the frame has no finance', () => {
    const stub = new Stub();
    const t = changingAt(13, unfunded, { ...unfunded, id: 6, market: unfunded.market + 0.3 }, null);
    const mine = run(stub, t, 120).events;
    expect(stub.log).toEqual([]);
    expect(mine).toEqual(run(null, t, 120).events);
    expect(mine.length).toBeGreaterThan(0);
  });

  it('gives the unfunded events when the stub does nothing, carried or rebuilt', () => {
    const plain = run(null, oneFrame(unfunded), LONG).events;
    expect(run(new Stub(), oneFrame(funded), LONG).events).toEqual(plain);
    expect(run(new Stub(), oneFrame(funded), LONG, new Recorder(), 12).events).toEqual(plain);
  });

  it('a certain funded start advances on sampleAdvance with no revision', () => {
    const slow = { ...funded, id: 7, speed: everyStage(0.8) };
    const stub = new Stub();
    const rows: number[] = [];
    stub.onServe = (ctx) => {
      if (ctx.month > 6) return;
      let n = 0;
      for (const lot of byRank) {
        if (n === 2) break;
        if (!isFree(ctx.world, lot) || topLevel(ctx.frame, lot) < 0) continue;
        const row = ctx.startProject(lot, ctx.firstDay, fundedStart(ctx, lot, true));
        expect(row).toBeGreaterThanOrEqual(0);
        rows.push(row);
        n++;
      }
    };
    const { w, events } = run(stub, oneFrame(slow), LONG);
    expect(rows.length).toBe(12);
    const day = events.at(-1)!.day;
    let pairs = 0;
    for (const row of rows) {
      const s = scheduleOf(w, row, day);
      expect(s.funding).toEqual({
        programmes: ['bond', 'loan'],
        applied: s.entered[firstStage(s.entered)],
        granted: 1000,
        lent: 2000,
        guaranteed: 3000,
        displaced: 0,
        certain: true
      });
      expect(s.end.kind).toBe('complete');
      const stream = w.projects.stream[row];
      const seen = STAGE_ORDER.filter((st) => s.entered[st] !== undefined);
      for (let j = 0; j + 1 < seen.length; j++) {
        const st = seen[j] as Exclude<Stage, 'complete'>;
        const t = funded.newCalibration.transitions[s.pathway][st]!;
        const days = sampleAdvance(t, drawOn(stream, P.STAGE_TIME, STAGE_ORDER.indexOf(st))).days;
        expect(s.entered[seen[j + 1]]! - s.entered[st]!).toBe(Math.floor(0.8 * days));
        pairs++;
      }
      expect(s.revisions.length).toBe(1);
      const mine = events.filter((e) => e.row === row);
      expect(mine.some((e) => e.kind === 'revise')).toBe(false);
      expect(mine.some((e) => e.kind === 'end' && e.how === 'exit')).toBe(false);
    }
    expect(pairs).toBeGreaterThan(rows.length);
  });

  it('a lot taken by a funded start this month is not started again by system 6', () => {
    const target = ordinaryStartFrom(2);
    const stub = new Stub();
    let row = -1;
    stub.onServe = (ctx) => {
      if (ctx.month !== target.month) return;
      expect(isFree(ctx.world, target.lot)).toBe(true);
      row = ctx.startProject(target.lot, ctx.firstDay, fundedStart(ctx, target.lot, true));
    };
    const { w, events } = run(stub, oneFrame(funded), target.month);
    const starts = events.filter(
      (e) =>
        e.kind === 'start' &&
        e.month === target.month &&
        w.projects.src[e.row] === target.lot &&
        w.projects.origin[e.row] === 3
    );
    expect(starts.map((e) => e.row)).toEqual([row]);
    expect(w.projects.funded[row]).toBe(1);
  });

  it('displace records homes on the funded row', () => {
    const stub = new Stub();
    let row = -1;
    let lot = -1;
    stub.onServe = (ctx) => {
      if (ctx.month !== 1) return;
      lot = byRank.find((l) => isFree(ctx.world, l) && topLevel(ctx.frame, l) >= 0)!;
      row = ctx.startProject(lot, ctx.firstDay, fundedStart(ctx, lot, true));
    };
    let lastDay = 0;
    stub.onShadow = (ctx) => {
      if (ctx.month !== 3) return;
      lastDay = ctx.lastDay;
      ctx.displace(row, lot, ctx.lastDay, 12);
    };
    const { w, events } = run(stub, oneFrame(funded), 4);
    const shown = events.filter((e) => e.kind === 'displaced');
    expect(shown).toEqual([{ kind: 'displaced', row, lot, day: lastDay, units: 12, month: 3 }]);
    expect(scheduleOf(w, row, lastDay).funding!.displaced).toBe(12);
    expect(scheduleOf(w, row, lastDay - 1).funding!.displaced).toBe(0);
  });
});

describe('funded planning', () => {
  it('applies a lot in its planLot month and still starts it on its ordinary clock', () => {
    const target = ordinaryStartFrom(10);
    const at = target.month - 5;
    const plain = run(null, oneFrame(unfunded), LONG).events;
    for (const rebuild of [undefined, 4]) {
      const stub = new Stub();
      stub.onPlanLot = (ctx, lot) => (lot === target.lot && ctx.month <= at ? at : 0);
      expect(run(stub, oneFrame(funded), LONG, new Recorder(), rebuild).events).toEqual(plain);
      expect(stub.applied.filter((a) => a.lots.length > 0)).toEqual([
        { month: at, lots: [target.lot] }
      ]);
    }
  });

  it('applies lots the ordinary clock never plans: no chance at all, or past the window', () => {
    const rates = startRates(funded.view, funded.market);
    const dead = byRank.find((l) => rates[l] === 0);
    const bound = skipBound(statics, oneFrame(funded), 1, 24);
    const sh = seedHash(SEED);
    const late = byRank.find((l) => rates[l] < 0 && initDraw(statics, sh, l, 0) > bound[l]);
    expect(dead).toBeDefined();
    expect(late).toBeDefined();
    const stub = new Stub();
    stub.onPlanLot = (ctx, lot) =>
      lot === dead && ctx.month <= 7 ? 7 : lot === late && ctx.month <= 9 ? 9 : 0;
    run(stub, oneFrame(funded), 24);
    expect(stub.applied.filter((a) => a.lots.length > 0)).toEqual([
      { month: 7, lots: [dead] },
      { month: 9, lots: [late] }
    ]);
  });

  it('drops a zero-rate lot planned only by planLot when the money stops, carried or rebuilt', () => {
    const rates = startRates(funded.view, funded.market);
    const dead = byRank.find((l) => rates[l] === 0)!;
    expect(dead).toBeDefined();
    const t = changingAt(5, funded, { ...unfunded, id: 9 }, new Int32Array(0));
    const plain = run(null, oneFrame(unfunded), 24).events;
    for (const rebuild of [undefined, 3]) {
      const stub = new Stub();
      stub.onPlanLot = (ctx, lot) => (lot === dead && ctx.month <= 7 ? 7 : 0);
      expect(run(stub, t, 24, new Recorder(), rebuild).events).toEqual(plain);
      expect(stub.applied.every((a) => a.lots.length === 0)).toBe(true);
    }
  });

  it('drops a planned application when the money stops, without falling out of step', () => {
    const target = ordinaryStartFrom(20);
    const stub = new Stub();
    stub.onPlanLot = (_ctx, lot) => (lot === target.lot ? target.month - 2 : 0);
    const t = changingAt(target.month - 4, funded, { ...unfunded, id: 9 }, new Int32Array(0));
    expect(run(stub, t, LONG).events).toEqual(run(null, oneFrame(unfunded), LONG).events);
    expect(stub.applied.every((a) => a.lots.length === 0)).toBe(true);
  });
});

describe('startProject guards', () => {
  it('refuses a lot that is not free', () => {
    const stub = new Stub();
    stub.onServe = (ctx) => {
      if (ctx.month !== 1) return;
      const lot = byRank.find((l) => isFree(ctx.world, l) && topLevel(ctx.frame, l) >= 0)!;
      ctx.startProject(lot, ctx.firstDay, fundedStart(ctx, lot, true));
      expect(() => ctx.startProject(lot, ctx.firstDay, fundedStart(ctx, lot, true))).toThrow(
        /not free/
      );
      const held = ctx.world.lots.lot[[...ctx.world.lots.state].findIndex((s) => s === 0)];
      expect(held).toBeDefined();
      expect(() => ctx.startProject(held, ctx.firstDay, fundedStart(ctx, held, true))).toThrow(
        /not free/
      );
    };
    run(stub, oneFrame(funded), 1);
    expect(stub.names(1)).toContain('serve');
  });

  it("refuses a programme id that is empty or holds ','", () => {
    const stub = new Stub();
    stub.onServe = (ctx) => {
      if (ctx.month !== 1) return;
      const lot = byRank.find((l) => isFree(ctx.world, l) && topLevel(ctx.frame, l) >= 0)!;
      for (const bad of [['a,b'], ['']]) {
        const n = ctx.world.projects.n;
        expect(() =>
          ctx.startProject(lot, ctx.firstDay, { ...fundedStart(ctx, lot, true), programmes: bad })
        ).toThrow(/programme id/);
        expect(ctx.world.projects.n).toBe(n);
      }
    };
    run(stub, oneFrame(funded), 1);
    expect(stub.names(1)).toContain('serve');
  });

  it('planDue gives planLot a context that cannot start or displace', () => {
    const stub = new Stub();
    const seen: { month: number; first: number }[] = [];
    stub.onPlanLot = (ctx) => {
      if (seen.length === 0) {
        seen.push({ month: ctx.month, first: ctx.firstDay });
        expect(() => ctx.startProject(0, ctx.firstDay, null)).toThrow();
        expect(() => ctx.displace(0, 0, ctx.firstDay, 1)).toThrow();
      }
      return 0;
    };
    const core = withFunding(stub);
    const w = core.createWorld(statics, oneFrame(funded), SEED, new Recorder());
    core.planDue(w, statics, oneFrame(funded), SEED, 12);
    expect(seen).toEqual([{ month: 1, first: statics.asOf + 1 }]);
  });
});

function firstStage(entered: Partial<Record<Stage, number>>): Stage {
  return STAGE_ORDER.find((s) => entered[s] !== undefined)!;
}

function scheduleOf(w: World, row: number, day: number) {
  const s = scheduleAt(w, statics, row, day);
  if (!s) throw new Error(`row ${row} not begun by ${day}`);
  return s;
}
