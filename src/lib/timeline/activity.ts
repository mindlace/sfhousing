/**
 * Activity's list on /sim: the latest stage changes citywide, up to the playhead. The page keeps
 * its own `CityStore`, fed by the same `TimelineUpdate`s it forwards to the map (map-interfaces,
 * "The citywide feed"), and this index over it. Pure TS.
 *
 * Cost: an `apply` only marks the order stale; the first read after it that can show anything
 * (not at today) sorts every event once (O(n log n), n = 3 × rows at most); every read is a binary search plus the few events it returns
 * (O(log n + limit)). Moving the playhead never sorts.
 */
import { CityStore } from '$lib/map/timelapse/city';
import { CITY_DAY, type TimelineUpdate } from '$lib/map/types';
import type { Day } from '$lib/timelapse/time';

export type ActivityKind = 'approved' | 'started' | 'completed';

export interface ActivityEvent {
  row: number;
  kind: ActivityKind;
  day: Day;
  homes: number;
  lngLat: [number, number];
  /** The project is under the person's policy (its flags are set). */
  policy: boolean;
}

/** One marker the index holds, for a reader that wants every project. */
export interface CityMarkerRow {
  row: number;
  lngLat: [number, number];
  /** The completed day; NaN when the project has none (yet). */
  completed: Day;
  /** The final revision's units, capped at 65,535. */
  homes: number;
  /** The homes it replaces after the dataset date (CityDelta.existing). */
  existing: number;
  /** SLOT_FLAG bits (CityDelta.flags): not 0 when the project carries the policy mark. */
  flags: number;
}

export const ACTIVITY_LIMIT = 6;

/** By `CITY_DAY` index (approved 0, started 1, completed 2). */
const KINDS: readonly ActivityKind[] = (['approved', 'started', 'completed'] as const)
  .slice()
  .sort((a, b) => CITY_DAY[a] - CITY_DAY[b]);

/** Event index e = 3 × row + kind (the store's `days` index) fits below this in a packed key. */
const SLOT = 2 ** 18;

export class ActivityIndex {
  #store = new CityStore();
  /** Packed keys, ascending: day × SLOT + (SLOT − 1 − e); null when not packed. */
  #keys: Float64Array | null = null;
  /** Event indices, ascending by (day, −e); used when the events do not pack. */
  #order: Uint32Array | null = null;
  #dirty = true;
  #sorts = 0;

  /** Revision 0: replace (clear when it carries no city); later: apply u.city when present. */
  apply(u: TimelineUpdate): void {
    if (u.revision === 0) {
      if (u.city) this.#store.apply(u.city, true);
      else this.#store.clear();
    } else if (u.city) this.#store.apply(u.city, false);
    else return;
    this.#dirty = true;
  }

  /** Sorts made since construction (a test seam: reads never sort twice for one store state). */
  get sorts(): number {
    return this.#sorts;
  }

  /**
   * The newest `limit` events with after < day <= through, newest first, ties by row then kind.
   * The first read after an apply that can show anything (`through > after`) sorts every
   * (day, event) key once; later reads only search, and a read at today never sorts.
   */
  recent(after: Day, through: Day, limit = ACTIVITY_LIMIT): ActivityEvent[] {
    const out: ActivityEvent[] = [];
    // Nothing can show (at today, or no room): return before sorting.
    if (through <= after || limit <= 0) return out;
    if (this.#dirty) this.#sort();
    const days = this.#store.days;
    if (this.#keys) {
      // Packed days are whole: day <= through is day < floor(through) + 1, day > after likewise.
      const lo = Math.floor(after) + 1;
      const hi = Math.floor(through) + 1;
      const keys = this.#keys;
      const end = lowerBound(keys.length, (i) => keys[i] < hi * SLOT);
      for (let i = end - 1; i >= 0 && out.length < limit; i--) {
        const k = keys[i];
        if (k < lo * SLOT) break;
        out.push(this.#event(SLOT - 1 - (k % SLOT)));
      }
    } else {
      const order = this.#order!;
      const end = lowerBound(order.length, (i) => days[order[i]] <= through);
      for (let i = end - 1; i >= 0 && out.length < limit; i--) {
        const e = order[i];
        if (days[e] <= after) break;
        out.push(this.#event(e));
      }
    }
    return out;
  }

  /** Every marker held, ascending by row. A new array on each call. Never sorts. */
  markers(): CityMarkerRow[] {
    const s = this.#store;
    const out: CityMarkerRow[] = [];
    for (let r = 0; r < s.length; r++) {
      if (!s.has[r]) continue;
      out.push({
        row: r,
        lngLat: [s.lngLat[2 * r], s.lngLat[2 * r + 1]],
        completed: s.days[3 * r + CITY_DAY.completed],
        homes: s.homes[r],
        existing: s.existing[r],
        flags: s.flags[r]
      });
    }
    return out;
  }

  #event(e: number): ActivityEvent {
    const s = this.#store;
    const row = Math.floor(e / 3);
    return {
      row,
      kind: KINDS[e % 3],
      day: s.days[e],
      homes: s.homes[row],
      lngLat: [s.lngLat[2 * row], s.lngLat[2 * row + 1]],
      policy: s.flags[row] !== 0
    };
  }

  #sort(): void {
    this.#dirty = false;
    this.#sorts++;
    const { days, has, length } = this.#store;
    let n = 0;
    let whole = true;
    for (let r = 0; r < length; r++) {
      if (!has[r]) continue;
      for (let k = 0; k < 3; k++) {
        const d = days[3 * r + k];
        if (d !== d) continue; // NaN: not (yet)
        n++;
        if (!Number.isInteger(d) || d < 0) whole = false;
      }
    }
    const events = new Uint32Array(n);
    n = 0;
    for (let r = 0; r < length; r++) {
      if (!has[r]) continue;
      for (let k = 0; k < 3; k++) if (days[3 * r + k] === days[3 * r + k]) events[n++] = 3 * r + k;
    }
    if (whole && 3 * length <= SLOT) {
      // One numeric sort of packed keys: day, then e descending, so a scan from the end gives
      // newest first and, on one day, row then kind ascending.
      const keys = new Float64Array(n);
      for (let i = 0; i < n; i++) keys[i] = days[events[i]] * SLOT + (SLOT - 1 - events[i]);
      keys.sort();
      this.#keys = keys;
      this.#order = null;
    } else {
      events.sort((a, b) => days[a] - days[b] || b - a);
      this.#order = events;
      this.#keys = null;
    }
  }
}

/** The first i in [0, n) where `below(i)` is false (`below` true then false over i). */
function lowerBound(n: number, below: (i: number) => boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (below(mid)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
