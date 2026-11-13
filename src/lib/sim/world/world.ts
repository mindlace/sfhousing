// The world at the dataset date, the month step and the funding hook (spec S2, S12, rules 14-19).
// Without a funding system in force the step runs systems 1 (policy, when the frame changes: rules
// 7 and 12), 3 (stages due), 4 (lots whose ordinary start falls this month are set aside) and 6
// (they start). `withFunding(f)` adds the calls into `f` in the months whose frame has `finance`.
import { FILL_LEVELS, fillStories } from '$lib/data/scenario-codec';
import { pathwayFrom } from '$lib/sim/scenario/engine';
import { sizeCumAgainst } from '$lib/sim/scenario/input';
import { P, drawOn, seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { Day } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER, type Pathway, type Stage } from '$lib/timelapse/types';
import { addProject, emptyWorld, ensureLot, lotRow, pushDisplacement, pushRev } from './columns';
import { createHolds } from './holds';
import { DueList, eachFreeLot, planDueWith, plannedMonth, type planDue } from './due';
import { enterStage, reanchor, rowSpeed } from './stage';
import { monthFirstDay, monthLastDay } from './months';
import { createProjects, dueMonthOf, followProject, rowStaticsOf, type Sys3 } from './pipeline';
import type { PolicyFrame, PolicyTimeline } from './policy/frame';
import { initDraw, lotEntity, ordinaryStart, skipBound, type OrdinaryStart } from './rates';
import type { Statics } from './statics';
import {
  END_ALIVE,
  LOT_DONE,
  LOT_FREE,
  LOT_LIVE,
  NO_DAY,
  ORIGIN_SIM,
  RULE_NONE,
  RULE_SIM,
  type Due,
  type FundedStart,
  type FundingSystem,
  type StepCtx,
  type StepSink,
  type World,
  type WorldEvent
} from './types';

const F = FILL_LEVELS.length;
const S = STAGE_ORDER.length;
const SI = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i])) as Record<Stage, number>;

/** The world at month 0 under `timeline.frameAt(1)`, with the events already true at the dataset date. */
export function createWorld(
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  out: StepSink
): World {
  return createWorldWith(null, statics, timeline, seed, out);
}

/** Advances `world` in place by one model month (S2). */
export function step(
  world: World,
  due: Due,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  out: StepSink
): void {
  stepWith(null, world, due, statics, timeline, seed, out);
}

/**
 * The core with the funding system `f` plugged in (S12). With `f` null, and in every month whose
 * frame has `finance` null, no hook is called and the world is the unfunded one (rule 18).
 *
 * - `createWorld` ends with `f.create(world, statics, frameAt(1))`.
 * - `step` runs the systems of rule 16: (1) on a frame change, rules 7 and 12, then
 *   `f.policyChanged`; (2) `f.moneyIn`; (3) the stages due, each event passed to
 *   `f.onProjectEvent` after it is sent; (4) the due free lots (those taken, and those system 3
 *   freed) for which `f.planLot` gives this month go to `f.apply` in rank order, those whose
 *   ordinary start falls this month are set aside, and the rest are planned again after `apply`;
 *   (5) `f.serve`; (6) each lot set aside that no project started on this month starts; every
 *   event of systems 5 and 6 (chains included) is passed to `f.onProjectEvent` after it is sent,
 *   except the `'start'` of a project `f` itself started through `ctx.startProject` (funded or
 *   not); (7) `f.shadow`. Hooks get a plain `StepCtx`.
 * - `planDue` plans each free lot at `plannedMonth(ordinary month, f.planLot(ctx, lot), month)`,
 *   `ctx` being `planCtx`'s (month `world.month + 1`, a sink that drops events, `startProject` and
 *   `displace` that throw).
 *
 * Wherever the core plans a free lot in a funded month it asks `planLot`; an answer before the
 * first month in which the lot can still apply (this month before system 4, the next one after) is
 * not counted. A frame change in a month whose frame, or the month before's, has `finance` plans
 * every free lot again.
 */
