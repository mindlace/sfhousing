// The funding side of the world's columns (spec S1): the funding line, the spell and shadow side
// tables, the pools' counters and the money rows. All typed arrays and string arrays, so
// `structuredClone(world)` stays a full copy.
import { NO_DAY, type LineColumns, type PoolColumns, type World } from '../types';

export const KIND_MARKET = 0;
export const KIND_AFFORDABLE = 1;
export const INSTR_GRANT = 0;
export const INSTR_LOAN = 1;
export const INSTR_GUARANTEE = 2;

export interface FundLine extends LineColumns {
  n: number;
  lot: Int32Array;
  kind: Uint8Array;
  /** Model month applied: the line's first key (rule 9). */
  month: Int32Array;
  applied: Int32Array;
  keyDay: Int32Array;
  key: Float64Array;
  /** Programme ids joined with ','. */
  bundle: string[];
  f: Uint8Array;
  units: Int32Array;
  stories: Float64Array;
  level: Float64Array;
  /** Model month whose frame's view gave the size. */
  viewMonth: Int32Array;
  /** 1 = removed this step, dropped by `compactLine`. */
  gone: Uint8Array;
  /** A row's number in the order rows were added: ascending along the line, kept by compaction. */
  seq: Float64Array;
  /** The `seq` the next added row takes. */
  nextSeq: number;
  /**
   * Bumped by every change to the line's rows (`addLineRow`, `leaveLine`, `joinLine`,
   * `compactLine`, and any later writer of a row's columns, such as Task 9's remake): the caches in
   * `line-index.ts` are rebuilt when it differs from theirs.
   */
  version: number;
  /** The last model month whose `apply` ran (0 = none): a day in it or before can no longer apply. */
  appliedThrough: number;
  spellN: number;
  spellLot: Int32Array;
  spellKind: Uint8Array;
  spellK: Int32Array;
  spellR: Int32Array;
  shadowN: number;
  shadowLot: Int32Array;
  shadowRow: Int32Array;
  shadowK: Int32Array;
  shadowR: Int32Array;
  shadowExisting: Int32Array;
  /**
   * The month of the shadow's planned ordinary start as last evaluated: 0 = not evaluated yet,
   * -1 = evaluated and never passed so far.
   */
  shadowMonth: Int32Array;
}

export interface FundPools extends PoolColumns {
  n: number;
  id: string[];
  received: Float64Array;
  committed: Float64Array;
  spentGrant: Float64Array;
  outLoan: Float64Array;
  lostLoan: Float64Array;
  lostGuarantee: Float64Array;
  /** Day and model month of the latest money that reached the pool (arrival, release, repayment). */
  moneyDay: Int32Array;
  moneyMonth: Int32Array;
  /** Money rows: one per (awarded project, paying programme) with events still to come, by project row ascending. */
  mN: number;
  mRow: Int32Array;
  mProg: string[];
  mPool: string[];
  mInstr: Uint8Array;
  mGrant: Float64Array;
  mLent: Float64Array;
  mReserve: Float64Array;
  mGuaranteed: Float64Array;
  /** `terms.lossOnExit` of the award's frame. */
  mLoss: Float64Array;
}

type Col = Int32Array | Uint8Array | Float64Array | string[];

const LINE_ROWS = [
  'lot', 'kind', 'month', 'applied', 'keyDay', 'key', 'bundle', 'f', 'units', 'stories', 'level',
  'viewMonth', 'gone', 'seq'
]; // prettier-ignore
const SPELLS = ['spellLot', 'spellKind', 'spellK', 'spellR'];
const SHADOWS = ['shadowLot', 'shadowRow', 'shadowK', 'shadowR', 'shadowExisting', 'shadowMonth'];
const POOL_ROWS = [
  'id', 'received', 'committed', 'spentGrant', 'outLoan', 'lostLoan', 'lostGuarantee', 'moneyDay',
  'moneyMonth'
]; // prettier-ignore
const MONEY_ROWS = [
  'mRow', 'mProg', 'mPool', 'mInstr', 'mGrant', 'mLent', 'mReserve', 'mGuaranteed', 'mLoss'
]; // prettier-ignore

