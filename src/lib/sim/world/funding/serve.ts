// Serving the funding line and the award (spec rules 10, 11): one scan a month in line order,
// each application tested against the pools as they stand, an award starting its funded project.
import { projectDollars, prototypeFor, type PrototypeId } from '$lib/sim/finance';
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
import { availableOf, commitAward } from './pools';

const kindOf = (line: FundLine, i: number): ProjectKind =>
  line.kind[i] === KIND_AFFORDABLE ? 'affordable' : 'market';

/** `serveLine`'s test seam. */
export interface ServeOpts {
  /** False serves by the direct scan (every waiting row asks the award rule); default true. */
  grouped?: boolean;
}

/** A group's key less its bundle: the kind and, for market, the prototype (`line.ts` groupKey). */
const subOf = (kind: ProjectKind, protoId: PrototypeId): string =>
  kind === 'market' ? protoId : '~affordable';

/**
 * System 5 (rule 10): one scan in line order (rows 0..n-1, skipping `gone`), each against the
 * pools as they stand. An award's chain may take a later lot's rows off the line (an ordinary
 * start marks them `gone`); they are skipped. Money that moves after the scan waits for next
 * month's: there is no second scan.
 *
 * Grouped serving (the rule 1 decision; groups as `line.ts:194-415` makes them): applications
 * with one award rule (kind, joined bundle ids and, for market, prototype) share a group, and in
 * a group the rule is monotone in the size. Once a group's test has failed at some size against
 * the pools as they stand, no later member of that size or larger can pass until money moves, so
 * it is skipped without asking. An award moves money (its commit, and any money event of its
 * chain), so every group's bound is dropped after one. The rows awarded, their order and their
 * days are the direct scan's (`opts.grouped === false`, a test seam).
 */
export function serveLine(ctx: StepCtx, opts: ServeOpts = {}): void {
  const { line, pools } = fundOf(ctx.world);
  const fm = frameMoney(ctx.timeline, ctx.frame);
  const fin = fm.fin;
  // The world pool row of each frame pool index.
  const rowOf = fin.pools.map((p) => poolRowOf(pools, p.id));
  const avail = (q: number): number => availableOf(pools, rowOf[q], fin.pools[q]);
  /** By `subOf`, then joined bundle ids: the least size that failed since money last moved. */
  const failed = opts.grouped === false ? null : new Map<string, Map<string, number>>();
  const n = line.n;
  for (let i = 0; i < n; i++) {
    if (line.gone[i] === 1) continue;
    // Rule 8: a lot no longer free left the line when its ordinary clock fired, also when that
    // start gained no home (the core marks it done and sends no 'start'). Same test as startRow's.
    const li = lotRow(ctx.world.lots, line.lot[i]);
    if (li >= 0 && ctx.world.lots.state[li] !== LOT_FREE) {
      leaveLine(line, line.lot[i]);
      continue;
    }
    const kind = kindOf(line, i);
    const units = line.units[i];
    const protoId = prototypeFor(line.stories[i], units).id;
    let group: Map<string, number> | undefined;
    if (failed !== null) {
      const sub = subOf(kind, protoId);
      group = failed.get(sub);
      if (group === undefined) failed.set(sub, (group = new Map()));
      const least = group.get(line.bundle[i]);
      if (least !== undefined && units >= least) continue;
    }
    // Null when an id is no longer offered: the row waits (Task 9 remakes such rows).
    const bundle = fm.bundleIds(line.bundle[i]);
    if (bundle === null) continue;
    if (!awardPasses(bundle, kind, protoId, units, avail, fm.index)) {
      // Smaller than any failed size of its group, else it was skipped above.
      group?.set(line.bundle[i], units);
      continue;
    }
    awardRow(ctx, fm, line, i, bundle, protoId, avail, rowOf);
    failed?.clear();
  }
}

/**
 * The award of line row `i` (rule 11), which the award rule passes against the pools as they
 * stand: its set, day and `FundedStart`, the commit, the row leaving the line, the funded start
 * and the `'award'` event. Both scans award through this one function.
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
