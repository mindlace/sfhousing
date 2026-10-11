import {
  EndType,
  FillRule,
  inflatePathsD,
  intersectD,
  JoinType,
  type PathD,
  type PathsD
} from 'clipper2-ts';
import { CLIPPER_PRECISION, MIN_PIECE_M2 } from './constants';

export interface Vec {
  x: number;
  y: number;
}

/** Shoelace area; CCW (y up) is positive. */
export function signedArea(p: PathD): number {
  let s = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function totalArea(paths: PathsD): number {
  let s = 0;
  for (const p of paths) s += Math.abs(signedArea(p));
  return s;
}

/** Area centroid (computed relative to the first vertex for stability). */
export function centroid(p: PathD): Vec {
  const ox = p[0].x;
  const oy = p[0].y;
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const x0 = p[i].x - ox;
    const y0 = p[i].y - oy;
    const x1 = p[(i + 1) % n].x - ox;
    const y1 = p[(i + 1) % n].y - oy;
    const cr = x0 * y1 - x1 * y0;
    a2 += cr;
    cx += (x0 + x1) * cr;
    cy += (y0 + y1) * cr;
  }
  return { x: ox + cx / (3 * a2), y: oy + cy / (3 * a2) };
}

/**
 * Long principal axis: eigenvector of the larger eigenvalue of the second-moment matrix
 * about `c` (closed-form 2×2). Tie → (1,0). Sign: u.x > 0, or u.x = 0 and u.y > 0.
 */
export function principalAxis(p: PathD, c: Vec): Vec {
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  const n = p.length;
  for (let i = 0; i < n; i++) {
    const x0 = p[i].x - c.x;
    const y0 = p[i].y - c.y;
    const x1 = p[(i + 1) % n].x - c.x;
    const y1 = p[(i + 1) % n].y - c.y;
    const cr = x0 * y1 - x1 * y0;
    sxx += cr * (x0 * x0 + x0 * x1 + x1 * x1);
    syy += cr * (y0 * y0 + y0 * y1 + y1 * y1);
    sxy += cr * (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0);
  }
  sxx /= 12;
  syy /= 12;
  sxy /= 24;
  if (sxx + syy < 0) {
    // clockwise ring: every moment has its sign flipped
    sxx = -sxx;
    syy = -syy;
    sxy = -sxy;
  }
  const half = (sxx - syy) / 2;
  const disc = Math.sqrt(half * half + sxy * sxy);
  const mean = (sxx + syy) / 2;
  const l1 = mean + disc;
  const l2 = mean - disc;
  if (l1 - l2 <= 1e-9 * (l1 + l2)) return { x: 1, y: 0 };
  // (λ1 − syy, sxy) and (sxy, λ1 − sxx) are both eigenvectors; pick the better-conditioned one
  let ux: number;
  let uy: number;
  if (half >= 0) {
    ux = half + disc;
    uy = sxy;
  } else {
    ux = sxy;
    uy = disc - half;
  }
  const len = Math.sqrt(ux * ux + uy * uy);
  ux /= len;
  uy /= len;
  if (ux < 0 || (ux === 0 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  return { x: ux, y: uy };
}

export function project(paths: PathsD, o: Vec, d: Vec): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const p of paths) {
    for (const q of p) {
      const t = (q.x - o.x) * d.x + (q.y - o.y) * d.y;
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  return { min, max };
}

/** Sutherland–Hodgman against the half-plane nx·x + ny·y ≤ k. */
function clipHalf(poly: PathD, nx: number, ny: number, k: number): PathD {
  const out: PathD = [];
  const n = poly.length;
  if (n === 0) return out;
  let prev = poly[n - 1];
  let dp = nx * prev.x + ny * prev.y - k;
  for (const cur of poly) {
    const dc = nx * cur.x + ny * cur.y - k;
    if (dc <= 0) {
      if (dp > 0) {
        const t = dp / (dp - dc);
        out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
      }
      out.push(cur);
    } else if (dp <= 0) {
      const t = dp / (dp - dc);
      out.push({ x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t });
    }
    prev = cur;
    dp = dc;
  }
  return out;
}

/** Clip `p` to the slab |(q − c)·u| ≤ h (two half-planes, in-house, no Clipper). */
export function clipSlab(p: PathD, c: Vec, u: Vec, h: number): PathD {
  const k = u.x * c.x + u.y * c.y;
  return clipHalf(clipHalf(p, u.x, u.y, k + h), -u.x, -u.y, -(k - h));
}

/** Rectangle c + t·u + s·v for t∈[u0,u1], s∈[v0,v1]; CCW when v = rot90(u). */
export function orientedRect(
  c: Vec,
  u: Vec,
  v: Vec,
  u0: number,
  u1: number,
  v0: number,
  v1: number
): PathD {
  const at = (t: number, s: number) => ({ x: c.x + t * u.x + s * v.x, y: c.y + t * u.y + s * v.y });
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

/** Open ring, no repeated vertices, CCW, starting at the lexicographically smallest (x, y). */
export function canonicalRing(p: PathD): PathD {
  let already = p.length >= 3;
  for (let i = 0; i < p.length && already; i++) {
    const q = p[i],
      prev = p[(i + p.length - 1) % p.length];
    if ((q.x === prev.x && q.y === prev.y) || q.x < p[0].x || (q.x === p[0].x && q.y < p[0].y))
      already = false;
  }
  if (already && signedArea(p) > 0) return p;
  const pts: PathD = [];
  for (const q of p) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== q.x || last.y !== q.y) pts.push({ x: q.x, y: q.y });
  }
  while (
    pts.length > 1 &&
    pts[0].x === pts[pts.length - 1].x &&
    pts[0].y === pts[pts.length - 1].y
  ) {
    pts.pop();
  }
  if (signedArea(pts) < 0) pts.reverse();
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < pts[start].x || (pts[i].x === pts[start].x && pts[i].y < pts[start].y))
      start = i;
  }
  return pts.slice(start).concat(pts.slice(0, start));
}

