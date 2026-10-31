/**
 * Envelope resolution (sim runs spec, section 3): FZP as written, then the rules (each lot takes
 * the highest rule that names it, uncapped where that raises it above FZP, whatever their order),
 * then custom paint in document order (it sets N uncapped, raising or lowering; a later stroke
 * wins), then protected lots, which are not redevelopable (partner ruling 2026-10-29): each is
 * reset to its FZP row with `hostable` 0, so no new project initiates there (Call 21: in-flight
 * projects carry on). Rows moved off their FZP and base rows need a yield recompute (`Need`);
 * the caller computes those with `envelopeRow` and hands them back to `fillNeeds`. Worker-safe.
 */
import { NULL_CAP } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { EnvelopeRow } from '$lib/data/envelope-row';
import type { Day } from '$lib/timelapse/types';
import { stockTable, type EnvelopeTable, type LayerCtx } from './layers';
import type { Protections, SimLevers } from './types';

/** A lot whose final (stories, cap) is on neither its FZP nor its base row: its yield is computed outside. */
export interface Need {
  row: number;
  stories: number;
  cap: number | null;
}
export const needKey = (n: Need): string => `${n.row}:${n.stories}:${n.cap ?? 'n'}`;

/** A Need row's yield and hostable are 0 until `fillNeeds`. */
export interface ResolvedTable {
  table: EnvelopeTable;
  needs: Need[];
}

export interface Resolution {
  plan: ResolvedTable;
  /** The same plan with protections off; `=== plan` when no row is protected. */
  unprotected: ResolvedTable;
  protectedRows: Int32Array;
  /** Distinct lot ids named in rules, paint and protect.lots that are not in the dataset. */
  unknownLots: number;
}

const yearOf = (day: Day) => new Date(day * 86400000).getUTCFullYear();

/** Rows protected as of `asOf` (ascending, unique) and the count of named lots not in the dataset. */
export function protectedRows(
  ctx: LayerCtx,
  p: Protections,
  asOf: Day
): { rows: Int32Array; unknown: number } {
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
  const unknownIds = new Set<string>();
  for (const id of p.lots) {
    const i = parcels.index.get(id);
    if (i === undefined) unknownIds.add(id);
    else mark[i] = 1;
  }
  const rows: number[] = [];
  for (let i = 0; i < mark.length; i++) if (mark[i]) rows.push(i);
  return { rows: Int32Array.from(rows), unknown: unknownIds.size };
}

/** A fresh copy of a table (`stockTable` returns views over the decoded columns). */
function copyTable(t: EnvelopeTable): EnvelopeTable {
  return {
    count: t.count,
    stories: t.stories.slice(),
    cap: t.cap.slice(),
    yield: t.yield.slice(),
    hostable: t.hostable.slice()
  };
}

function resolvePlan(ctx: LayerCtx, levers: SimLevers, protect: Int32Array | null): ResolvedTable {
  const F = ctx.parcels.fillLevels.length;
  const index = ctx.parcels.index;
  const fzp = stockTable(ctx, 'fzp');
  const table = copyTable(fzp);
  const touched = new Uint8Array(table.count);

  // Rules: max over the rules naming the lot, so their order does not matter.
  const highest = new Map<number, number>();
  for (const e of levers.rules)
    for (const id of e.lots) {
      const i = index.get(id);
      if (i === undefined) continue;
      highest.set(i, Math.max(highest.get(i) ?? 0, e.stories));
    }
  for (const [i, n] of highest)
    if (n > table.stories[i]) {
      table.stories[i] = n;
      table.cap[i] = NULL_CAP;
      touched[i] = 1;
    }
  // Paint: sets N, in document order.
  for (const e of levers.paint)
    for (const id of e.lots) {
      const i = index.get(id);
      if (i === undefined) continue;
      table.stories[i] = e.stories;
      table.cap[i] = NULL_CAP;
      touched[i] = 1;
    }
  if (protect)
    // Not redevelopable: the FZP row, never hostable, and never a Need.
    for (const i of protect) {
      table.stories[i] = fzp.stories[i];
      table.cap[i] = fzp.cap[i];
      table.yield.set(fzp.yield.subarray(i * F, i * F + F), i * F);
      table.hostable[i] = 0;
      touched[i] = 0;
    }

  // The SB 79 and current-law rows follow other yield rules than `envelopeRow` (sim-levers.md,
  // "Resolution order"), so only the FZP and base rows are reused.
  const candidates = [fzp, stockTable(ctx, 'base')];
  const needs: Need[] = [];
  for (let i = 0; i < table.count; i++) {
    if (!touched[i]) continue;
    const stories = table.stories[i];
    const cap = table.cap[i];
    if (stories === fzp.stories[i] && cap === fzp.cap[i]) continue; // still the FZP row
    if (stories === 0) {
      table.yield.fill(0, i * F, i * F + F);
      table.hostable[i] = 0;
      continue;
    }
    const hit = candidates.find((t) => t.stories[i] === stories && t.cap[i] === cap);
    if (hit) {
      table.hostable[i] = hit.hostable[i];
      table.yield.set(hit.yield.subarray(i * F, i * F + F), i * F);
      continue;
    }
    table.yield.fill(0, i * F, i * F + F);
    table.hostable[i] = 0;
    needs.push({ row: i, stories, cap: cap === NULL_CAP ? null : cap });
  }
  return { table, needs };
}

