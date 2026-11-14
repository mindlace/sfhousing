// Per-building boxes from registered LiDAR (spec "Per-building boxes", "Ground reference"): a base
// box at the main roof (mid-roof when pitched), false-front strips along street faces, interior
// steps with flush faces, or today's single box as a fallback. Cells are sampled at footprint +
// shift; every output polygon is in the footprint's frame and inside the derived shape.
import { BOXES } from '../../boxes-config.js';
import {
  area,
  bufferLine,
  cellsToPoly,
  difference,
  grow,
  inset,
  intersect,
  union,
  type Bbox7131,
  type MultiPoly,
  type Ring
} from '../../geom.js';
import type { RasterWindow } from './mosaic.js';
import { cellMask, gaussian, gradient, label4 } from './raster.js';
import type { Footprint, Shift } from './register.js';
import type { StreetIndex } from './streets.js';

export type BoxSrc = 'box' | 'base' | 'front' | 'step' | 'part';

export interface RenderBox {
  bid: string;
  k: number;
  src: BoxSrc;
  shape: MultiPoly;
  baseM: number;
  heightM: number;
}

export type Fallback = 'no_lidar' | 'new_building' | 'unreliable' | 'elevated';

export interface RoofRecord {
  bid: string;
  roof: 'flat' | 'pitched' | 'unknown';
  eaveM: number | null;
  ridgeM: number | null;
  /** [0, 180) degrees clockwise from grid north. */
  ridgeDeg: number | null;
  groundM: number | null;
  groundMinM: number | null;
  fallback: Fallback | null;
  nFront: number;
  nStep: number;
  stepsCapped: boolean;
}

export interface DeriveInput {
  fp: Footprint;
  /** The cluster's registration; null when the cluster has no LiDAR coverage. */
  shift: Shift | null;
  streets: StreetIndex;
  /** Restrict the derivation to this part of the footprint (the parts' uncovered area). */
  area?: MultiPoly;
  kStart?: number;
}

const round1 = (v: number): number => Math.round(v * 10) / 10 + 0;
const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;

function bboxOf(p: MultiPoly): Bbox7131 {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const poly of p)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return { x0, y0, x1, y1 };
}

/** The cells of w over b (clamped to w); null when they do not overlap. */
function subWindow(w: RasterWindow, b: Bbox7131): RasterWindow | null {
  const i0 = Math.max(0, Math.floor((b.x0 - w.x0) / w.res));
  const j0 = Math.max(0, Math.floor((b.y0 - w.y0) / w.res));
  const i1 = Math.min(w.nx, Math.ceil((b.x1 - w.x0) / w.res));
  const j1 = Math.min(w.ny, Math.ceil((b.y1 - w.y0) / w.res));
  const nx = i1 - i0;
  const ny = j1 - j0;
  if (nx <= 0 || ny <= 0) return null;
  const hag = new Float32Array(nx * ny);
  const ground = new Float32Array(nx * ny);
  const veg = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const src = (j0 + j) * w.nx + i0;
    hag.set(w.hag.subarray(src, src + nx), j * nx);
    ground.set(w.ground.subarray(src, src + nx), j * nx);
    veg.set(w.veg.subarray(src, src + nx), j * nx);
  }
  return { x0: w.x0 + i0 * w.res, y0: w.y0 + j0 * w.res, res: w.res, nx, ny, hag, ground, veg };
}

/** The window a building reads: its footprint at the shift, padded by 1 m for the 3x3 filters. */
function buildingWindow(
  w: RasterWindow,
  fp: Footprint,
  dx: number,
  dy: number
): RasterWindow | null {
  const b = bboxOf(fp.shape);
  return subWindow(w, {
    x0: b.x0 + dx - 1,
    y0: b.y0 + dy - 1,
    x1: b.x1 + dx + 1,
    y1: b.y1 + dy + 1
  });
}

