import * as scenarioCodecModule from '$lib/data/scenario-codec';
import type { Schedule } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import * as typesModule from './types';
import type { LotColumns, ProjectColumns, World } from './types';

// Imports are bound once, here: under Vite's module runner (the tests and the cost bench) every
// use of an imported name is a getter call (docs/dev/world-core.md, Cost).
const { FILL_LEVELS } = scenarioCodecModule;
const { END_ALIVE, NO_DAY, NO_STOP, LOT_FREE } = typesModule;

type Typed = Int32Array | Uint32Array | Uint8Array | Float64Array;

/** Stages a row's `entered` entry covers. */
const ENTERED_STRIDE = 7;
const YIELDS_STRIDE = FILL_LEVELS.length;
const FIRST_CAPACITY = 64;

/** Per-row strides of the project columns; every other typed column has one entry per row. */
const STRIDE: Record<string, number> = { entered: ENTERED_STRIDE, yields: YIELDS_STRIDE };
const REV_COLUMNS = ['revDay', 'revUnits', 'revStories', 'revPrev'];
const DISP_COLUMNS = ['dispRow', 'dispDay', 'dispUnits'];
const COUNTS = new Set(['n', 'revN', 'dispN']);

function grown(a: Typed, length: number): Typed {
  const next = new (a.constructor as new (n: number) => Typed)(length);
  next.set(a);
  return next;
}

/** Doubles the named typed columns of `o` to hold at least `rows` entries (scaled by stride). */
function grow(o: object, names: string[], rows: number): void {
  const cols = o as Record<string, Typed>;
  for (const name of names) {
    const a = cols[name];
    const stride = STRIDE[name] ?? 1;
    const cap = a.length / stride;
    if (cap >= rows) continue;
    let next = Math.max(FIRST_CAPACITY, cap * 2);
    while (next < rows) next *= 2;
    cols[name] = grown(a, next * stride);
  }
}

function typedNames(o: object, skip: (name: string) => boolean): string[] {
  return Object.keys(o).filter(
    (k) => !COUNTS.has(k) && !skip(k) && ArrayBuffer.isView((o as Record<string, unknown>)[k])
  );
}

function emptyLots(): LotColumns {
  return {
    n: 0,
    lot: new Int32Array(0),
    rowOf: new Int32Array(0),
    state: new Uint8Array(0),
    k: new Int32Array(0),
    r: new Int32Array(0),
    holders: new Int32Array(0),
    lastExit: new Int32Array(0),
    blocked: new Uint8Array(0),
    demolished: new Uint8Array(0),
    project: new Int32Array(0)
  };
}

function emptyProjects(): ProjectColumns {
  return {
    n: 0,
    origin: new Uint8Array(0),
    src: new Int32Array(0),
    sub: new Int32Array(0),
    stream: new Uint32Array(0),
    pathway: new Uint8Array(0),
    isNew: new Uint8Array(0),
    filed: new Int32Array(0),
    certain: new Uint8Array(0),
    rule: new Uint8Array(0),
    stage: new Uint8Array(0),
    stopAt: new Uint8Array(0),
    outcome: new Uint8Array(0),
    length: new Float64Array(0),
    used: new Float64Array(0),
    anchor: new Int32Array(0),
    speed: new Float64Array(0),
    leave: new Int32Array(0),
    endKind: new Uint8Array(0),
    endDay: new Int32Array(0),
    endStage: new Uint8Array(0),
    entered: new Int32Array(0),
    units: new Int32Array(0),
    stories: new Float64Array(0),
    existing: new Int32Array(0),
    yieldCap: new Int32Array(0),
    envelope: new Int32Array(0),
    level: new Uint8Array(0),
    env: new Int32Array(0),
    top: new Int32Array(0),
    yields: new Int32Array(0),
    phaseNext: new Int32Array(0),
    phaseDay: new Int32Array(0),
    kind: new Uint8Array(0),
    funded: new Uint8Array(0),
    applied: new Int32Array(0),
    granted: new Float64Array(0),
    lent: new Float64Array(0),
    guaranteed: new Float64Array(0),
    programmes: [],
    revLast: new Int32Array(0),
    revN: 0,
    revDay: new Int32Array(0),
    revUnits: new Int32Array(0),
    revStories: new Float64Array(0),
    revPrev: new Int32Array(0),
    dispN: 0,
    dispRow: new Int32Array(0),
    dispDay: new Int32Array(0),
    dispUnits: new Int32Array(0)
  };
}

/** The world at month 0 before anything is created: empty columns, nothing funded. */
export function emptyWorld(frameId: number): World {
  return {
    month: 0,
    frame: frameId,
    lots: emptyLots(),
    projects: emptyProjects(),
    line: { n: 0 },
    pools: { n: 0 }
  };
}

