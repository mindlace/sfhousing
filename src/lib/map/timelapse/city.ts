// The citywide view on the page (map-citywide slice 6): the marker store the feed fills
// (`CityStore`), the 800 m grid, the merged ring records (`buildCity`) and the CPU reference of
// the `timeline-city` shader (`edgeOf`, `blockOutside`, `evalCity`). Pure. The GLSL port in
// city-layer.ts keeps `evalCity`'s rule order; change one with the other.
//
// Cost: `buildCity` runs once per applied update that carried city rows, O(markers), never per
// frame. Whether a record is a ring, an edge glow or nothing is decided per record per frame in
// the vertex shader from uniforms (the clock's day, the zoom, the camera).
import type { TokenName } from '../palette';
import { CONSTRAINTS } from '../camera';
import { validateCityDelta } from '../city-delta';
import type { CityDelta } from '../types';
import {
  CITY_BUCKET_DAYS,
  CITY_CELL_M,
  CITY_EDGE_DAYS,
  CITY_HANDOVER_ZOOM,
  CITY_R_MAX_PX,
  CITY_R_REF_HOMES,
  CITY_RING_DAYS,
  HALO_R_PX
} from './constants';
import { HALO_TOKEN } from './halos';
import type { Day } from '$lib/timelapse/time';

export const CITY_KIND = { approved: 0, started: 1, completed: 2, policy: 3 } as const;

/**
 * The token each record kind is drawn in, by `CITY_KIND`: the stage tones of `HALO_TOKEN` (so
 * the key cannot drift from the halo rows) and the site accent for the person's policy. No new
 * token: every one is held to 3:1 on `land` in both themes by palette.spec.ts.
 */
export const CITY_KIND_TOKEN = [
  HALO_TOKEN.approved,
  HALO_TOKEN.started,
  HALO_TOKEN.completed,
  'tl-halo-policy'
] as const satisfies readonly TokenName[];

/** A square's bounds: [west, south, east, north] in degrees. */
export type CityBounds = [w: number, s: number, e: number, n: number];

export interface CityAttrs {
  anchor: [lng: number, lat: number]; // homes-weighted centre of the record's events
  day: Day; // the latest event day in it
  homes: number; // the sum of its events' homes
  kind: 0 | 1 | 2 | 3; // a flagged marker's events go to `policy`, whatever stage
  square: CityBounds; // the grid square the record stands for
}

/** A point in clip space: [x, y, w]. */
export type Clip = [x: number, y: number, w: number];

export interface CityEval {
  mode: 'none' | 'ring' | 'edge';
  sizePx: number;
  alpha: number;
  at: [x: number, y: number]; // NDC: the anchor (ring) or the edge point (edge)
}

/** Metres per degree of latitude (mean Earth radius 6,371,008.8 m). */
const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const [[WEST, SOUTH], [EAST, NORTH]] = CONSTRAINTS.maxBounds;
const D_LAT = CITY_CELL_M / M_PER_DEG;
const D_LNG = D_LAT / Math.cos((((SOUTH + NORTH) / 2) * Math.PI) / 180);

/** The CITY_CELL_M grid over `CONSTRAINTS.maxBounds`, from its south-west corner. */
export const CITY_GRID = {
  west: WEST,
  south: SOUTH,
  dLng: D_LNG,
  dLat: D_LAT,
  cols: Math.ceil((EAST - WEST) / D_LNG),
  rows: Math.ceil((NORTH - SOUTH) / D_LAT)
} as const;

const clampInt = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));

/**
 * The square of a point on the CITY_CELL_M grid over CONSTRAINTS.maxBounds (row-major from the
 * south-west); outside points clamp to the edge squares.
 */
export function cityGroup(lng: number, lat: number): number {
  const col = clampInt((lng - WEST) / D_LNG, CITY_GRID.cols);
  const row = clampInt((lat - SOUTH) / D_LAT, CITY_GRID.rows);
  return row * CITY_GRID.cols + col;
}

