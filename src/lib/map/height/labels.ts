import { LNG0, LAT0, M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { NO_ZOOM, type LabelSet } from './types';

/**
 * The label font: the system sans at semibold, as the app's UI (no font fetch). The width
 * estimate below covers its measured width (label-font.svelte.spec.ts).
 */
export const LABEL_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const LABEL_FONT_WEIGHT = 600;
/** Estimated advance per character at 12 px: digits and "+", narrow " ·,", and letters. */
export const LABEL_WIDE_PX = 8.5;
export const LABEL_NARROW_PX = 4;
export const LABEL_LETTER_PX = 6.5;
/** Room around a label's box, its 2 px halo included. */
export const LABEL_PAD_PX = 4;
export const LABEL_H_PX = 16;
export const LID_ZOOMS = [15, 16, 17, 18, 19] as const;
export const CONTOUR_ZOOMS = [11, 12, 13, 14, 15] as const;

/** A label's width in px at 12 px in the label font (an upper estimate). */
export function labelWidthPx(text: string): number {
  let w = 0;
  for (const ch of text)
    w += /[0-9+]/.test(ch) ? LABEL_WIDE_PX : /[ ·,]/.test(ch) ? LABEL_NARROW_PX : LABEL_LETTER_PX;
  return w;
}

// cos(LAT0) as a literal (M_PER_DEG_LNG / M_PER_DEG_LAT): geometry code never calls trig.
const COS_LAT0 = 0.7906233208295852;
const EQUATOR_M_PER_PX_Z0 = 78271.517; // 512 px tiles

export function metersPerPixel(zoom: number): number {
  return (EQUATOR_M_PER_PX_Z0 * COS_LAT0) / 2 ** zoom;
}

export interface LabelCandidate {
  lng: number;
  lat: number;
  zM: number;
  text: string;
  priority: number;
  /** Radius (m) of the largest circle the label may occupy; the box must fit inside it. */
  roomM: number;
}

/** minZoom per candidate (smallest listed zoom where it is placed), NO_ZOOM = never. */
export function placeLabels(c: readonly LabelCandidate[], zooms: readonly number[]): Uint8Array {
  const out = new Uint8Array(c.length).fill(NO_ZOOM);
  const order = Array.from(c.keys()).sort((a, b) => c[b].priority - c[a].priority || a - b);
  const halfW = c.map((l) => labelWidthPx(l.text) / 2 + LABEL_PAD_PX);
  const halfH = LABEL_H_PX / 2 + LABEL_PAD_PX;
  let maxW = 0;
  for (const w of halfW) maxW = Math.max(maxW, w);
  const cell = Math.max(2 * maxW, 2 * halfH, 1);
  const mx = c.map((l) => (l.lng - LNG0) * M_PER_DEG_LNG);
  const my = c.map((l) => (l.lat - LAT0) * M_PER_DEG_LAT);

  for (const z of zooms) {
    const mpp = metersPerPixel(z);
    const need = (LABEL_H_PX / 2) * mpp;
    const grid = new Map<string, number[]>();
    const insert = (i: number, cx: number, cy: number) => {
      const key = `${cx},${cy}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    };
    // Labels placed at a smaller zoom stay shown, so they hold their boxes first.
    for (const i of order) {
      if (out[i] === NO_ZOOM) continue;
      insert(i, Math.floor(mx[i] / mpp / cell), Math.floor(my[i] / mpp / cell));
    }
    for (const i of order) {
      if (out[i] !== NO_ZOOM || c[i].roomM < need) continue;
      const x = mx[i] / mpp;
      const y = my[i] / mpp;
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      let hit = false;
      for (let gx = cx - 1; gx <= cx + 1 && !hit; gx++) {
        for (let gy = cy - 1; gy <= cy + 1 && !hit; gy++) {
          for (const j of grid.get(`${gx},${gy}`) ?? []) {
            if (
              Math.abs(mx[j] / mpp - x) < halfW[i] + halfW[j] &&
              Math.abs(my[j] / mpp - y) < 2 * halfH
            ) {
              hit = true;
              break;
            }
          }
        }
      }
      if (hit) continue;
      out[i] = z;
      insert(i, cx, cy);
    }
  }
  return out;
}

/** Placed candidates only (NO_ZOOM entries are dropped). */
export function toLabelSet(c: readonly LabelCandidate[], minZoom: Uint8Array): LabelSet {
  const text: string[] = [];
  const pos: number[] = [];
  const zooms: number[] = [];
  for (let i = 0; i < c.length; i++) {
    if (minZoom[i] === NO_ZOOM) continue;
    text.push(c[i].text);
    pos.push(c[i].lng, c[i].lat, c[i].zM);
    zooms.push(minZoom[i]);
  }
  return { text, position: Float64Array.from(pos), minZoom: Uint8Array.from(zooms) };
}

/**
 * The labels to draw, in screen space: in `order` (first wins), each label is kept unless its box
 * (labelWidthPx × LABEL_H_PX, padded) overlaps one already kept, as projected by `project`.
 * placeLabels thins labels per zoom in ground metres, which a pitch or a perspective squeezes;
 * this pass runs on the main thread on the current view, so the labels shown never overlap.
 */
export function declutter<T>(
  order: readonly T[],
  textOf: (l: T) => string,
  project: (l: T) => [number, number]
): T[] {
  const halfH = LABEL_H_PX / 2 + LABEL_PAD_PX;
  const placed: { x: number; y: number; hw: number }[] = [];
  const grid = new Map<string, number[]>();
  const cell = 64;
  const kept: T[] = [];
  for (const l of order) {
    const [x, y] = project(l);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const hw = labelWidthPx(textOf(l)) / 2 + LABEL_PAD_PX;
    const [x0, x1] = [Math.floor((x - hw) / cell) - 4, Math.floor((x + hw) / cell) + 4];
    const [y0, y1] = [Math.floor((y - halfH) / cell) - 1, Math.floor((y + halfH) / cell) + 1];
    let hit = false;
    for (let gx = x0; gx <= x1 && !hit; gx++)
      for (let gy = y0; gy <= y1 && !hit; gy++)
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          const p = placed[j];
          if (Math.abs(p.x - x) < p.hw + hw && Math.abs(p.y - y) < 2 * halfH) {
            hit = true;
            break;
          }
        }
    if (hit) continue;
    const k = placed.push({ x, y, hw }) - 1;
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(k);
    else grid.set(key, [k]);
    kept.push(l);
  }
  return kept;
}