/** Recognize rectangles without depending on their orientation or vertex start. */
export function isRectangle(p: PathD): boolean {
  if (p.length !== 4) return false;
  const [a, b, c, d] = p;
  const ux = b.x - a.x,
    uy = b.y - a.y,
    vx = d.x - a.x,
    vy = d.y - a.y;
  const scale = Math.max(1, Math.hypot(ux, uy) * Math.hypot(vx, vy));
  return (
    Math.abs(ux * vx + uy * vy) < scale * 1e-10 &&
    Math.abs(c.x - b.x - d.x + a.x) < 1e-8 &&
    Math.abs(c.y - b.y - d.y + a.y) < 1e-8
  );
}

/** Inward offset by `d` metres (Miter, closed polygons, cm grid). */
export function inset(paths: PathsD, d: number, precision = CLIPPER_PRECISION): PathsD {
  if (paths.length === 1 && isRectangle(paths[0])) {
    const p = paths[0],
      a = p[0],
      b = p[1],
      z = p[3];
    const lu = Math.hypot(b.x - a.x, b.y - a.y),
      lv = Math.hypot(z.x - a.x, z.y - a.y);
    if (lu <= 2 * d || lv <= 2 * d) return [];
    const u = { x: (b.x - a.x) / lu, y: (b.y - a.y) / lu },
      v = { x: (z.x - a.x) / lv, y: (z.y - a.y) / lv };
    return [canonicalRing(orientedRect(a, u, v, d, lu - d, d, lv - d))];
  }
  return inflatePathsD(paths, -d, JoinType.Miter, EndType.Polygon, 2, precision);
}

export function intersect(a: PathsD, b: PathsD): PathsD {
  if (a.length === 1 && b.length === 1 && isRectangle(a[0]) && isRectangle(b[0])) {
    let ring = a[0];
    const clip = canonicalRing(b[0]);
    for (let i = 0; i < 4; i++) {
      const p = clip[i],
        q = clip[(i + 1) % 4],
        nx = q.y - p.y,
        ny = p.x - q.x;
      ring = clipHalf(ring, nx, ny, nx * p.x + ny * p.y);
    }
    return ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-8 ? [canonicalRing(ring)] : [];
  }
  return intersectD(a, b, FillRule.NonZero, CLIPPER_PRECISION);
}

export function keepPieces(paths: PathsD, min = MIN_PIECE_M2): PathsD {
  return paths.filter((p) => Math.abs(signedArea(p)) >= min);
}

export function largest(paths: PathsD): PathD | null {
  let best: PathD | null = null;
  let bestA = -1;
  for (const p of paths) {
    const a = Math.abs(signedArea(p));
    if (a > bestA) {
      best = p;
      bestA = a;
    }
  }
  return best;
}
