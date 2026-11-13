// Pipeline rows, masters and phases (spec rules 3 and 13; today's `pipelineRow`, `masterOf`,
// `phaseFiledDay` and `phaseSchedule`, scenario/engine.ts:661-898): made at the dataset date,
// followed through their stages month by month, and phases filed as their days come.
import type { ParcelId } from '$lib/data/parcel';
import { FILL_LEVELS, type ScenarioParcels } from '$lib/data/scenario-codec';
import { isSkipped, nextStage } from '$lib/sim/scenario/engine';
import { P, drawOn, jobEntity, streamOf } from '$lib/sim/scenario/rng';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER, type Stage } from '$lib/timelapse/types';
import { addProject, pushRev } from './columns';
import { monthOfDay } from './months';
import type { PolicyFrame, PolicyTimeline, ZoningView } from './policy/frame';
import { enterStage, reviseOnEntry } from './stage';
import type { Statics } from './statics';
import {
  END_ALIVE,
  END_COMPLETE,
  END_ENTITLED,
  END_EXIT,
  NO_DAY,
  ORIGIN_MASTER,
  ORIGIN_PHASE,
  ORIGIN_PIPELINE,
  RULE_NONE,
  RULE_PIPELINE,
  type StepSink,
  type World
} from './types';

const F = FILL_LEVELS.length;
const S = STAGE_ORDER.length;
const SI = Object.fromEntries(STAGE_ORDER.map((s, i) => [s, i])) as Record<Stage, number>;
const PRE_APPLICATION = SI.preApplication;
const ENTITLED = SI.entitled;
const PERMIT_FILED = SI.permitFiled;
const COMPLETE = SI.complete;
const PLANNING: readonly Stage[] = ['preApplication', 'filed', 'entitled'];

/** Revision caps of a project on some view rows (today's `Caps`). */
interface Caps {
  /** Sum of the top-level yield of its rows. */
  yieldCap: number;
  /** Largest envelope stories of its rows. */
  envelope: number;
}

/** One phase of a phased row, on one view. */
export interface PhaseStatic extends Caps {
  /** `'<masterId>:phase:<i>'`. */
  projectId: string;
  entity: number;
  rows: Int32Array;
  /** The view's existing homes on its rows. */
  existing: number;
}

/** What one `statics.projects` row needs from a view (today's `RowStatic`). */
export interface RowStatic extends Caps {
  entity: number;
  /** View rows of its `parcelIds` present in the view, in order. */
  rows: Int32Array;
  phased: {
    /** Every row of the master and its phases, de-duplicated. */
    all: Int32Array;
    /** The master's rows in no phase. */
    rest: Int32Array;
    phases: PhaseStatic[];
  } | null;
}

/** Index-aligned with `statics.projects`. */
export type RowStatics = readonly RowStatic[];

/** A multi-phase row with phases: a master plus phase rows, not a schedule. */
export function isPhased(p: InFlightProject): boolean {
  return p.multiPhase && p.phases !== null;
}

function rowsOf(parcels: ScenarioParcels, ids: readonly ParcelId[]): Int32Array {
  const out: number[] = [];
  for (const id of ids) {
    const i = parcels.index.get(id);
    if (i !== undefined) out.push(i);
  }
  return Int32Array.from(out);
}

function capsOf(parcels: ScenarioParcels, rows: Int32Array): Caps {
  let yieldCap = 0;
  let envelope = 0;
  for (const i of rows) {
    yieldCap += parcels.yield[i * F + F - 1];
    envelope = Math.max(envelope, parcels.envelopeStories[i]);
  }
  return { yieldCap, envelope };
}

const rowMemo = new WeakMap<Statics, WeakMap<ZoningView, RowStatics>>();

/** Per `statics.projects` row, its rows, caps and phases on `view`; memoised per (statics, view). */
export function rowStaticsOf(statics: Statics, view: ZoningView): RowStatics {
  let byView = rowMemo.get(statics);
  if (!byView) {
    byView = new WeakMap();
    rowMemo.set(statics, byView);
  }
  const hit = byView.get(view);
  if (hit) return hit;
  const parcels = view.parcels;
  const out = statics.projects.map((p): RowStatic => {
    const own = rowsOf(parcels, p.parcelIds);
    let phased: RowStatic['phased'] = null;
    if (isPhased(p)) {
      const phases = p.phases ?? [];
      const inPhase = new Set(phases.flatMap((ph) => ph.parcelIds));
      phased = {
        all: rowsOf(parcels, [
          ...new Set([...p.parcelIds, ...phases.flatMap((ph) => ph.parcelIds)])
        ]),
        rest: rowsOf(
          parcels,
          p.parcelIds.filter((id) => !inPhase.has(id))
        ),
        phases: phases.map((ph, j) => {
          const projectId = `${p.id}:phase:${j + 1}`;
          const r = rowsOf(parcels, ph.parcelIds);
          let existing = 0;
          for (const i of r) existing += parcels.existingUnits[i];
          return {
            projectId,
            entity: jobEntity(projectId),
            rows: r,
            existing,
            ...capsOf(parcels, r)
          };
        })
      };
    }
    return { entity: jobEntity(p.id), rows: own, phased, ...capsOf(parcels, own) };
  });
  byView.set(view, out);
  return out;
}

