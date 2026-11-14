// Footprint-to-LiDAR registration: one rigid translation per cluster, fitted against the LiDAR's
// height edges (spec "Registration"; ported from the offset spike's fitlib.py). Footprints never
// move: the shift says where a cluster's LiDAR is sampled (footprint + shift).
import { BOXES } from '../../boxes-config.js';
import type { Bbox7131, MultiPoly, Ring } from '../../geom.js';
import type { RasterWindow } from './mosaic.js';
import { cellMask, gaussian, gradient } from './raster.js';

export interface Footprint {
  bid: string;
  shape: MultiPoly;
  heightM: number;
  baseM: number;
  hs: number;
}

/**
 * Where a cluster's shift came from.
 * - `fit`: a confident peak of the edge-gradient score.
 * - `frame-nad83`, `frame-wgs84`, `zero`: the fit was ambiguous or at the edge of the search, and
 *   that candidate ((0,0) for `zero`) scored best and above 0. Usable; `flagged` is true.
 * - `none`: no candidate scored above 0, so nothing in the LiDAR supports any shift. dx = dy = 0,
 *   `score` <= 0, `flagged` is true; downstream treats the cluster as unreliable (single box).
 *
 * Exactly: `source === 'none'` iff `score <= 0`. A cluster with no LiDAR coverage gets no Shift at
 * all (`registerCluster` returns null); downstream stores its shift source as NULL.
 */
export type ShiftSource = 'fit' | 'frame-nad83' | 'frame-wgs84' | 'zero' | 'none';

export interface Shift {
  dx: number;
  dy: number;
  source: ShiftSource;
  /** The chosen shift's score (the peak's for `fit`, the candidate's otherwise). */
  score: number;
  /** Best score farther than regSecondPeakM from the peak over the peak's; 1 when the peak <= 0. */
  ratio: number;
  /** Weighted spread (m) of the grid cells within 10% of the peak. */
  sharpX: number;
  sharpY: number;
  /** The peak lies on the border of the search grid. */
  atEdge: boolean;
  flagged: boolean;
}

