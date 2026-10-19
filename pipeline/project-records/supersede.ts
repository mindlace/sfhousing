/**
 * Supersession of refiled in-flight Planning projects (spec 4.7, partner ruling 3, Ruling SP1;
 * rule `pr.projects.superseded`). Two in-flight PRJ-anchored T3 projects describe the same project
 * when their labels are equal (street address upper-cased, whitespace collapsed), their parcels
 * share a block, and their units are within 25%. The latest one is kept. Pure.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Day } from '../../src/lib/timelapse/time';

export interface SupersedeCandidate {
  /** T3 id. */
  id: string;
  /** The primary Planning record id (split parts of one PRJ share it). */
  recordId: string;
  /** The T3 label (spec 4.8). */
  label: string | null;
  parcelIds: readonly ParcelId[];
  units: number;
  /** The primary Planning record's open day. */
  openDay: Day | null;
}

/** Ruling SP1: units match when the smaller is at least this share of the larger. */
export const SUPERSEDE_UNITS_SHARE = 0.75;

/** A parcel id's block: its `^\d{4}[A-Z]?` prefix (as link.ts `blockOf`). */
function blockOf(id: ParcelId): string {
  return /^\d{4}[A-Z]?/.exec(id)?.[0] ?? id;
}

/** Upper-cased with whitespace collapsed; null for a blank label or one starting '0 UNKNOWN'. */
export function normalisedLabel(label: string | null): string | null {
  if (label === null) return null;
  const s = label.trim().replace(/\s+/g, ' ').toUpperCase();
  if (s === '' || s.startsWith('0 UNKNOWN')) return null;
  return s;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Later first: the latest primary open day (null earliest), ties to the higher record id. */
function laterFirst(a: SupersedeCandidate, b: SupersedeCandidate): number {
  const da = a.openDay ?? -Infinity;
  const db = b.openDay ?? -Infinity;
  return db - da || cmp(b.recordId, a.recordId) || cmp(b.id, a.id);
}

function sameProject(a: SupersedeCandidate, b: SupersedeCandidate): boolean {
  if (a.recordId === b.recordId) return false; // split parts of one Planning record
  const blocks = new Set(a.parcelIds.map(blockOf));
  if (!b.parcelIds.some((id) => blocks.has(blockOf(id)))) return false;
  const lo = Math.min(a.units, b.units);
  const hi = Math.max(a.units, b.units);
  return lo >= SUPERSEDE_UNITS_SHARE * hi;
}

/**
 * Within each normalised-label group, candidates are taken latest first; each is superseded by
 * the first kept candidate it matches (same block, units within 25%), else it is kept. A chain is
 * therefore resolved against kept projects only, in a fixed order. `superseded` maps each
 * superseded id to its keeper, in id order; `tested` is the number of candidates.
 */
export function supersessions(candidates: readonly SupersedeCandidate[]): {
  superseded: Map<string, string>;
  tested: number;
} {
  const groups = new Map<string, SupersedeCandidate[]>();
  for (const c of candidates) {
    const key = normalisedLabel(c.label);
    if (key === null) continue;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  const pairs: [string, string][] = [];
  for (const group of groups.values()) {
    const kept: SupersedeCandidate[] = [];
    for (const c of [...group].sort(laterFirst)) {
      const keeper = kept.find((k) => sameProject(c, k));
      if (keeper === undefined) kept.push(c);
      else pairs.push([c.id, keeper.id]);
    }
  }
  pairs.sort((x, y) => cmp(x[0], y[0]));
  return { superseded: new Map(pairs), tested: candidates.length };
}
