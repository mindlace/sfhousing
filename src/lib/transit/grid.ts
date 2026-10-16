// Area-capacity surface (transit spec §5.3): peak riders/hr reachable on foot, each
// route-direction counted once at its best stop. Straight-line distance in plan-model metres.
import KDBush from 'kdbush';
import {
  LAT0,
  LNG0,
  M_PER_DEG_LAT,
  M_PER_DEG_LNG,
  project,
  type BBox,
  type XY
} from '$lib/plan/geometry';
import { stopService, type StopService } from './service';
import type { TransitNetwork } from './types';

export interface TransitParams {
  /** Walk radius R, metres. */
  radiusM: number;
  /** Full-weight distance d0, metres. */
  fullM: number;
  gridSizeM: number;
}
export const DEFAULT_TRANSIT_PARAMS: TransitParams = { radiusM: 800, fullM: 200, gridSizeM: 100 };

export interface AccessGrid {
  /** Projected plan-model metres of the grid's south-west corner. */
  origin: XY;
  sizeM: number;
  cols: number;
  rows: number;
  /** Row-major (r * cols + c), value at the cell centre. */
  values: Float32Array;
}

export function walkWeight(d: number, p: TransitParams = DEFAULT_TRANSIT_PARAMS): number {
  if (d <= p.fullM) return 1;
  if (d >= p.radiusM) return 0;
  return 1 - (d - p.fullM) / (p.radiusM - p.fullM);
}

/** Mainland San Francisco extent [west, south, east, north], about 14 x 14 km. */
export const SF_GRID_BBOX: BBox = [-122.5155, 37.708, -122.3549, 37.8324];

/** Grid-relative metres (east, north of `origin`) to lng/lat. */
export function gridLngLat(grid: AccessGrid, x: number, y: number): [number, number] {
  return [LNG0 + (grid.origin[0] + x) / M_PER_DEG_LNG, LAT0 + (grid.origin[1] + y) / M_PER_DEG_LAT];
}

export function buildAccessGrid(
  net: TransitNetwork,
  params: TransitParams = DEFAULT_TRANSIT_PARAMS,
  bounds: BBox = SF_GRID_BBOX,
  service: StopService = stopService(net)
): AccessGrid {
  const n = net.stops.length;
  const size = params.gridSizeM;
  const [x0, y0] = project(bounds[0], bounds[1]);
  const [maxX, maxY] = project(bounds[2], bounds[3]);
  const cols = Math.ceil((maxX - x0) / size);
  const rows = Math.ceil((maxY - y0) / size);
  const values = new Float32Array(cols * rows);
  const grid: AccessGrid = { origin: [x0, y0], sizeM: size, cols, rows, values };
  if (n === 0) return grid;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [x, y] = project(net.stops[i].lngLat[0], net.stops[i].lngLat[1]);
    xs[i] = x;
    ys[i] = y;
  }
  const R = params.radiusM;

  const keyIx = new Map<string, number>();
  const keys: Int32Array[] = [];
  const caps: Float64Array[] = [];
  for (let i = 0; i < n; i++) {
    const list = service[i];
    const k = new Int32Array(list.length);
    const c = new Float64Array(list.length);
    list.forEach((e, j) => {
      let ix = keyIx.get(e.routeKey);
      if (ix === undefined) keyIx.set(e.routeKey, (ix = keyIx.size));
      k[j] = ix;
      c[j] = e.cap;
    });
    keys.push(k);
    caps.push(c);
  }

  const tree = new KDBush(n);
  for (let i = 0; i < n; i++) tree.add(xs[i], ys[i]);
  tree.finish();
  const best = new Float64Array(keyIx.size);
  const touched: number[] = [];
  for (let r = 0; r < rows; r++) {
    const cy = y0 + (r + 0.5) * size;
    for (let c = 0; c < cols; c++) {
      const cx = x0 + (c + 0.5) * size;
      for (const id of tree.within(cx, cy, R)) {
        const w = walkWeight(Math.hypot(xs[id] - cx, ys[id] - cy), params);
        if (w <= 0) continue;
        const k = keys[id];
        const cap = caps[id];
        for (let j = 0; j < k.length; j++) {
          const v = cap[j] * w;
          if (v <= 0) continue;
          if (best[k[j]] === 0) touched.push(k[j]);
          if (v > best[k[j]]) best[k[j]] = v;
        }
      }
      let sum = 0;
      for (const k of touched) {
        sum += best[k];
        best[k] = 0;
      }
      touched.length = 0;
      values[r * cols + c] = sum;
    }
  }
  return grid;
}

/** Bilinear between cell centres; 0 outside the grid. */
export function accessAt(grid: AccessGrid, [lng, lat]: [number, number]): number {
  if (grid.cols === 0) return 0;
  const [x, y] = project(lng, lat);
  const fx = (x - grid.origin[0]) / grid.sizeM - 0.5;
  const fy = (y - grid.origin[1]) / grid.sizeM - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > grid.cols - 0.5 || fy > grid.rows - 0.5) return 0;
  const c0 = Math.max(0, Math.min(grid.cols - 1, Math.floor(fx)));
  const r0 = Math.max(0, Math.min(grid.rows - 1, Math.floor(fy)));
  const c1 = Math.min(grid.cols - 1, c0 + 1);
  const r1 = Math.min(grid.rows - 1, r0 + 1);
  const tx = Math.max(0, Math.min(1, fx - c0));
  const ty = Math.max(0, Math.min(1, fy - r0));
  const v = (r: number, c: number) => grid.values[r * grid.cols + c];
  return (
    (v(r0, c0) * (1 - tx) + v(r0, c1) * tx) * (1 - ty) +
    (v(r1, c0) * (1 - tx) + v(r1, c1) * tx) * ty
  );
}
