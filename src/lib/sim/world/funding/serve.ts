// Serving the funding line and the award (spec rules 10, 11): one scan a month in line order,
// each application tested against the pools as they stand, an award starting its funded project.
import { PROTOTYPES, projectDollars, prototypeFor, type PrototypeId } from '$lib/sim/finance';
import { pathwayFrom } from '$lib/sim/scenario/engine';
import { awardPasses, awardSet, coverageLevel, type Award } from '$lib/sim/scenario/funding';
import { seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { Day } from '$lib/timelapse/time';
import type { Pathway, ProjectKind } from '$lib/timelapse/types';
import { lotRow } from '../columns';
import { lotEntity } from '../rates';
import { LOT_FREE, type FundedStart, type StepCtx } from '../types';
import { leaveLine } from './apply';
import { KIND_AFFORDABLE, fundOf, poolRowOf, type FundLine, type FundPools } from './columns';
import { frameMoney, type FrameMoney } from './frame-money';
import { firstAtMost, lineIndex, rowOfSeq, startAfter, type Group } from './line-index';
import { availableOf, commitAward, heldOf, holdingReturns } from './pools';
import { shadowAward } from './shadow';

const kindOf = (line: FundLine, i: number): ProjectKind =>
  line.kind[i] === KIND_AFFORDABLE ? 'affordable' : 'market';

/** `serveLine`'s test seam. */
export interface ServeOpts {
  /** False serves by the direct scan (every waiting row asks the award rule); default true. */
  grouped?: boolean;
}

/**
 * System 5 (rule 10): one scan in line order (rows 0..n-1, skipping `gone`), each against the
 * pools as they stand. An award's chain may take a later lot's rows off the line (an ordinary
 * start marks them `gone`); they are skipped. Money that moves after the scan waits for next
 * month's: there is no second scan. So does money an award's chain returns during the scan (a
 * release or repayment): it is held out of the scan's available money (`holdingReturns`), while
 * commits and losses apply at once.
 *
 * Rule 8's guard is lazy: a row whose lot is no longer free (its ordinary clock fired, also when
 * that start gained no home, which the core does without a 'start') is found when it would be
 * awarded, and then its lot's rows leave the line and the scan goes on. Awards, days, events and
 * ledger are those of a guard on every row; only the month a dead row leaves differs (it waits
 * until it would pass, or until Task 9 lapses it). Task 9's lapse and replan must therefore never
 * `due.put` a lot that is not free.
 *
 * Grouped serving (the rule 1 decision; groups as `line.ts:194-415` makes them, kept in
 * `line-index.ts` across months): applications with one award rule (kind, joined bundle ids and,
 * for market, prototype) share a group, and in a group the rule is monotone in the size, so it
 * passes for exactly the members of size at most the group's threshold H. A pass takes the
 * earliest member, after the last row decided, among the groups' members at most H; confirms it
 * with the rule at its own size; and drops every H after an award (its commit and its chain's
 * money events move money). The rows awarded, their order and their days are the direct scan's
 * (`opts.grouped === false`, a test seam).
 */
export function serveLine(ctx: StepCtx, opts: ServeOpts = {}): void {
  const { pools } = fundOf(ctx.world);
  holdingReturns(pools, () => scanLine(ctx, opts));
}

/** `serveLine`'s scan, with money returned during it held (`holdingReturns`). */
function scanLine(ctx: StepCtx, opts: ServeOpts): void {
  const { line, pools } = fundOf(ctx.world);
  const fm = frameMoney(ctx.timeline, ctx.frame);
  const fin = fm.fin;
  // The world pool row of each frame pool index.
  const rowOf = fin.pools.map((p) => poolRowOf(pools, p.id));
  // Available money less what was returned during this scan (rule 10).
  const avail = (q: number): number =>
    availableOf(pools, rowOf[q], fin.pools[q]) - heldOf(pools, rowOf[q]);
  if (opts.grouped === false) {
    const n = line.n;
    for (let i = 0; i < n; i++) {
      if (line.gone[i] === 1) continue;
      const bundle = offeredBundle(fm, line, i);
      const kind = kindOf(line, i);
      const units = line.units[i];
      const protoId = prototypeFor(line.stories[i], units).id;
      if (!awardPasses(bundle, kind, protoId, units, avail, fm.index)) continue;
      serveRow(ctx, fm, line, i, bundle, protoId, avail, rowOf);
    }
    return;
  }

  const idx = lineIndex(line);
  /** Each group's H for the pools as they stand. */
  const hs = new Map<Group, number>();
  const hOf = (g: Group): number => {
    let h = hs.get(g);
    if (h === undefined) {
      const bundle = fm.bundleIds(g.bundle);
      if (bundle === null) throw notOffered(g.bundle);
      const kind: ProjectKind = g.kind === KIND_AFFORDABLE ? 'affordable' : 'market';
      // Affordable pricing ignores the prototype (`funding.ts` price): any id serves.
      const protoId = g.protoId ?? ANY_PROTO;
      h = threshold(g, (u) => awardPasses(bundle, kind, protoId, u, avail, fm.index));
      hs.set(g, h);
    }
    return h;
  };
  /** The `seq` of the last row decided in this scan, as the scan's position. */
  let after = -1;
  for (;;) {
    let best: Group | null = null;
    let bestSeq = Infinity;
    for (const g of idx.groups) {
      if (g.alive === 0) continue;
      const h = hOf(g);
      if (g.min[1] > h) continue;
      const k = firstAtMost(g, startAfter(g, after), h);
      if (k >= 0 && g.seqs[k] < bestSeq) {
        best = g;
        bestSeq = g.seqs[k];
      }
    }
    if (best === null) break;
    after = bestSeq;
    const i = rowOfSeq(line, bestSeq);
    if (i < 0 || line.gone[i] === 1)
      throw new Error(`serveLine: the line index names row seq ${bestSeq}, not waiting`);
    const bundle = offeredBundle(fm, line, i);
    const protoId = prototypeFor(line.stories[i], line.units[i]).id;
    if (!awardPasses(bundle, kindOf(line, i), protoId, line.units[i], avail, fm.index)) continue;
    if (serveRow(ctx, fm, line, i, bundle, protoId, avail, rowOf)) hs.clear();
  }
}

/**
 * The error for a waiting row whose bundle names a programme the frame does not offer. Never
 * legitimate: `policyChanged` re-makes every waiting row when the money changes (rule 17), and an
 * application joins under the frame of its month (`applyLots`).
 */
function notOffered(bundle: string): Error {
  return new Error(`serveLine: the frame does not offer every programme of bundle '${bundle}'`);
}

/** Row `i`'s bundle as programme indices of the frame; throws when it names one not offered. */
function offeredBundle(fm: FrameMoney, line: FundLine, i: number): number[] {
  const bundle = fm.bundleIds(line.bundle[i]);
  if (bundle === null) throw notOffered(line.bundle[i]);
  return bundle;
}

/** A prototype id for groups whose pricing ignores it (affordable). */
const ANY_PROTO: PrototypeId = PROTOTYPES[4].id;

/**
 * The largest size from 1 to the group's largest live size at which `passes` holds (`line.ts`
 * threshold): exact on [least, largest] of the live members, so it stays right while members
 * only leave.
 */
function threshold(g: Group, passes: (units: number) => boolean): number {
  const lo0 = g.min[1];
  const hi0 = g.max[1];
  if (lo0 === Infinity) return 0;
  if (!passes(lo0)) return lo0 - 1;
  if (passes(hi0)) return hi0;
  let lo = lo0;
  let hi = hi0;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (passes(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Line row `i`, which the award rule passes: rule 8's lazy guard (a lot no longer free takes its
 * rows off the line; same test as startRow's), else its award. True when it was awarded.
 */
function serveRow(
  ctx: StepCtx,
  fm: FrameMoney,
  line: FundLine,
  i: number,
  bundle: readonly number[],
  protoId: PrototypeId,
  avail: (q: number) => number,
  rowOf: readonly number[]
): boolean {
  const li = lotRow(ctx.world.lots, line.lot[i]);
  if (li >= 0 && ctx.world.lots.state[li] !== LOT_FREE) {
    leaveLine(line, line.lot[i]);
    return false;
  }
  awardRow(ctx, fm, line, i, bundle, protoId, avail, rowOf);
  return true;
}

/**
 * The award of line row `i` (rule 11), which the award rule passes against the pools as they
 * stand: its set, day and `FundedStart`, the commit, the row leaving the line, the shadow of the
 * ordinary start it pre-empts (rule 20), the funded start and the `'award'` event. Both scans
 * award through this one function.
 */
function awardRow(
  ctx: StepCtx,
  fm: FrameMoney,
  line: FundLine,
  i: number,
  bundle: readonly number[],
  protoId: PrototypeId,
  avail: (q: number) => number,
  rowOf: readonly number[]
): void {
  const { pools } = fundOf(ctx.world);
  const units = line.units[i];
  const award = awardSet(bundle, kindOf(line, i), protoId, units, avail, fm.index);
  if (award === null) throw new Error('serveLine: awardPasses and awardSet disagree');
  const asked: number[] = [];
  for (const q of award.asks.keys()) asked.push(rowOf[q]);
  const day = awardDay(ctx, line, i, pools, asked);
  const lot = line.lot[i];
  const funded = fundedStartOf(ctx, fm, line, i, award);
  // A funded start appends exactly one row first (`world.ts` startRow); its chain may append
  // more, so the row is read before the call and checked against what it returns.
  const row = ctx.world.projects.n;
  commitAward(ctx, fm, row, day, award, units);
  leaveLine(line, lot);
  // Rule 20: the shadow of the attempt the award pre-empts, read before the start's chain can
  // free the lot and start it again.
  shadowAward(ctx, line, lot, row);
  const got = ctx.startProject(lot, day, funded);
  if (got === -1)
    throw new Error(`serveLine: startProject returned -1 for a funded start on lot ${lot}`);
  if (got !== row)
    throw new Error(`serveLine: startProject made row ${got}, not the predicted row ${row}`);
  ctx.out.event({ kind: 'award', row, day });
}

/**
 * Rule 11's award day for line row `i`: the latest of its `applied` day (when it applied this
 * month, else the month's first day) and the day of the latest money that reached, this month,
 * any of the world pool rows `asked` (the capped pools the award asks money of).
 */
export function awardDay(
  ctx: StepCtx,
  line: FundLine,
  i: number,
  pools: FundPools,
  asked: readonly number[]
): Day {
  let day = line.month[i] === ctx.month ? line.applied[i] : ctx.firstDay;
  for (const q of asked) {
    if (pools.moneyMonth[q] === ctx.month && pools.moneyDay[q] > day) day = pools.moneyDay[q];
  }
  return day;
}

/**
 * Rule 11's `FundedStart` for line row `i`: the size of its view, its paying programme ids and its
 * dollars as `fundingOf` computes them (`funded.ts:1657-1675`), `certain` from the award's
 * coverage and the route as `funded.ts:1738-1745` draws it.
 */
export function fundedStartOf(
  ctx: StepCtx,
  fm: FrameMoney,
  line: FundLine,
  i: number,
  award: Award
): FundedStart {
  const lot = line.lot[i];
  const kind = kindOf(line, i);
  const units = line.units[i];
  const programmes: string[] = [];
  let granted = 0;
  let lent = 0;
  let guaranteed = 0;
  award.set.forEach((g, n) => {
    const it = award.priced.items[n];
    if (it.granted > 0 || it.lent > 0 || it.guaranteed > 0)
      programmes.push(fm.fin.programmes[g].id);
    granted += projectDollars(it.granted, units);
    lent += projectDollars(it.lent, units);
    guaranteed += projectDollars(it.guaranteed, units);
  });
  const certain = coverageLevel(award.priced.coverage) === 1;
  const view = ctx.timeline.frameAt(line.viewMonth[i]).view;
  let pathway: Pathway | null = null;
  if (view.parcels.localProgram[lot] === 1) pathway = 'streamlined';
  else if (certain && kind === 'affordable') {
    // The attempt's stream, as `startRow` makes it.
    const li = lotRow(ctx.world.lots, lot);
    const k = li < 0 ? 0 : ctx.world.lots.k[li];
    const stream = streamOf(seedHash(ctx.seed), lotEntity(ctx.statics, lot), k);
    pathway = pathwayFrom(ctx.frame.newCalibration.affordableRoutes!, stream);
  }
  return {
    kind,
    view,
    f: line.f[i],
    units,
    stories: line.stories[i],
    applied: line.applied[i],
    programmes,
    granted,
    lent,
    guaranteed,
    certain,
    pathway
  };
}
