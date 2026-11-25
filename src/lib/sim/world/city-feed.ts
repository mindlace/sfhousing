// city-feed (map-citywide slice 6): one marker per project row of the plan world that has a T11
// lot, loaded cell or not, for the page's citywide rings and edge glows. Composed by
// `createMapStream`, so it rides the stream's updates, revisions, resync and rewind.
//
// - A row's marker: its anchor lot's label point, the approved day (the first of entitled and
//   permitIssued entered), the started day (construction), the completed day (a complete end), the
//   final revision's homes (capped at 65,535; below 0 sent as 0), the homes the project replaces
//   after the dataset date (0 until its construction starts after it; capped at 65,535) and the
//   `SLOT_FLAG` bits. Days, homes, existing and flags come from `scheduleAt(world, statics, row,
//   day)`, the read the cells are packed from, so a marker's days are its slot's whenever both
//   exist. While `scheduleAt` is null (the row has not begun) the days are NaN and homes,
//   existing and flags 0. A row with no anchor (a master, or no T11 parcel) has no marker.
// - Nothing runs per world step but `touch`, a set insert. `take` reads the touched rows at flush
//   and sends those whose marker differs from the one sent, ascending; at rest it sends nothing.
// - `rewind` drops the rows at or past the restored world's `n` and touches every row whose marker
//   now differs from the one sent. When a marker at or past `n` was sent, `n` becomes the drop
//   floor, and a surviving row whose sent marker is now null (it lost its anchor) lowers the floor
//   to that row (the lowest over the rewinds since the last take): the next delta carries it as `from`,
//   so the page forgets every marker at or past it before applying the rows, and that delta also
//   carries every row from the floor to the world's `n` then (rows the refill re-created between
//   the rewind and the flush, touched or not). `snapshot` sends every marker and supersedes what is
//   pending.
//
// Worker-safe, under the determinism lint rule (no transcendental Math).
import type { ParcelId } from '$lib/data/parcel';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import { CITY_DAY, type CityDelta } from '$lib/map/types';
import { scheduleAt } from './read';
import type { Statics } from './statics';
import type { World } from './types';

/** The largest homes count a marker carries (`Uint16Array`). */
const MAX_HOMES = 0xffff;

export interface CityFeedDeps {
  /** T11: `labelPoint` and `index`. */
  parcels: ScenarioParcels;
  /** The row's anchor lot (the stream's `place`), null for a master or a row with no T11 lot. */
  anchorOf(world: World, statics: Statics, row: number): ParcelId | null;
  /** The row's `SLOT_FLAG` bits. */
  flagsOf(world: World, statics: Statics, row: number): number;
}

export interface CityFeed {
  /** From `onEvent`: the row may have changed. */
  touch(row: number): void;
  /** A touched row or a drop not yet sent. */
  pending(): boolean;
  /** The touched rows' markers at `day` (scheduleAt), or null when nothing is pending. */
  take(world: World, statics: Statics, day: number): CityDelta | null;
  /**
   * After a restore: rows = world.projects.n; every row whose marker differs from the one sent
   * becomes touched.
   */
  rewind(world: World, statics: Statics, day: number): void;
  /** Every marker; supersedes pending touches. */
  snapshot(world: World, statics: Statics, day: number): CityDelta;
}

/** Values of one marker in a row of `Marker`'s layout (float32 as sent). */
const WIDTH = 8;
const LNG = 0;
const LAT = 1;
const DAYS = 2; // approved, started, completed: DAYS + CITY_DAY.*
const HOMES = 5;
const EXISTING = 6;
const FLAGS = 7;

type Marker = Float64Array;

const same = (a: number, b: number) => a === b || (a !== a && b !== b);

function sameMarker(a: Marker, b: Marker): boolean {
  for (let i = 0; i < WIDTH; i++) if (!same(a[i], b[i])) return false;
  return true;
}

