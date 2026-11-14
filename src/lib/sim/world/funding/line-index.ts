// Indices of the funding line kept outside the world (a world holds only columns): the waiting
// (lot, kind) pairs, each lot's waiting rows, and the waiting rows grouped by award rule for
// grouped serving. One per `FundLine` object, valid while its `version` is the line's; a
// structuredClone of the world is a new object and builds its own, so clones stay exact.
import { prototypeFor, type PrototypeId } from '$lib/sim/finance';
import { KIND_MARKET, compactLine, type FundLine } from './columns';

/** Waiting rows sharing one award rule (`line.ts` groupKey): kind, bundle ids and market prototype. */
export interface Group {
  kind: number;
  /** The market prototype; null for affordable, whose pricing ignores the prototype. */
  protoId: PrototypeId | null;
  /** Programme ids joined with ','. */
  bundle: string;
  /** Members by `seq`, ascending; a member that left keeps its place, marked in the trees. */
  seqs: number[];
  units: number[];
  alive: number;
  /** Segment trees over members: least and greatest units of live members (leaves at `cap`). */
  min: Float64Array;
  max: Float64Array;
  cap: number;
}

interface Member {
  seq: number;
  kind: number;
  group: Group;
}

export interface LineIndex {
  version: number;
  /** Groups in the order they were first made. */
  groups: Group[];
  byKey: Map<string, Group>;
  /** Each lot's waiting rows. */
  byLot: Map<number, Member[]>;
}

const caches = new WeakMap<FundLine, LineIndex>();

/** The index of `line`, rebuilt from its waiting rows when absent or stale. */
export function lineIndex(line: FundLine): LineIndex {
  const hit = caches.get(line);
  if (hit !== undefined && hit.version === line.version) return hit;
  const c: LineIndex = { version: line.version, groups: [], byKey: new Map(), byLot: new Map() };
  for (let i = 0; i < line.n; i++) if (line.gone[i] === 0) addRow(c, line, i);
  for (const g of c.groups) buildTrees(g);
  caches.set(line, c);
  return c;
}

/** The index of `line` only when it is current (no rebuild). */
function current(line: FundLine): LineIndex | null {
  const hit = caches.get(line);
  return hit !== undefined && hit.version === line.version ? hit : null;
}

/** True when `lot` holds a waiting application of kind code `kind`. */
export function isWaiting(line: FundLine, lot: number, kind: number): boolean {
  const rows = lineIndex(line).byLot.get(lot);
  if (rows === undefined) return false;
  for (const m of rows) if (m.kind === kind) return true;
  return false;
}

/** The line row of `seq` (rows are in `seq` order); -1 when it is not on the line. */
export function rowOfSeq(line: FundLine, seq: number): number {
  let lo = 0;
  let hi = line.n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (line.seq[mid] < seq) lo = mid + 1;
    else hi = mid;
  }
  return lo < line.n && line.seq[lo] === seq ? lo : -1;
}

/** Records rows `from..to-1`, just added, in a current index; `before` is the index from before. */
export function noteAdded(
  line: FundLine,
  before: LineIndex | null,
  from: number,
  to: number
): void {
  if (before === null) return;
  for (let i = from; i < to; i++) {
    const g = addRow(before, line, i);
    appendLeaf(g);
  }
  before.version = line.version;
}

/** The index of `line` when current, before a change the caller will record. */
export function beforeChange(line: FundLine): LineIndex | null {
  return current(line);
}

/** Rule 8: marks every waiting row of `lot` `gone`, through the index. */
export function leaveRows(line: FundLine, lot: number): void {
  const c = lineIndex(line);
  const rows = c.byLot.get(lot);
  line.version++;
  c.version = line.version;
  if (rows === undefined) return;
  c.byLot.delete(lot);
  for (const m of rows) {
    const i = rowOfSeq(line, m.seq);
    if (i >= 0) line.gone[i] = 1;
    dropMember(m.group, m.seq);
  }
}

/** `compactLine`, keeping a current index current (`seq` survives compaction). */
export function compact(line: FundLine): void {
  const c = current(line);
  compactLine(line);
  if (c !== null) c.version = line.version;
}

