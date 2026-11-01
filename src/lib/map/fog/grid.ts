/**
 * The height-limit fog (sim map overlays spec §4): a smoothed vertex grid of the allowed height
 * over the map's bounds, built from each lot's label point and effective stories. Pure and
 * worker-safe (no DOM, no camera.ts): the scenario worker builds it, the page draws it.
 *
 * Build: each cell takes the tallest limit whose label point falls in it; empty cells within
 * FOG_FILL_CELLS of a limit take the [1,4,6,4,1]-weighted mean of the occupied cells around them
 * (roads, small open space); one [1,2,1] pass over the non-empty cells smooths it, averaging only
 * non-empty neighbours so the city's edge does not sag; a vertex is the mean of the non-empty
 * cells that touch it. Every window is a product of 1-D weights, so each pass runs separably.
 */
import { FTF_M, GROUND_FTF_M } from '$lib/generator/constants';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';

/** A vertex grid over FOG_BOUNDS; heightM is (cols+1)·(rows+1), row-major from the south-west. */
export interface FogGrid {
  west: number;
  south: number;
  dLng: number;
  dLat: number;
  cols: number;
  rows: number;
  heightM: Float32Array;
}

export const FOG_CELL_M = 50; // tier 4: our choice; about a quarter block
export const FOG_FILL_CELLS = 2; // tier 4: an empty cell within 2 cells (~100 m) of a limit is filled
/** = CONSTRAINTS.maxBounds (camera.ts); repeated here so the worker need not import camera.ts. */
export const FOG_BOUNDS: [[number, number], [number, number]] = [
  [-122.56, 37.69],
  [-122.33, 37.84]
];

// The plan-model plane (the brush ring's), so a cell is FOG_CELL_M in the same metres.
const D_LNG = FOG_CELL_M / M_PER_DEG_LNG;
const D_LAT = FOG_CELL_M / M_PER_DEG_LAT;
const COLS = Math.ceil((FOG_BOUNDS[1][0] - FOG_BOUNDS[0][0]) / D_LNG);
const ROWS = Math.ceil((FOG_BOUNDS[1][1] - FOG_BOUNDS[0][1]) / D_LAT);

const FILL_W = [1, 4, 6, 4, 1]; // radius FOG_FILL_CELLS
const SMOOTH_W = [1, 2, 1];

/** 0 → 0; s ≥ 1 → GROUND_FTF_M + (s − 1)·FTF_M. */
export function storiesToM(stories: number): number {
  return stories <= 0 ? 0 : GROUND_FTF_M + (stories - 1) * FTF_M;
}

/** Separable 2-D convolution of `src` (cols × rows) with the 1-D kernel `k` on both axes, into `out`. */
function convolve(
  src: Float32Array,
  k: readonly number[],
  cols: number,
  rows: number,
  tmp: Float32Array,
  out: Float32Array
): void {
  const rad = (k.length - 1) / 2;
  for (let r = 0; r < rows; r++) {
    const o = r * cols;
    for (let c = 0; c < cols; c++) {
      let s = 0;
      const lo = Math.max(0, c - rad);
      const hi = Math.min(cols - 1, c + rad);
      for (let j = lo; j <= hi; j++) s += k[j - c + rad] * src[o + j];
      tmp[o + c] = s;
    }
  }
  for (let r = 0; r < rows; r++) {
    const lo = Math.max(0, r - rad);
    const hi = Math.min(rows - 1, r + rad);
    const o = r * cols;
    for (let c = 0; c < cols; c++) {
      let s = 0;
      for (let j = lo; j <= hi; j++) s += k[j - r + rad] * tmp[j * cols + c];
      out[o + c] = s;
    }
  }
}