// The typed columns, named once: every row column of one table has the same row capacity, so one
// column's length says whether the table must grow.
const PROJECT_ROW_COLUMNS = typedNames(
  emptyProjects(),
  (k) => REV_COLUMNS.includes(k) || DISP_COLUMNS.includes(k)
);
const LOT_COLUMNS = typedNames(emptyLots(), (k) => k === 'rowOf');

/** Appends a project row with its defaults and returns its index. */
export function addProject(p: ProjectColumns): number {
  const row = p.n;
  if (p.origin.length <= row) grow(p, PROJECT_ROW_COLUMNS, row + 1);
  p.n = row + 1;
  p.entered.fill(NO_DAY, row * ENTERED_STRIDE, (row + 1) * ENTERED_STRIDE);
  p.stories[row] = NaN;
  p.endKind[row] = END_ALIVE;
  p.stopAt[row] = NO_STOP;
  p.filed[row] = NO_DAY;
  p.revLast[row] = -1;
  p.programmes[row] = '';
  return row;
}

/**
 * Records a revision on `row` with today's same-day merge (`pushRevision`, scenario/engine.ts):
 * a revision due on the last entry's day replaces that entry's units and stories; if the merged
 * entry then equals its predecessor it is removed. The first entry is never removed. A day before
 * the last entry's throws.
 */
export function pushRev(
  p: ProjectColumns,
  row: number,
  day: Day,
  units: number,
  stories: number | null
): void {
  const s = stories === null ? NaN : stories;
  const last = p.revLast[row];
  if (last >= 0) {
    const lastDay = p.revDay[last];
    if (day < lastDay) {
      throw new Error(`pushRev: day ${day} is before the last revision day ${lastDay}`);
    }
    if (day === lastDay) {
      p.revUnits[last] = units;
      p.revStories[last] = s;
      const prev = p.revPrev[last];
      if (prev >= 0 && p.revUnits[prev] === units && sameStories(p.revStories[prev], s)) {
        p.revLast[row] = prev;
        // Reclaim the slot when it is the newest one in the side table.
        if (last === p.revN - 1) p.revN--;
      }
      return;
    }
  }
  if (p.revDay.length <= p.revN) grow(p, REV_COLUMNS, p.revN + 1);
  const at = p.revN++;
  p.revDay[at] = day;
  p.revUnits[at] = units;
  p.revStories[at] = s;
  p.revPrev[at] = last;
  p.revLast[row] = at;
}

/** Appends `units` displaced homes on `day` to `row`'s entries in the displacement side table. */
export function pushDisplacement(p: ProjectColumns, row: number, day: Day, units: number): void {
  if (p.dispRow.length <= p.dispN) grow(p, DISP_COLUMNS, p.dispN + 1);
  const at = p.dispN++;
  p.dispRow[at] = row;
  p.dispDay[at] = day;
  p.dispUnits[at] = units;
}

/** The homes displaced by `row` on or before `upTo`. */
export function displacedOf(p: ProjectColumns, row: number, upTo: Day): number {
  let sum = 0;
  for (let at = 0; at < p.dispN; at++) {
    if (p.dispRow[at] === row && p.dispDay[at] <= upTo) sum += p.dispUnits[at];
  }
  return sum;
}

function sameStories(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/** The row's revisions dated at or before `upTo`, ascending, as today's `Schedule.revisions`. */
export function revisionsOf(p: ProjectColumns, row: number, upTo: Day): Schedule['revisions'] {
  const out: Schedule['revisions'] = [];
  for (let at = p.revLast[row]; at >= 0; at = p.revPrev[at]) {
    if (p.revDay[at] > upTo) continue;
    const st = p.revStories[at];
    out.push({ day: p.revDay[at], units: p.revUnits[at], stories: Number.isNaN(st) ? null : st });
  }
  return out.reverse();
}

/** The row of `lot`, or -1 when the lot has not left its starting state. */
export function lotRow(l: LotColumns, lot: number): number {
  return lot < l.rowOf.length ? l.rowOf[lot] - 1 : -1;
}

/**
 * The row of `lot`, appending one (free, attempt 0, free since `asOf`) when absent. Rows never
 * move.
 */
export function ensureLot(l: LotColumns, lot: number, asOf: Day): number {
  if (lot < l.rowOf.length) {
    const found = l.rowOf[lot];
    if (found > 0) return found - 1;
  } else {
    let cap = Math.max(FIRST_CAPACITY, l.rowOf.length * 2);
    while (cap <= lot) cap *= 2;
    l.rowOf = grown(l.rowOf, cap) as Int32Array;
  }
  const row = l.n;
  if (l.lot.length <= row) grow(l, LOT_COLUMNS, row + 1);
  l.rowOf[lot] = row + 1;
  l.n = row + 1;
  l.lot[row] = lot;
  l.state[row] = LOT_FREE;
  l.k[row] = 0;
  l.r[row] = asOf;
  l.holders[row] = 0;
  l.lastExit[row] = asOf;
  l.blocked[row] = 0;
  l.demolished[row] = 0;
  l.project[row] = -1;
  return row;
}
