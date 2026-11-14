// One world's calendar-month series from its events (world-score rules 1, 3 and 5). Each event
// files the deltas `shownSeries` (scenario/score.ts) files for the same schedule part, so the prefix
// sums equal `shownSeries` month for month. The series keeps every per-row fact that changes in its
// own state, because `createWorld` sends events before the world exists.
import { TIER_FIELDS, tiersOf } from '$lib/sim/scenario/finance-score';
import { monthIndexer } from '$lib/sim/scenario/score';
import type { Day } from '$lib/timelapse/time';
import { STAGE_ORDER, type Stage, type TierUnits } from '$lib/timelapse/types';
import { monthOfDay } from '../months';
import { scheduleAt } from '../read';
import type { Statics } from '../statics';
import { NO_DAY, ORIGIN_MASTER, ORIGIN_SIM, type World, type WorldEvent } from '../types';
import { finalTable, horizonOf, tierTableFor } from './statics';
import type { MonthRow, ScoreStatics, WorldSeries, WorldSeriesData } from './types';

type Live = Exclude<Stage, 'complete'>;

/** The stages a project can be in progress at, in `STAGE_ORDER` (score.ts `LIVE`). */
const LIVE = STAGE_ORDER.filter((s): s is Live => s !== 'complete');
const NL = LIVE.length;
const ENTITLED = LIVE.indexOf('entitled');
const CONSTRUCTION = LIVE.indexOf('construction');

/** Per-month fields of `WorldSeriesData.delta` and `.sum`; the `inProgress` stages follow. */
const PIPELINE = 0;
const FRESH = 1;
const ENTITLED_NEW = 2;
const EXITED = 3;
const STAGE0 = 4;
/** World 1's extras (rule 2): homes completed by funded projects, homes in 'displaced' events. */
const FUNDED = STAGE0 + NL;
const DISPLACED = FUNDED + 1;
/** World 1's homes by income tier (rule 2), `TIER_FIELDS` in order. */
const TIER0 = DISPLACED + 1;
const TIER_AM = TIER0 + TIER_FIELDS.indexOf('aboveModerate');
/** Fields per month. */
export const SERIES_FIELDS = TIER0 + TIER_FIELDS.length;
/** `WorldSeriesData.version` of this layout. */
const VERSION = 3;

/** No row state yet (no `'start'` seen). */
const UNKNOWN = -2;
/** Started, in no LIVE stage. */
const NONE = -1;
const FIRST_CAPACITY = 64;

function emptyData(s: ScoreStatics): WorldSeriesData {
  const n = s.lastIndex + 1;
  return {
    version: VERSION,
    stepped: 0,
    final: -1,
    summed: -1,
    rows: 0,
    stage: new Int8Array(0),
    since: new Int32Array(0),
    units: new Int32Array(0),
    entitled: new Int32Array(0),
    pending: new Int32Array(0),
    filed: new Int32Array(0),
    award: new Int32Array(0),
    delta: new Int32Array(SERIES_FIELDS * n),
    sum: new Int32Array(SERIES_FIELDS * n)
  };
}

type RowColumn = 'stage' | 'since' | 'units' | 'entitled' | 'pending' | 'filed' | 'award';
const ROW_COLUMNS: RowColumn[] = [
  'stage',
  'since',
  'units',
  'entitled',
  'pending',
  'filed',
  'award'
];

/** A copy of saved data that shares no array with it. */
function copyData(from: WorldSeriesData): WorldSeriesData {
  return {
    ...from,
    stage: from.stage.slice(),
    since: from.since.slice(),
    units: from.units.slice(),
    entitled: from.entitled.slice(),
    pending: from.pending.slice(),
    filed: from.filed.slice(),
    award: from.award.slice(),
    delta: from.delta.slice(),
    sum: from.sum.slice()
  };
}

/** Grows the per-row columns to hold row `row`; new rows are `UNKNOWN`. */
function ensureRow(d: WorldSeriesData, row: number): void {
  const cap = d.stage.length;
  if (row < cap) return;
  let next = Math.max(FIRST_CAPACITY, cap * 2);
  while (next <= row) next *= 2;
  for (const name of ROW_COLUMNS) {
    const a = d[name];
    const grown = new (a.constructor as new (n: number) => typeof a)(next);
    grown.set(a as never);
    d[name] = grown as never;
  }
  d.stage.fill(UNKNOWN, cap);
}

/** The units of a row's first revision: `revPrev` walked from `revLast` to the root. */
function firstUnits(w: World, row: number): number {
  const p = w.projects;
  let at = p.revLast[row];
  if (at < 0) throw new Error(`world-score: row ${row} started without a revision`);
  while (p.revPrev[at] >= 0) at = p.revPrev[at];
  return p.revUnits[at];
}