function median(sorted: ArrayLike<number>, lo = 0, hi = sorted.length): number {
  const n = hi - lo;
  const m = lo + (n >> 1);
  return n % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

function groundIn(
  w: RasterWindow,
  shape: MultiPoly,
  dx: number,
  dy: number
): { groundM: number; groundMinM: number } | null {
  const mask = cellMask(w, shape, dx, dy);
  const vals: number[] = [];
  for (let k = 0; k < mask.length; k++)
    if (mask[k] && Number.isFinite(w.ground[k])) vals.push(w.ground[k]);
  if (vals.length === 0) return null;
  vals.sort((a, b) => a - b);
  return { groundM: round2(median(vals)), groundMinM: round2(vals[0]) };
}

/**
 * The building's ground reference (spec "Ground reference", ruling F3): the median and the lowest
 * ground (NAVD88 m, to the cm) under the WHOLE footprint, read at footprint + shift. Null without
 * a window or without ground under the footprint.
 */
export function groundOf(
  w: RasterWindow | null,
  fp: Footprint,
  shift: Shift | null
): { groundM: number; groundMinM: number } | null {
  if (!w) return null;
  const dx = shift?.dx ?? 0;
  const dy = shift?.dy ?? 0;
  const sw = buildingWindow(w, fp, dx, dy);
  return sw ? groundIn(sw, fp.shape, dx, dy) : null;
}

// ---- masks ----

function erode3(m: Uint8Array, nx: number, ny: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let j = 1; j < ny - 1; j++)
    for (let i = 1; i < nx - 1; i++) {
      let all = 1;
      for (let b = -1; b <= 1 && all; b++)
        for (let a = -1; a <= 1; a++)
          if (!m[(j + b) * nx + i + a]) {
            all = 0;
            break;
          }
      out[j * nx + i] = all;
    }
  return out;
}

function dilate3(m: Uint8Array, nx: number, ny: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      if (!m[j * nx + i]) continue;
      for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++)
        for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) out[b * nx + a] = 1;
    }
  return out;
}

/** Cells whose 3x3 neighbourhood (finite cells only) has a population std of h over limit. */
function roughMask(h: Float64Array, nx: number, ny: number, limit: number): Uint8Array {
  const out = new Uint8Array(h.length);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let n = 0;
      let s = 0;
      let ss = 0;
      for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++)
        for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) {
          const v = h[b * nx + a];
          if (Number.isNaN(v)) continue;
          n++;
          s += v;
          ss += v * v;
        }
      if (n < 2) continue;
      const mean = s / n;
      if (ss / n - mean * mean > limit * limit) out[j * nx + i] = 1;
    }
  return out;
}

// ---- roof form ----

/**
 * A roof model's misfit over C: squared residuals capped at stepGapM², so cells a storey or more
 * off the model (steps, fronts) count as outliers, not as evidence against the roof under them.
 */
const capped = (r: number): number => Math.min(r * r, BOXES.stepGapM * BOXES.stepGapM);

interface Flat {
  top: number;
  /** The capped loss of every C cell against its nearest level. */
  loss: number;
}

/**
 * Flat roof levels: 0.5 m histogram of h over C smoothed [1,2,1]; levels are local maxima whose
 * three bins hold >= 10% of C (value: the median of those bins' cells), merged when under stepGapM
 * apart (the larger kept). The main roof is the lowest level whose nearest-level share is >=
 * roofMainShareMin, else the largest; top is the median h of C within 1 m of it.
 */
function flatRoof(sorted: Float64Array): Flat {
  const n = sorted.length;
  const bw = BOXES.roofBinM;
  const b0 = Math.floor(sorted[0] / bw);
  const nb = Math.floor(sorted[n - 1] / bw) - b0 + 1;
  const counts = new Float64Array(nb);
  for (let k = 0; k < n; k++) counts[Math.floor(sorted[k] / bw) - b0]++;
  const c = (i: number): number => (i >= 0 && i < nb ? counts[i] : 0);
  const s = (i: number): number => c(i - 1) + 2 * c(i) + c(i + 1);
  // First index with sorted[k] >= v.
  const lower = (v: number): number => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const cands: { v: number; mass: number }[] = [];
  let peakBin = 0;
  for (let i = 0; i < nb; i++) {
    if (s(i) > s(peakBin)) peakBin = i;
    if (!(s(i) > s(i - 1) && s(i) >= s(i + 1))) continue;
    const mass = c(i - 1) + c(i) + c(i + 1);
    if (mass < 0.1 * n) continue;
    const lo = lower((b0 + i - 1) * bw);
    const hi = lower((b0 + i + 2) * bw);
    cands.push({ v: median(sorted, lo, hi), mass });
  }
  if (cands.length === 0) {
    const lo = lower((b0 + peakBin - 1) * bw);
    const hi = lower((b0 + peakBin + 2) * bw);
    cands.push({ v: median(sorted, lo, hi), mass: hi - lo });
  }
  cands.sort((a, b) => b.mass - a.mass || a.v - b.v);
  const levels: number[] = [];
  for (const cd of cands)
    if (levels.every((l) => Math.abs(l - cd.v) >= BOXES.stepGapM)) levels.push(cd.v);
  levels.sort((a, b) => a - b);

  const share = new Float64Array(levels.length);
  let loss = 0;
  for (let k = 0; k < n; k++) {
    let best = 0;
    for (let l = 1; l < levels.length; l++)
      if (Math.abs(sorted[k] - levels[l]) < Math.abs(sorted[k] - levels[best])) best = l;
    share[best]++;
    loss += capped(sorted[k] - levels[best]);
  }
  let main = -1;
  for (let l = 0; l < levels.length && main < 0; l++)
    if (share[l] / n >= BOXES.roofMainShareMin) main = l;
  if (main < 0) {
    main = 0;
    for (let l = 1; l < levels.length; l++) if (share[l] > share[main]) main = l;
  }
  const lo = lower(levels[main] - 1);
  const hi = lower(levels[main] + 1 + 1e-9);
  return { top: hi > lo ? median(sorted, lo, hi) : levels[main], loss };
}

