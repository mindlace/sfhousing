import { FILL_LEVELS } from '$lib/data/scenario-codec';
import type { Schedule } from '$lib/sim/scenario/types';
import type { Day } from '$lib/timelapse/time';
import {
  END_ALIVE,
  NO_DAY,
  NO_STOP,
  LOT_FREE,
  type LotColumns,
  type ProjectColumns,
  type World
} from './types';

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

/** Appends a project row with its defaults and returns its index. */
export function addProject(p: ProjectColumns): number {
  const row = p.n;
  const rowColumns = typedNames(p, (k) => REV_COLUMNS.includes(k) || DISP_COLUMNS.includes(k));
  grow(p, rowColumns, row + 1);
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
  grow(p, REV_COLUMNS, p.revN + 1);
  const at = p.revN++;
  p.revDay[at] = day;
  p.revUnits[at] = units;
  p.revStories[at] = s;
  p.revPrev[at] = last;
  p.revLast[row] = at;
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
  let lo = 0;
  let hi = l.n - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = l.lot[mid];
    if (v === lot) return mid;
    if (v < lot) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** The row of `lot`, inserting one (free, attempt 0, free since `asOf`) in order when absent. */
export function ensureLot(l: LotColumns, lot: number, asOf: Day): number {
  let lo = 0;
  let hi = l.n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const v = l.lot[mid];
    if (v === lot) return mid;
    if (v < lot) lo = mid + 1;
    else hi = mid;
  }
  const names = typedNames(l, () => false);
  grow(l, names, l.n + 1);
  const cols = l as unknown as Record<string, Typed>;
  for (const name of names) cols[name].copyWithin(lo + 1, lo, l.n);
  l.n++;
  l.lot[lo] = lot;
  l.state[lo] = LOT_FREE;
  l.k[lo] = 0;
  l.r[lo] = asOf;
  l.holders[lo] = 0;
  l.lastExit[lo] = asOf;
  l.blocked[lo] = 0;
  l.demolished[lo] = 0;
  l.project[lo] = -1;
  return lo;
}
