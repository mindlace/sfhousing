// The world at the dataset date and the month step (spec S2, rules 14, 16-18). Without a funding
// system the step runs systems 3 (stages due), 4 (lots whose ordinary start falls this month are
// set aside) and 6 (they start).
import { FILL_LEVELS, fillStories } from '$lib/data/scenario-codec';
import { pathwayFrom } from '$lib/sim/scenario/engine';
import { sizeCumAgainst } from '$lib/sim/scenario/input';
import { P, drawOn, seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { Day } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER, type Pathway, type Stage } from '$lib/timelapse/types';
import { addProject, emptyWorld, ensureLot, lotRow, pushDisplacement, pushRev } from './columns';
import { createHolds } from './holds';
import { enterStage } from './stage';
import { monthFirstDay, monthLastDay } from './months';
import { createProjects, dueMonthOf, followProject, rowStaticsOf, type Sys3 } from './pipeline';
import type { PolicyFrame, PolicyTimeline } from './policy/frame';
import { lotEntity, ordinaryStart, type OrdinaryStart } from './rates';
import type { Statics } from './statics';
import {
  LOT_DONE,
  LOT_FREE,
  LOT_LIVE,
  NO_DAY,
  ORIGIN_SIM,
  RULE_NONE,
  RULE_SIM,
  type Due,
  type FundedStart,
  type StepCtx,
  type StepSink,
  type World
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

/** One step's context: `StepCtx` (S12) plus what the core's own systems share. */
interface Step extends StepCtx {
  x: Sys3;
  /** Puts a row at the month it is next due, if any. */
  put(row: number): void;
  /** Plans every lot in `x.freed` from position `from` on, then forgets them (rule 14). */
  planFreed(from: number, aside: number[] | null): void;
  /** Starts a free lot on its ordinary start `s`, which falls in this month. */
  startOrdinary(lot: number, s: OrdinaryStart): number;
}

function stepCtx(
  world: World,
  due: Due,
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
  const put = (row: number) => {
    const m = dueMonthOf(world, asOf, row);
    if (m > 0) due.put(-1 - row, m);
  };

  /**
   * Plans the lots freed from position `from` of `x.freed` on: a start this month goes to `aside`
   * (system 3) or is made at once (`aside` null, inside a chain); a later one is put.
   */
  const planFreed = (from: number, aside: number[] | null): void => {
    while (x.freed.length > from) {
      const lot = x.freed[from];
      x.freed.splice(from, 1);
      const s = startOf(world, statics, timeline, month, sh, lot);
      if (s === null) continue;
      if (s.month < month)
        throw new Error(`lot ${lot} freed in month ${month} starts in ${s.month}`);
      if (s.month > month) due.put(lot, s.month);
      else if (aside !== null) aside.push(lot);
      else startRow(lot, s.day, s, null);
    }
  };

  const startRow = (
    lot: number,
    day: Day,
    ordinary: OrdinaryStart | null,
    funded: FundedStart | null
  ): number => {
    const l = world.lots;
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
    out.event({ kind: 'start', row, day });
    out.event({ kind: 'enter', row, day, stage: first });
    // Stage draws and speeds come from the step's frame (rules 10 and 11).
    enterStage(world, row, SI[first], day, 0, frame);
    const mark = x.freed.length;
    followProject(x, row, lastDay, put);
    planFreed(mark, null);
    return row;
  };

  return {
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
    put,
    planFreed,
    startOrdinary: (lot, s) => startRow(lot, s.day, s, null),
    startProject(lot, day, funded) {
      if (funded !== null) return startRow(lot, day, null, funded);
      const s = startOf(world, statics, timeline, month, sh, lot);
      if (s === null || s.day !== day) {
        throw new Error(`startProject: day ${day} is not lot ${lot}'s ordinary start`);
      }
      return startRow(lot, day, s, null);
    },
    displace(row, lot, day, units) {
      pushDisplacement(world.projects, row, day, units);
      out.event({ kind: 'displaced', row, lot, day, units });
    }
  };
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
  const month = world.month + 1;
  const ready = timeline.readyThrough();
  if (ready < month) throw new RangeError(`step: month ${month} is past readyThrough ${ready}`);
  const frame = timeline.frameAt(month);
  const ctx = stepCtx(world, due, statics, timeline, seed, out, month, frame);
  const { x, put } = ctx;
  const entities = due.take(month);
  // System 3: projects (entity -1 - row) in ascending row order, the reverse of `take`'s order.
  let lotsFrom = 0;
  while (lotsFrom < entities.length && entities[lotsFrom] < 0) lotsFrom++;
  for (let i = lotsFrom - 1; i >= 0; i--) followProject(x, -1 - entities[i], ctx.lastDay, put);
  // System 4: lots due this month, and those system 3 freed whose start falls this month.
  const aside: number[] = [];
  for (let i = lotsFrom; i < entities.length; i++) aside.push(entities[i]);
  ctx.planFreed(0, aside);
  const rank = statics.rank;
  const lots = [...new Set(aside)].sort((a, b) => rank[a] - rank[b]);
  // System 6: each starts (rule 2 order), its chain followed to the month's end (rule 14).
  for (const lot of lots) {
    const i = lotRow(world.lots, lot);
    if (i >= 0 && world.lots.state[i] === LOT_LIVE) continue;
    if (i >= 0 && world.lots.state[i] !== LOT_FREE) throw new Error('due list out of step');
    const s = startOf(world, statics, timeline, month, x.sh, lot);
    if (s === null || s.month !== month) throw new Error('due list out of step');
    ctx.startOrdinary(lot, s);
  }
  world.month = month;
  world.frame = frame.id;
}
