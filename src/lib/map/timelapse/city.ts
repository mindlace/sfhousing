// The citywide view on the page (map-citywide slice 6): the marker store the feed fills
// (`CityStore`), the 800 m grid, the merged ring records (`buildCity`) and the CPU reference of
// the `timeline-city` shader (`inView`, `edgeOf`, `evalCity`). Pure. The GLSL port in
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
  CITY_GLOW_FAR_ALPHA,
  CITY_GLOW_REACH,
  CITY_HANDOVER_ZOOM,
  CITY_R_MAX_PX,
  CITY_R_REF_HOMES,
  CITY_RING_DAYS,
  CITY_RING_FADE_PX,
  CITY_RING_FLOOR_PX,
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
  homes: number; // the homes it stands for (see buildCity)
  kind: 0 | 1 | 2 | 3; // a flagged marker's events go to `policy`, whatever stage
}

/** A point in clip space: [x, y, w]. */
export type Clip = [x: number, y: number, w: number];

export interface CityEval {
  mode: 'none' | 'ring' | 'edge';
  sizePx: number;
  alpha: number;
  at: [x: number, y: number]; // NDC: the anchor (ring) or the edge point (edge)
}

/**
 * From CITY_HANDOVER_ZOOM, the px beyond each side of the view inside which an off-view record
 * draws no edge glow: the largest reach of a project's own ring (HALO_R_PX[1], plus its stroke's
 * half pixel and a pixel of margin) whose centre is there. Beyond it, the record glows.
 */
export const CITY_EDGE_MARGIN_PX = HALO_R_PX[1] + 1;

/** Metres per degree of latitude (mean Earth radius 6,371,008.8 m). */
export const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;
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

/** min(CITY_R_MAX_PX, HALO_R_PX[1] · max(1, sqrt(homes / CITY_R_REF_HOMES))): 22 to 40 px. */
export function cityRadiusPx(homes: number): number {
  return Math.min(CITY_R_MAX_PX, HALO_R_PX[1] * Math.max(1, Math.sqrt(homes / CITY_R_REF_HOMES)));
}

/** An edge glow's radius: cityRadiusPx(homes) / 2. */
export function cityEdgePx(homes: number): number {
  return cityRadiusPx(homes) / 2;
}

/**
 * True when the clip-space point is in the view widened by `mx`, `my` in NDC on each side:
 * w > 0, |x/w| <= 1 + mx, |y/w| <= 1 + my.
 */
export function inView([x, y, w]: Clip, mx = 0, my = 0): boolean {
  return w > 0 && Math.abs(x / w) <= 1 + mx && Math.abs(y / w) <= 1 + my;
}

/**
 * null when the clip-space point is in view (inView); else the NDC point on the view's edge
 * toward it: d / max(|d.x|, |d.y|), where d = (x/w, y/w) in front of the camera and (x, y)
 * behind it (w <= 0); (0, −1) when d is zero. Clip x and y are the point's components along the
 * camera's right and up axes whatever the sign of w, so (x, y) is the screen direction behind
 * the camera too, and the edge point does not jump as w crosses 0 (it tends to the same edge).
 */
export function edgeOf(clip: Clip): [x: number, y: number] | null {
  if (inView(clip)) return null;
  const [x, y, w] = clip;
  const dx = w > 0 ? x / w : x;
  const dy = w > 0 ? y / w : y;
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return m === 0 ? [0, -1] : [dx / m, dy / m];
}

const NONE: CityEval = { mode: 'none', sizePx: 0, alpha: 0, at: [0, 0] };

/**
 * The camera, as the city shader reads it from uniforms each frame (the CPU reference takes it
 * whole). `pxPerMeter` and `focalW` are at the view's centre on the ground: the CSS px a metre
 * spans there and that point's clip w (deck's `project.focalDistance`). `forward` is one square
 * (CITY_CELL_M) on the ground straight up the screen (the camera's bearing), in degrees.
 */
export interface CityView {
  zoom: number;
  viewPx: readonly [w: number, h: number]; // CSS px
  inset: readonly [top: number, right: number, bottom: number, left: number]; // CSS px
  centre: readonly [lng: number, lat: number];
  pxPerMeter: number;
  focalW: number;
  forward: readonly [dLng: number, dLat: number];
}