/** What system 3 reads while it follows rows through one month. */
export interface Sys3 {
  w: World;
  statics: Statics;
  timeline: PolicyTimeline;
  /** The frame of the month being stepped (month 1's in `createWorld`). */
  frame: PolicyFrame;
  /** `seedHash(seed)`. */
  sh: number;
  out: StepSink;
  /** Month 1's rows and caps: pipeline rows, masters and phases take them from there. */
  rs: RowStatics;
}

/** The day a row filed: the stage after preApplication on its pathway, else the dataset date. */
function filingDay(w: World, row: number, pathway: InFlightProject['pathway'], asOf: Day): Day {
  const d = w.projects.entered[row * S + SI[nextStage(pathway, 'preApplication')]];
  return d === NO_DAY ? asOf : d;
}

function sendEntered(x: Sys3, row: number): void {
  const p = x.w.projects;
  for (let s = 0; s < S; s++) {
    const d = p.entered[row * S + s];
    if (d !== NO_DAY) x.out.event({ kind: 'enter', row, day: d, stage: STAGE_ORDER[s] });
  }
}

/** The earliest entered day of a row, or `fallback` when it has none. */
function firstEntered(x: Sys3, row: number, fallback: Day): Day {
  const p = x.w.projects;
  let first = fallback;
  for (let s = 0; s < S; s++) {
    const d = p.entered[row * S + s];
    if (d !== NO_DAY && d < first) first = d;
  }
  return first;
}

/**
 * Every non-skipped row of `statics.projects`, in order, as a pipeline row or a master at the
 * dataset date (rule 3): `'start'` then `'enter'` for each stage already entered.
 */
export function createProjects(x: Sys3): void {
  const { statics } = x;
  for (let k = 0; k < statics.projects.length; k++) {
    const p = statics.projects[k];
    if (isSkipped(p)) continue;
    if (isPhased(p)) createMaster(x, k, p);
    else createPipelineRow(x, k, p);
  }
}

function baseRow(x: Sys3, origin: number, k: number, sub: number, stream: number, pathway: string) {
  const p = x.w.projects;
  const row = addProject(p);
  p.origin[row] = origin;
  p.src[row] = k;
  p.sub[row] = sub;
  p.stream[row] = stream;
  p.pathway[row] = PATHWAYS.indexOf(pathway as (typeof PATHWAYS)[number]);
  return row;
}

function createPipelineRow(x: Sys3, k: number, ip: InFlightProject): void {
  const asOf = x.statics.asOf;
  const rs = x.rs[k];
  const row = baseRow(x, ORIGIN_PIPELINE, k, 0, streamOf(x.sh, rs.entity, 0), ip.pathway);
  const p = x.w.projects;
  for (const s of STAGE_ORDER) {
    const d = ip.history[s];
    if (d !== undefined) p.entered[row * S + SI[s]] = Math.min(d, asOf);
  }
  const cur = SI[ip.stage];
  let e = p.entered[row * S + cur];
  if (e === NO_DAY) {
    e = asOf;
    p.entered[row * S + cur] = e;
  }
  const isNew = ip.stage === 'preApplication';
  p.isNew[row] = isNew ? 1 : 0;
  p.filed[row] = isNew ? NO_DAY : filingDay(x.w, row, ip.pathway, asOf);
  p.rule[row] = RULE_PIPELINE;
  p.units[row] = ip.units;
  p.stories[row] = ip.stories === null ? NaN : ip.stories;
  p.existing[row] = ip.existingUnits;
  p.yieldCap[row] = rs.yieldCap;
  p.envelope[row] = rs.envelope;
  const first = firstEntered(x, row, e);
  pushRev(p, row, first, ip.units, ip.stories);
  x.out.event({ kind: 'start', row, day: first });
  sendEntered(x, row);
  enterStage(x.w, row, cur, e, asOf + 1 - e, x.frame);
}