function addRow(c: LineIndex, line: FundLine, i: number): Group {
  const kind = line.kind[i];
  const protoId = kind === KIND_MARKET ? prototypeFor(line.stories[i], line.units[i]).id : null;
  const key = `${kind}|${protoId ?? ''}|${line.bundle[i]}`;
  let g = c.byKey.get(key);
  if (g === undefined) {
    g = {
      kind,
      protoId,
      bundle: line.bundle[i],
      seqs: [],
      units: [],
      alive: 0,
      min: new Float64Array(2).fill(Infinity),
      max: new Float64Array(2).fill(-Infinity),
      cap: 1
    };
    c.byKey.set(key, g);
    c.groups.push(g);
  }
  const seq = line.seq[i];
  g.seqs.push(seq);
  g.units.push(line.units[i]);
  g.alive++;
  const lot = line.lot[i];
  let rows = c.byLot.get(lot);
  if (rows === undefined) c.byLot.set(lot, (rows = []));
  rows.push({ seq, kind, group: g });
  return g;
}

/** The trees of `g` from its live members, dropping the members that left. */
function buildTrees(g: Group): void {
  const seqs: number[] = [];
  const units: number[] = [];
  for (let k = 0; k < g.seqs.length; k++) {
    if (g.units[k] === -1) continue;
    seqs.push(g.seqs[k]);
    units.push(g.units[k]);
  }
  g.seqs = seqs;
  g.units = units;
  let cap = 1;
  while (cap < Math.max(units.length, 1) * 2) cap *= 2;
  g.cap = cap;
  g.min = new Float64Array(2 * cap).fill(Infinity);
  g.max = new Float64Array(2 * cap).fill(-Infinity);
  for (let k = 0; k < units.length; k++) {
    g.min[cap + k] = units[k];
    g.max[cap + k] = units[k];
  }
  for (let n = cap - 1; n >= 1; n--) {
    g.min[n] = Math.min(g.min[2 * n], g.min[2 * n + 1]);
    g.max[n] = Math.max(g.max[2 * n], g.max[2 * n + 1]);
  }
}

function setLeaf(g: Group, k: number, lo: number, hi: number): void {
  let n = g.cap + k;
  g.min[n] = lo;
  g.max[n] = hi;
  for (n >>= 1; n >= 1; n >>= 1) {
    g.min[n] = Math.min(g.min[2 * n], g.min[2 * n + 1]);
    g.max[n] = Math.max(g.max[2 * n], g.max[2 * n + 1]);
  }
}

/** Places the last member of `g` (just pushed) in its trees, growing them when full. */
function appendLeaf(g: Group): void {
  const k = g.seqs.length - 1;
  if (k >= g.cap) buildTrees(g);
  else setLeaf(g, k, g.units[k], g.units[k]);
}

/** The member position of `seq` in `g`. */
function posOf(g: Group, seq: number): number {
  let lo = 0;
  let hi = g.seqs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (g.seqs[mid] < seq) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function dropMember(g: Group, seq: number): void {
  const k = posOf(g, seq);
  if (k >= g.seqs.length || g.seqs[k] !== seq || g.units[k] === -1) return;
  g.units[k] = -1;
  g.alive--;
  setLeaf(g, k, Infinity, -Infinity);
  // Members that left are dropped once they are most of the group.
  if (g.seqs.length > 32 && g.alive * 2 < g.seqs.length) buildTrees(g);
}

/** The first member position at or after `from` whose units are at most `H`; -1 when none. */
export function firstAtMost(g: Group, from: number, H: number): number {
  const go = (n: number, l: number, r: number): number => {
    if (r <= from || g.min[n] > H) return -1;
    if (n >= g.cap) return l;
    const m = (l + r) >> 1;
    const left = go(2 * n, l, m);
    return left >= 0 ? left : go(2 * n + 1, m, r);
  };
  return go(1, 0, g.cap);
}

/** The first member position of `g` whose `seq` is above `after`. */
export function startAfter(g: Group, after: number): number {
  let lo = 0;
  let hi = g.seqs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (g.seqs[mid] <= after) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