/** `forward` for a camera of bearing `bearing` degrees at latitude `lat`. */
export function cityForward(bearing: number, lat: number): [dLng: number, dLat: number] {
  const b = (bearing * Math.PI) / 180;
  return [
    (CITY_CELL_M * Math.sin(b)) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180)),
    (CITY_CELL_M * Math.cos(b)) / M_PER_DEG
  ];
}

/**
 * Half a square's projected size on screen in CSS px at an anchor of clip `clip`: half the
 * smaller of its width across the screen (CITY_CELL_M at the centre's scale, times focalW / w)
 * and its depth up the screen (the px between the anchor and `fwd`, the clip point one square
 * up the screen from it, foreshortened under a pitched camera). Without `fwd`, the width alone.
 * 0 at or behind the camera.
 */
export function squareHalfPx(clip: Clip, view: CityView, fwd?: Clip): number {
  const w = clip[2];
  if (w <= 0) return 0;
  const across = (CITY_CELL_M * view.pxPerMeter * view.focalW) / w;
  if (!fwd) return across / 2;
  if (fwd[2] <= 0) return 0;
  const dx = ((fwd[0] / fwd[2] - clip[0] / w) * view.viewPx[0]) / 2;
  const dy = ((fwd[1] / fwd[2] - clip[1] / w) * view.viewPx[1]) / 2;
  return Math.min(across, Math.hypot(dx, dy)) / 2;
}