export function withFunding(f: FundingSystem | null): {
  createWorld: typeof createWorld;
  step: typeof step;
  planDue: typeof planDue;
} {
  return {
    createWorld: (statics, timeline, seed, out) => createWorldWith(f, statics, timeline, seed, out),
    step: (world, due, statics, timeline, seed, out) =>
      stepWith(f, world, due, statics, timeline, seed, out),
    planDue: (world, statics, timeline, seed, through) =>
      planDueWith(world, statics, timeline, seed, through, { skip: true, funding: f })
  };
}

function createWorldWith(
  f: FundingSystem | null,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  out: StepSink
): World {
  const frame = timeline.frameAt(1);
  const w = emptyWorld(frame.id);
  const x: Sys3 = {
    w,
    statics,
    timeline,
    frame,
    sh: seedHash(seed),
    out,
    rs: rowStaticsOf(statics, frame.view),
    freed: []
  };
  createHolds(w, statics, x.rs);
  createProjects(x);
  if (x.freed.length > 0) throw new Error('createWorld: a lot was freed at the dataset date');
  if (f !== null && frame.finance !== null) f.create(w, statics, frame);
  return w;
}

/** A lot's attempt and the day it became free: its row's, or attempt 0 from the dataset date. */
function freeSince(w: World, statics: Statics, lot: number): { r: Day; k: number } {
  const i = lotRow(w.lots, lot);
  return i < 0 ? { r: statics.asOf, k: 0 } : { r: w.lots.r[i], k: w.lots.k[i] };
}

/** The ordinary start of a free lot, reading frames up to `month` (rules 5 and 6). */
function startOf(
  w: World,
  statics: Statics,
  timeline: PolicyTimeline,
  month: number,
  sh: number,
  lot: number
): OrdinaryStart | null {
  const { r, k } = freeSince(w, statics, lot);
  return ordinaryStart(statics, timeline, month, sh, lot, r, k);
}

/** True when the lot has no row or its row is `LOT_FREE`. */
function isFree(w: World, lot: number): boolean {
  const i = lotRow(w.lots, lot);
  return i < 0 || w.lots.state[i] === LOT_FREE;
}

/** One step's context: `StepCtx` (S12) plus what the core's own systems share. */
interface Step extends StepCtx {
  x: Sys3;
  /** The due list itself; `due` is the guarded view the hooks get. */
  list: Due;
  /** The funding system plugged in, whether or not it is in force this month. */
  hook: FundingSystem | null;
  /** `hook` when this month's frame has `finance`, else null: the one the systems call. */
  fund: FundingSystem | null;
  /** Lots a start was made on this month (including one refused for want of homes). */
  started: Set<number>;
  /** True once this month has been taken from the due list (system 3 on). */
  taken: boolean;
  /** True while system 3 follows the stages due: `startProject` throws. */
  following: boolean;
  /** The `StepCtx` the hooks are handed (S12), and nothing more. */
  pub: StepCtx;
  /** Puts a row at the month it is next due, if any. */
  put(row: number): void;
  /** The month a free lot whose ordinary month is `ord` (0 = none) is put at, asking `planLot`. */
  planLot(lot: number, ord: number): number;
  /** Plans every lot in `x.freed` from position `from` on, then forgets them (rule 14). */
  planFreed(from: number): void;
  /** Starts a free lot on its ordinary start `s`, which falls in this month (system 6). */
  startOrdinary(lot: number, s: OrdinaryStart): number;
}

