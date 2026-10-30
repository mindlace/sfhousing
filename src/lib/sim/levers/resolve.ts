/**
 * Envelope resolution per period (plan 2 ruling 3): the stock blend, then the user layer's edits,
 * then protected lots, which are not redevelopable (partner ruling 2026-10-29): each is reset to
 * its stock-blend row with `hostable` 0, so no new project initiates there (Call 21: in-flight
 * projects carry on). Rows the user layer moves off every stock row need a yield recompute
 * (`Need`); the caller computes those with `envelopeRow` and hands them back to `fillNeeds`.
 * Worker-safe.
 */
import { NULL_CAP } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { EnvelopeRow } from '$lib/data/envelope-row';
import type { Day } from '$lib/timelapse/types';
import {
  blendStock,
  currentLawAfterTable,
  currentLawTable,
  stockTable,
  type EnvelopeTable,
  type LayerCtx,
  type Period
} from './layers';
import { STOCK_LAYERS, type Protections, type SimLevers } from './types';

/** A lot whose final (stories, cap) is on none of its stock rows: its yield is computed outside. */
export interface Need {
  row: number;
  stories: number;
  cap: number | null;
}
export const needKey = (n: Need): string => `${n.row}:${n.stories}:${n.cap ?? 'n'}`;

/** A Need row's yield and hostable are 0 until `fillNeeds`. */
export interface PeriodResolution {
  table: EnvelopeTable;
  needs: Need[];
}