/** The window a cluster's registration reads: its footprints padded by the search and the blur. */
export function registrationBbox(members: Footprint[]): Bbox7131 {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const m of members)
    for (const poly of m.shape)
      for (const ring of poly)
        for (const [x, y] of ring) {
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
  const pad = BOXES.regSearchM + 2;
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** The search offsets, -regSearchM..regSearchM at regStepM. */
function searchShifts(): Float64Array {
  const half = Math.round(BOXES.regSearchM / BOXES.regStepM);
  return Float64Array.from({ length: 2 * half + 1 }, (_, k) => (k - half) * BOXES.regStepM);
}

function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

/**
 * Points every regSampleStepM along every ring of every member, with outward unit normals (outer
 * rings oriented CCW and holes CW here, whatever the input), stride-subsampled to at most
 * regMaxSamples. Flat [x, y, nx, ny, ...].
 */
function boundarySamples(members: Footprint[]): Float64Array {
  const out: number[] = [];
  const step = BOXES.regSampleStepM;
  for (const m of members)
    for (const poly of m.shape)
      poly.forEach((ring0, k) => {
        if (ring0.length < 3) return;
        const ccw = signedArea(ring0) > 0;
        const ring = ccw === (k === 0) ? ring0 : [...ring0].reverse();
        for (let i = 0; i < ring.length; i++) {
          const [ax, ay] = ring[i];
          const [bx, by] = ring[(i + 1) % ring.length];
          const ex = bx - ax;
          const ey = by - ay;
          const len = Math.hypot(ex, ey);
          if (len < 1e-6) continue;
          const n = Math.ceil(len / step);
          // Right-hand normal: outward for a CCW outer ring and for a CW hole.
          const nx = ey / len;
          const ny = -ex / len;
          for (let t = 0; t < n; t++) {
            const f = (t + 0.5) / n;
            out.push(ax + f * ex, ay + f * ey, nx, ny);
          }
        }
      });
  const total = out.length / 4;
  const stride = Math.max(1, Math.ceil(total / BOXES.regMaxSamples));
  if (stride === 1) return Float64Array.from(out);
  const keep = Math.ceil(total / stride);
  const sub = new Float64Array(keep * 4);
  for (let s = 0, o = 0; s < total; s += stride, o += 4)
    for (let c = 0; c < 4; c++) sub[o + c] = out[s * 4 + c];
  return sub;
}

/** Median of the finite, non-vegetation height-above-ground cells under the unshifted footprints. */
function referenceHeight(w: RasterWindow, members: Footprint[]): number | null {
  const under = new Uint8Array(w.nx * w.ny);
  for (const m of members) {
    const mask = cellMask(w, m.shape);
    for (let k = 0; k < mask.length; k++) if (mask[k]) under[k] = 1;
  }
  const vals: number[] = [];
  for (let k = 0; k < under.length; k++)
    if (under[k] && !w.veg[k] && Number.isFinite(w.hag[k])) vals.push(w.hag[k]);
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  const mid = vals.length >> 1;
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

/**
 * The edge-gradient score of every shift on the search grid. S is row-major with rows along dy:
 * S[iy * n + ix] scores the shift (shifts[ix], shifts[iy]). Each score is the mean over boundary
 * samples of the downhill gradient of the normalised raised-ness image along the outward normal,
 * read at the sample moved by the shift.
 */
export function scoreGrid(
  w: RasterWindow,
  members: Footprint[],
  href: number
): { shifts: Float64Array; S: Float64Array } {
  const { nx, ny, res } = w;
  const scale = Math.max(0.6 * href, 1.5);
  const hn = new Float32Array(nx * ny);
  for (let k = 0; k < hn.length; k++) {
    const h = w.veg[k] || !Number.isFinite(w.hag[k]) ? 0 : w.hag[k];
    hn[k] = Math.min(1, Math.max(0, (h - 0.5) / scale));
  }
  const { gx, gy } = gradient(gaussian(hn, nx, ny, 1), nx, ny, res);

  const shifts = searchShifts();
  const n = shifts.length;
  const S = new Float64Array(n * n);
  const P = boundarySamples(members);
  const m = P.length / 4;
  if (m === 0) return { shifts, S };

  // Continuous cell coordinates (u, v) of each sample; a shift adds shift / res. Reads clamp to
  // the window (edge-nearest), as the spike's map_coordinates(mode='nearest') did.
  const u0 = new Float64Array(m);
  const v0 = new Float64Array(m);
  const nxs = new Float64Array(m);
  const nys = new Float64Array(m);
  for (let s = 0; s < m; s++) {
    u0[s] = (P[s * 4] - w.x0) / res - 0.5;
    v0[s] = (P[s * 4 + 1] - w.y0) / res - 0.5;
    nxs[s] = P[s * 4 + 2];
    nys[s] = P[s * 4 + 3];
  }
  const uMax = nx - 1;
  const vMax = ny - 1;
  const iLast = Math.max(0, nx - 2);
  const jLast = Math.max(0, ny - 2);
  const dI = nx > 1 ? 1 : 0;
  const dJ = ny > 1 ? nx : 0;
  for (let iy = 0; iy < n; iy++) {
    const dv = shifts[iy] / res;
    for (let ix = 0; ix < n; ix++) {
      const du = shifts[ix] / res;
      let sum = 0;
      for (let s = 0; s < m; s++) {
        let u = u0[s] + du;
        let v = v0[s] + dv;
        u = u < 0 ? 0 : u > uMax ? uMax : u;
        v = v < 0 ? 0 : v > vMax ? vMax : v;
        let i = Math.floor(u);
        let j = Math.floor(v);
        if (i > iLast) i = iLast;
        if (j > jLast) j = jLast;
        const fu = u - i;
        const fv = v - j;
        const k = j * nx + i;
        const w00 = (1 - fu) * (1 - fv);
        const w10 = fu * (1 - fv);
        const w01 = (1 - fu) * fv;
        const w11 = fu * fv;
        const a = gx[k] * w00 + gx[k + dI] * w10 + gx[k + dJ] * w01 + gx[k + dI + dJ] * w11;
        const b = gy[k] * w00 + gy[k + dI] * w10 + gy[k + dJ] * w01 + gy[k + dI + dJ] * w11;
        sum -= a * nxs[s] + b * nys[s];
      }
      S[iy * n + ix] = sum / m;
    }
  }
  return { shifts, S };
}

/**
 * The score grid's peak and its confidence.
 * - The peak is the weighted centroid (weights S - threshold) of the cells within 10% of the best
 *   score that lie within regSecondPeakM of the best cell. On a sharp peak this is the sub-cell
 *   refinement; where eaves make the LiDAR outline larger than the footprint, opposite walls give
 *   two close maxima and the centroid lands between them (the spike's parabolic refinement picked
 *   one wall pair).
 * - `ratio`: the best score farther than regSecondPeakM from the peak over the peak's (1 when the
 *   peak is not positive).
 * - `sharpX`/`sharpY`: the weighted spread about the peak of every cell within 10% of the best.
 * - `atEdge`: the best cell lies on the border of the search grid.
 */
export function analysePeak(
  shifts: Float64Array,
  S: Float64Array
): Omit<Shift, 'source' | 'flagged'> {
  const n = shifts.length;
  const near = BOXES.regSecondPeakM;
  let bi = 0;
  for (let k = 1; k < S.length; k++) if (S[k] > S[bi]) bi = k;
  const ix = bi % n;
  const iy = (bi - ix) / n;
  const best = S[bi];
  const thr = best - 0.1 * Math.abs(best);

  let ws = 0;
  let sx = 0;
  let sy = 0;
  for (let jy = 0; jy < n; jy++)
    for (let jx = 0; jx < n; jx++) {
      const v = S[jy * n + jx];
      if (v < thr || Math.hypot(shifts[jx] - shifts[ix], shifts[jy] - shifts[iy]) > near) continue;
      ws += v - thr;
      sx += (v - thr) * shifts[jx];
      sy += (v - thr) * shifts[jy];
    }
  const dx = ws > 0 ? sx / ws : shifts[ix];
  const dy = ws > 0 ? sy / ws : shifts[iy];

  let second = -Infinity;
  let wt = 0;
  let wxx = 0;
  let wyy = 0;
  let cnt = 0;
  let cxx = 0;
  let cyy = 0;
  for (let jy = 0; jy < n; jy++)
    for (let jx = 0; jx < n; jx++) {
      const v = S[jy * n + jx];
      const ddx = (shifts[jx] - dx) ** 2;
      const ddy = (shifts[jy] - dy) ** 2;
      if (ddx + ddy > near * near && v > second) second = v;
      if (v >= thr) {
        wt += v - thr;
        wxx += (v - thr) * ddx;
        wyy += (v - thr) * ddy;
        cnt++;
        cxx += ddx;
        cyy += ddy;
      }
    }
  // A flat peak (best = 0) gives every top cell weight 0: fall back to equal weights.
  const sharpX = wt > 0 ? Math.sqrt(wxx / wt) : Math.sqrt(cxx / cnt);
  const sharpY = wt > 0 ? Math.sqrt(wyy / wt) : Math.sqrt(cyy / cnt);
  const ratio = best > 0 && Number.isFinite(second) ? second / best : 1;
  const lim = shifts[n - 1] - 1e-6;
  const atEdge = Math.abs(shifts[ix]) >= lim || Math.abs(shifts[iy]) >= lim;
  return { dx, dy, score: best, ratio, sharpX, sharpY, atEdge };
}

/** Bilinear read of the score grid at a continuous shift (clamped to the grid). */
function scoreAt(shifts: Float64Array, S: Float64Array, dx: number, dy: number): number {
  const n = shifts.length;
  const step = shifts[1] - shifts[0];
  const u = Math.min(Math.max((dx - shifts[0]) / step, 0), n - 1);
  const v = Math.min(Math.max((dy - shifts[0]) / step, 0), n - 1);
  const i = Math.min(Math.floor(u), n - 2);
  const j = Math.min(Math.floor(v), n - 2);
  const fu = u - i;
  const fv = v - j;
  return (
    S[j * n + i] * (1 - fu) * (1 - fv) +
    S[j * n + i + 1] * fu * (1 - fv) +
    S[(j + 1) * n + i] * (1 - fu) * fv +
    S[(j + 1) * n + i + 1] * fu * fv
  );
}

/**
 * One rigid shift for a cluster's members. A confident fit (not at the edge, positive, second-peak
 * ratio under regAmbiguousRatio) is `fit`. Otherwise the two OSM frames and (0,0) are scored on the
 * grid and the best positive one wins, flagged; `none` when none is positive.
 *
 * Returns null when there is no LiDAR coverage: no window, or no finite height under any member.
 */
export function registerCluster(w: RasterWindow | null, members: Footprint[]): Shift | null {
  if (!w) return null;
  const href = referenceHeight(w, members);
  if (href === null) return null;
  const { shifts, S } = scoreGrid(w, members, href);
  const peak = analysePeak(shifts, S);
  if (!peak.atEdge && peak.score > 0 && peak.ratio < BOXES.regAmbiguousRatio)
    return { ...peak, source: 'fit', flagged: false };

  const candidates: [ShiftSource, number, number][] = [
    ['zero', 0, 0],
    ...Object.entries(BOXES.regFrames).map(([name, [fx, fy]]): [ShiftSource, number, number] => [
      name as ShiftSource,
      fx,
      fy
    ])
  ];
  let pick: [ShiftSource, number, number] | null = null;
  let pickScore = -Infinity;
  for (const c of candidates) {
    const sc = scoreAt(shifts, S, c[1], c[2]);
    if (sc > pickScore) {
      pick = c;
      pickScore = sc;
    }
  }
  if (!pick || !(pickScore > 0))
    return { ...peak, dx: 0, dy: 0, score: pickScore, source: 'none', flagged: true };
  return { ...peak, dx: pick[1], dy: pick[2], score: pickScore, source: pick[0], flagged: true };
}
