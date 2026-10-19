/**
 * Placeholder valuations (rule `pr.permits.placeholder-valuation`, main's ruling 4, partner
 * Ruling PV1). A `revised_cost` under $1,000 on a permit's lead row is a placeholder; parse keeps
 * today's value (the permit's own `estimated_cost` as recorded) and the fill candidates it found.
 * After linking, each placeholder takes the first real valuation (at least $1,000) of: (a) its own
 * `estimated_cost`; (b) another row of the same permit (its `revised_cost`, else its
 * `estimated_cost`); (c) the permit of the same linked project nearest by filed day that has a
 * real valuation of its own (its `revised_cost`, else its `estimated_cost`; ties to the later
 * filed, then the lowest number). With none, today's value stays (null: no valuation, the middle
 * bracket). The valuation feeds only the SFBC 106A.4.4 brackets (expiry.ts, stale.ts).
 */
import type { Day } from '../../src/lib/timelapse/time';
import type { LinkedProject, Permit } from './types';

/** Below this, a value is a placeholder, not a valuation (main's ruling 4; tier 4). */
export const PLACEHOLDER_REVISED_COST = 1000;

/** At least $1,000 (Ruling PV1), else null. */
export function realValue(v: number | null): number | null {
  return v !== null && v >= PLACEHOLDER_REVISED_COST ? v : null;
}

/** A permit's own real valuation, before any fill: a real revised cost, else a real estimate. */
function ownReal(q: Permit): number | null {
  if (q.placeholder) return realValue(q.placeholder.estimate);
  return realValue(q.valuation);
}

export type FillSource = 'ownEstimate' | 'ownRows' | 'projectPermit';

/** Ruling PV1 (c): the nearest permit of the project with a real valuation of its own. */
function nearest(q: Permit, others: readonly Permit[]): number | null {
  let best: { q: Permit; v: number; d: number } | null = null;
  for (const o of others) {
    if (o === q || o.number === q.number) continue;
    const v = ownReal(o);
    if (v === null) continue;
    const d =
      q.filedDay === null || o.filedDay === null ? Infinity : Math.abs(o.filedDay - q.filedDay);
    const later = (a: Day | null, b: Day | null) => (a ?? -Infinity) > (b ?? -Infinity);
    if (
      best === null ||
      d < best.d ||
      (d === best.d &&
        (later(o.filedDay, best.q.filedDay) ||
          (o.filedDay === best.q.filedDay && o.number < best.q.number)))
    ) {
      best = { q: o, v, d };
    }
  }
  return best?.v ?? null;
}

/**
 * Fills every placeholder valuation of the linked projects in place (projects in id order; a
 * permit is filled once). Returns the fill source per permit number, and the unfilled numbers.
 */
export function fillPlaceholderValuations(projects: readonly LinkedProject[]): {
  filled: Map<string, FillSource>;
  unfilled: Set<string>;
} {
  const filled = new Map<string, FillSource>();
  const unfilled = new Set<string>();
  const done = new Set<Permit>();
  const sorted = [...projects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const proj of sorted) {
    for (const q of proj.permits) {
      if (!q.placeholder || done.has(q)) continue;
      done.add(q);
      const own = realValue(q.placeholder.estimate);
      if (own !== null) {
        filled.set(q.number, 'ownEstimate');
        continue; // today's value is the estimate already
      }
      const rows = realValue(q.placeholder.otherRows);
      const near = rows === null ? nearest(q, proj.permits) : null;
      if (rows !== null) {
        q.valuation = rows;
        filled.set(q.number, 'ownRows');
      } else if (near !== null) {
        q.valuation = near;
        filled.set(q.number, 'projectPermit');
      } else {
        unfilled.add(q.number);
      }
    }
  }
  return { filled, unfilled };
}