/**
 * The median local slope (m/m) over C, from h on C only, Gaussian-smoothed (sigma 2 cells) against
 * LiDAR noise. A pitched roof is sloped almost everywhere; a stepped one (a 2 m front band, a
 * podium and tower) is flat almost everywhere, however well a plane fits it.
 */
function medianSlope(h: Float64Array, cIdx: number[], nx: number, ny: number, res: number): number {
  const hc = new Float32Array(nx * ny).fill(NaN);
  for (const k of cIdx) hc[k] = h[k];
  const { gx, gy } = gradient(gaussian(hc, nx, ny, BOXES.pitchSlopeSigmaCells), nx, ny, res);
  const s: number[] = [];
  for (const k of cIdx) {
    const v = Math.hypot(gx[k], gy[k]);
    if (Number.isFinite(v)) s.push(v);
  }
  if (s.length === 0) return 0;
  s.sort((a, b) => a - b);
  return median(s);
}

interface Fit {
  kind: 'gable' | 'shed';
  /** Unit axis the roof varies along (perpendicular to the ridge), and its origin. */
  ex: number;
  ey: number;
  ox: number;
  oy: number;
  /** gable: h = r - k |u - u0|; shed: h = r + k u. */
  r: number;
  k: number;
  u0: number;
  sse: number;
  r2: number;
}

function fitAt(f: Fit, x: number, y: number): number {
  const u = (x - f.ox) * f.ex + (y - f.oy) * f.ey;
  return f.kind === 'gable' ? f.r - f.k * Math.abs(u - f.u0) : f.r + f.k * u;
}

/** The angle of the interior's minimum-area rotated rectangle (rotating calipers on the hull). */
function minRectAngle(p: MultiPoly): number {
  const pts = p.flatMap((poly) => poly[0] ?? []).map(([x, y]): [number, number] => [x, y]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lowerH: [number, number][] = [];
  for (const q of pts) {
    while (
      lowerH.length >= 2 &&
      cross(lowerH[lowerH.length - 2], lowerH[lowerH.length - 1], q) <= 0
    )
      lowerH.pop();
    lowerH.push(q);
  }
  const upperH: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    while (
      upperH.length >= 2 &&
      cross(upperH[upperH.length - 2], upperH[upperH.length - 1], q) <= 0
    )
      upperH.pop();
    upperH.push(q);
  }
  const hull = lowerH.slice(0, -1).concat(upperH.slice(0, -1));
  let bestA = Infinity;
  let bestT = 0;
  for (let i = 0; i < hull.length; i++) {
    const [ax, ay] = hull[i];
    const [bx, by] = hull[(i + 1) % hull.length];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-9) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, y] of hull) {
      const u = x * ux + y * uy;
      const v = -x * uy + y * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const a = (u1 - u0) * (v1 - v0);
    if (a < bestA - 1e-9) {
      bestA = a;
      bestT = Math.atan2(uy, ux);
    }
  }
  return bestT;
}

/**
 * Least-squares gable (h = r - k|u - u0|, k > 0, u0 searched at 0.1 m then 0.01 m) and shed
 * (h = r + k u) fits along both axes of the interior's minimum rotated rectangle; the best R².
 */
