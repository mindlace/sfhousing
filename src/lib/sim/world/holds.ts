// Holds (rule 9; today's `Holds`, scenario/engine.ts:593-627, 706-729, 814-848, and the demolished
// lot, funded.ts:1595-1602): a lot is free only when every project holding it has dropped out; it
// is blocked for good when a holder completes, is skipped or never ends; once a project has
// entered construction on it, its existing homes count as 0.
import * as engineModule from '$lib/sim/scenario/engine';
import type { Day } from '$lib/timelapse/time';
import * as columnsModule from './columns';
import type { RowStatics } from './pipeline';
import type { Statics } from './statics';
import * as typesModule from './types';
import type { World } from './types';

// Imports are bound once, here: under Vite's module runner (the tests and the cost bench) every
// use of an imported name is a getter call (docs/dev/world-core.md, Cost).
const { isSkipped } = engineModule;
const { ensureLot, lotRow } = columnsModule;
const { LOT_DONE, LOT_FREE, LOT_HELD, ORIGIN_MASTER, ORIGIN_PHASE, ORIGIN_PIPELINE, ORIGIN_SIM } =
  typesModule;

/** The lots `row` holds: its own (pipeline), its phase's, a master's `all`, a start's one lot. */
export function heldLots(w: World, rs: RowStatics, row: number): Int32Array {
  const p = w.projects;
  const origin = p.origin[row];
  if (origin === ORIGIN_SIM) return Int32Array.of(p.src[row]);
  const st = rs[p.src[row]];
  if (origin === ORIGIN_PIPELINE) return st.rows;
  if (origin === ORIGIN_PHASE) return st.phased!.phases[p.sub[row] - 1].rows;
  if (origin === ORIGIN_MASTER) return st.phased!.all;
  throw new Error(`heldLots: row ${row} has origin ${origin}`);
}

/** One more holder on each of `lots` (a lot row made when absent); a blocked lot stays done. */
export function holdStart(w: World, lots: Int32Array, asOf: Day): void {
  const l = w.lots;
  for (const lot of lots) {
    const i = ensureLot(l, lot, asOf);
    l.holders[i]++;
    if (l.blocked[i] === 0) l.state[i] = LOT_HELD;
  }
}

/** Blocks each of `lots` for good (a lot row made when absent). */
export function block(w: World, lots: Int32Array, asOf: Day): void {
  const l = w.lots;
  for (const lot of lots) {
    const i = ensureLot(l, lot, asOf);
    l.blocked[i] = 1;
    if (l.state[i] === LOT_HELD || l.state[i] === LOT_FREE) l.state[i] = LOT_DONE;
  }
}

/** Marks each of `lots` demolished: later starts on it count 0 existing homes. */
export function demolish(w: World, lots: Int32Array, asOf: Day): void {
  const l = w.lots;
  for (const lot of lots) l.demolished[ensureLot(l, lot, asOf)] = 1;
}

/**
 * A holder of `lots` ends: an exit on `exitDay` raises each lot's `lastExit`, and the last
 * holder's exit frees a lot that is not blocked (`LOT_FREE`, free since `lastExit`, attempt 0),
 * pushed onto `freed`; a completion or anything else (`exitDay` null) blocks it.
 */
export function holdEnd(w: World, lots: Int32Array, exitDay: Day | null, freed?: number[]): void {
  const l = w.lots;
  for (const lot of lots) {
    const i = lotRow(l, lot);
    if (i < 0) throw new Error(`holdEnd: lot ${lot} has no row`);
    if (exitDay === null) {
      l.blocked[i] = 1;
      if (l.state[i] === LOT_HELD) l.state[i] = LOT_DONE;
      continue;
    }
    if (exitDay > l.lastExit[i]) l.lastExit[i] = exitDay;
    l.holders[i]--;
    if (l.holders[i] === 0 && l.blocked[i] === 0 && l.state[i] === LOT_HELD) {
      l.state[i] = LOT_FREE;
      l.r[i] = l.lastExit[i];
      l.k[i] = 0;
      freed?.push(lot);
    }
  }
}

/**
 * A start on `lot` ends: an exit frees the lot from the exit day on attempt k + 1 (pushed onto
 * `freed`); a completion leaves it done.
 */
export function startEnd(w: World, row: number, exitDay: Day | null, freed: number[]): void {
  const p = w.projects;
  const l = w.lots;
  const lot = p.src[row];
  const i = lotRow(l, lot);
  if (i < 0 || l.project[i] !== row) throw new Error(`startEnd: lot ${lot} is not row ${row}'s`);
  l.project[i] = -1;
  if (exitDay === null) {
    l.state[i] = LOT_DONE;
    return;
  }
  l.state[i] = LOT_FREE;
  l.r[i] = exitDay;
  l.k[i] = p.sub[row] + 1;
  freed.push(lot);
}

/**
 * At entitlement a master blocks the lots in no phase, passes its holds to its phases' lots (an
 * unfiled phase holds them until it files and ends), then lets go of all of them.
 */
export function passToPhases(w: World, rs: RowStatics, master: number, asOf: Day): void {
  const ph = rs[w.projects.src[master]].phased!;
  block(w, ph.rest, asOf);
  for (const phase of ph.phases) holdStart(w, phase.rows, asOf);
  const l = w.lots;
  for (const lot of ph.all) {
    const i = lotRow(l, lot);
    l.holders[i]--;
    if (l.holders[i] === 0 && l.blocked[i] === 0 && l.state[i] === LOT_HELD) {
      throw new Error(`passToPhases: lot ${lot} left with no holder`);
    }
  }
}

/**
 * The holds at the dataset date, before any row is made: a skipped row blocks its own lots, an
 * unphased row holds its own, a phased master holds `all`. A lot is demolished when a holder's
 * history (or current stage) has construction; a master's never does (`engine.ts:825`).
 */
export function createHolds(w: World, statics: Statics, rs: RowStatics): void {
  const asOf = statics.asOf;
  statics.projects.forEach((ip, k) => {
    const st = rs[k];
    if (isSkipped(ip)) {
      block(w, st.rows, asOf);
      if (ip.history.construction !== undefined) demolish(w, st.rows, asOf);
      return;
    }
    if (st.phased !== null) {
      holdStart(w, st.phased!.all, asOf);
      return;
    }
    holdStart(w, st.rows, asOf);
    if (ip.history.construction !== undefined || ip.stage === 'construction') {
      demolish(w, st.rows, asOf);
    }
  });
}
