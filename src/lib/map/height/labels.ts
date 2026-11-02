import { LNG0, LAT0, M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { NO_ZOOM, type LabelSet } from './types';

export const LABEL_CHAR_PX = 7;
export const LABEL_PAD_PX = 4;
export const LABEL_H_PX = 16;
export const LID_ZOOMS = [15, 16, 17, 18, 19] as const;
export const CONTOUR_ZOOMS = [11, 12, 13, 14, 15] as const;

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
  const halfW = c.map((l) => (l.text.length * LABEL_CHAR_PX) / 2 + LABEL_PAD_PX);
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
