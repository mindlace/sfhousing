// city-feed (map-citywide slice 6): one marker per project row of the plan world that has a T11
// lot, loaded cell or not, for the page's citywide rings and edge glows. Composed by
// `createMapStream`, so it rides the stream's updates, revisions, resync and rewind.
//
// - A row's marker: its anchor lot's label point, the approved day (the first of entitled and
//   permitIssued entered), the started day (construction), the completed day (a complete end), the
//   final revision's homes (capped at 65,535; below 0 sent as 0) and the `SLOT_FLAG` bits. Days,
//   homes and flags come from `scheduleAt(world, statics, row, day)`, the read the cells are
//   packed from, so a marker's days are its slot's whenever both exist. While `scheduleAt` is null
//   (the row has not begun) the days are NaN and homes and flags 0. A row with no anchor (a master,
//   or no T11 parcel) has no marker.
// - Nothing runs per world step but `touch`, a set insert. `take` reads the touched rows at flush
//   and sends those whose marker differs from the one sent, ascending; at rest it sends nothing.
// - `rewind` drops the rows at or past the restored world's `n` (the next delta says `rows = n`)
//   and touches every row whose marker now differs from the one sent. `snapshot` sends every
//   marker and supersedes what is pending.
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
const WIDTH = 7;
const LNG = 0;
const LAT = 1;
const DAYS = 2; // approved, started, completed: DAYS + CITY_DAY.*
const HOMES = 5;
const FLAGS = 6;

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
  /** A rewind dropped rows the page holds; the next take says the new `rows`. */
  let dropped = false;

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
    m[FLAGS] = deps.flagsOf(world, statics, row);
    return m;
  }

  function deltaOf(rows: number, picked: number[], markers: Marker[]): CityDelta {
    const k = picked.length;
    const d: CityDelta = {
      rows,
      row: Int32Array.from(picked),
      lngLat: new Float32Array(2 * k),
      days: new Float32Array(3 * k),
      homes: new Uint16Array(k),
      flags: new Uint8Array(k)
    };
    for (let i = 0; i < k; i++) {
      const m = markers[i];
      d.lngLat[2 * i] = m[LNG];
      d.lngLat[2 * i + 1] = m[LAT];
      for (let j = 0; j < 3; j++) d.days[3 * i + j] = m[DAYS + j];
      d.homes[i] = m[HOMES];
      d.flags[i] = m[FLAGS];
    }
    return d;
  }

  return {
    touch(row) {
      touched.add(row);
    },

    pending() {
      return touched.size > 0 || dropped;
    },

    take(world, statics, day) {
      if (touched.size === 0 && !dropped) return null;
      const n = world.projects.n;
      const order = [...touched].sort((a, b) => a - b);
      touched.clear();
      const picked: number[] = [];
      const markers: Marker[] = [];
      for (const row of order) {
        if (row >= n) continue;
        const m = markerOf(world, statics, row, day);
        if (m === null) continue;
        const was = sent[row];
        if (was !== undefined && sameMarker(was, m)) continue;
        sent[row] = m;
        picked.push(row);
        markers.push(m);
      }
      const drop = dropped;
      dropped = false;
      if (picked.length === 0 && !drop) return null;
      return deltaOf(n, picked, markers);
    },

    rewind(world, statics, day) {
      const n = world.projects.n;
      for (let row = n; row < sent.length; row++) if (sent[row] !== undefined) dropped = true;
      if (sent.length > n) sent.length = n;
      for (const row of [...touched]) if (row >= n) touched.delete(row);
      for (let row = 0; row < n; row++) {
        const m = markerOf(world, statics, row, day);
        const was = sent[row];
        if (m === null ? was !== undefined : was === undefined || !sameMarker(was, m)) {
          touched.add(row);
        }
      }
    },

    snapshot(world, statics, day) {
      const n = world.projects.n;
      sent = [];
      touched.clear();
      dropped = false;
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