function createMaster(x: Sys3, k: number, ip: InFlightProject): void {
  const asOf = x.statics.asOf;
  const rs = x.rs[k];
  const row = baseRow(x, ORIGIN_MASTER, k, 0, streamOf(x.sh, rs.entity, 0), ip.pathway);
  const p = x.w.projects;
  for (const s of PLANNING) {
    const d = ip.history[s];
    if (d !== undefined) p.entered[row * S + SI[s]] = Math.min(d, asOf);
  }
  p.rule[row] = RULE_NONE;
  p.units[row] = ip.units;
  p.stories[row] = ip.stories === null ? NaN : ip.stories;
  p.stopAt[row] = ENTITLED;
  if (ip.history.entitled !== undefined || SI[ip.stage] >= ENTITLED) {
    let E = p.entered[row * S + ENTITLED];
    if (E === NO_DAY) {
      let found: Day | undefined;
      for (let i = ENTITLED + 1; i < S && found === undefined; i++) {
        const d = ip.history[STAGE_ORDER[i]];
        if (d !== undefined) found = Math.min(d, asOf);
      }
      E = found ?? asOf;
      if (ip.pathway !== 'permitOnly') p.entered[row * S + ENTITLED] = E;
    }
    p.filed[row] = filingDay(x.w, row, ip.pathway, asOf);
    const first = firstEntered(x, row, E);
    pushRev(p, row, first, ip.units, ip.stories);
    x.out.event({ kind: 'start', row, day: first });
    sendEntered(x, row);
    p.stage[row] = ENTITLED;
    endRow(x, row, END_ENTITLED, E, ENTITLED);
    planPhases(x, row);
    return;
  }
  const cur = SI[ip.stage];
  let e = p.entered[row * S + cur];
  if (e === NO_DAY) {
    e = asOf;
    p.entered[row * S + cur] = e;
  }
  p.filed[row] = filingDay(x.w, row, ip.pathway, asOf);
  const first = firstEntered(x, row, e);
  pushRev(p, row, e, ip.units, ip.stories);
  x.out.event({ kind: 'start', row, day: first });
  sendEntered(x, row);
  enterStage(x.w, row, cur, e, asOf + 1 - e, x.frame);
}

function endRow(x: Sys3, row: number, kind: number, day: Day, stage: number): void {
  const p = x.w.projects;
  p.endKind[row] = kind;
  p.endDay[row] = day;
  p.endStage[row] = stage;
  const how = kind === END_COMPLETE ? 'complete' : kind === END_EXIT ? 'exit' : 'entitled';
  x.out.event({ kind: 'end', row, day, how });
}

/**
 * The filing days F_1..F_n of a master's phases (today's `phaseFiledDay`): the plan date when after
 * the dataset date (not before E + 1), else one `PHASE_GAP` draw after the base (max(E, asOf) for
 * phase 1, max(F_{i-1}, asOf) after). Gaps come from the calibration of the month the master was
 * entitled in (month 1 for one entitled by the dataset date), so the days never change once set.
 */
export function phaseDaysOf(x: Sys3, master: number): Int32Array {
  const p = x.w.projects;
  const asOf = x.statics.asOf;
  const ip = x.statics.projects[p.src[master]];
  const phases = ip.phases ?? [];
  const E = p.endDay[master];
  const gaps = x.timeline.frameAt(Math.max(1, monthOfDay(asOf, E))).calibration.phaseGap.days;
  const entity = x.rs[p.src[master]].entity;
  const out = new Int32Array(phases.length);
  let prev = E;
  for (let j = 0; j < phases.length; j++) {
    const i = j + 1;
    const plan = phases[j].plannedPermitFiled;
    let F_i: Day;
    if (plan !== null && plan > asOf) F_i = Math.max(plan, E + 1);
    else {
      const u = drawOn(streamOf(x.sh, entity, i), P.PHASE_GAP, 0);
      const base = Math.max(i === 1 ? E : prev, asOf);
      F_i = base + 1 + gaps[Math.floor(u * gaps.length)];
    }
    out[j] = F_i;
    prev = F_i;
  }
  return out;
}

/**
 * The phases in the order they file: by filing day, then by index (a plan date can come before
 * an earlier phase's gap-drawn day).
 */
function filingOrder(days: Int32Array): number[] {
  return Array.from(days.keys()).sort((a, b) => days[a] - days[b] || a - b);
}