/** Ground metres from `b` to `a` (equirectangular at b's latitude: exact enough within a city). */
export function groundM(a: readonly [number, number], b: readonly [number, number]): number {
  const dx = (a[0] - b[0]) * M_PER_DEG * Math.cos((b[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * M_PER_DEG;
  return Math.hypot(dx, dy);
}

/** The view's ground half-diagonal in metres: half its diagonal in px at the centre's scale. */
export function halfDiagM(view: CityView): number {
  return Math.hypot(view.viewPx[0], view.viewPx[1]) / 2 / view.pxPerMeter;
}

/**
 * The NDC edge point `e` (on the view's [-1, 1] square) moved onto the inset rectangle: the view
 * less `inset` CSS px on each side, so a glow sits clear of controls on the map's edges.
 */
export function insetEdge(e: readonly [number, number], view: CityView): [number, number] {
  const [w, h] = view.viewPx;
  const [top, right, bottom, left] = view.inset;
  const x0 = -1 + (2 * left) / w;
  const x1 = 1 - (2 * right) / w;
  const y0 = -1 + (2 * bottom) / h;
  const y1 = 1 - (2 * top) / h;
  return [(x0 + x1) / 2 + (e[0] * (x1 - x0)) / 2, (y0 + y1) / 2 + (e[1] * (y1 - y0)) / 2];
}

/**
 * CPU reference of the city shader for a record whose anchor projects to `clip`, rule order
 * fixed:
 * 1. t < day: none.
 * 2. off view (edgeOf non-null):
 *    a. zoom >= CITY_HANDOVER_ZOOM and the anchor in the view widened by CITY_EDGE_MARGIN_PX on
 *       each side: none (a project ringing there reaches into the view on its own).
 *    b. the anchor's ground distance from the view's centre, in half-diagonals (`range`), past
 *       CITY_GLOW_REACH: none.
 *    c. t < day + CITY_EDGE_DAYS → edge, cityEdgePx(homes), alpha (1 − age / CITY_EDGE_DAYS,
 *       reduced 1) · (1 − (1 − CITY_GLOW_FAR_ALPHA) · range / CITY_GLOW_REACH), at the edge
 *       point moved onto the inset rectangle (insetEdge); else none.
 * 3. zoom >= CITY_HANDOVER_ZOOM: none.
 * 4. The square's projected half-size `half` (squareHalfPx, with `fwd`, the clip point one
 *    square up the screen from the anchor) at or below CITY_RING_FADE_PX: none.
 * 5. t < day + CITY_RING_DAYS → ring of radius R = max(CITY_RING_FLOOR_PX, min(cityRadiusPx,
 *    half)), growing from r0 = min(HALO_R_PX[0], R) to R and fading, u = age / CITY_RING_DAYS
 *    (reduced: R and 1), its alpha times clamp((half − CITY_RING_FADE_PX) / (CITY_RING_FLOOR_PX
 *    − CITY_RING_FADE_PX), 0, 1), at the anchor's NDC point; else none.
 */
export function evalCity(
  c: CityAttrs,
  t: Day,
  view: CityView,
  clip: Clip,
  reduced: boolean,
  fwd?: Clip
): CityEval {
  // 1. Nothing before its day (the last event it holds).
  if (t < c.day) return NONE;
  const age = t - c.day;
  const far = view.zoom >= CITY_HANDOVER_ZOOM;
  const edge = edgeOf(clip);
  // 2. Off view: an edge glow toward it.
  if (edge) {
    // a. From the handover, a project ringing within reach of the view shows on its own.
    const mx = (2 * CITY_EDGE_MARGIN_PX) / view.viewPx[0];
    const my = (2 * CITY_EDGE_MARGIN_PX) / view.viewPx[1];
    if (far && inView(clip, mx, my)) return NONE;
    // b. Only what is near enough to matter here.
    const range = groundM(c.anchor, view.centre) / halfDiagM(view);
    if (range > CITY_GLOW_REACH) return NONE;
    // c. The glow's window, fainter with distance.
    if (age >= CITY_EDGE_DAYS) return NONE;
    const strength = 1 - ((1 - CITY_GLOW_FAR_ALPHA) * range) / CITY_GLOW_REACH;
    return {
      mode: 'edge',
      sizePx: cityEdgePx(c.homes),
      alpha: (reduced ? 1 : 1 - age / CITY_EDGE_DAYS) * strength,
      at: insetEdge(edge, view)
    };
  }
  // 3. From the handover each project rings on its own.
  if (far) return NONE;
  // 4. Near the horizon a square is too small to ring.
  const half = squareHalfPx(clip, view, fwd);
  if (half <= CITY_RING_FADE_PX) return NONE;
  // 5. A merged ring, no wider than its square, grows and fades over its life.
  if (age >= CITY_RING_DAYS) return NONE;
  const at: [number, number] = [clip[0] / clip[2], clip[1] / clip[2]];
  const fade = Math.min(1, (half - CITY_RING_FADE_PX) / (CITY_RING_FLOOR_PX - CITY_RING_FADE_PX));
  const R = Math.max(CITY_RING_FLOOR_PX, Math.min(cityRadiusPx(c.homes), half));
  if (reduced) return { mode: 'ring', sizePx: R, alpha: fade, at };
  const u = age / CITY_RING_DAYS;
  const r0 = Math.min(HALO_R_PX[0], R);
  return { mode: 'ring', sizePx: r0 + (R - r0) * u, alpha: (1 - u) * fade, at };
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
  n: number; // markers
  x: number; // Σ lng
  y: number; // Σ lat
}

/** Buckets per square in a record key; far beyond any horizon (2^24 half-years). */
const KEY_BUCKETS = 2 ** 24;

/**
 * One record per (square, CITY_BUCKET_DAYS bucket counted from `from`, kind) with an event
 * after `from`, in square, bucket, kind order. An event is one of a marker's three days; a
 * flagged marker's events go to `policy`. Every kind's homes mean the same thing: the homes of
 * the markers in the square with an event of that kind in that half-year, each marker once (a
 * stage kind: the homes that reached that stage; policy: the homes of the flagged projects with
 * any stage change). The anchor is those markers' homes-weighted centre (the plain centre when
 * they hold no homes). O(markers), plus a sort of the records.
 *
 * The record's day is its latest event's, so it never shows before every event it counts has
 * happened. The cost (accepted, 2026-11-20 review M1): a rebuild that brings a later event into
 * the same square, half-year and kind moves the day later, so a ring showing near the fill
 * frontier vanishes and is born again at the new day.
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
    // The keys this marker has counted in (a flagged marker's events can share one).
    let seen0 = -1;
    let seen1 = -1;
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
      if (key === seen0 || key === seen1) continue;
      if (seen0 < 0) seen0 = key;
      else seen1 = key;
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
    const anchor: [number, number] =
      a.homes > 0 ? [a.wx / a.homes, a.wy / a.homes] : [a.x / a.n, a.y / a.n];
    return { anchor, day: a.day, homes: a.homes, kind };
  });
}