function pitchFit(
  xs: Float64Array,
  ys: Float64Array,
  hs: Float64Array,
  theta: number,
  ox: number,
  oy: number
): Fit | null {
  const n = hs.length;
  let sh = 0;
  let shh = 0;
  for (let k = 0; k < n; k++) {
    sh += hs[k];
    shh += hs[k] * hs[k];
  }
  const sst = shh - (sh * sh) / n;
  if (!(sst > 1e-9)) return null;
  let best: Fit | null = null;
  // Ties go to the earlier fit: a gable whose ridge sits on the last cell column is the shed.
  const consider = (f: Omit<Fit, 'r2'>): void => {
    const r2 = 1 - f.sse / sst;
    if (!best || r2 > best.r2 + 1e-9) best = { ...f, r2 };
  };
  for (const t of [theta, theta + Math.PI / 2]) {
    const ex = Math.cos(t);
    const ey = Math.sin(t);
    const u = new Float64Array(n);
    for (let k = 0; k < n; k++) u[k] = (xs[k] - ox) * ex + (ys[k] - oy) * ey;

    // Shed.
    let su = 0;
    let suu = 0;
    let suh = 0;
    for (let k = 0; k < n; k++) {
      su += u[k];
      suu += u[k] * u[k];
      suh += u[k] * hs[k];
    }
    const varU = suu - (su * su) / n;
    if (varU > 1e-9) {
      const cov = suh - (su * sh) / n;
      const b = cov / varU;
      consider({
        kind: 'shed',
        ex,
        ey,
        ox,
        oy,
        r: (sh - b * su) / n,
        k: b,
        u0: 0,
        sse: sst - b * cov
      });
    }

    // Gable, with prefix sums over the cells sorted by u.
    const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => u[a] - u[b]);
    const us = new Float64Array(n);
    const pu = new Float64Array(n + 1);
    const ph = new Float64Array(n + 1);
    const puh = new Float64Array(n + 1);
    for (let q = 0; q < n; q++) {
      const k = order[q];
      us[q] = u[k];
      pu[q + 1] = pu[q] + u[k];
      ph[q + 1] = ph[q] + hs[k];
      puh[q + 1] = puh[q] + u[k] * hs[k];
    }
    const gable = (u0: number): { sse: number; r: number; k: number } | null => {
      let lo = 0;
      let hi = n;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (us[mid] < u0) lo = mid + 1;
        else hi = mid;
      }
      const p = lo;
      const st = u0 * p - pu[p] + (pu[n] - pu[p]) - u0 * (n - p);
      const stt = suu - 2 * u0 * su + n * u0 * u0;
      const sth = u0 * ph[p] - puh[p] + (puh[n] - puh[p]) - u0 * (ph[n] - ph[p]);
      const varT = stt - (st * st) / n;
      if (!(varT > 1e-9)) return null;
      const cov = sth - (st * sh) / n;
      const c = cov / varT;
      if (!(c < 0)) return null;
      return { sse: sst - c * cov, r: (sh - c * st) / n, k: -c };
    };
    let bu = NaN;
    let bs = Infinity;
    const search = (a: number, b: number, step: number): void => {
      for (let u0 = a; u0 <= b + 1e-9; u0 += step) {
        const g = gable(u0);
        if (g && g.sse < bs) {
          bs = g.sse;
          bu = u0;
        }
      }
    };
    search(us[0], us[n - 1], 0.1);
    if (Number.isFinite(bu)) {
      search(Math.max(us[0], bu - 0.1), Math.min(us[n - 1], bu + 0.1), 0.01);
      const g = gable(bu)!;
      consider({ kind: 'gable', ex, ey, ox, oy, r: g.r, k: g.k, u0: bu, sse: g.sse });
    }
  }
  return best;
}

// ---- faces ----

interface Face {
  path: Ring;
  mid: [number, number];
  n: [number, number];
}

function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

/** Distance from (x, y) to the nearest edge of any outer ring of p. */
function distToOuter(p: MultiPoly, x: number, y: number): number {
  let d = Infinity;
  for (const poly of p) {
    const ring = poly[0];
    if (!ring) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j];
      const ex = ring[i][0] - x1;
      const ey = ring[i][1] - y1;
      const l2 = ex * ex + ey * ey;
      const s = l2 > 0 ? Math.max(0, Math.min(1, ((x - x1) * ex + (y - y1) * ey) / l2)) : 0;
      d = Math.min(d, Math.hypot(x - (x1 + s * ex), y - (y1 + s * ey)));
    }
  }
  return d;
}

/** Edges within 1 cm of the footprint's exterior lie on it (`area` comes back from clipper at mm). */
const ON_EXTERIOR_M = 0.01;

/**
 * Faces of the outer rings: runs of consecutive edges whose turns, and whose deviation from the
 * run's first edge, stay under frontFaceAngleDeg; at least frontMinFaceM long. Only edges on the
 * exterior of `footprint` count: a cut of `area` against a counted part is never a face. `n` is the
 * outward unit normal of the face's chord; `mid` is halfway along it.
 */