/** Points the master at the `pos`-th filing (1-based), or at none past the last. */
function pointAt(x: Sys3, master: number, pos: number): void {
  const p = x.w.projects;
  const days = phaseDaysOf(x, master);
  if (pos > days.length) {
    p.phaseNext[master] = 0;
    p.phaseDay[master] = NO_DAY;
    return;
  }
  p.phaseNext[master] = pos;
  p.phaseDay[master] = days[filingOrder(days)[pos - 1]];
}

/** At entitlement: the master waits for its first phase filing. */
function planPhases(x: Sys3, master: number): void {
  pointAt(x, master, 1);
}

/** Files the master's next phase (today's `phaseSchedule`) and returns the new row. */
function filePhase(x: Sys3, master: number): number {
  const p = x.w.projects;
  const k = p.src[master];
  const ip = x.statics.projects[k];
  const days = phaseDaysOf(x, master);
  const j = filingOrder(days)[p.phaseNext[master] - 1];
  const i = j + 1;
  const day = days[j];
  const ph = (ip.phases ?? [])[j];
  const pst = x.rs[k].phased!.phases[j];
  x.out.event({ kind: 'phaseFiled', row: master, day, phase: i });
  const row = baseRow(x, ORIGIN_PHASE, k, i, streamOf(x.sh, pst.entity, 0), ip.pathway);
  const q = x.w.projects;
  q.filed[row] = x.statics.asOf;
  q.rule[row] = RULE_PIPELINE;
  q.units[row] = ph.units;
  q.existing[row] = pst.existing;
  q.yieldCap[row] = pst.yieldCap;
  q.envelope[row] = pst.envelope;
  q.entered[row * S + PERMIT_FILED] = day;
  pushRev(q, row, day, ph.units, null);
  x.out.event({ kind: 'start', row, day });
  x.out.event({ kind: 'enter', row, day, stage: 'permitFiled' });
  enterStage(x.w, row, PERMIT_FILED, day, 0, x.frame);
  pointAt(x, master, q.phaseNext[master] + 1);
  return row;
}

/**
 * Follows `row` to the end of the month whose last day is `lastDay` (rule 14): its stage ends and
 * entries, and for a master its phase filings, each phase row followed in turn. `put(row)` is
 * called for every row touched that is still due after the month.
 */
export function followProject(
  x: Sys3,
  row: number,
  lastDay: Day,
  put: (row: number) => void
): void {
  const p = x.w.projects;
  while (p.endKind[row] === END_ALIVE && p.leave[row] <= lastDay) leaveStage(x, row);
  while (p.phaseNext[row] > 0 && p.phaseDay[row] <= lastDay) {
    const phase = filePhase(x, row);
    followProject(x, phase, lastDay, put);
  }
  put(row);
}

/** The model month in which `row` is next due, or 0 when nothing is left for it. */
export function dueMonthOf(w: World, asOf: Day, row: number): number {
  const p = w.projects;
  if (p.endKind[row] === END_ALIVE) return monthOfDay(asOf, p.leave[row]);
  if (p.phaseNext[row] > 0) return monthOfDay(asOf, p.phaseDay[row]);
  return 0;
}

/** One stage ending on the row's `leave` day: exit, or entry into the next stage. */
function leaveStage(x: Sys3, row: number): void {
  const p = x.w.projects;
  const day = p.leave[row];
  const s = p.stage[row];
  if (p.outcome[row] !== 0) {
    endRow(x, row, END_EXIT, day, s);
    return;
  }
  const pathway = PATHWAYS[p.pathway[row]];
  const n = SI[nextStage(pathway, STAGE_ORDER[s])];
  const stop = p.stopAt[row];
  if (n >= stop) {
    if (n === stop) {
      p.entered[row * S + n] = day;
      x.out.event({ kind: 'enter', row, day, stage: STAGE_ORDER[n] });
    }
    p.stage[row] = n;
    endRow(x, row, END_ENTITLED, day, n);
    planPhases(x, row);
    return;
  }
  p.entered[row * S + n] = day;
  x.out.event({ kind: 'enter', row, day, stage: STAGE_ORDER[n] });
  if (n === COMPLETE) {
    p.stage[row] = n;
    endRow(x, row, END_COMPLETE, day, n);
    return;
  }
  if (s === PRE_APPLICATION && p.filed[row] === NO_DAY) p.filed[row] = day;
  if (reviseOnEntry(x.w, row, n, day, x.frame)) {
    const last = p.revLast[row];
    const st = p.revStories[last];
    x.out.event({
      kind: 'revise',
      row,
      day,
      units: p.revUnits[last],
      stories: Number.isNaN(st) ? null : st
    });
  }
  enterStage(x.w, row, n, day, 0, x.frame);
}