export interface Resolution {
  before: PeriodResolution;
  after: { day: Day; period: PeriodResolution } | null;
  /** The same plan with protections off. */
  unprotected: { before: PeriodResolution; after: PeriodResolution | null };
  /** The law `before` was resolved under: 'after' when the switch is on or before `asOf`. */
  beforePeriod: Period;
  protectedRows: Int32Array;
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

interface ResolveWindow {
  asOf: Day;
  horizon: Day;
  switchDay: Day;
}

function resolvePeriod(
  ctx: LayerCtx,
  levers: SimLevers,
  period: Period,
  protect: Int32Array | null
): PeriodResolution {
  const F = ctx.parcels.fillLevels.length;
  const assume = levers.assumeAlternativePlanKept;
  const table = blendStock(ctx, levers.stock, period, assume);
  const current = currentLawTable(ctx, period, assume);
  const blendStories = table.stories.slice();
  const blendCap = table.cap.slice();
  const blendYield = protect && protect.length > 0 ? table.yield.slice() : null;
  const touched = new Uint8Array(table.count);

  for (const e of levers.user) {
    for (const id of e.lots) {
      const i = ctx.parcels.index.get(id);
      if (i === undefined) continue;
      const s = table.stories[i];
      table.stories[i] =
        e.mode === 'raise'
          ? Math.max(s, e.stories)
          : e.mode === 'lower'
            ? Math.min(s, e.stories)
            : e.stories;
      table.cap[i] = e.densityLimits ? current.cap[i] : NULL_CAP;
      touched[i] = 1;
    }
  }
  if (protect && blendYield) {
    // Not redevelopable: the blend's row, never hostable, and never a Need.
    for (const i of protect) {
      table.stories[i] = blendStories[i];
      table.cap[i] = blendCap[i];
      table.yield.set(blendYield.subarray(i * F, i * F + F), i * F);
      table.hostable[i] = 0;
      touched[i] = 0;
    }
  }

  const candidates = [...STOCK_LAYERS.map((id) => stockTable(ctx, id)), currentLawAfterTable(ctx)];
  const needs: Need[] = [];
  for (let i = 0; i < table.count; i++) {
    if (!touched[i]) continue;
    const stories = table.stories[i];
    const cap = table.cap[i];
    if (stories === blendStories[i] && cap === blendCap[i]) continue; // still the blended row
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

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Row for row: stories, cap, yields and hostable. An unfilled Need row reads as 0 in both. */
function sameTable(a: EnvelopeTable, b: EnvelopeTable): boolean {
  return (
    a.count === b.count &&
    sameArray(a.stories, b.stories) &&
    sameArray(a.cap, b.cap) &&
    sameArray(a.hostable, b.hostable) &&
    sameArray(a.yield, b.yield)
  );
}

export function resolveEnvelopes(
  ctx: LayerCtx,
  levers: SimLevers,
  window: ResolveWindow
): Resolution {
  const { rows, unknown } = protectedRows(ctx, levers.protect, window.asOf);
  const assume = levers.assumeAlternativePlanKept;
  const switched = !assume && window.switchDay <= window.asOf;
  const beforePeriod: Period = switched ? 'after' : 'before';
  // The switch is resolved whenever it falls inside the window, and dropped when it changes no
  // row: whether a run switches depends only on whether the envelopes differ, not on which levers
  // read current law (the currentLaw stock, capped user edits). A protected row is its blend row
  // in both periods, so protections alone never switch.
  const inWindow = !assume && window.asOf < window.switchDay && window.switchDay <= window.horizon;

  const before = resolvePeriod(ctx, levers, beforePeriod, rows);
  const unprotectedBefore =
    rows.length === 0 ? before : resolvePeriod(ctx, levers, beforePeriod, null);
  let after = inWindow ? resolvePeriod(ctx, levers, 'after', rows) : null;
  let unprotectedAfter = !after
    ? null
    : rows.length === 0
      ? after
      : resolvePeriod(ctx, levers, 'after', null);
  if (
    after &&
    unprotectedAfter &&
    sameTable(after.table, before.table) &&
    sameTable(unprotectedAfter.table, unprotectedBefore.table)
  ) {
    after = null;
    unprotectedAfter = null;
  }
  return {
    before,
    after: after ? { day: window.switchDay, period: after } : null,
    unprotected: { before: unprotectedBefore, after: unprotectedAfter },
    beforePeriod,
    protectedRows: rows,
    unknownLots: unknown
  };
}

/** Every Need in the resolution, once per key, sorted by (row, stories, cap). */
export function allNeeds(r: Resolution): Need[] {
  const seen = new Map<string, Need>();
  const periods = [r.before, r.after?.period, r.unprotected.before, r.unprotected.after];
  for (const p of periods) if (p) for (const n of p.needs) seen.set(needKey(n), n);
  const capOf = (n: Need) => n.cap ?? Infinity;
  return [...seen.values()].sort(
    (a, b) => a.row - b.row || a.stories - b.stories || capOf(a) - capOf(b)
  );
}

/** A copy of the resolution with every Need's yield and hostable written in. Throws on a missing row. */
export function fillNeeds(r: Resolution, rows: ReadonlyMap<string, EnvelopeRow>): Resolution {
  const done = new Map<PeriodResolution, PeriodResolution>();
  const fill = (p: PeriodResolution): PeriodResolution => {
    const hit = done.get(p);
    if (hit) return hit;
    const t = p.table;
    const F = t.count === 0 ? 0 : t.yield.length / t.count;
    const table: EnvelopeTable = {
      count: t.count,
      stories: t.stories.slice(),
      cap: t.cap.slice(),
      yield: t.yield.slice(),
      hostable: t.hostable.slice()
    };
    for (const n of p.needs) {
      const row = rows.get(needKey(n));
      if (!row) throw new Error(`fillNeeds: no envelope row for need ${needKey(n)}`);
      if (row.yield.length !== F)
        throw new Error(`fillNeeds: need ${needKey(n)} has ${row.yield.length} yields, not ${F}`);
      table.yield.set(row.yield, n.row * F);
      table.hostable[n.row] = row.hostable ? 1 : 0;
    }
    const out = { table, needs: p.needs };
    done.set(p, out);
    return out;
  };
  const before = fill(r.before);
  const after = r.after ? { day: r.after.day, period: fill(r.after.period) } : null;
  return {
    ...r,
    before,
    after,
    unprotected: {
      before: fill(r.unprotected.before),
      after: r.unprotected.after ? fill(r.unprotected.after) : null
    }
  };
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
  afterSwitch: { plan: number; withoutProtections: number } | null;
}

/** Call on a filled resolution: an unfilled Need counts as no capacity. */
export function leverCapacity(r: Resolution, parcels: ScenarioParcels): LeverCapacity {
  return {
    plan: netCapacity(r.before.table, parcels),
    withoutProtections: netCapacity(r.unprotected.before.table, parcels),
    protectedLots: r.protectedRows.length,
    afterSwitch:
      r.after && r.unprotected.after
        ? {
            plan: netCapacity(r.after.period.table, parcels),
            withoutProtections: netCapacity(r.unprotected.after.table, parcels)
          }
        : null
  };
}
