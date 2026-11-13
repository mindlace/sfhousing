// Planning and making applications (spec rules 5, 6, 8, 9): which model month a free lot applies
// in, the rows it adds to the funding line, and its leaving the line.
import { lineKey } from '$lib/sim/scenario/funded';
import { seedHash, streamOf } from '$lib/sim/scenario/rng';
import type { ProjectKind } from '$lib/timelapse/types';
import { lotRow } from '../columns';
import { lotEntity } from '../rates';
import { NO_DAY, type StepCtx, type World } from '../types';
import { kindClock, type KindClock, type Spell } from './clocks';
import {
  KIND_AFFORDABLE,
  KIND_MARKET,
  addLineRow,
  fundOf,
  spellOf,
  type FundLine
} from './columns';

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
  if (line === null) return false;
  for (let i = 0; i < line.n; i++) {
    if (line.lot[i] === lot && line.kind[i] === kind && line.gone[i] === 0) return true;
  }
  return false;
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

/** The waiting (not `gone`) applications of `line` as `lot * 2 + kind` (kind codes are 0 and 1). */
function waitingSet(line: FundLine): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < line.n; i++) if (line.gone[i] === 0) out.add(line.lot[i] * 2 + line.kind[i]);
  return out;
}

/**
 * Each kind's clock read through `ctx.month`, null for a kind already waiting. `held` is
 * `waitingSet(line)` when the caller asks for many lots of one unchanged line.
 */
function clocksOf(
  ctx: StepCtx,
  lot: number,
  line: FundLine | null,
  held: Set<number> | null = null
): (KindClock | null)[] {
  const spells = spellsOf(ctx, lot);
  const sh = seedHash(ctx.seed);
  return KINDS.map((kind) =>
    (held === null ? waiting(line, lot, CODE[kind]) : held.has(lot * 2 + CODE[kind]))
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
}

/**
 * System 4: each kind whose day falls in `ctx.month` and is not waiting joins the line; the month's
 * new rows are appended in key order after every waiting row (rule 9). Each records (rule 6) the
 * lot, the kind, the day, the key day and key, the bundle's programme ids, the size, the level and
 * the month whose view gave the size. Records `ctx.month` as `line.appliedThrough`.
 */
export function applyLots(ctx: StepCtx, lots: Int32Array): void {
  const { line } = fundOf(ctx.world);
  const rank = ctx.statics.rank;
  const apps: Application[] = [];
  // The line does not change until `joinLine` below: one index of its waiting rows serves all lots.
  const held = waitingSet(line);
  for (const lot of lots) {
    for (const c of clocksOf(ctx, lot, line, held)) {
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
  joinLine(line, ctx.month, apps);
  line.appliedThrough = ctx.month;
}

/** Rule 8: marks both of the lot's waiting applications `gone`. */
export function leaveLine(line: FundLine, lot: number): void {
  for (let i = 0; i < line.n; i++) if (line.lot[i] === lot) line.gone[i] = 1;
}
