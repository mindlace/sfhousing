/**
 * Metric dashes along a lng/lat path (no `PathStyleExtension`, which would be a new dependency).
 * Used by the eraser's painted-lot outlines and the height-limit rims and contours.
 */
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';

/** The eraser's painted-lot outline and the lid rims: 4 m dashes, 3 m gaps (tier 4). */
export const OUTLINE_DASH_M = 4;
export const OUTLINE_GAP_M = 3;

const lengthM = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot((b[0] - a[0]) * M_PER_DEG_LNG, (b[1] - a[1]) * M_PER_DEG_LAT);

/**
 * `path` (2D lng/lat or 3D lng/lat/z points) as dash paths of `dashM` metres with `gapM` gaps,
 * measured along the ground from the first point. `closed` joins the last point back to the first
 * (a ring that already repeats its first point is not joined twice). Every dash vertex has the
 * dimension of the path's first point; z is interpolated linearly along each segment. A dash that
 * crosses a vertex keeps it.
 */
export function dashPath(
  path: readonly (readonly number[])[],
  dashM: number,
  gapM: number,
  closed: boolean
): number[][][] {
  if (path.length < 2 || dashM <= 0) return [];
  const dim = path[0].length >= 3 ? 3 : 2;
  const pts: number[][] = path.map((p) => p.slice(0, dim));
  if (closed) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (first.some((v, i) => v !== last[i])) pts.push(first.slice());
  }
  // cum[i]: metres from the start to vertex i
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + lengthM(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];

  let seg = 0;
  const at = (d: number): number[] => {
    // d only grows across calls, so the segment search resumes where it stopped
    while (seg < pts.length - 2 && cum[seg + 1] < d) seg++;
    const span = cum[seg + 1] - cum[seg];
    const t = span === 0 ? 0 : (d - cum[seg]) / span;
    const a = pts[seg];
    const b = pts[seg + 1];
    const out = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (dim === 3) out.push(a[2] + (b[2] - a[2]) * t);
    return out;
  };

  const dashes: number[][][] = [];
  const period = dashM + Math.max(gapM, 0);
  for (let s = 0; s < total; s += period) {
    const e = Math.min(s + dashM, total);
    const dash: number[][] = [at(s)];
    const from = seg;
    for (let i = from + 1; i < pts.length - 1; i++) {
      if (cum[i] >= e) break;
      if (cum[i] > s) dash.push(pts[i]);
    }
    dash.push(at(e));
    dashes.push(dash);
  }
  return dashes;
}
