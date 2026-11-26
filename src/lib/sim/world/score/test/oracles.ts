// Test oracles: the month-by-month folds over a run's Schedules, Masters and ledger that the
// world's series are held to (shown series, homes by income tier, money).
import type { Day } from '$lib/timelapse/time';
import { STAGE_ORDER, type Pool, type Stage, type TierUnits } from '$lib/timelapse/types';
import { debtService, limitStatements } from '$lib/sim/finance';
import {
  TIER_FIELDS,
  addedBorrowing,
  poolSeries,
  tiersOf,
  type Money,
  type TierCtx
} from '$lib/sim/scenario/finance-score';
import { monthIndexer } from '$lib/sim/scenario/score';
import type { Schedule, SimInput, TimelineScore } from '$lib/sim/scenario/types';
import type { LedgerEvent } from '$lib/sim/world/types';
import type { Master } from '$lib/sim/world/read';

type Shown = TimelineScore['shown'];
type Live = Exclude<Stage, 'complete'>;

/** The stages a project can be in progress at (every stage but `complete`), in `STAGE_ORDER`. */
const LIVE = STAGE_ORDER.filter((s): s is Live => s !== 'complete');
const NL = LIVE.length;
const PLANNING: readonly Live[] = ['preApplication', 'filed', 'entitled'];

/**
 * Per-month deltas of the three net series (completions by origin, and `entitledNew`): what
 * `shownSeries` accumulates, through `addNet`.
 */
export interface NetAcc {
  idx: (d: Day) => number;
  pipeline: Int32Array;
  fresh: Int32Array;
  entitled: Int32Array;
}

/** Per-month deltas of one run's series; `stage[s * n + i]` is `inProgress[LIVE[s]]`. */
interface Acc extends NetAcc {
  n: number;
  m0: Day;
  horizon: Day;
  exited: Int32Array;
  stage: Int32Array;
}

/** The month a delta on `day` lands in: days before `months[0]` (history) count at 0. */
const monthOf = (acc: Acc, day: Day): number => (day < acc.m0 ? 0 : acc.idx(day));

/** In stage `s` on `[a, b)` with `units`: in `inProgress` at every `T_i` in that window. */
function addSpan(acc: Acc, s: number, a: Day, b: Day, units: number): void {
  if (!(a < b) || a > acc.horizon) return;
  acc.stage[s * acc.n + monthOf(acc, a)] += units;
  if (b <= acc.horizon) acc.stage[s * acc.n + monthOf(acc, b)] -= units;
}

/** Stage `s` on `[a, b)`, split by the revision current at each instant (`[0]` before its day). */
function addStage(acc: Acc, s: number, a: Day, b: Day, revs: Schedule['revisions']): void {
  for (let k = 0; k < revs.length; k++) {
    const from = k === 0 ? a : Math.max(a, revs[k].day);
    const to = k + 1 < revs.length ? Math.min(b, revs[k + 1].day) : b;
    addSpan(acc, s, from, to, revs[k].units);
  }
}

/** The units of the revision current on `day` (the last one with `revision.day ≤ day`). */
function unitsOn(revs: Schedule['revisions'], day: Day): number {
  let u = revs[0].units;
  for (let k = 1; k < revs.length && revs[k].day <= day; k++) u = revs[k].units;
  return u;
}

function addSchedule(acc: Acc, sc: Schedule, asOf: Day): void {
  const revs = sc.revisions;
  const e = sc.entered;
  const end = sc.end;
  // in progress: each entered stage until the next entered stage, or the exit / completion
  const stop = end.kind === 'open' ? Infinity : end.day;
  let prev = -1;
  let prevDay = 0;
  for (let s = 0; s < NL; s++) {
    const day = e[LIVE[s]];
    if (day === undefined) continue;
    if (prev >= 0) addStage(acc, prev, prevDay, day, revs);
    prev = s;
    prevDay = day;
  }
  if (prev >= 0) addStage(acc, prev, prevDay, stop, revs);
  addNet(acc, sc, asOf);
  if (end.kind === 'exit' && end.day > asOf) acc.exited[acc.idx(end.day)] += unitsOn(revs, end.day);
}