/** The bounds of square `group`. */
export function citySquare(group: number): CityBounds {
  const col = group % CITY_GRID.cols;
  const row = (group - col) / CITY_GRID.cols;
  const w = WEST + col * D_LNG;
  const s = SOUTH + row * D_LAT;
  return [w, s, w + D_LNG, s + D_LAT];
}

/**
 * The margin block of a square: the square widened by one square on each side (3 × 3 squares).
 * From CITY_HANDOVER_ZOOM an off-view record glows only when this block is wholly outside the
 * view (`blockOutside`): a project's own ring sits at the bbox centre of its parts, not at its
 * anchor lot's label point, so a project of a square whose block reaches into the view may
 * still ring on screen, and must not also glow.
 */
export function cityBlock([w, s, e, n]: CityBounds): CityBounds {
  const dx = e - w;
  const dy = n - s;
  return [w - dx, s - dy, e + dx, n + dy];
}

/**
 * True when every corner of a convex ground box lies past one and the same clip plane (right,
 * left, top, bottom) or behind the camera (w <= 0). The planes are linear in clip space, so the
 * whole box is then out of view. A box past different planes (around a corner of the view) is
 * not wholly outside by this test: conservative, it never says outside for a visible point.
 */
export function blockOutside(corners: readonly Clip[]): boolean {
  let r = true;
  let l = true;
  let t = true;
  let b = true;
  let behind = true;
  for (const [x, y, w] of corners) {
    r &&= x - w > 0;
    l &&= -x - w > 0;
    t &&= y - w > 0;
    b &&= -y - w > 0;
    behind &&= w <= 0;
  }
  return r || l || t || b || behind;
}

/** min(CITY_R_MAX_PX, HALO_R_PX[1] · max(1, sqrt(homes / CITY_R_REF_HOMES))): 22 to 40 px. */
export function cityRadiusPx(homes: number): number {
  return Math.min(CITY_R_MAX_PX, HALO_R_PX[1] * Math.max(1, Math.sqrt(homes / CITY_R_REF_HOMES)));
}

/** An edge glow's radius: cityRadiusPx(homes) / 2. */
export function cityEdgePx(homes: number): number {
  return cityRadiusPx(homes) / 2;
}

/**
 * null when the clip-space point is in view (w > 0, |x/w| <= 1, |y/w| <= 1); else the NDC
 * point on the view's edge toward it: d / max(|d.x|, |d.y|), where d = (x/w, y/w), or (−x, −y)
 * behind the camera (w <= 0); (0, −1) when d is zero.
 */
export function edgeOf([x, y, w]: Clip): [x: number, y: number] | null {
  if (w > 0 && Math.abs(x / w) <= 1 && Math.abs(y / w) <= 1) return null;
  const dx = w > 0 ? x / w : -x;
  const dy = w > 0 ? y / w : -y;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return m === 0 ? [0, -1] : [dx / m, dy / m];
}

const NONE: CityEval = { mode: 'none', sizePx: 0, alpha: 0, at: [0, 0] };

/**
 * CPU reference of the city shader, rule order fixed:
 * 1. t < day: none.
 * 2. off view (edgeOf non-null):
 *    a. zoom >= CITY_HANDOVER_ZOOM and the margin block (`block`: the clip-space corners of
 *       `cityBlock(c.square)`) not wholly outside the view (`blockOutside`), or no block given:
 *       none.
 *    b. t < day + CITY_EDGE_DAYS → edge, cityEdgePx(homes), alpha 1 − age / CITY_EDGE_DAYS
 *       (reduced: 1), at the edge point; else none.
 * 3. zoom >= CITY_HANDOVER_ZOOM: none.
 * 4. t < day + CITY_RING_DAYS → ring, radius HALO_R_PX[0] + (cityRadiusPx − HALO_R_PX[0]) · u
 *    and alpha 1 − u, u = age / CITY_RING_DAYS (reduced: cityRadiusPx and 1), at the anchor's
 *    NDC point; else none.
 */