export function createCityFeed(deps: CityFeedDeps): CityFeed {
  const P = deps.parcels;
  /** Row → the marker last sent for it (undefined: none sent). */
  let sent: (Marker | undefined)[] = [];
  /** Rows an event touched since the last take. */
  const touched = new Set<number>();
  /** A rewind dropped rows the page holds: the lowest restored `n` since the last take, or null. */
  let floor: number | null = null;

  /** The row's marker at `day`, or null for a row with no anchor. */
  function markerOf(world: World, statics: Statics, row: number, day: number): Marker | null {
    const anchor = deps.anchorOf(world, statics, row);
    if (anchor === null) return null;
    const at = P.index.get(anchor)!;
    const m: Marker = new Float64Array(WIDTH);
    m[LNG] = Math.fround(P.labelPoint[2 * at]);
    m[LAT] = Math.fround(P.labelPoint[2 * at + 1]);
    m[DAYS + CITY_DAY.approved] = NaN;
    m[DAYS + CITY_DAY.started] = NaN;
    m[DAYS + CITY_DAY.completed] = NaN;
    const s = scheduleAt(world, statics, row, day);
    if (s === null) return m;
    const e = s.entered;
    const a = e.entitled;
    const b = e.permitIssued;
    if (a !== undefined || b !== undefined) {
      m[DAYS + CITY_DAY.approved] = Math.fround(
        a === undefined ? b! : b === undefined ? a : Math.min(a, b)
      );
    }
    if (e.construction !== undefined) m[DAYS + CITY_DAY.started] = Math.fround(e.construction);
    if (s.end.kind === 'complete') m[DAYS + CITY_DAY.completed] = Math.fround(s.end.day);
    const units = s.revisions.length === 0 ? 0 : s.revisions[s.revisions.length - 1].units;
    m[HOMES] = Math.min(MAX_HOMES, Math.max(0, units));
    const built = s.entered.construction;
    if (built !== undefined && built > statics.asOf) {
      m[EXISTING] = Math.min(MAX_HOMES, Math.max(0, s.existingUnits));
    }
    m[FLAGS] = deps.flagsOf(world, statics, row);
    return m;
  }

  function deltaOf(
    rows: number,
    picked: number[],
    markers: Marker[],
    from: number | null = null
  ): CityDelta {
    const k = picked.length;
    const d: CityDelta = {
      rows,
      row: Int32Array.from(picked),
      lngLat: new Float32Array(2 * k),
      days: new Float32Array(3 * k),
      homes: new Uint16Array(k),
      existing: new Uint16Array(k),
      flags: new Uint8Array(k)
    };
    for (let i = 0; i < k; i++) {
      const m = markers[i];
      d.lngLat[2 * i] = m[LNG];
      d.lngLat[2 * i + 1] = m[LAT];
      for (let j = 0; j < 3; j++) d.days[3 * i + j] = m[DAYS + j];
      d.homes[i] = m[HOMES];
      d.existing[i] = m[EXISTING];
      d.flags[i] = m[FLAGS];
    }
    if (from !== null) d.from = from;
    return d;
  }

  return {
    touch(row) {
      touched.add(row);
    },

    pending() {
      return touched.size > 0 || floor !== null;
    },

    take(world, statics, day) {
      if (touched.size === 0 && floor === null) return null;
      const n = world.projects.n;
      const from = floor;
      floor = null;
      // the page forgets every marker at or past the floor: resend every row there that has one
      if (from !== null) for (let row = from; row < n; row++) touched.add(row);
      const order = [...touched].sort((a, b) => a - b);
      touched.clear();
      const picked: number[] = [];
      const markers: Marker[] = [];
      for (const row of order) {
        if (row >= n) continue;
        const m = markerOf(world, statics, row, day);
        if (m === null) {
          // the page forgot it with the floor (rewind lowers the floor to such a row)
          if (from !== null && row >= from) sent[row] = undefined;
          continue;
        }
        const was = from !== null && row >= from ? undefined : sent[row];
        if (was !== undefined && sameMarker(was, m)) continue;
        sent[row] = m;
        picked.push(row);
        markers.push(m);
      }
      if (picked.length === 0 && from === null) return null;
      return deltaOf(n, picked, markers, from);
    },

    rewind(world, statics, day) {
      const n = world.projects.n;
      // a floor already pending is lowered to n too: it stays at or below the delta's `rows`
      if (floor !== null) floor = Math.min(floor, n);
      for (let row = n; row < sent.length && floor === null; row++) {
        if (sent[row] !== undefined) floor = n;
      }
      if (sent.length > n) sent.length = n;
      for (const row of [...touched]) if (row >= n) touched.delete(row);
      for (let row = 0; row < n; row++) {
        const m = markerOf(world, statics, row, day);
        const was = sent[row];
        if (m === null) {
          // a sent marker now gone: only `from` removes a marker on the page, so the floor drops
          // to this row and the rows above it are resent
          if (was !== undefined) floor = floor === null ? row : Math.min(floor, row);
        } else if (was === undefined || !sameMarker(was, m)) touched.add(row);
      }
    },

    snapshot(world, statics, day) {
      const n = world.projects.n;
      sent = [];
      touched.clear();
      floor = null;
      const picked: number[] = [];
      const markers: Marker[] = [];
      for (let row = 0; row < n; row++) {
        const m = markerOf(world, statics, row, day);
        if (m === null) continue;
        sent[row] = m;
        picked.push(row);
        markers.push(m);
      }
      return deltaOf(n, picked, markers);
    }
  };
}