function facesOf(shape: MultiPoly, footprint: MultiPoly): Face[] {
  const lim = (BOXES.frontFaceAngleDeg * Math.PI) / 180;
  const faces: Face[] = [];
  const onExterior = (a: [number, number], b: [number, number]): boolean =>
    [0, 0.25, 0.5, 0.75, 1].every(
      (f) =>
        distToOuter(footprint, a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])) <= ON_EXTERIOR_M
    );
  for (const poly of shape) {
    const ring0 = poly[0];
    if (!ring0 || ring0.length < 3) continue;
    const ring = signedArea(ring0) > 0 ? ring0 : [...ring0].reverse();
    const edges: {
      a: [number, number];
      b: [number, number];
      t: number;
      len: number;
      ext: boolean;
    }[] = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 1e-6)
        edges.push({ a, b, t: Math.atan2(b[1] - a[1], b[0] - a[0]), len, ext: onExterior(a, b) });
    }
    const m = edges.length;
    if (m < 3) continue;
    const turn = (s: number, t: number): number => {
      const d = Math.abs(t - s) % (2 * Math.PI);
      return d > Math.PI ? 2 * Math.PI - d : d;
    };
    // Start just after a cut edge if there is one, else at the sharpest corner, so no run wraps
    // past a break.
    let start = 0;
    const cut = edges.findIndex((e) => !e.ext);
    if (cut >= 0) start = (cut + 1) % m;
    else
      for (let i = 1; i < m; i++)
        if (
          turn(edges[(i + m - 1) % m].t, edges[i].t) >
          turn(edges[(start + m - 1) % m].t, edges[start].t)
        )
          start = i;
    let run: typeof edges = [];
    const close = (): void => {
      const len = run.reduce((s, e) => s + e.len, 0);
      if (run.length && len >= BOXES.frontMinFaceM) {
        const path: Ring = [run[0].a, ...run.map((e) => e.b)];
        const [ax, ay] = path[0];
        const [bx, by] = path[path.length - 1];
        const cl = Math.hypot(bx - ax, by - ay);
        let rest = len / 2;
        let mid: [number, number] = path[0];
        for (const e of run) {
          if (rest <= e.len) {
            const f = rest / e.len;
            mid = [e.a[0] + f * (e.b[0] - e.a[0]), e.a[1] + f * (e.b[1] - e.a[1])];
            break;
          }
          rest -= e.len;
        }
        if (cl > 1e-6) faces.push({ path, mid, n: [(by - ay) / cl, -(bx - ax) / cl] });
      }
      run = [];
    };
    for (let q = 0; q < m; q++) {
      const e = edges[(start + q) % m];
      if (!e.ext) {
        close();
        continue;
      }
      if (run.length && (turn(run[run.length - 1].t, e.t) >= lim || turn(run[0].t, e.t) >= lim))
        close();
      run.push(e);
    }
    close();
  }
  return faces;
}

// ---- the derivation ----