/** Makes every column in `names` hold at least `rows` rows, doubling capacity. */
function grow(o: object, names: string[], rows: number): void {
  const cols = o as Record<string, Col>;
  const have = cols[names[0]].length;
  if (rows <= have) return;
  const cap = Math.max(rows, have * 2, 8);
  for (const name of names) {
    const c = cols[name];
    if (Array.isArray(c)) {
      while (c.length < cap) c.push('');
    } else {
      const next = new (c.constructor as new (n: number) => Exclude<Col, string[]>)(cap);
      next.set(c);
      cols[name] = next;
    }
  }
}

/** Moves rows `from..end` of every column in `names` to `to`. */
function moveRows(o: object, names: string[], from: number, end: number, to: number): void {
  const cols = o as Record<string, Col>;
  for (const name of names) {
    const c = cols[name];
    if (Array.isArray(c)) {
      const part = c.slice(from, end);
      for (let i = 0; i < part.length; i++) c[to + i] = part[i];
    } else c.copyWithin(to, from, end);
  }
}

function emptyLine(): FundLine {
  return {
    n: 0,
    lot: new Int32Array(0),
    kind: new Uint8Array(0),
    month: new Int32Array(0),
    applied: new Int32Array(0),
    keyDay: new Int32Array(0),
    key: new Float64Array(0),
    bundle: [],
    f: new Uint8Array(0),
    units: new Int32Array(0),
    stories: new Float64Array(0),
    level: new Float64Array(0),
    viewMonth: new Int32Array(0),
    gone: new Uint8Array(0),
    seq: new Float64Array(0),
    nextSeq: 0,
    version: 0,
    appliedThrough: 0,
    spellN: 0,
    spellLot: new Int32Array(0),
    spellKind: new Uint8Array(0),
    spellK: new Int32Array(0),
    spellR: new Int32Array(0),
    shadowN: 0,
    shadowLot: new Int32Array(0),
    shadowRow: new Int32Array(0),
    shadowK: new Int32Array(0),
    shadowR: new Int32Array(0),
    shadowExisting: new Int32Array(0),
    shadowMonth: new Int32Array(0)
  };
}

function emptyPools(): FundPools {
  return {
    n: 0,
    id: [],
    received: new Float64Array(0),
    committed: new Float64Array(0),
    spentGrant: new Float64Array(0),
    outLoan: new Float64Array(0),
    lostLoan: new Float64Array(0),
    lostGuarantee: new Float64Array(0),
    moneyDay: new Int32Array(0),
    moneyMonth: new Int32Array(0),
    mN: 0,
    mRow: new Int32Array(0),
    mProg: [],
    mPool: [],
    mInstr: new Uint8Array(0),
    mGrant: new Float64Array(0),
    mLent: new Float64Array(0),
    mReserve: new Float64Array(0),
    mGuaranteed: new Float64Array(0),
    mLoss: new Float64Array(0)
  };
}

/** Gives `world` the funding columns, one zeroed pool row per id in `poolIds`, in that order. */
export function initFunding(world: World, poolIds: readonly string[]): void {
  const line = emptyLine();
  const pools = emptyPools();
  world.line = line;
  world.pools = pools;
  for (const id of poolIds) poolRowOf(pools, id);
}

/** The funding columns of `world`; throws before `initFunding`. */
export function fundOf(world: World): { line: FundLine; pools: FundPools } {
  if (!('gone' in world.line) || !('mRow' in world.pools))
    throw new Error('fundOf: the world has no funding columns (initFunding was not called)');
  return { line: world.line as FundLine, pools: world.pools as FundPools };
}

/** The row of pool `id`; an unknown id appends a zeroed row. */
export function poolRowOf(pools: FundPools, id: string): number {
  for (let i = 0; i < pools.n; i++) if (pools.id[i] === id) return i;
  const row = pools.n;
  grow(pools, POOL_ROWS, row + 1);
  pools.n = row + 1;
  pools.id[row] = id;
  return row;
}

/** Appends a line row with defaults and returns its index. */
export function addLineRow(line: FundLine): number {
  const row = line.n;
  grow(line, LINE_ROWS, row + 1);
  line.n = row + 1;
  line.lot[row] = -1;
  line.kind[row] = KIND_MARKET;
  line.month[row] = 0;
  line.applied[row] = NO_DAY;
  line.keyDay[row] = NO_DAY;
  line.key[row] = 0;
  line.bundle[row] = '';
  line.f[row] = 0;
  line.units[row] = 0;
  line.stories[row] = NaN;
  line.level[row] = 0;
  line.viewMonth[row] = 0;
  line.gone[row] = 0;
  line.seq[row] = line.nextSeq++;
  line.version++;
  return row;
}