function stepCtx(
  hook: FundingSystem | null,
  world: World,
  list: Due,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  out: StepSink,
  month: number,
  frame: PolicyFrame
): Step {
  const asOf = statics.asOf;
  const firstDay = monthFirstDay(asOf, month);
  const lastDay = monthLastDay(asOf, month);
  const sh = seedHash(seed);
  const fund = hook !== null && frame.finance !== null ? hook : null;
  const x: Sys3 = {
    w: world,
    statics,
    timeline,
    frame,
    sh,
    out,
    rs: rowStaticsOf(statics, timeline.frameAt(1).view),
    freed: []
  };
  const started = new Set<number>();
  const put = (row: number) => {
    const m = dueMonthOf(world, asOf, row);
    if (m > 0) list.put(-1 - row, m);
  };
  // The hooks' view of the due list: once this month is taken nothing can be put in it or before
  // it (it would never be taken again), and only the core takes.
  const due: Due = {
    take() {
      throw new Error('StepCtx.due: only the core takes from the due list');
    },
    put(entity, m) {
      if (m < month || (m === month && ctx.taken)) {
        throw new RangeError(`StepCtx.due: month ${m} has already been taken`);
      }
      list.put(entity, m);
    },
    drop: (entity) => list.drop(entity)
  };

  const planLot = (lot: number, ord: number): number =>
    plannedMonth(
      ord,
      fund === null ? 0 : fund.planLot(ctx.pub, lot),
      ctx.taken ? month + 1 : month
    );

  /**
   * Plans the lots freed from position `from` of `x.freed` on, inside a chain (rule 14): a start
   * this month is made at once, a later one (or an application) is put.
   */
  const planFreed = (from: number): void => {
    while (x.freed.length > from) {
      const lot = x.freed[from];
      x.freed.splice(from, 1);
      const s = startOf(world, statics, timeline, month, sh, lot);
      if (s !== null && s.month < month)
        throw new Error(`lot ${lot} freed in month ${month} starts in ${s.month}`);
      if (s !== null && s.month === month) {
        startRow(lot, s.day, s, null, false);
        continue;
      }
      const m = planLot(lot, s === null ? 0 : s.month);
      if (m > 0) list.put(lot, m);
    }
  };

  /**
   * Makes the row of a start on `lot`. `byHook` is true for a start the funding system made through
   * its `StepCtx`: its `'start'` is not passed back to `onProjectEvent` (rule 16 as amended).
   */
  const startRow = (
    lot: number,
    day: Day,
    ordinary: OrdinaryStart | null,
    funded: FundedStart | null,
    byHook: boolean
  ): number => {
    const l = world.lots;
    const i0 = lotRow(l, lot);
    if (i0 >= 0 && l.state[i0] !== LOT_FREE) {
      throw new Error(`startProject: lot ${lot} is not free (state ${l.state[i0]})`);
    }
    if (funded !== null) {
      if (day < firstDay || day > lastDay) {
        throw new RangeError(`startProject: day ${day} is outside month ${month}`);
      }
      for (const id of funded.programmes) {
        if (id === '' || id.includes(',')) {
          throw new Error(`startProject: programme id ${JSON.stringify(id)} is empty or holds ','`);
        }
      }
    }
    started.add(lot);
    // The lot leaves the free state: the month it was due in no longer applies.
    list.drop(lot);
    let li = ensureLot(l, lot, asOf);
    const k = l.k[li];
    const stream = streamOf(sh, lotEntity(statics, lot), k);
    // Rule 8 and Open question 3: route shares, Local Program and size from the frame of the
    // model month holding the lot-month's first day.
    const from = ordinary === null ? frame : timeline.frameAt(Math.min(ordinary.frameMonth, month));
    const view = funded === null ? from.view : funded.view;
    const parcels = view.parcels;
    const own = parcels.existingUnits[lot];
    const existing = l.demolished[li] === 1 ? 0 : own;
    let f: number;
    if (funded !== null) f = funded.f;
    else {
      const cum =
        existing === own
          ? view.pre.sizeCum
          : sizeCumAgainst(
              {
                parcels,
                projects: statics.projects,
                calibration: from.calibration,
                asOf,
                districtMaxStories: statics.districtMaxStories
              },
              lot,
              existing
            );
      const at = existing === own ? lot * F : 0;
      const u = drawOn(stream, P.SIZE, 0);
      f = 0;
      while (f < F && !(u < cum[at + f])) f++;
      if (f === F) {
        l.state[li] = LOT_DONE;
        return -1;
      }
    }
    const cal = from.newCalibration;
    const path: Pathway =
      funded?.pathway ??
      (parcels.localProgram[lot] === 1 ? 'streamlined' : pathwayFrom(cal.pathwayForNew, stream));
    const first: Stage =
      drawOn(stream, P.PPA, 0) < cal.ppaShare[path]
        ? 'preApplication'
        : path === 'permitOnly'
          ? 'permitFiled'
          : 'filed';
    const p = world.projects;
    const row = addProject(p);
    const certain = funded !== null && funded.certain;
    p.origin[row] = ORIGIN_SIM;
    p.src[row] = lot;
    p.sub[row] = k;
    p.stream[row] = stream;
    p.pathway[row] = PATHWAYS.indexOf(path);
    p.isNew[row] = 1;
    p.filed[row] = first === 'preApplication' ? NO_DAY : day;
    p.certain[row] = certain ? 1 : 0;
    p.rule[row] = certain ? RULE_NONE : RULE_SIM;
    const env = parcels.envelopeStories[lot];
    let top = 0;
    for (let g = 0; g < F; g++) {
      const y = parcels.yield[lot * F + g];
      p.yields[row * F + g] = y;
      top = Math.max(top, y);
    }
    const units = funded !== null ? funded.units : parcels.yield[lot * F + f];
    const stories = funded !== null ? funded.stories : fillStories(FILL_LEVELS[f], env);
    p.level[row] = f;
    p.units[row] = units;
    p.stories[row] = stories;
    p.existing[row] = existing;
    p.env[row] = env;
    p.top[row] = top;
    p.entered[row * S + SI[first]] = day;
    pushRev(p, row, day, units, stories);
    if (funded !== null) {
      p.funded[row] = 1;
      p.kind[row] = funded.kind === 'affordable' ? 1 : 0;
      p.applied[row] = funded.applied;
      p.granted[row] = funded.granted;
      p.lent[row] = funded.lent;
      p.guaranteed[row] = funded.guaranteed;
      p.programmes[row] = funded.programmes.join(',');
    }
    li = lotRow(l, lot);
    l.state[li] = LOT_LIVE;
    l.project[li] = row;
    // A start the funding system made itself (an award, or an ordinary start it chose to make) is
    // not passed back to it (rule 16 as amended); every later event of the row goes through `x.out`.
    (byHook ? out : x.out).event({ kind: 'start', row, day });
    x.out.event({ kind: 'enter', row, day, stage: first });
    // Stage draws and speeds come from the step's frame (rules 10 and 11).
    enterStage(world, row, SI[first], day, 0, frame);
    const mark = x.freed.length;
    followProject(x, row, lastDay, put);
    planFreed(mark);
    return row;
  };

  const ctx: Step = {
    world,
    due,
    statics,
    timeline,
    frame,
    month,
    seed,
    out,
    firstDay,
    lastDay,
    x,
    list,
    hook,
    fund,
    started,
    taken: false,
    following: false,
    pub: null as unknown as StepCtx,
    put,
    planLot,
    planFreed,
    startOrdinary: (lot, s) => startRow(lot, s.day, s, null, false),
    startProject(lot, day, funded) {
      if (ctx.following) {
        throw new Error('startProject: no project can start while system 3 follows the stages');
      }
      if (funded !== null) return startRow(lot, day, null, funded, true);
      const s = startOf(world, statics, timeline, month, sh, lot);
      if (s === null || s.day !== day) {
        throw new Error(`startProject: day ${day} is not lot ${lot}'s ordinary start`);
      }
      return startRow(lot, day, s, null, true);
    },
    displace(row, lot, day, units) {
      const p = world.projects;
      if (!(row >= 0 && row < p.n) || p.funded[row] !== 1 || p.src[row] !== lot) {
        throw new Error(`displace: row ${row} is not a funded start on lot ${lot}`);
      }
      if (day < firstDay || day > lastDay) {
        throw new RangeError(`displace: day ${day} is outside month ${month}`);
      }
      pushDisplacement(p, row, day, units);
      out.event({ kind: 'displaced', row, lot, day, units });
    }
  };
  // What the hooks get: exactly a `StepCtx`, with nothing of the core's own state behind it.
  ctx.pub = {
    world,
    due,
    statics,
    timeline,
    frame,
    month,
    seed,
    out,
    firstDay,
    lastDay,
    startProject: (lot, day, funded) => ctx.startProject(lot, day, funded),
    displace: (row, lot, day, units) => ctx.displace(row, lot, day, units)
  };
  return ctx;
}