/**
 * One Schedule's net deltas (§4.5): −existing at a construction start after `asOf` and +final
 * units at completion, by origin (phases are pipeline); `entitledNew` for simulated projects
 * only, the net units of the revision current on the entitled day. Masters add nothing here.
 */
function addNet(acc: NetAcc, sc: Schedule, asOf: Day): void {
  const revs = sc.revisions;
  const e = sc.entered;
  const net = sc.origin === 'pipeline' ? acc.pipeline : acc.fresh;
  const c = e.construction;
  if (c !== undefined && c > asOf) net[acc.idx(c)] -= sc.existingUnits;
  if (sc.end.kind === 'complete') net[acc.idx(sc.end.day)] += revs[revs.length - 1].units;
  const ent = e.entitled;
  if (sc.origin === 'simulated' && ent !== undefined && ent > asOf) {
    acc.entitled[acc.idx(ent)] += unitsOn(revs, ent) - sc.existingUnits;
  }
}

/**
 * A master's bucket (§4.5): each phase's units sit at the master's current Planning stage (the
 * latest entered one), at `entitled` from E, until the phase files (`phaseFiled`) or the master
 * exits; unfiled phases stay to the horizon. A master exit sends Σ `phaseUnits` to `exitedUnits`.
 * Masters never complete or demolish anything.
 */
function addMaster(acc: Acc, m: Master, asOf: Day): void {
  const E = m.end.kind === 'entitled' ? m.end.day : Infinity;
  let total = 0;
  for (let j = 0; j < m.phaseUnits.length; j++) {
    const u = m.phaseUnits[j];
    total += u;
    const f = m.phaseFiled[j];
    const leave = m.end.kind === 'exit' ? m.end.day : f !== null ? f : Infinity;
    let prev = -1;
    let prevDay = 0;
    for (let s = 0; s < PLANNING.length; s++) {
      const st = PLANNING[s]; // the first stages of LIVE, so s is also the LIVE index
      let day = m.entered[st];
      if (st === 'entitled' && E !== Infinity) day = day === undefined ? E : Math.min(day, E);
      if (day === undefined || day >= leave) continue;
      if (prev >= 0) addSpan(acc, prev, prevDay, day, u);
      prev = s;
      prevDay = day;
    }
    if (prev >= 0) addSpan(acc, prev, prevDay, leave, u);
  }
  if (m.end.kind === 'exit' && m.end.day > asOf) acc.exited[acc.idx(m.end.day)] += total;
}

function inProgressOf(live: number[]): Shown[number]['inProgress'] {
  const r = {} as Shown[number]['inProgress'];
  for (let s = 0; s < NL; s++) r[LIVE[s]] = live[s];
  return r;
}

/**
 * The shown series of one run (§4.5): `[i]` is the state at the end of month `i` (events with
 * `day < T_i`). Completions split by origin (phases are pipeline); `entitledNew` is net and
 * simulated only; `inProgress[s]` holds the units of the revision current at `T_i`.
 */
export function shownSeries(
  run: { schedules: Schedule[]; masters: Master[] },
  asOf: Day,
  horizon: Day,
  months: Day[]
): Shown {
  const n = months.length;
  const acc: Acc = {
    n,
    m0: months[0],
    horizon,
    idx: monthIndexer(months, horizon),
    pipeline: new Int32Array(n),
    fresh: new Int32Array(n),
    entitled: new Int32Array(n),
    exited: new Int32Array(n),
    stage: new Int32Array(NL * n)
  };
  for (const s of run.schedules) addSchedule(acc, s, asOf);
  for (const m of run.masters) addMaster(acc, m, asOf);
  const out: Shown = [];
  let pipeline = 0;
  let fresh = 0;
  let entitled = 0;
  let exited = 0;
  const live = new Array<number>(NL).fill(0);
  for (let i = 0; i < n; i++) {
    pipeline += acc.pipeline[i];
    fresh += acc.fresh[i];
    entitled += acc.entitled[i];
    exited += acc.exited[i];
    for (let s = 0; s < NL; s++) live[s] += acc.stage[s * n + i];
    out.push({
      completedNet: pipeline + fresh,
      completedNetPipeline: pipeline,
      completedNetNew: fresh,
      entitledNew: entitled,
      inProgress: inProgressOf(live),
      exitedUnits: exited
    });
  }
  return out;
}

