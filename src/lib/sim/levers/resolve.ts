/**
 * Envelope resolution (sim runs spec, section 3): FZP as written, then the rules (each lot takes
 * the highest rule that names it, uncapped where that raises it above FZP, whatever their order),
 * then custom paint in document order (it sets N uncapped, raising or lowering; a later stroke
 * wins), then protected lots, which are not redevelopable (partner ruling 2026-10-29): each is
 * reset to its FZP row with `hostable` 0, so no new project initiates there (Call 21: in-flight
 * projects carry on). A lot's homes at any (stories, cap) are its options' (options.bin), so no
 * envelope needs a recompute. Capacity is rule A: the most homes an allowed option holds after the
 * cap, less the homes there now. Worker-safe.
 */
import type { OptionTable } from '$lib/data/option-table';
import { NULL_CAP } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { allowedCount, capFrom, topHomes } from '$lib/sim/choice/choose';
import type { Day } from '$lib/timelapse/types';
import { stockTable, type EnvelopeTable, type LayerCtx } from './layers';
import type { Protections, SimLevers } from './types';

export interface ResolvedTable {
  table: EnvelopeTable;
}

export interface Resolution {
  plan: ResolvedTable;
  /** The same plan with protections off; `=== plan` when no row is protected. */
  unprotected: ResolvedTable;
  protectedRows: Int32Array;
  /** Distinct lot ids named in rules and paint that are not in the dataset. */
  unknownLots: number;
}

const yearOf = (day: Day) => new Date(day * 86400000).getUTCFullYear();

/** Rows protected as of `asOf` (ascending, unique): the categories, read from the dataset. */
export function protectedRows(ctx: LayerCtx, p: Protections, asOf: Day): Int32Array {
  const { parcels, policy } = ctx;
  const mark = new Uint8Array(parcels.count);
  if (p.rentControl)
    for (let i = 0; i < mark.length; i++) if (parcels.rentControlLikely[i]) mark[i] = 1;
  if (p.historic)
    for (let i = 0; i < mark.length; i++) if (policy.historicProtected[i]) mark[i] = 1;
  if (p.newerThanYears !== null) {
    const from = yearOf(asOf) - p.newerThanYears;
    for (let i = 0; i < mark.length; i++) {
      const y = parcels.yearBuilt[i];
      if (y > 0 && y >= from) mark[i] = 1;
    }
  }
  const rows: number[] = [];
  for (let i = 0; i < mark.length; i++) if (mark[i]) rows.push(i);
  return Int32Array.from(rows);
}

/** A fresh copy of a table (`stockTable` returns views over the decoded columns). */
function copyTable(t: EnvelopeTable): EnvelopeTable {
  return {
    count: t.count,
    stories: t.stories.slice(),
    cap: t.cap.slice(),
    hostable: t.hostable.slice()
  };
}

function resolvePlan(ctx: LayerCtx, levers: SimLevers, protect: Int32Array | null): ResolvedTable {
  const { index, eligible } = ctx.parcels;
  const fzp = stockTable(ctx, 'fzp');
  const table = copyTable(fzp);

  /**
   * A lot moved off its FZP row may host when it is eligible and keeps at least one story; one
   * that lands back on its FZP row (same stories, no cap either way) keeps the FZP row's flag.
   */
  const set = (i: number, stories: number) => {
    table.stories[i] = stories;
    table.cap[i] = NULL_CAP;
    const same = stories === fzp.stories[i] && fzp.cap[i] === NULL_CAP;
    table.hostable[i] = same ? fzp.hostable[i] : eligible[i] === 1 && stories >= 1 ? 1 : 0;
  };
  // Rules: max over the rules naming the lot, so their order does not matter.
  const highest = new Map<number, number>();
  for (const e of levers.rules)
    for (const id of e.lots) {
      const i = index.get(id);
      if (i === undefined) continue;
      highest.set(i, Math.max(highest.get(i) ?? 0, e.stories));
    }
  for (const [i, n] of highest) if (n > table.stories[i]) set(i, n);
  // Paint: sets N, in document order.
  for (const e of levers.paint)
    for (const id of e.lots) {
      const i = index.get(id);
      if (i !== undefined) set(i, e.stories);
    }
  if (protect)
    // Not redevelopable: the FZP row, never hostable.
    for (const i of protect) {
      table.stories[i] = fzp.stories[i];
      table.cap[i] = fzp.cap[i];
      table.hostable[i] = 0;
    }
  return { table };
}

export function resolveEnvelopes(ctx: LayerCtx, levers: SimLevers, asOf: Day): Resolution {
  const rows = protectedRows(ctx, levers.protect, asOf);
  // One set across rules and paint, so a lot named in both counts once.
  const unknown = new Set<string>();
  const index = ctx.parcels.index;
  for (const e of [...levers.rules, ...levers.paint])
    for (const id of e.lots) if (!index.has(id)) unknown.add(id);
  const plan = resolvePlan(ctx, levers, rows.length > 0 ? rows : null);
  return {
    plan,
    unprotected: rows.length === 0 ? plan : resolvePlan(ctx, levers, null),
    protectedRows: rows,
    unknownLots: unknown.size
  };
}

/**
 * Rule A's capacity of one lot: the most homes after the cap among the options its envelope allows,
 * less the homes there now, never below 0. What a lot can hold, not what a developer builds.
 */
export function lotCapacity(
  t: OptionTable,
  lot: number,
  stories: number,
  cap: number,
  existing: number
): number {
  return Math.max(
    0,
    topHomes(t, lot, allowedCount(t, lot, stories), capFrom(cap), existing) - existing
  );
}

/** Static net capacity (rule A): Σ over the table's hostable lots of `lotCapacity`. */
export function netCapacity(
  t: EnvelopeTable,
  parcels: ScenarioParcels,
  options: OptionTable
): number {
  let sum = 0;
  for (let i = 0; i < t.count; i++)
    if (t.hostable[i] === 1)
      sum += lotCapacity(options, i, t.stories[i], t.cap[i], parcels.existingUnits[i]);
  return sum;
}

/**
 * Rule A's capacity of a zoning view: `netCapacity` over its own envelope, cap and hosting
 * columns. The room box, `leverCapacity` and the runner's `capacity()` count the same way.
 */
export function capacityOf(view: {
  parcels: ScenarioParcels;
  pre: { choice: { t: OptionTable } };
}): number {
  const p = view.parcels;
  const t = { count: p.count, stories: p.envelopeStories, cap: p.fzpCap, hostable: p.hostable };
  return netCapacity(t, p, view.pre.choice.t);
}

/**
 * Static net capacity with and without protections. Protected rows are not hostable, so
 * `withoutProtections - plan` is the protected rows' unprotected capacity, never negative.
 */
export interface LeverCapacity {
  plan: number;
  withoutProtections: number;
  protectedLots: number;
}

export function leverCapacity(r: Resolution, ctx: LayerCtx): LeverCapacity {
  return {
    plan: netCapacity(r.plan.table, ctx.parcels, ctx.options),
    withoutProtections: netCapacity(r.unprotected.table, ctx.parcels, ctx.options),
    protectedLots: r.protectedRows.length
  };
}