/**
 * System 1, when the frame differs from last month's.
 *
 * Rule 7: the free lots among `touched(month)` are planned again at their ordinary start read
 * through this month's frame (none when null); every free lot is when `touched` is null, when the
 * market moved, or when a funding system is plugged in and this month's frame or the month
 * before's has `finance` (in a funded month, at the earlier of that start and the month `planLot`
 * gives). `take(month)` has not run yet, so every entity still on the due list is due in this
 * month or later: the lots due in a month before this one were taken and started in that month's
 * step (or are no longer free). Rule 6 keeps every lot-month that began before this month on the
 * frame it ran on, so a lot's new ordinary start can never fall before this month; one that did
 * would mean the due list was out of step, and it throws.
 *
 * The whole-city replan uses the skip shortcut when `due` is a `DueList` (it knows its `through`):
 * a lot with no row whose `INIT` draw is above its `skipBound` starts after `through`, so its
 * ordinary clock is not read (unfunded, it is dropped and not put).
 *
 * Rule 12: every live row whose speed under the new frame differs is re-anchored on the month's
 * first day and put at the month of its new leave (this month when the carried end lands in it,
 * so the row is stepped by system 3 below).
 */
function policyChanged(ctx: Step): void {
  const { world, list: due, statics, timeline, frame, month, x, hook } = ctx;
  const before = timeline.frameAt(Math.max(1, month - 1));
  let bound: Float64Array | null = null;
  const replan = (lot: number, r: Day, k: number, rowless: boolean, never: boolean) => {
    due.drop(lot);
    let ord = 0;
    if (!never && !(bound !== null && rowless && initDraw(statics, x.sh, lot, 0) > bound[lot])) {
      const s = ordinaryStart(statics, timeline, month, x.sh, lot, r, k);
      if (s !== null) {
        if (s.month < month)
          throw new Error(`lot ${lot} replanned in month ${month} starts in ${s.month}`);
        ord = s.month;
      }
    }
    const m = ctx.planLot(lot, ord);
    if (m > 0) due.put(lot, m);
  };
  const touched = timeline.touched(month);
  const money = hook !== null && (frame.finance !== null || before.finance !== null);
  if (touched === null || money || frame.market !== before.market) {
    if (due instanceof DueList) bound = skipBound(statics, timeline, month, due.through);
    // With money in force now or last month every free lot is visited, zero-rate lots included:
    // a lot only `planLot` put on the list must be dropped when the money stops.
    eachFreeLot(world, statics, timeline, month, replan, money);
  } else {
    const l = world.lots;
    for (const lot of touched) {
      const i = lotRow(l, lot);
      if (i < 0) replan(lot, statics.asOf, 0, true, false);
      else if (l.state[i] === LOT_FREE) replan(lot, l.r[i], l.k[i], false, false);
    }
  }
  const p = world.projects;
  for (let row = 0; row < p.n; row++) {
    if (p.endKind[row] !== END_ALIVE) continue;
    const speed = rowSpeed(world, row, frame);
    if (speed === p.speed[row]) continue;
    reanchor(world, row, ctx.firstDay, speed);
    due.drop(-1 - row);
    ctx.put(row);
  }
}