function phaseUnits(statics: Statics, w: World, row: number): number[] {
  return (statics.projects[w.projects.src[row]].phases ?? []).map((ph) => ph.units);
}

/** World 1's cumulative funded and displaced homes and tiers, which `WorldSeries` has no channel for (Q5). */
export interface Extras {
  /** Cumulative homes by final calendar month `from..through`. */
  homes(from: number, through: number): { funded: number; displaced: number }[];
  /** Cumulative homes by income tier by final calendar month `from..through`; throws without finance. */
  tiers(from: number, through: number): TierUnits[];
}

const EXTRAS = new WeakMap<WorldSeries, Extras>();

/** The extras of a series from `createWorldSeries`; for sibling files only, not `index.ts`. */
export function extrasOf(series: WorldSeries): Extras {
  const x = EXTRAS.get(series);
  if (x === undefined) throw new Error('world-score: not a series of createWorldSeries');
  return x;
}

const describeEvent = (e: WorldEvent): string =>
  `'${e.kind}'${e.kind === 'end' ? ` '${e.how}'` : e.kind === 'enter' ? ` '${e.stage}'` : ''}` +
  ` on day ${e.day}`;

/**
 * One world's series. `from` restores a saved state (copied, never shared); without it the series
 * starts empty at model month 0.
 */