export function buildFogGrid(labelPoint: Float64Array, stories: Uint8Array): FogGrid {
  const cols = COLS;
  const rows = ROWS;
  const west = FOG_BOUNDS[0][0];
  const south = FOG_BOUNDS[0][1];
  const n = cols * rows;

  // 1. The tallest limit per cell.
  const v = new Float32Array(n);
  for (let i = 0; i < stories.length; i++) {
    const s = stories[i];
    if (s === 0) continue;
    const c = Math.floor((labelPoint[2 * i] - west) / D_LNG);
    const r = Math.floor((labelPoint[2 * i + 1] - south) / D_LAT);
    if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
    const m = storiesToM(s);
    if (m > v[r * cols + c]) v[r * cols + c] = m;
  }

  const mask = new Float32Array(n);
  const num = new Float32Array(n);
  const den = new Float32Array(n);
  const tmp = new Float32Array(n);

  // 2. Fill: an empty cell takes the weighted mean of the occupied cells in its 5×5 window.
  for (let i = 0; i < n; i++) mask[i] = v[i] > 0 ? 1 : 0;
  convolve(v, FILL_W, cols, rows, tmp, num); // v is 0 where unoccupied
  convolve(mask, FILL_W, cols, rows, tmp, den);
  const f = new Float32Array(n);
  for (let i = 0; i < n; i++) f[i] = v[i] > 0 ? v[i] : den[i] > 0 ? num[i] / den[i] : 0;

  // 3. Smooth over the non-empty cells only.
  for (let i = 0; i < n; i++) mask[i] = f[i] > 0 ? 1 : 0;
  convolve(f, SMOOTH_W, cols, rows, tmp, num);
  convolve(mask, SMOOTH_W, cols, rows, tmp, den);
  const cell = v; // reuse: the smoothed cells
  for (let i = 0; i < n; i++) cell[i] = f[i] > 0 ? num[i] / den[i] : 0;

  // 4. Vertices: the mean of the non-empty cells touching each.
  const vc = cols + 1;
  const heightM = new Float32Array(vc * (rows + 1));
  for (let r = 0; r <= rows; r++)
    for (let c = 0; c <= cols; c++) {
      let s = 0;
      let k = 0;
      for (let dr = -1; dr <= 0; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 0; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const x = cell[rr * cols + cc];
          if (x > 0) {
            s += x;
            k++;
          }
        }
      }
      heightM[r * vc + c] = k > 0 ? s / k : 0;
    }

  return { west, south, dLng: D_LNG, dLat: D_LAT, cols, rows, heightM };
}

/** Bilinear height at a point; 0 outside the grid. */
export function sampleFog(g: FogGrid, lng: number, lat: number): number {
  const x = (lng - g.west) / g.dLng;
  const y = (lat - g.south) / g.dLat;
  if (!(x >= 0 && x <= g.cols && y >= 0 && y <= g.rows)) return 0;
  const c = Math.min(Math.floor(x), g.cols - 1);
  const r = Math.min(Math.floor(y), g.rows - 1);
  const fx = x - c;
  const fy = y - r;
  const vc = g.cols + 1;
  const h = g.heightM;
  const sw = h[r * vc + c];
  const se = h[r * vc + c + 1];
  const nw = h[(r + 1) * vc + c];
  const ne = h[(r + 1) * vc + c + 1];
  return (sw * (1 - fx) + se * fx) * (1 - fy) + (nw * (1 - fx) + ne * fx) * fy;
}

export interface FogInstances {
  count: number;
  anchors: Float64Array; // 2 per cell: south-west lng, lat
  corners: Float32Array; // 4 per cell, metres: SW, SE, NW, NE
}

/** Cells with any corner above 0, for the layer (Task 3). */
export function fogInstances(g: FogGrid): FogInstances {
  const vc = g.cols + 1;
  const h = g.heightM;
  let count = 0;
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const i = r * vc + c;
      if (h[i] > 0 || h[i + 1] > 0 || h[i + vc] > 0 || h[i + vc + 1] > 0) count++;
    }
  const anchors = new Float64Array(2 * count);
  const corners = new Float32Array(4 * count);
  let k = 0;
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++) {
      const i = r * vc + c;
      const sw = h[i];
      const se = h[i + 1];
      const nw = h[i + vc];
      const ne = h[i + vc + 1];
      if (!(sw > 0 || se > 0 || nw > 0 || ne > 0)) continue;
      anchors[2 * k] = g.west + c * g.dLng;
      anchors[2 * k + 1] = g.south + r * g.dLat;
      corners[4 * k] = sw;
      corners[4 * k + 1] = se;
      corners[4 * k + 2] = nw;
      corners[4 * k + 3] = ne;
      k++;
    }
  return { count, anchors, corners };
}