export function evalCity(
  c: CityAttrs,
  t: Day,
  zoom: number,
  clip: Clip,
  reduced: boolean,
  block?: readonly Clip[]
): CityEval {
  // 1. Nothing before its day (the last event it holds).
  if (t < c.day) return NONE;
  const age = t - c.day;
  const edge = edgeOf(clip);
  // 2. Off view: an edge glow toward it.
  if (edge) {
    // a. From the handover a project of the square may ring on screen: glow only when the
    //    square is wholly outside the view by a margin of one square.
    if (zoom >= CITY_HANDOVER_ZOOM && !(block && blockOutside(block))) return NONE;
    // b. The glow's window.
    if (age >= CITY_EDGE_DAYS) return NONE;
    return {
      mode: 'edge',
      sizePx: cityEdgePx(c.homes),
      alpha: reduced ? 1 : 1 - age / CITY_EDGE_DAYS,
      at: edge
    };
  }
  // 3. From the handover each project rings on its own.
  if (zoom >= CITY_HANDOVER_ZOOM) return NONE;
  // 4. A merged ring grows and fades over its life.
  if (age >= CITY_RING_DAYS) return NONE;
  const at: [number, number] = [clip[0] / clip[2], clip[1] / clip[2]];
  const R = cityRadiusPx(c.homes);
  if (reduced) return { mode: 'ring', sizePx: R, alpha: 1, at };
  const u = age / CITY_RING_DAYS;
  return { mode: 'ring', sizePx: HALO_R_PX[0] + (R - HALO_R_PX[0]) * u, alpha: 1 - u, at };
}

/** The page's markers, by row: typed arrays grown on demand, one entry per world row. */
export class CityStore {
  #cap = 0;
  #length = 0;
  #size = 0;
  #flagged = 0;
  #lngLat = new Float32Array(0);
  #days = new Float32Array(0);
  #homes = new Uint16Array(0);
  #flags = new Uint8Array(0);
  #has = new Uint8Array(0);

  /** Rows holding a marker. */
  get size(): number {
    return this.#size;
  }
  /** Of them, with a flag. */
  get flagged(): number {
    return this.#flagged;
  }
  /** The row bound: every marker is at a row below it. */
  get length(): number {
    return this.#length;
  }
  /** Views by row, valid until the next `apply` or `clear`. */
  get lngLat(): Float32Array {
    return this.#lngLat;
  }
  get days(): Float32Array {
    return this.#days;
  }
  get homes(): Uint16Array {
    return this.#homes;
  }
  get flags(): Uint8Array {
    return this.#flags;
  }
  get has(): Uint8Array {
    return this.#has;
  }

