// Planning and making applications (spec rules 5, 6, 8, 9): which model month a free lot applies
// in, the rows it adds to the funding line, re-making a row under a new frame (rules 17, 18) and
// its leaving the line.
import { lineKey } from '$lib/sim/scenario/funded';
import { below, coverageLevel } from '$lib/sim/scenario/funding';
import { P, drawOn, seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { ProjectKind } from '$lib/timelapse/types';
import { lotRow } from '../columns';
import { lotEntity } from '../rates';
import { monthOfDay } from '../months';
import { NO_DAY, type StepCtx, type World } from '../types';
import { kindClock, sizeIn, type KindClock, type Spell } from './clocks';
import { frameMoney, sameMoney, type FrameMoney } from './frame-money';
import {
  KIND_AFFORDABLE,
  KIND_MARKET,
  addLineRow,
  fundOf,
  setSpell,
  spellOf,
  type FundLine
} from './columns';
import { beforeChange, isWaiting, leaveRows, noteAdded } from './line-index';

const KINDS: readonly ProjectKind[] = ['market', 'affordable'];
const CODE: Record<ProjectKind, number> = { market: KIND_MARKET, affordable: KIND_AFFORDABLE };

/** One application as it joins the line (rule 6); `month` is the month it joins in. */
export interface Application {
  lot: number;
  kind: number;
  applied: number;
  keyDay: number;
  key: number;
  /** Programme ids joined with ','. */
  bundle: string;
  f: number;
  units: number;
  stories: number;
  level: number;
  viewMonth: number;
}

/** The funding line of `world`, or null before the funding columns exist (never creates them). */
function lineOf(world: World): FundLine | null {
  return 'gone' in world.line ? fundOf(world).line : null;
}

/** True when `lot` holds a waiting (not `gone`) application of kind code `kind`. */
function waiting(line: FundLine | null, lot: number, kind: number): boolean {
  return line !== null && isWaiting(line, lot, kind);
}

/** The attempt of free lot `lot` and each kind's spell start (a respelled one from `spellOf`). */
export function spellsOf(ctx: StepCtx, lot: number): { market: Spell; affordable: Spell } {
  const { world, statics } = ctx;
  const l = world.lots;
  const i = lotRow(l, lot);
  const r = i < 0 ? statics.asOf : l.r[i];
  const k = i < 0 ? 0 : l.k[i];
  const existing = i >= 0 && l.demolished[i] === 1 ? 0 : ctx.frame.view.parcels.existingUnits[lot];
  const stream = streamOf(seedHash(ctx.seed), lotEntity(statics, lot), k);
  const line = lineOf(world);
  const spell = (kind: number): Spell => {
    const own = line === null ? NO_DAY : spellOf(line, lot, kind, k);
    return { lot, k, stream, r: own === NO_DAY ? r : own, existing };
  };
  return { market: spell(KIND_MARKET), affordable: spell(KIND_AFFORDABLE) };
}

/**
 * Whether any frame `kindClock` reads for a spell free since `r`, through `month`, offers a
 * programme of `kind`: the frame of the spell's first month and each change after it through
 * `month`. When none does, every lot-month's bundle is empty and the clock has no day (rule 5).
 */
function offersAny(ctx: StepCtx, r: number, kind: ProjectKind): boolean {
  const { timeline, month } = ctx;
  const first = Math.min(monthOfDay(ctx.statics.asOf, r + 1), month);
  const offers = (m: number): boolean => {
    const g = timeline.frameAt(m);
    return g.finance !== null && frameMoney(timeline, g).offered[kind].length > 0;
  };
  if (offers(first)) return true;
  for (const c of timeline.changes()) {
    if (c <= first) continue;
    if (c > month) break;
    if (offers(c)) return true;
  }
  return false;
}

/**
 * Each kind's clock read through `ctx.month`, null for a kind already waiting or one no frame it
 * reads offers (its clock would have no day): callers read only a clock's day.
 */
function clocksOf(ctx: StepCtx, lot: number, line: FundLine | null): (KindClock | null)[] {
  const spells = spellsOf(ctx, lot);
  const sh = seedHash(ctx.seed);
  return KINDS.map((kind) =>
    waiting(line, lot, CODE[kind]) || !offersAny(ctx, spells[kind].r, kind)
      ? null
      : kindClock(ctx.statics, ctx.timeline, ctx.month, sh, spells[kind], kind)
  );
}

/**
 * Rule 5: the model month of the earliest application day of a kind not already waiting, or 0.
 * A kind whose spell is spent (its pass fell in a lot-month with nothing on offer) has no day. A
 * day in a model month whose `apply` has already run (`line.appliedThrough`) is lost, and is
 * passed over so it never hides the other kind; reading that from the world (not from `ctx.month`)
 * gives every path (carried due list, replan, `planDue` rebuild) the same answer. Pure: reads the
 * world, never writes it.
 */
export function planLotMonth(ctx: StepCtx, lot: number): number {
  const line = lineOf(ctx.world);
  const through = line === null ? 0 : line.appliedThrough;
  let best = 0;
  for (const c of clocksOf(ctx, lot, line)) {
    if (c === null || c.day === null || c.month <= through) continue;
    if (best === 0 || c.month < best) best = c.month;
  }
  return best;
}

/**
 * Rule 9: appends `apps`, applied in model month `month`, after every row already on the line, in
 * key order (key day, then parcel rank, then market before affordable).
 */
export function joinLine(line: FundLine, month: number, apps: Application[]): void {
  const sorted = [...apps].sort((a, b) => a.key - b.key);
  const before = beforeChange(line);
  const from = line.n;
  for (const a of sorted) {
    const i = addLineRow(line);
    line.lot[i] = a.lot;
    line.kind[i] = a.kind;
    line.month[i] = month;
    line.applied[i] = a.applied;
    line.keyDay[i] = a.keyDay;
    line.key[i] = a.key;
    line.bundle[i] = a.bundle;
    line.f[i] = a.f;
    line.units[i] = a.units;
    line.stories[i] = a.stories;
    line.level[i] = a.level;
    line.viewMonth[i] = a.viewMonth;
  }
  noteAdded(line, before, from, line.n);
}

/**
 * System 4: each kind whose day falls in `ctx.month` and is not waiting joins the line; the month's
 * new rows are appended in key order after every waiting row (rule 9). Each records (rule 6) the
 * lot, the kind, the day, the key day and key, the bundle's programme ids, the size, the level and
 * the month whose view gave the size. An application whose size and bundle came from a frame
 * before this month's change is re-made or lapses under this month's frame (`remakeRow`). Records
 * `ctx.month` as `line.appliedThrough`.
 */
export function applyLots(ctx: StepCtx, lots: Int32Array): void {
  const { line } = fundOf(ctx.world);
  const rank = ctx.statics.rank;
  const apps: Application[] = [];
  for (const lot of lots) {
    for (const c of clocksOf(ctx, lot, line)) {
      if (c === null || c.day === null || c.month !== ctx.month) continue;
      const ids = ctx.timeline.frameAt(c.viewMonth).finance!.programmes;
      apps.push({
        lot,
        kind: CODE[c.kind],
        applied: c.day,
        keyDay: c.keyDay,
        key: lineKey(c.keyDay, rank[lot], c.kind),
        bundle: c.bundle.map((g) => ids[g].id).join(','),
        f: c.f,
        units: c.units,
        stories: c.stories,
        level: c.level,
        viewMonth: c.viewMonth
      });
    }
  }
  const from = line.n;
  joinLine(line, ctx.month, apps);
  // An application whose lot-month began under an earlier frame (its day falls after a change)
  // carries that frame's size and bundle: it is re-made under this month's frame as a waiting
  // one was by `policyChanged` (rule 17), or lapses (rule 18). The core plans every lot that
  // applied again after `apply`, so a lapsed kind's new spell is read then.
  let remade = false;
  for (let i = from; i < line.n; i++) {
    if (!stale(ctx, line.viewMonth[i])) continue;
    remakeRow(ctx, frameMoney(ctx.timeline, ctx.frame), line, i);
    remade = true;
  }
  if (remade) line.version++;
  line.appliedThrough = ctx.month;
}

/** True when the frame of model month `m` differs from `ctx.frame` in view or money identity. */
function stale(ctx: StepCtx, m: number): boolean {
  const g = ctx.timeline.frameAt(m);
  if (g === ctx.frame) return false;
  return g.view !== ctx.frame.view || !sameMoney(g, ctx.frame, ctx.timeline);
}

/**
 * Re-makes waiting line row `i` of a free lot under `ctx.frame` (rule 17, `remake`): the size the
 * attempt's SIZE draw gives in the frame's view against the lot's existing homes now, and the
 * bundle of its kind that size meets. It lapses when there is no size or no chance in the view,
 * the bundle is empty, or the bundle's level is below the row's; a lapse marks the row `gone` and
 * records the kind's new spell from the month's first day (rule 18). Otherwise the row takes the
 * bundle's ids, the size, the level and `viewMonth = ctx.month`, keeping its place, `month`,
 * `applied`, `keyDay` and `key`. Writes columns directly: the caller bumps `line.version`. True
 * when it lapsed.
 */
export function remakeRow(ctx: StepCtx, fm: FrameMoney, line: FundLine, i: number): boolean {
  const lot = line.lot[i];
  const kind: ProjectKind = line.kind[i] === KIND_AFFORDABLE ? 'affordable' : 'market';
  const spell = spellsOf(ctx, lot)[kind];
  const view = ctx.frame.view;
  const uS = drawOn(spell.stream, P.SIZE, 0);
  const size = sizeIn(ctx.statics, view, ctx.frame.calibration, lot, spell.existing, uS);
  let bundle: number[] = [];
  let level = 0;
  if (size !== null && view.pre.logit[lot] !== -Infinity) {
    bundle = fm.bundleOf(kind, size.units);
    if (bundle.length > 0)
      level = coverageLevel(fm.index.price(kind, bundle, size.protoId).coverage);
  }
  if (size === null || bundle.length === 0 || below(level, line.level[i])) {
    line.gone[i] = 1;
    setSpell(line, lot, line.kind[i], spell.k, ctx.firstDay - 1);
    return true;
  }
  const programmes = fm.fin.programmes;
  line.bundle[i] = bundle.map((g) => programmes[g].id).join(',');
  line.f[i] = size.f;
  line.units[i] = size.units;
  line.stories[i] = size.stories;
  line.level[i] = level;
  line.viewMonth[i] = ctx.month;
  return false;
}

/** Rule 8: marks both of the lot's waiting applications `gone` (through the line's index). */
export function leaveLine(line: FundLine, lot: number): void {
  leaveRows(line, lot);
}
