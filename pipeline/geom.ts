// Geometry for the building-boxes pipeline: polygons in EPSG:7131 metres on clipper2-ts (PathsD at
// precision 3 = mm, deterministic). A Poly is an outer ring then its holes; rings are open (the
// closing vertex is implicit). Outers are returned counter-clockwise, holes clockwise.
import { Clipper, FillRule, JoinType, EndType, type PathsD } from 'clipper2-ts';
import type { Ring } from './lib/rings.js';
import type { RasterWindow } from './lib/lidar/mosaic.js';

export type { Ring };
export type Poly = Ring[];
export type MultiPoly = Poly[];

/** Axis-aligned box in EPSG:7131 metres (x east, y north). */
export interface Bbox7131 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const PRECISION = 3;
const MITER_LIMIT = 3;

function signedArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
  return a / 2;
}

function oriented(r: Ring, ccw: boolean): Ring {
  return signedArea(r) > 0 === ccw ? r : [...r].reverse();
}

function toPaths(p: MultiPoly): PathsD {
  const out: PathsD = [];
  for (const poly of p)
    poly.forEach((ring, k) => {
      if (ring.length < 3) return;
      out.push(oriented(ring, k === 0).map(([x, y]) => ({ x, y })));
    });
  return out;
}

function inRingStrict(x: number, y: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function fromPaths(paths: PathsD): MultiPoly {
  const outers: { ring: Ring; area: number; holes: Ring[] }[] = [];
  const holes: Ring[] = [];
  for (const path of paths) {
    const ring: Ring = path.map((q): [number, number] => [q.x, q.y]);
    if (ring.length < 3) continue;
    const a = signedArea(ring);
    if (a > 0) outers.push({ ring, area: a, holes: [] });
    else if (a < 0) holes.push(oriented(ring, false));
  }
  for (const h of holes) {
    let best: (typeof outers)[number] | null = null;
    for (const o of outers) {
      if (best && o.area >= best.area) continue;
      if (h.some(([x, y]) => inRingStrict(x, y, o.ring))) best = o;
    }
    if (best) best.holes.push(h);
  }
  return outers.map((o) => [o.ring, ...o.holes]);
}

function offset(p: MultiPoly, d: number): MultiPoly {
  if (p.length === 0) return [];
  return fromPaths(
    Clipper.inflatePathsD(toPaths(p), d, JoinType.Miter, EndType.Polygon, MITER_LIMIT, PRECISION)
  );
}

/** Negative buffer, miter joins. */
export function inset(p: MultiPoly, d: number): MultiPoly {
  return offset(p, -d);
}

export function grow(p: MultiPoly, d: number): MultiPoly {
  return offset(p, d);
}

export function union(a: MultiPoly[]): MultiPoly {
  const paths = a.flatMap((p) => toPaths(p));
  if (paths.length === 0) return [];
  return fromPaths(Clipper.unionD(paths, [], FillRule.NonZero, PRECISION));
}

export function intersect(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0 || b.length === 0) return [];
  return fromPaths(Clipper.intersectD(toPaths(a), toPaths(b), FillRule.NonZero, PRECISION));
}

export function difference(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (a.length === 0) return [];
  if (b.length === 0) return union([a]);
  return fromPaths(Clipper.differenceD(toPaths(a), toPaths(b), FillRule.NonZero, PRECISION));
}

export function area(p: MultiPoly): number {
  let s = 0;
  for (const poly of p)
    poly.forEach((ring, k) => {
      const a = Math.abs(signedArea(ring));
      s += k === 0 ? a : -a;
    });
  return s;
}

export function translate(p: MultiPoly, dx: number, dy: number): MultiPoly {
  return p.map((poly) =>
    poly.map((ring) => ring.map(([x, y]): [number, number] => [x + dx, y + dy]))
  );
}

/**
 * Row runs of masked cells as rectangles (vertically merged where consecutive rows repeat a run),
 * unioned, then translated by (-dx, -dy): the mask lives where the LiDAR is, the result where the
 * footprint is.
 */
export function cellsToPoly(w: RasterWindow, mask: Uint8Array, dx = 0, dy = 0): MultiPoly {
  const { nx, ny, res } = w;
  const open = new Map<string, { i0: number; i1: number; j0: number }>();
  const rects: MultiPoly[] = [];
  const emit = (r: { i0: number; i1: number; j0: number }, j1: number): void => {
    const xa = w.x0 + r.i0 * res;
    const xb = w.x0 + (r.i1 + 1) * res;
    const ya = w.y0 + r.j0 * res;
    const yb = w.y0 + j1 * res;
    rects.push([
      [
        [
          [xa, ya],
          [xb, ya],
          [xb, yb],
          [xa, yb]
        ]
      ]
    ]);
  };
  for (let j = 0; j <= ny; j++) {
    const seen = new Set<string>();
    if (j < ny) {
      let i = 0;
      while (i < nx) {
        if (!mask[j * nx + i]) {
          i++;
          continue;
        }
        let e = i;
        while (e + 1 < nx && mask[j * nx + e + 1]) e++;
        const key = `${i},${e}`;
        seen.add(key);
        if (!open.has(key)) open.set(key, { i0: i, i1: e, j0: j });
        i = e + 1;
      }
    }
    for (const [key, r] of [...open])
      if (!seen.has(key)) {
        emit(r, j);
        open.delete(key);
      }
  }
  return translate(union(rects), -dx, -dy);
}

function ringOf(c: number[][]): Ring {
  const r: Ring = c.map((q): [number, number] => [q[0], q[1]]);
  const f = r[0];
  const l = r[r.length - 1];
  if (r.length > 1 && f[0] === l[0] && f[1] === l[1]) r.pop();
  return r;
}

/** DuckDB ST_AsGeoJSON: Polygon or MultiPolygon. */
export function fromGeoJson(g: string): MultiPoly {
  const j = JSON.parse(g) as { type: string; coordinates: number[][][] | number[][][][] };
  if (j.type === 'Polygon') return [(j.coordinates as number[][][]).map(ringOf)];
  if (j.type === 'MultiPolygon')
    return (j.coordinates as number[][][][]).map((poly) => poly.map(ringOf));
  throw new Error(`fromGeoJson: unsupported geometry ${j.type}`);
}

export function toGeoJson(p: MultiPoly): string {
  const closed = (r: Ring): number[][] => [...r, r[0]].map(([x, y]) => [x, y]);
  const polys = p.map((poly) => poly.map(closed));
  return JSON.stringify(
    polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0] }
      : { type: 'MultiPolygon', coordinates: polys }
  );
}