/**
 * The cumulative homes by income tier at the end of each month (spec 4.2), with exactly the month
 * rules of `addNet` (`score.ts`): at a construction start after `asOf`, `-existingUnits` from
 * `aboveModerate`; at completion, `tiersOf(sc, ctx)`. Both at `idx(day)`, no clamp. The five
 * fields of month `i` sum to `shownSeries(...)[i].completedNet`.
 */
export function tierSeries(
  schedules: Schedule[],
  ctx: TierCtx,
  asOf: Day,
  horizon: Day,
  months: Day[]
): TierUnits[] {
  const n = months.length;
  const idx = monthIndexer(months, horizon);
  const delta = TIER_FIELDS.map(() => new Int32Array(n));
  const AM = TIER_FIELDS.indexOf('aboveModerate');
  for (const sc of schedules) {
    const c = sc.entered.construction;
    if (c !== undefined && c > asOf) delta[AM][idx(c)] -= sc.existingUnits;
    if (sc.end.kind === 'complete') {
      const t = tiersOf(sc, ctx);
      const i = idx(sc.end.day);
      TIER_FIELDS.forEach((f, k) => {
        delta[k][i] += t[f];
      });
    }
  }
  const run = TIER_FIELDS.map(() => 0);
  const out: TierUnits[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < run.length; k++) run[k] += delta[k][i];
    out.push({
      veryLow: run[0],
      low: run[1],
      moderate: run[2],
      aboveModerate: run[3],
      unrecorded: run[4]
    });
  }
  return out;
}

/**
 * A funded project's homes and the public money, per month (spec 4.4-4.8). `fundedHomes` and
 * `displacedHomes` count a schedule with `funding` that completed (never keyed on `origin`) at its
 * completion month; `publicSpent` is `spent + lostCredit` summed over every pool (never `lost`,
 * which holds a grant's loss again); `owed` has each debt pool's principal (its last `received`)
 * and the total of level payments on it; `limits` come from `addedBorrowing`.
 */
export function moneyOf(p: {
  ledger: LedgerEvent[];
  schedules: Schedule[];
  finance: NonNullable<SimInput['finance']>;
  baseline: readonly Pool[];
  asOf: Day;
  horizon: Day;
  months: Day[];
}): Money {
  const n = p.months.length;
  const pools = poolSeries(p.ledger, p.finance, p.months, p.horizon);
  const idx = monthIndexer(p.months, p.horizon);
  const funded = new Array<number>(n).fill(0);
  const displaced = new Array<number>(n).fill(0);
  for (const sc of p.schedules) {
    if (sc.funding === undefined || sc.end.kind !== 'complete') continue;
    const i = idx(sc.end.day);
    funded[i] += sc.revisions[sc.revisions.length - 1].units - sc.existingUnits;
    displaced[i] += sc.funding.displaced;
  }
  for (let i = 1; i < n; i++) {
    funded[i] += funded[i - 1];
    displaced[i] += displaced[i - 1];
  }
  const publicSpent = Array.from({ length: n }, (_, i) =>
    pools.reduce((a, q) => a + q.spent[i] + q.lostCredit[i], 0)
  );
  const owed: Money['owed'] = [];
  p.finance.pools.forEach((pool, q) => {
    if (pool.debt === null) return;
    const principal = pools[q].received[n - 1];
    owed.push({
      pool: pool.id,
      principal,
      repayment: debtService(principal, pool.debt).total,
      nominal: true
    });
  });
  const limits = limitStatements(addedBorrowing(p.finance, p.baseline, p.asOf, p.horizon));
  return { pools, fundedHomes: funded, displacedHomes: displaced, publicSpent, owed, limits };
}