function quantile(sorted: number[], p: number): number {
  const x = p * (sorted.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}

/** Polygons of a multipolygon that overlap `core`. */
function touching(p: MultiPoly, core: MultiPoly): MultiPoly {
  return p.filter((poly) => area(intersect([poly], core)) > 1e-6);
}

/**
 * The boxes of one building (or of `area`, the part of it no counted part covers). Heights are
 * metres above the building's ground reference: heightM rounded to 0.1 and clamped to
 * heightRangeM, baseM in [0, heightM) (ruling F6). A fallback returns exactly one `box` with
 * fp.baseM / fp.heightM over `area ?? fp.shape` and `roof: 'unknown'`. An empty `area` returns no
 * boxes and no fallback. The ground reference is always the whole footprint's (F3).
 */
export function deriveBoxes(
  w: RasterWindow | null,
  inp: DeriveInput
): { boxes: RenderBox[]; roof: RoofRecord } {
  const { fp, shift, streets } = inp;
  const k0 = inp.kStart ?? 0;
  const shape = inp.area ?? fp.shape;
  const dx = shift?.dx ?? 0;
  const dy = shift?.dy ?? 0;
  const sw = w ? buildingWindow(w, fp, dx, dy) : null;
  const g = sw ? groundIn(sw, fp.shape, dx, dy) : null;
  const rec: RoofRecord = {
    bid: fp.bid,
    roof: 'unknown',
    eaveM: null,
    ridgeM: null,
    ridgeDeg: null,
    groundM: g?.groundM ?? null,
    groundMinM: g?.groundMinM ?? null,
    fallback: null,
    nFront: 0,
    nStep: 0,
    stepsCapped: false
  };
  if (!(area(shape) > 0)) return { boxes: [], roof: rec };
  const fallback = (f: Fallback): { boxes: RenderBox[]; roof: RoofRecord } => ({
    boxes: [{ bid: fp.bid, k: k0, src: 'box', shape, baseM: fp.baseM, heightM: fp.heightM }],
    roof: { ...rec, fallback: f }
  });

  if (fp.baseM > 0) return fallback('elevated');
  if (!sw || !shift || !g) return fallback('no_lidar');
  const { nx, ny, res } = sw;
  const shapeMask = cellMask(sw, shape, dx, dy);
  let nShape = 0;
  let nShapeFinite = 0;
  for (let k = 0; k < shapeMask.length; k++)
    if (shapeMask[k]) {
      nShape++;
      if (Number.isFinite(sw.hag[k])) nShapeFinite++;
    }
  if (nShape > 0 && nShapeFinite === 0) return fallback('no_lidar');

  const interior = inset(shape, BOXES.marginM);
  if (area(interior) < BOXES.minInteriorM2) return fallback('unreliable');
  const intMask = cellMask(sw, interior, dx, dy);
  let nInt = 0;
  let nFinite = 0;
  let nLow = 0;
  for (let k = 0; k < intMask.length; k++) {
    if (!intMask[k]) continue;
    nInt++;
    if (!Number.isFinite(sw.hag[k])) continue;
    nFinite++;
    if (sw.hag[k] < BOXES.raisedHagM) nLow++;
  }
  if (nInt === 0 || nFinite / nInt < BOXES.coverageMin) return fallback('unreliable');
  // Ground before the registration test: a lot built after the flight has nothing to register
  // against (its score grid is flat, source 'none'), and it is a new building, not unreliable.
  if (nLow / nFinite >= BOXES.groundShareMin) return fallback('new_building');
  if (shift.source === 'none') return fallback('unreliable');

  // Height above the reference, and C: interior cells, finite, not vegetation, raised.
  const h = new Float64Array(nx * ny);
  for (let k = 0; k < h.length; k++) {
    const v = sw.hag[k] + sw.ground[k] - g.groundM;
    h[k] = Number.isFinite(v) ? v : NaN;
  }
  const cIdx: number[] = [];
  for (let k = 0; k < h.length; k++)
    if (intMask[k] && !Number.isNaN(h[k]) && !sw.veg[k] && sw.hag[k] >= BOXES.raisedHagM)
      cIdx.push(k);
  // Raised non-vegetation cells under minInteriorM2: nothing in the LiDAR is a building (a lot
  // with trees, built after the flight).
  if (cIdx.length * res * res < BOXES.minInteriorM2) return fallback('new_building');

  const nC = cIdx.length;
  const cx = new Float64Array(nC);
  const cy = new Float64Array(nC);
  const ch = new Float64Array(nC);
  cIdx.forEach((k, q) => {
    const i = k % nx;
    const j = (k - i) / nx;
    cx[q] = sw.x0 + (i + 0.5) * res - dx;
    cy[q] = sw.y0 + (j + 0.5) * res - dy;
    ch[q] = h[k];
  });

  // Roof form.
  const sortedH = Float64Array.from(ch).sort();
  const flat = flatRoof(sortedH);
  const verts = shape.flatMap((poly) => poly[0] ?? []);
  const ox = verts.reduce((s, v) => s + v[0], 0) / verts.length;
  const oy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
  const theta = minRectAngle(interior);
  let fit = pitchFit(cx, cy, ch, theta, ox, oy);
  if (fit) {
    // One trimmed refit: cells a false front or more (frontRiseM) off the first fit are not roof
    // surface (fronts, dormers, rooftop structures) and would drag the plane.
    const first = fit;
    const keep: number[] = [];
    for (let q = 0; q < nC; q++)
      if (Math.abs(ch[q] - fitAt(first, cx[q], cy[q])) <= BOXES.frontRiseM) keep.push(q);
    if (keep.length < nC && keep.length * res * res >= BOXES.minInteriorM2)
      fit = pitchFit(
        Float64Array.from(keep, (q) => cx[q]),
        Float64Array.from(keep, (q) => cy[q]),
        Float64Array.from(keep, (q) => ch[q]),
        theta,
        ox,
        oy
      );
  }
  let top = flat.top;
  let model: (x: number, y: number) => number = () => flat.top;
  rec.roof = 'flat';
  if (fit && fit.r2 >= BOXES.pitchMinR2 && Math.abs(fit.k) >= BOXES.pitchMinSlope) {
    let eave = Infinity;
    let ridge = -Infinity;
    let uMin = Infinity;
    let uMax = -Infinity;
    for (const [x, y] of verts) {
      const v = fitAt(fit, x, y);
      eave = Math.min(eave, v);
      ridge = Math.max(ridge, v);
      const u = (x - ox) * fit.ex + (y - oy) * fit.ey;
      uMin = Math.min(uMin, u);
      uMax = Math.max(uMax, u);
    }
    if (fit.kind === 'gable' && fit.u0 >= uMin && fit.u0 <= uMax) ridge = fit.r;
    // A pitched fit must also explain all of C better than the flat levels do (capped loss): a
    // podium and a tower spanning one axis fit a shed plane with R² up to 0.75.
    let loss = 0;
    for (let q = 0; q < nC; q++) loss += capped(ch[q] - fitAt(fit, cx[q], cy[q]));
    if (
      ridge - eave >= BOXES.pitchMinRiseM &&
      loss < flat.loss &&
      medianSlope(h, cIdx, nx, ny, res) >= BOXES.pitchSlopeShareMin * Math.abs(fit.k)
    ) {
      rec.roof = 'pitched';
      rec.eaveM = round1(eave);
      rec.ridgeM = round1(ridge);
      // Round, then reduce: rounding 179.96 after the reduction would give 180.0.
      const deg = round1((Math.atan2(-fit.ey, fit.ex) * 180) / Math.PI);
      rec.ridgeDeg = (((deg % 180) + 180) % 180) + 0;
      top = (eave + ridge) / 2;
      const f = fit;
      model = (x, y) => fitAt(f, x, y);
    }
  }
  const clampH = (v: number): number =>
    Math.min(Math.max(round1(v), BOXES.heightRangeM[0]), BOXES.heightRangeM[1]);
  // The base box's rendered top. Front rise and step gap are measured from it (plan decision),
  // and on a flat roof it is the roof model.
  const baseTop = clampH(top);
  if (rec.roof === 'flat') model = () => baseTop;

  // Steps: cells clearly above the roof model, without rough texture, opened by one cell and
  // grown back one cell into the candidates (the rough ring a wall edge leaves).
  const rough = roughMask(h, nx, ny, BOXES.treeRoughM);
  const cand = new Uint8Array(nx * ny);
  cIdx.forEach((k, q) => {
    if (ch[q] - model(cx[q], cy[q]) >= BOXES.stepGapM) cand[k] = 1;
  });
  const s0 = new Uint8Array(nx * ny);
  for (let k = 0; k < s0.length; k++) s0[k] = cand[k] && !rough[k] ? 1 : 0;
  const s1 = dilate3(erode3(s0, nx, ny), nx, ny);
  const back = dilate3(s1, nx, ny);
  const s2 = new Uint8Array(nx * ny);
  for (let k = 0; k < s2.length; k++) s2[k] = s1[k] || (back[k] && cand[k]) ? 1 : 0;

  const { labels, n: nComp } = label4(s2, nx, ny);
  const comps: number[][] = Array.from({ length: nComp }, () => []);
  for (let k = 0; k < labels.length; k++) if (labels[k]) comps[labels[k] - 1].push(k);
  const parts: { cells: number[]; level: number }[] = [];
  const medianOf = (cells: number[]): number => {
    const v = Float64Array.from(cells, (k) => h[k]).sort();
    return median(v);
  };
  const minCells = BOXES.stepMinAreaM2 / (res * res);
  for (const comp of comps) {
    if (comp.length < minCells) continue;
    const cut = medianOf(comp) + BOXES.stepGapM;
    const high = comp.filter((k) => h[k] >= cut);
    const pieces: number[][] = [];
    if (high.length === 0) pieces.push(comp);
    else
      for (const sub of [comp.filter((k) => h[k] < cut), high]) {
        const m = new Uint8Array(nx * ny);
        for (const k of sub) m[k] = 1;
        const l = label4(m, nx, ny);
        const groups: number[][] = Array.from({ length: l.n }, () => []);
        for (const k of sub) groups[l.labels[k] - 1].push(k);
        pieces.push(...groups);
      }
    for (const cells of pieces) {
      if (cells.length < minCells) continue;
      const level = medianOf(cells);
      if (level - baseTop >= BOXES.stepGapM) parts.push({ cells, level });
    }
  }
  parts.sort(
    (a, b) =>
      b.cells.length * (b.level - baseTop) - a.cells.length * (a.level - baseTop) ||
      b.level - a.level ||
      a.cells[0] - b.cells[0]
  );
  rec.stepsCapped = parts.length > BOXES.stepCap;
  const kept = parts
    .slice(0, BOXES.stepCap)
    .sort((a, b) => b.level - a.level || a.cells[0] - b.cells[0]);

  // Flush faces: a step reaching the margin is grown out to the real edge, within the outer ring
  // the interior's edge cells can leave (marginM + res).
  const edgeZone = difference(shape, inset(shape, BOXES.marginM + res));
  const stepCells = new Uint8Array(nx * ny);
  const steps: { shape: MultiPoly; level: number }[] = [];
  let stepUnion: MultiPoly = [];
  for (const p of kept) {
    const m = new Uint8Array(nx * ny);
    for (const k of p.cells) {
      m[k] = 1;
      stepCells[k] = 1;
    }
    const core = cellsToPoly(sw, m, dx, dy);
    const flush = intersect(grow(core, BOXES.marginM + res), edgeZone);
    let poly = touching(intersect(union([core, flush]), shape), core);
    if (stepUnion.length) poly = difference(poly, stepUnion);
    if (!(area(poly) > 0.01)) continue;
    steps.push({ shape: poly, level: p.level });
    stepUnion = union([stepUnion, poly]);
  }

  // False fronts: per street face, the frontPct quantile of h in the band from the margin to
  // frontBandM in, without vegetation, rough or step cells (F15); a strip when it stands
  // frontRiseM over the base top. A band left with under coverageMin of its cells is skipped.
  const stepNear = dilate3(stepCells, nx, ny);
  const fronts: { shape: MultiPoly; value: number }[] = [];
  for (const face of facesOf(shape, fp.shape)) {
    if (!streets.facing(face.mid, face.n, BOXES.frontStreetM, BOXES.frontFacingCos)) continue;
    const bandMask = cellMask(
      sw,
      intersect(bufferLine(face.path, BOXES.frontBandM), interior),
      dx,
      dy
    );
    let nBand = 0;
    const vals: number[] = [];
    const above: number[] = [];
    for (let k = 0; k < bandMask.length; k++) {
      if (!bandMask[k]) continue;
      nBand++;
      if (Number.isNaN(h[k]) || sw.veg[k] || rough[k] || stepNear[k]) continue;
      vals.push(h[k]);
      const i = k % nx;
      const j = (k - i) / nx;
      above.push(h[k] - model(sw.x0 + (i + 0.5) * res - dx, sw.y0 + (j + 0.5) * res - dy));
    }
    if (nBand === 0 || vals.length < BOXES.coverageMin * nBand) continue;
    vals.sort((a, b) => a - b);
    above.sort((a, b) => a - b);
    const value = quantile(vals, BOXES.frontPct);
    // The band must stand over the base top AND over the roof surface: a gable end facing the
    // street reaches toward the ridge, above mid-roof, but is no false front. On a flat roof the
    // two tests are the same.
    if (value - baseTop < BOXES.frontRiseM || quantile(above, BOXES.frontPct) < BOXES.frontRiseM)
      continue;
    fronts.push({ shape: intersect(bufferLine(face.path, BOXES.frontDepthM), shape), value });
  }
  // Steps win over strips whatever their height (a step reaching the street face is the facade
  // there); between strips the taller wins.
  fronts.sort((a, b) => b.value - a.value);
  const frontBoxes: { shape: MultiPoly; value: number }[] = [];
  let taken = stepUnion;
  for (const f of fronts) {
    const poly = taken.length ? difference(f.shape, taken) : f.shape;
    if (!(area(poly) > 0.01)) continue;
    frontBoxes.push({ shape: poly, value: f.value });
    taken = union([taken, poly]);
  }

  const boxes: RenderBox[] = [
    { bid: fp.bid, k: k0, src: 'base', shape, baseM: 0, heightM: baseTop }
  ];
  const upper = (src: BoxSrc, s: MultiPoly, v: number): void => {
    const heightM = clampH(v);
    if (heightM <= baseTop) return;
    boxes.push({ bid: fp.bid, k: k0 + boxes.length, src, shape: s, baseM: baseTop, heightM });
  };
  for (const f of frontBoxes) upper('front', f.shape, f.value);
  for (const s of steps) upper('step', s.shape, s.level);
  rec.nFront = boxes.filter((b) => b.src === 'front').length;
  rec.nStep = boxes.filter((b) => b.src === 'step').length;
  return { boxes, roof: rec };
}
