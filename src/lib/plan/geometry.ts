import type { PlanOp } from './types';

/** Metres in the plan-model plane (spec §4.1). */
export type XY = [x: number, y: number];
export type BBox = [minLng: number, minLat: number, maxLng: number, maxLat: number];
export type XYBox = [minX: number, minY: number, maxX: number, maxY: number];

// Equirectangular about φ₀ = 37.7562°, mean Earth radius 6,371,008.8 m. Literals: never compute
// these at runtime (no trig — ECMAScript trig is not bit-identical across engines).
export const LNG0 = -122.4431;
export const LAT0 = 37.7562;
export const M_PER_DEG_LNG = 87913.423594147971;
export const M_PER_DEG_LAT = 111195.08023353292;

/**
 * Extra growth for candidate boxes only. The exact squared-distance test decides coverage; the pad
 * just guarantees rounding in the interpolated foot point can never drop a true candidate.
 */
export const CANDIDATE_PAD_M = 1e-3;

export function project(lng: number, lat: number): XY {
  return [(lng - LNG0) * M_PER_DEG_LNG, (lat - LAT0) * M_PER_DEG_LAT];
}

export function projectPath(path: readonly (readonly [number, number])[]): XY[] {
  return path.map(([lng, lat]) => project(lng, lat));
}

/** Squared distance from L to segment AB. Evaluation order is fixed by spec §4.2. */
export function segDist2(l: XY, a: XY, b: XY): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 === 0 ? 0 : ((l[0] - a[0]) * abx + (l[1] - a[1]) * aby) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const px = a[0] + t * abx;
  const py = a[1] + t * aby;
  const dx = l[0] - px;
  const dy = l[1] - py;
  return dx * dx + dy * dy;
}

/** Inclusive: covered iff some segment (or the single point) is within r (r2 = r * r). */
export function pathCovers(path: readonly XY[], r2: number, l: XY): boolean {
  if (path.length === 1) return segDist2(l, path[0], path[0]) <= r2;
  for (let i = 1; i < path.length; i++) {
    if (segDist2(l, path[i - 1], path[i]) <= r2) return true;
  }
  return false;
}

export function segmentBoxes(path: readonly XY[], grow: number): XYBox[] {
  if (path.length === 1) {
    const [x, y] = path[0];
    return [[x - grow, y - grow, x + grow, y + grow]];
  }
  const out: XYBox[] = [];
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1];
    const [bx, by] = path[i];
    out.push([
      (ax < bx ? ax : bx) - grow,
      (ay < by ? ay : by) - grow,
      (ax > bx ? ax : bx) + grow,
      (ay > by ? ay : by) + grow
    ]);
  }
  return out;
}

export function pathBox(path: readonly XY[], grow: number): XYBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of path) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX - grow, minY - grow, maxX + grow, maxY + grow];
}

export function boxesIntersect(a: XYBox, b: XYBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

export function pointInBox(p: XY, b: XYBox): boolean {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

export function assertNever(x: never): never {
  throw new Error(`Unhandled plan op: ${JSON.stringify(x)}`);
}

/** The projected path of an op. Exhaustive over PlanOp kinds (seam for AreaOp, spec §5). */
export function opPath(op: PlanOp): XY[] {
  switch (op.kind) {
    case 'paint':
    case 'erase':
      return projectPath(op.path);
    default:
      return assertNever(op);
  }
}

/** Projected op bbox, grown by radiusM plus CANDIDATE_PAD_M. */
export function opXYBox(op: PlanOp): XYBox {
  switch (op.kind) {
    case 'paint':
    case 'erase':
      return pathBox(opPath(op), op.radiusM + CANDIDATE_PAD_M);
    default:
      return assertNever(op);
  }
}

/** Path bbox in lng/lat grown by radiusM (plus the pad); used to pick which chunks to load. */
export function opBBox(op: PlanOp): BBox {
  switch (op.kind) {
    case 'paint':
    case 'erase': {
      const g = op.radiusM + CANDIDATE_PAD_M;
      let minLng = Infinity;
      let minLat = Infinity;
      let maxLng = -Infinity;
      let maxLat = -Infinity;
      for (const [lng, lat] of op.path) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
      const dLng = g / M_PER_DEG_LNG;
      const dLat = g / M_PER_DEG_LAT;
      return [minLng - dLng, minLat - dLat, maxLng + dLng, maxLat + dLat];
    }
    default:
      return assertNever(op);
  }
}

/** ParcelId order: JS string `<` (never locale, never numeric). */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