export function resolveEnvelopes(ctx: LayerCtx, levers: SimLevers, asOf: Day): Resolution {
  const { rows } = protectedRows(ctx, levers.protect, asOf);
  // One set across rules, paint and protections, so a lot named in several counts once.
  const unknown = new Set<string>();
  const index = ctx.parcels.index;
  for (const e of [...levers.rules, ...levers.paint, { lots: levers.protect.lots }])
    for (const id of e.lots) if (!index.has(id)) unknown.add(id);
  const plan = resolvePlan(ctx, levers, rows.length > 0 ? rows : null);
  return {
    plan,
    unprotected: rows.length === 0 ? plan : resolvePlan(ctx, levers, null),
    protectedRows: rows,
    unknownLots: unknown.size
  };
}

/** Every Need in the resolution, once per key, sorted by (row, stories, cap). */
export function allNeeds(r: Resolution): Need[] {
  const seen = new Map<string, Need>();
  for (const p of [r.plan, r.unprotected]) for (const n of p.needs) seen.set(needKey(n), n);
  const capOf = (n: Need) => n.cap ?? Infinity;
  return [...seen.values()].sort(
    (a, b) => a.row - b.row || a.stories - b.stories || capOf(a) - capOf(b)
  );
}

/** A copy of the resolution with every Need's yield and hostable written in. Throws on a missing row. */
export function fillNeeds(r: Resolution, rows: ReadonlyMap<string, EnvelopeRow>): Resolution {
  const fill = (p: ResolvedTable): ResolvedTable => {
    const t = p.table;
    const F = t.count === 0 ? 0 : t.yield.length / t.count;
    const table = copyTable(t);
    for (const n of p.needs) {
      const row = rows.get(needKey(n));
      if (!row) throw new Error(`fillNeeds: no envelope row for need ${needKey(n)}`);
      if (row.yield.length !== F)
        throw new Error(`fillNeeds: need ${needKey(n)} has ${row.yield.length} yields, not ${F}`);
      table.yield.set(row.yield, n.row * F);
      table.hostable[n.row] = row.hostable ? 1 : 0;
    }
    return { table, needs: p.needs };
  };
  const plan = fill(r.plan);
  return { ...r, plan, unprotected: r.unprotected === r.plan ? plan : fill(r.unprotected) };
}

/** Static net capacity: Σ over hostable lots of max(0, full-fill yield − existing homes). */
export function netCapacity(t: EnvelopeTable, parcels: ScenarioParcels): number {
  const F = parcels.fillLevels.length;
  let sum = 0;
  for (let i = 0; i < t.count; i++)
    if (t.hostable[i] === 1) sum += Math.max(0, t.yield[i * F + F - 1] - parcels.existingUnits[i]);
  return sum;
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

/** Call on a filled resolution: an unfilled Need counts as no capacity. */
export function leverCapacity(r: Resolution, parcels: ScenarioParcels): LeverCapacity {
  return {
    plan: netCapacity(r.plan.table, parcels),
    withoutProtections: netCapacity(r.unprotected.table, parcels),
    protectedLots: r.protectedRows.length
  };
}