export function createWorldSeries(s: ScoreStatics, from?: WorldSeriesData): WorldSeries {
  let d: WorldSeriesData;
  if (from === undefined) d = emptyData(s);
  else {
    if (from.version !== VERSION)
      throw new Error(`world-score: saved series version ${from.version}`);
    if (from.delta.length !== SERIES_FIELDS * (s.lastIndex + 1)) {
      throw new Error('world-score: saved series does not match these statics');
    }
    d = copyData(from);
  }
  const tierTable = tierTableFor(s);
  const H: Day = horizonOf(s);
  const m0 = s.months[0];
  const idx = monthIndexer(s.months, H);
  const table = finalTable(s);
  const last = s.lastIndex;
  /** The event being filed, for the guard's message. */
  let current: WorldEvent | null = null;
  /**
   * The event's deltas, applied once all of them are checked, so an event that throws files
   * nothing (its per-row state may still have moved; a series that threw is not used again).
   */
  const at: number[] = [];
  const by: number[] = [];

  const monthOf = (day: Day): number => (day < m0 ? 0 : idx(day));

  /** Adds `v` to field `f` of calendar month `i`; a final month throws. */
  function bump(f: number, i: number, v: number): void {
    if (i <= d.final) {
      const e = current;
      throw new Error(
        `world-score: row ${e ? e.row : '?'} event ${e ? describeEvent(e) : '?'} files into ` +
          `month ${i}, final through ${d.final}`
      );
    }
    at.push(i * SERIES_FIELDS + f);
    by.push(v);
  }

  /** A dated delta: nothing after the horizon. */
  function on(f: number, day: Day, v: number): void {
    if (day <= H) bump(f, monthOf(day), v);
  }

  /** Opens stage `st` at `a` with `u` (`addSpan`'s +). */
  function open(st: number, a: Day, u: number): void {
    if (a <= H) bump(STAGE0 + st, monthOf(a), u);
  }

  /** Closes stage `st`, opened at `a`, at `b` with `u` (`addSpan`'s −, or undoes the open). */
  function close(st: number, a: Day, b: Day, u: number): void {
    if (a < b) {
      if (b <= H) bump(STAGE0 + st, monthOf(b), -u);
    } else if (a <= H) bump(STAGE0 + st, monthOf(a), -u);
  }

  /** Ends the row's open span at `day`, if any, with `u`. */
  function closeRow(row: number, day: Day, u: number): void {
    const st = d.stage[row];
    if (st >= 0) close(st, d.since[row], day, u);
  }

  /** Moves `u` from the row's open span into stage `st` from `day`. */
  function move(row: number, st: number, day: Day, u: number): void {
    closeRow(row, day, u);
    d.stage[row] = st;
    d.since[row] = day;
    open(st, day, u);
  }

  function known(row: number): void {
    if (row >= d.stage.length || d.stage[row] === UNKNOWN) {
      throw new Error(`world-score: row ${row} has no 'start' before ${describeEvent(current!)}`);
    }
  }

  /**
   * A completed row's homes by income tier at its month (rule 2, `tierSeries`): `tiersOf` of its
   * schedule on the completion day, a funded row's by the programme definitions in force in the
   * month of its award (design 3.4).
   */
  function fileTiers(e: WorldEvent, w: World, statics: Statics): void {
    if (tierTable === null || e.day > H) return;
    const row = e.row;
    let ctx = tierTable.base;
    if (w.projects.funded[row] === 1) {
      const award = d.award[row];
      if (award === NO_DAY) {
        throw new Error(
          `world-score: funded row ${row} completes on day ${e.day} without an 'award'`
        );
      }
      const at = tierTable.byMonth[Math.max(1, monthOfDay(s.asOf, award))];
      if (!at) throw new Error(`world-score: row ${row} awarded on day ${award} without finance`);
      ctx = at;
    }
    const sc = scheduleAt(w, statics, row, e.day);
    const revs = sc?.revisions;
    if (!sc || revs![revs!.length - 1].units !== d.units[row]) {
      throw new Error(`world-score: row ${row}'s schedule on day ${e.day} is not the one filed`);
    }
    const t = tiersOf(sc, ctx);
    const i = monthOf(e.day);
    for (let k = 0; k < TIER_FIELDS.length; k++) bump(TIER0 + k, i, t[TIER_FIELDS[k]]);
  }

  function addMasterEvent(e: WorldEvent, w: World, statics: Statics): void {
    const row = e.row;
    switch (e.kind) {
      case 'enter': {
        const st = LIVE.indexOf(e.stage as Live);
        if (st < 0 || st > ENTITLED) {
          throw new Error(`world-score: master ${row} enters '${e.stage}'`);
        }
        move(row, st, e.day, d.pending[row]);
        return;
      }
      case 'end':
        if (e.how === 'entitled') {
          if (d.stage[row] !== ENTITLED) move(row, ENTITLED, e.day, d.pending[row]);
        } else if (e.how === 'exit') {
          closeRow(row, e.day, d.pending[row]);
          d.stage[row] = NONE;
          if (e.day > s.asOf) {
            let total = 0;
            for (const u of phaseUnits(statics, w, row)) total += u;
            on(EXITED, e.day, total);
          }
        } else throw new Error(`world-score: master ${row} completes`);
        return;
      case 'phaseFiled': {
        const u = phaseUnits(statics, w, row)[e.phase - 1];
        if (u === undefined) throw new Error(`world-score: master ${row} has no phase ${e.phase}`);
        if (e.phase > 31) throw new Error(`world-score: master ${row} has phase ${e.phase}`);
        const bit = 1 << (e.phase - 1);
        if (d.filed[row] & bit) {
          throw new Error(`world-score: master ${row} phase ${e.phase} filed twice`);
        }
        d.filed[row] |= bit;
        const st = d.stage[row];
        if (st >= 0) close(st, d.since[row], e.day, u);
        d.pending[row] -= u;
        return;
      }
      case 'revise':
        // A master's phases keep their own units (`addMaster` reads `phaseUnits` only).
        return;
      default:
        throw new Error(`world-score: master ${row} gets ${describeEvent(e)}`);
    }
  }

  function add(e: WorldEvent, w: World, statics: Statics): void {
    at.length = 0;
    by.length = 0;
    fileEvent(e, w, statics);
    for (let k = 0; k < at.length; k++) d.delta[at[k]] += by[k];
  }

  function fileEvent(e: WorldEvent, w: World, statics: Statics): void {
    current = e;
    const row = e.row;
    const p = w.projects;
    if (e.kind === 'award') {
      known(row);
      if (d.award[row] !== NO_DAY) throw new Error(`world-score: row ${row} awarded twice`);
      d.award[row] = e.day;
      return;
    }
    if (e.kind === 'displaced') {
      // Rule 2: the event's own month, whether or not the funded project has completed.
      known(row);
      on(DISPLACED, e.day, e.units);
      return;
    }
    const origin = p.origin[row];
    if (e.kind === 'start') {
      ensureRow(d, row);
      if (row >= d.rows) d.rows = row + 1;
      d.stage[row] = NONE;
      d.since[row] = NO_DAY;
      d.entitled[row] = NO_DAY;
      d.filed[row] = 0;
      d.award[row] = NO_DAY;
      if (origin === ORIGIN_MASTER) {
        let total = 0;
        for (const u of phaseUnits(statics, w, row)) total += u;
        d.pending[row] = total;
        d.units[row] = 0;
      } else d.units[row] = firstUnits(w, row);
      return;
    }
    known(row);
    if (origin === ORIGIN_MASTER) {
      addMasterEvent(e, w, statics);
      return;
    }
    const net = origin === ORIGIN_SIM ? FRESH : PIPELINE;
    switch (e.kind) {
      case 'enter': {
        if (e.stage === 'complete') return;
        const st = LIVE.indexOf(e.stage);
        move(row, st, e.day, d.units[row]);
        if (e.day > s.asOf) {
          if (st === ENTITLED && origin === ORIGIN_SIM) {
            d.entitled[row] = e.day;
            on(ENTITLED_NEW, e.day, d.units[row] - p.existing[row]);
          } else if (st === CONSTRUCTION) {
            on(net, e.day, -p.existing[row]);
            if (tierTable !== null) on(TIER_AM, e.day, -p.existing[row]);
          }
        }
        return;
      }
      case 'revise': {
        const st = d.stage[row];
        if (st >= 0) {
          close(st, d.since[row], e.day, d.units[row]);
          d.since[row] = e.day;
          open(st, e.day, e.units);
        }
        if (e.day === d.entitled[row]) on(ENTITLED_NEW, e.day, e.units - d.units[row]);
        d.units[row] = e.units;
        return;
      }
      case 'end': {
        closeRow(row, e.day, d.units[row]);
        d.stage[row] = NONE;
        if (e.how === 'complete') {
          on(net, e.day, d.units[row]);
          // Read from the row, never from event order: the 'award' follows the start chain.
          if (p.funded[row] === 1) on(FUNDED, e.day, d.units[row] - p.existing[row]);
          fileTiers(e, w, statics);
        } else if (e.how === 'exit') {
          if (e.day > s.asOf) on(EXITED, e.day, d.units[row]);
        } else throw new Error(`world-score: row ${row} ends 'entitled' but is not a master`);
        return;
      }
      default:
        throw new Error(`world-score: row ${row} gets ${describeEvent(e)}`);
    }
  }

  /** The largest i with `table[i] <= m`, capped at `last`, or -1. */
  function finalAt(m: number): number {
    let f = d.final;
    while (f < last && table[f + 1] <= m) f++;
    return f;
  }
  d.final = finalAt(d.stepped);

  /** Prefix sums through `through` (a final month). */
  function sumThrough(through: number): void {
    for (let i = d.summed + 1; i <= through; i++) {
      const at = i * SERIES_FIELDS;
      const prev = at - SERIES_FIELDS;
      for (let f = 0; f < SERIES_FIELDS; f++) {
        d.sum[at + f] = (i > 0 ? d.sum[prev + f] : 0) + d.delta[at + f];
      }
    }
    if (through > d.summed) d.summed = through;
  }

  function rowAt(i: number): MonthRow {
    const at = i * SERIES_FIELDS;
    const inProgress = {} as MonthRow['inProgress'];
    for (let st = 0; st < NL; st++) inProgress[LIVE[st]] = d.sum[at + STAGE0 + st];
    const pipeline = d.sum[at + PIPELINE];
    const fresh = d.sum[at + FRESH];
    return {
      completedNet: pipeline + fresh,
      completedNetPipeline: pipeline,
      completedNetNew: fresh,
      entitledNew: d.sum[at + ENTITLED_NEW],
      inProgress,
      exitedUnits: d.sum[at + EXITED]
    };
  }

  function checkRange(name: string, from: number, through: number): void {
    if (!(Number.isInteger(from) && Number.isInteger(through))) {
      throw new RangeError(`world-score: ${name}(${from}, ${through}) needs whole months`);
    }
    if (!(0 <= from && from <= through && through <= d.final)) {
      throw new RangeError(`world-score: ${name}(${from}, ${through}) outside 0..${d.final}`);
    }
  }

  const series: WorldSeries = {
    add,
    stepped(month: number): void {
      if (month !== d.stepped + 1) {
        throw new Error(`world-score: stepped(${month}) after month ${d.stepped}`);
      }
      d.stepped = month;
      d.final = finalAt(month);
    },
    finalThrough: () => d.final,
    rows(from: number, through: number): MonthRow[] {
      checkRange('rows', from, through);
      sumThrough(through);
      const out: MonthRow[] = [];
      for (let i = from; i <= through; i++) out.push(rowAt(i));
      return out;
    },
    data: () => copyData(d)
  };
  EXTRAS.set(series, {
    homes(from: number, through: number) {
      checkRange('homes', from, through);
      sumThrough(through);
      const out: { funded: number; displaced: number }[] = [];
      for (let i = from; i <= through; i++) {
        const at = i * SERIES_FIELDS;
        out.push({ funded: d.sum[at + FUNDED], displaced: d.sum[at + DISPLACED] });
      }
      return out;
    },
    tiers(from: number, through: number) {
      if (tierTable === null) throw new Error('world-score: no tiers without finance');
      checkRange('tiers', from, through);
      sumThrough(through);
      const out: TierUnits[] = [];
      for (let i = from; i <= through; i++) {
        const at = i * SERIES_FIELDS + TIER0;
        out.push({
          veryLow: d.sum[at],
          low: d.sum[at + 1],
          moderate: d.sum[at + 2],
          aboveModerate: d.sum[at + 3],
          unrecorded: d.sum[at + 4]
        });
      }
      return out;
    }
  });
  return series;
}