  /**
   * replace: revision 0 (the delta is the whole set); else forget markers at or past d.from
   * (when present), drop those at or past d.rows, then write its rows. Validates first
   * (validateCityDelta): a malformed delta throws and leaves the store as it was.
   */
  apply(d: CityDelta, replace: boolean): void {
    validateCityDelta(d);
    if (replace) this.clear();
    else if (d.from !== undefined) this.#forget(d.from);
    this.#forget(d.rows);
    this.#reserve(d.rows);
    this.#length = d.rows;
    for (let i = 0; i < d.row.length; i++) {
      const r = d.row[i];
      if (this.#has[r]) {
        if (this.#flags[r]) this.#flagged--;
      } else {
        this.#has[r] = 1;
        this.#size++;
      }
      this.#lngLat[2 * r] = d.lngLat[2 * i];
      this.#lngLat[2 * r + 1] = d.lngLat[2 * i + 1];
      this.#days[3 * r] = d.days[3 * i];
      this.#days[3 * r + 1] = d.days[3 * i + 1];
      this.#days[3 * r + 2] = d.days[3 * i + 2];
      this.#homes[r] = d.homes[i];
      this.#flags[r] = d.flags[i];
      if (d.flags[i]) this.#flagged++;
    }
  }

  clear(): void {
    this.#has.fill(0);
    this.#length = 0;
    this.#size = 0;
    this.#flagged = 0;
  }

  /** Forgets every marker at row >= k. */
  #forget(k: number): void {
    for (let r = k; r < this.#length; r++) {
      if (!this.#has[r]) continue;
      this.#has[r] = 0;
      this.#size--;
      if (this.#flags[r]) this.#flagged--;
    }
    this.#length = Math.min(this.#length, k);
  }

  #reserve(n: number): void {
    if (n <= this.#cap) return;
    const cap = Math.max(n, 2 * this.#cap);
    const grow = <T extends Float32Array | Uint16Array | Uint8Array>(a: T, w: number, b: T): T => {
      b.set(a.subarray(0, this.#cap * w));
      return b;
    };
    this.#lngLat = grow(this.#lngLat, 2, new Float32Array(2 * cap));
    this.#days = grow(this.#days, 3, new Float32Array(3 * cap));
    this.#homes = grow(this.#homes, 1, new Uint16Array(cap));
    this.#flags = grow(this.#flags, 1, new Uint8Array(cap));
    this.#has = grow(this.#has, 1, new Uint8Array(cap));
    this.#cap = cap;
  }
}

/** Accumulators of one record while building. */
interface Acc {
  day: number;
  homes: number;
  wx: number; // Σ homes · lng
  wy: number; // Σ homes · lat
  n: number; // events
  x: number; // Σ lng
  y: number; // Σ lat
}

/** Buckets per square in a record key; far beyond any horizon (2^24 half-years). */
const KEY_BUCKETS = 2 ** 24;

/**
 * One record per (square, CITY_BUCKET_DAYS bucket counted from `from`, kind) with an event
 * after `from`, in square, bucket, kind order. An event is one of a marker's three days; a
 * flagged marker's events go to `policy`. The record's day is its latest event's (so it never
 * shows before every event it counts has happened), its homes the sum of its events' homes, its
 * anchor their homes-weighted centre (the plain centre when they hold no homes). O(markers),
 * plus a sort of the records.
 */
export function buildCity(store: CityStore, from: Day): CityAttrs[] {
  const { lngLat, days, homes, flags, has, length } = store;
  const acc = new Map<number, Acc>();
  for (let r = 0; r < length; r++) {
    if (!has[r]) continue;
    const lng = lngLat[2 * r];
    const lat = lngLat[2 * r + 1];
    const h = homes[r];
    const group = cityGroup(lng, lat);
    for (let k = 0; k < 3; k++) {
      const day = days[3 * r + k];
      // NaN (not yet) fails this too.
      if (!(day > from)) continue;
      const bucket = Math.floor((day - from) / CITY_BUCKET_DAYS);
      const kind = flags[r] ? CITY_KIND.policy : k;
      const key = (group * KEY_BUCKETS + bucket) * 4 + kind;
      let a = acc.get(key);
      if (!a) acc.set(key, (a = { day, homes: 0, wx: 0, wy: 0, n: 0, x: 0, y: 0 }));
      a.day = Math.max(a.day, day);
      a.homes += h;
      a.wx += h * lng;
      a.wy += h * lat;
      a.n++;
      a.x += lng;
      a.y += lat;
    }
  }
  const keys = [...acc.keys()].sort((p, q) => p - q);
  return keys.map((key) => {
    const a = acc.get(key)!;
    const kind = (key % 4) as CityAttrs['kind'];
    const group = Math.floor(key / (4 * KEY_BUCKETS));
    const anchor: [number, number] =
      a.homes > 0 ? [a.wx / a.homes, a.wy / a.homes] : [a.x / a.n, a.y / a.n];
    return { anchor, day: a.day, homes: a.homes, kind, square: citySquare(group) };
  });
}