/** A sink that sends each event to `out`, then passes it to `onProjectEvent`. */
function tee(out: StepSink, fund: FundingSystem, ctx: StepCtx): StepSink {
  return {
    event(e: WorldEvent) {
      out.event(e);
      fund.onProjectEvent(ctx, e);
    }
  };
}

function stepWith(
  hook: FundingSystem | null,
  world: World,
  due: Due,
  statics: Statics,
  timeline: PolicyTimeline,
  seed: number,
  out: StepSink
): void {
  const month = world.month + 1;
  const ready = timeline.readyThrough();
  if (ready < month) throw new RangeError(`step: month ${month} is past readyThrough ${ready}`);
  const frame = timeline.frameAt(month);
  const ctx = stepCtx(hook, world, due, statics, timeline, seed, out, month, frame);
  const { x, put, fund, pub } = ctx;
  // System 1: policy (rules 7 and 12), then the funding system's.
  if (frame.id !== world.frame) {
    policyChanged(ctx);
    fund?.policyChanged(pub);
  }
  // System 2: money in.
  fund?.moneyIn(pub);
  const entities = due.take(month);
  ctx.taken = true;
  // System 3: projects (entity -1 - row) in ascending row order, the reverse of `take`'s order.
  let lotsFrom = 0;
  while (lotsFrom < entities.length && entities[lotsFrom] < 0) lotsFrom++;
  if (fund !== null) x.out = tee(out, fund, pub);
  ctx.following = true;
  for (let i = lotsFrom - 1; i >= 0; i--) followProject(x, -1 - entities[i], ctx.lastDay, put);
  ctx.following = false;
  x.out = out;
  // System 4: the lots due this month and those system 3 freed, in rank order (rule 2). A lot met
  // twice means the due list is out of step.
  const lots: number[] = [];
  const takenLots = new Set<number>();
  for (let i = lotsFrom; i < entities.length; i++) {
    lots.push(entities[i]);
    takenLots.add(entities[i]);
  }
  const seen = new Set(takenLots);
  for (const lot of x.freed) {
    if (seen.has(lot)) throw new Error(`due list out of step: lot ${lot} met twice`);
    seen.add(lot);
    lots.push(lot);
  }
  x.freed.length = 0;
  const rank = statics.rank;
  lots.sort((a, b) => rank[a] - rank[b]);
  const aside: number[] = [];
  const applying: number[] = [];
  const later: number[] = [];
  const laterOrd: number[] = [];
  for (const lot of lots) {
    if (!isFree(world, lot)) throw new Error(`due list out of step: lot ${lot} is not free`);
    const s = startOf(world, statics, timeline, month, x.sh, lot);
    if (s !== null && s.month < month) throw new Error('due list out of step');
    const ord = s === null ? 0 : s.month;
    if (ord === month) aside.push(lot);
    else {
      if (fund === null && takenLots.has(lot)) throw new Error('due list out of step');
      later.push(lot);
      laterOrd.push(ord);
    }
    if (fund !== null && fund.planLot(pub, lot) === month) applying.push(lot);
  }
  fund?.apply(pub, Int32Array.from(applying));
  // The rest are planned again after `apply`; an application now counts from next month on.
  for (let j = 0; j < later.length; j++) {
    if (!isFree(world, later[j])) continue;
    const m = ctx.planLot(later[j], laterOrd[j]);
    if (m > 0) due.put(later[j], m);
  }
  // Systems 5 and 6 (rule 16 as amended): every event of a start made here and of its chain to the
  // month's end is passed to `onProjectEvent`, except the `'start'` of a start the funding system
  // made through its `StepCtx` (`startRow` sends that one past the tee).
  if (fund !== null) x.out = tee(out, fund, pub);
  // System 5: the funding system serves its line.
  fund?.serve(pub);
  // System 6: each lot set aside starts (rule 2 order), its chain followed to the month's end
  // (rule 14), unless a start was made on it this month.
  for (const lot of aside) {
    if (ctx.started.has(lot)) continue;
    if (!isFree(world, lot)) throw new Error('due list out of step');
    const s = startOf(world, statics, timeline, month, x.sh, lot);
    if (s === null || s.month !== month) throw new Error('due list out of step');
    ctx.startOrdinary(lot, s);
  }
  x.out = out;
  // System 7: the funding system's shadow starts.
  fund?.shadow(pub);
  world.month = month;
  world.frame = frame.id;
}
