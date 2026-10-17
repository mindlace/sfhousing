// Stage bar declutter (spec §4.4.4): per-project zoom gates so bars that coexist in time do not
// overlap on screen. CPU, run on each bar rebuild by the controller, never on `setTime`.
import { barSizePx } from './bars';
import { BAR_MIN_ZOOM, DECLUTTER_MAX_ZOOM, DECLUTTER_STEP } from './constants';
import type { BarAttrs } from './types';

const EARTH_CIRCUMFERENCE_M = 40075016.686;
/** `TILE_SIZE` (§4.0): the map's vector tiles are 512 px. */
const TILE_SIZE = 512;
/** Metres per degree of latitude (equirectangular). */
const M_PER_DEG = 111319.49079327357;
const DEG = Math.PI / 180;

/** Metres per screen pixel at zoom `z` and latitude `lat` (degrees). */
export function mpp(z: number, lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat * DEG)) / (TILE_SIZE * 2 ** z);
}

/** The zoom ladder: BAR_MIN_ZOOM, +STEP, … DECLUTTER_MAX_ZOOM. */
const RUNGS = Math.round((DECLUTTER_MAX_ZOOM - BAR_MIN_ZOOM) / DECLUTTER_STEP) + 1;
const TOP = RUNGS - 1;
const rungZoom = (r: number) => BAR_MIN_ZOOM + r * DECLUTTER_STEP;
/** `W(z)·mpp(z, 0)` per rung, metres; a project at latitude `lat` scales it by `cos(lat)`. */
const NEED_EQUATOR = Float64Array.from({ length: RUNGS }, (_, r) => {
  const z = rungZoom(r);
  return (barSizePx(z).w * EARTH_CIRCUMFERENCE_M) / (TILE_SIZE * 2 ** z);
});

/** Open-addressing slot for grid cell `(cx, cy)`: the slot holding it, or the empty slot to use. */
function slotOf(sx: Int32Array, sy: Int32Array, head: Int32Array, cx: number, cy: number): number {
  const mask = head.length - 1;
  let h = (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) & mask;
  while (head[h] !== -1 && (sx[h] !== cx || sy[h] !== cy)) h = (h + 1) & mask;
  return h;
}

/**
 * Set `minZoom` on every bar, in place (§4.4.4). A project's bars (its revisions) share one
 * `minZoom`, computed from its final revision's anchor and its whole active interval
 * `[min from, max to)`. Projects are visited by final units descending, then `parcelId`, then
 * `projectId` ascending (a total order); each takes the smallest ladder zoom `z` at which every
 * earlier project `j` that overlaps in time, shown from `max(z, minZoom_j)`, is at least one bar
 * width away (equirectangular metres at the project's latitude). A project that never clears
 * shows at the top rung. O(n log n): a uniform grid whose cell is the widest conflict distance,
 * 3×3 neighbourhood.
 */
export function declutter(bars: BarAttrs[]): void {
  // One record per project, as parallel arrays.
  const index = new Map<string, number>();
  const barProject = new Int32Array(bars.length);
  const finalBar: number[] = [];
  const first: BarAttrs[] = [];
  const from: number[] = [];
  const to: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    let p = index.get(b.projectId);
    if (p === undefined) {
      p = first.length;
      index.set(b.projectId, p);
      first.push(b);
      finalBar.push(i);
      from.push(b.from);
      to.push(b.to);
    } else {
      if (b.from < from[p]) from[p] = b.from;
      if (b.to > to[p]) to[p] = b.to;
      // The final revision is the latest one.
      const f = bars[finalBar[p]];
      if (b.from > f.from || (b.from === f.from && b.to > f.to)) finalBar[p] = i;
    }
    barProject[i] = p;
  }
  const n = first.length;
  if (n === 0) return;

  // Grid metric: x scaled at the highest latitude (smallest cosine), so grid distances never
  // exceed true distances; the cell is the widest conflict distance, at the lowest latitude.
  let minLat = Infinity;
  let maxLat = 0;
  const lat = new Float64Array(n);
  for (let p = 0; p < n; p++) {
    lat[p] = Math.abs(bars[finalBar[p]].anchor[1]);
    if (lat[p] < minLat) minLat = lat[p];
    if (lat[p] > maxLat) maxLat = lat[p];
  }
  const gridCos = Math.cos(maxLat * DEG);
  const cell = NEED_EQUATOR[0] * Math.cos(minLat * DEG);
  const tx = new Float64Array(n); // longitude in metres, unscaled
  const ty = new Float64Array(n);
  const cosLat = new Float64Array(n);
  const cxs = new Int32Array(n);
  const cys = new Int32Array(n);
  for (let p = 0; p < n; p++) {
    const a = bars[finalBar[p]].anchor;
    tx[p] = a[0] * M_PER_DEG;
    ty[p] = a[1] * M_PER_DEG;
    cosLat[p] = Math.cos(a[1] * DEG);
    cxs[p] = Math.floor((tx[p] * gridCos) / cell);
    cys[p] = Math.floor(ty[p] / cell);
  }

  const units = Float64Array.from(first, (b) => b.units);
  const order = Array.from({ length: n }, (_, p) => p);
  order.sort((a, b) => {
    const d = units[b] - units[a];
    if (d !== 0) return d;
    const pa = first[a].parcelId;
    const pb = first[b].parcelId;
    if (pa !== pb) return pa < pb ? -1 : 1;
    const ia = first[a].projectId;
    const ib = first[b].projectId;
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  // Visited projects, chained per grid cell: head[slot] → next[p] → … → -1.
  let size = 16;
  while (size < 2 * n) size *= 2;
  const head = new Int32Array(size).fill(-1);
  const slotX = new Int32Array(size);
  const slotY = new Int32Array(size);
  const next = new Int32Array(n);
  const rung = new Int8Array(n);
  for (let o = 0; o < n; o++) {
    const p = order[o];
    const cx = cxs[p];
    const cy = cys[p];
    const pc = cosLat[p];
    const pf = from[p];
    const pt = to[p];
    let r = 0;
    for (let ox = -1; ox <= 1 && r < TOP; ox++) {
      for (let oy = -1; oy <= 1 && r < TOP; oy++) {
        let q = head[slotOf(slotX, slotY, head, cx + ox, cy + oy)];
        for (; q >= 0; q = next[q]) {
          if (!(pf < to[q] && from[q] < pt)) continue;
          // Distance in metres at p's latitude.
          const dx = (tx[p] - tx[q]) * pc;
          const dy = ty[p] - ty[q];
          const d2 = dx * dx + dy * dy;
          // Shown together from the later of the two gates. If that clears q, so does every
          // higher zoom; otherwise take the first higher rung that does (the top if none).
          const start = r > rung[q] ? r : rung[q];
          const n0 = NEED_EQUATOR[start] * pc;
          if (d2 >= n0 * n0) continue;
          let c = start < TOP ? start + 1 : TOP;
          while (c < TOP) {
            const need = NEED_EQUATOR[c] * pc;
            if (d2 >= need * need) break;
            c++;
          }
          if (c > r) r = c;
          if (r >= TOP) break;
        }
      }
    }
    rung[p] = r;
    const slot = slotOf(slotX, slotY, head, cx, cy);
    next[p] = head[slot];
    head[slot] = p;
    slotX[slot] = cx;
    slotY[slot] = cy;
  }

  for (let i = 0; i < bars.length; i++) bars[i].minZoom = rungZoom(rung[barProject[i]]);
}