/** Drops the rows marked `gone`, keeping the order of the rest; each run of kept rows moves at once. */
export function compactLine(line: FundLine): void {
  const n = line.n;
  let w = line.gone.subarray(0, n).indexOf(1);
  if (w < 0) return;
  let r = w;
  while (r < n) {
    while (r < n && line.gone[r] === 1) r++;
    const from = r;
    while (r < n && line.gone[r] === 0) r++;
    if (r > from) moveRows(line, LINE_ROWS, from, r, w);
    w += r - from;
  }
  line.n = w;
  line.version++;
}

/** Appends a money row (zeroed) and returns its index. */
export function addMoneyRow(pools: FundPools): number {
  const row = pools.mN;
  grow(pools, MONEY_ROWS, row + 1);
  pools.mN = row + 1;
  pools.mRow[row] = -1;
  pools.mProg[row] = '';
  pools.mPool[row] = '';
  pools.mInstr[row] = INSTR_GRANT;
  pools.mGrant[row] = 0;
  pools.mLent[row] = 0;
  pools.mReserve[row] = 0;
  pools.mGuaranteed[row] = 0;
  pools.mLoss[row] = 0;
  return row;
}

/** The money rows `[from, to)` of project row `row` (empty when none); `mRow` is ascending. */
export function moneyRowsOf(pools: FundPools, row: number): [from: number, to: number] {
  let lo = 0;
  let hi = pools.mN;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pools.mRow[mid] < row) lo = mid + 1;
    else hi = mid;
  }
  const from = lo;
  hi = pools.mN;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (pools.mRow[mid] <= row) lo = mid + 1;
    else hi = mid;
  }
  return [from, lo];
}

/** Removes the money rows of project row `row`. */
export function dropMoneyRows(pools: FundPools, row: number): void {
  const [from, to] = moneyRowsOf(pools, row);
  if (to === from) return;
  moveRows(pools, MONEY_ROWS, to, pools.mN, from);
  pools.mN -= to - from;
}

/** The spell table is sorted by (lot, kind): the first row not before that pair. */
function spellAt(line: FundLine, lot: number, kind: number): number {
  let lo = 0;
  let hi = line.spellN;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const l = line.spellLot[mid];
    if (l < lot || (l === lot && line.spellKind[mid] < kind)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The day `r` a lot's kind became free for attempt `k`, or `NO_DAY` when the spell is for another attempt. */
export function spellOf(line: FundLine, lot: number, kind: number, k: number): number {
  const i = spellAt(line, lot, kind);
  if (i >= line.spellN || line.spellLot[i] !== lot || line.spellKind[i] !== kind) return NO_DAY;
  return line.spellK[i] === k ? line.spellR[i] : NO_DAY;
}

/** Records (or replaces) the spell of `(lot, kind)`. */
export function setSpell(line: FundLine, lot: number, kind: number, k: number, r: number): void {
  const i = spellAt(line, lot, kind);
  if (i >= line.spellN || line.spellLot[i] !== lot || line.spellKind[i] !== kind) {
    grow(line, SPELLS, line.spellN + 1);
    moveRows(line, SPELLS, i, line.spellN, i + 1);
    line.spellN++;
    line.spellLot[i] = lot;
    line.spellKind[i] = kind;
  }
  line.spellK[i] = k;
  line.spellR[i] = r;
}

/** Appends a shadow row (the ordinary start a funded start may pre-empt). */
export function addShadow(
  line: FundLine,
  lot: number,
  row: number,
  k: number,
  r: number,
  existing: number
): void {
  const i = line.shadowN;
  grow(line, SHADOWS, i + 1);
  line.shadowN = i + 1;
  line.shadowLot[i] = lot;
  line.shadowRow[i] = row;
  line.shadowK[i] = k;
  line.shadowR[i] = r;
  line.shadowExisting[i] = existing;
  line.shadowMonth[i] = 0;
}

/** Removes the shadow rows `ended` (ascending indices), keeping the order of the rest. */
export function dropShadows(line: FundLine, ended: readonly number[]): void {
  if (ended.length === 0) return;
  let w = ended[0];
  for (let j = 0; j < ended.length; j++) {
    const from = ended[j] + 1;
    const to = j + 1 < ended.length ? ended[j + 1] : line.shadowN;
    if (to > from) moveRows(line, SHADOWS, from, to, w);
    w += to - from;
  }
  line.shadowN = w;
}
