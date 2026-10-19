/**
 * Supersession of refiled in-flight Planning projects (spec 4.7, partner ruling 3, Rulings SP1 and
 * SP2; rule `pr.projects.superseded`). Two in-flight PRJ-anchored T3 projects describe the same
 * project when their addresses are equal (the primary PRJ `project_address`, else the T3 label;
 * upper-cased, whitespace collapsed, a trailing 5-digit ZIP stripped), their parcels share a
 * block, their units are within 25%, and one primary PRJ opened strictly later (a same-day filing
 * is a sibling building, never a refile). The later one is kept. Pure.
 */
import type { ParcelId } from '../../src/lib/data/parcel';
import type { Day } from '../../src/lib/timelapse/time';

export interface SupersedeCandidate {
  /** T3 id. */
  id: string;
  /** The primary Planning record id (split parts of one PRJ share it). */
  recordId: string;
  /** The primary Planning record's `project_address` (Ruling SP2). */
  address: string | null;
  /** The T3 label (spec 4.8): the address when the primary PRJ has none. */
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

/**
 * Upper-cased, whitespace collapsed, a trailing 5-digit ZIP stripped (Ruling SP2); null for a
 * blank address or one starting '0 UNKNOWN'.
 */
export function normalisedAddress(address: string | null): string | null {
  if (address === null) return null;
  const s = address
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .replace(/ \d{5}$/, '');
  if (s === '' || /^\d{5}$/.test(s) || s.startsWith('0 UNKNOWN')) return null;
  return s;
}

/** Ruling SP2: the primary PRJ's address, else the T3 label, normalised. */
export function supersedeKey(c: Pick<SupersedeCandidate, 'address' | 'label'>): string | null {
  return normalisedAddress(c.address) ?? normalisedAddress(c.label);
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Later first: the latest primary open day (null earliest), ties to the higher record id. */
function laterFirst(a: SupersedeCandidate, b: SupersedeCandidate): number {
  const da = a.openDay ?? -Infinity;
  const db = b.openDay ?? -Infinity;
  return db - da || cmp(b.recordId, a.recordId) || cmp(b.id, a.id);
}

/** `keeper` supersedes `c`: a refile of it (Rulings SP1, SP2). */
function refiles(c: SupersedeCandidate, keeper: SupersedeCandidate): boolean {
  if (c.recordId === keeper.recordId) return false; // split parts of one Planning record
  // Ruling SP2: a strictly later primary open day; same-day filings are sibling buildings.
  if (keeper.openDay === null || (c.openDay !== null && keeper.openDay <= c.openDay)) return false;
  const blocks = new Set(c.parcelIds.map(blockOf));
  if (!keeper.parcelIds.some((id) => blocks.has(blockOf(id)))) return false;
  const lo = Math.min(c.units, keeper.units);
  const hi = Math.max(c.units, keeper.units);
  return lo >= SUPERSEDE_UNITS_SHARE * hi;
}

/**
 * Within each address group (`supersedeKey`), candidates are taken latest first; each is superseded
 * by the first kept candidate it matches (strictly later open day, same block, units within 25%),
 * else it is kept. A chain is
 * therefore resolved against kept projects only, in a fixed order. `superseded` maps each
 * superseded id to its keeper, in id order; `tested` is the number of candidates.
 */
export function supersessions(candidates: readonly SupersedeCandidate[]): {
  superseded: Map<string, string>;
  tested: number;
} {
  const groups = new Map<string, SupersedeCandidate[]>();
  for (const c of candidates) {
    const key = supersedeKey(c);
    if (key === null) continue;
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }
  const pairs: [string, string][] = [];
  for (const group of groups.values()) {
    const kept: SupersedeCandidate[] = [];
    for (const c of [...group].sort(laterFirst)) {
      const keeper = kept.find((k) => refiles(c, k));
      if (keeper === undefined) kept.push(c);
      else pairs.push([c.id, keeper.id]);
    }
  }
  pairs.sort((x, y) => cmp(x[0], y[0]));
  return { superseded: new Map(pairs), tested: candidates.length };
}
