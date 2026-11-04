// The /lesscars basemap split (docs/dev/lesscars.md "Basemap ids", Task 1's verdict `split`): the
// protomaps `roads` features of a removed freeway stretch are merged across the cut at the zooms
// the page shows, so they cannot be hidden by id. The tiles step clips them at the removal
// corridor (the phase's lines buffered by LC.basemapBandM, flat caps) and moves the parts inside it
// that run along a removed line, and nearer it than any kept freeway line, to source layer
// `roads_lc`, tagged `lc_project`; the page draws that layer with clones of the road layers and
// hides a project's features from its open day.
import { VectorTile, type VectorTileFeature, type VectorTileLayer } from '@mapbox/vector-tile';
import {
  fromVectorTileJs,
  type VectorTileFeatureLike,
  type VectorTileLayerLike
} from '@maplibre/vt-pbf';
import Pbf from 'pbf';
import { LC } from '../../lesscars-config';
import type { Duck } from '../duck';

export const LC_ROADS_LAYER = 'roads_lc';

export interface SplitPhase {
  projectId: string;
  /** Curated ids (basemap-ids.json): moved inside the corridor whatever their kind or direction. */
  ids: ReadonlySet<number>;
  /** The removed lines, [lng, lat]: the phase's CNN centrelines. */
  lines: [number, number][][];
  /** Polygon ring(s), [lng, lat]: the phase's lines buffered by basemapBandM. */
  corridor: [number, number][][];
}

export interface SplitOptions {
  /** The kept freeways' lines, [lng, lat]: a part nearer one of them than a removed line stays. */
  keep?: readonly [number, number][][];
  /**
   * Refs only kept freeways carry (e.g. `I 280`): an unlisted road whose every `;`-separated ref
   * token is one of them stays whole, wherever it runs.
   */
  keepRefs?: readonly string[];
  /** A part within this of a line may run along it, metres (default LC.basemapBandM). */
  bandM?: number;
  /** A part runs along a line when their directions differ by at most this, degrees. */
  parallelDeg?: number;
}

type Pt = [number, number];

/** Equatorial circumference of the Web Mercator sphere, metres. */
const EARTH_M = 2 * Math.PI * 6_378_137;
/** Step of the along test inside a corridor, metres (at least one tile unit). */
const STEP_M = 2;
type Edge = [number, number, number, number]; // u0, v0, u1, v1
type Geometry = ReturnType<VectorTileFeatureLike['loadGeometry']>;

/** Web Mercator [0, 1] world coordinates of a [lng, lat]. */
export function world([lng, lat]: Pt): Pt {
  const r = (lat * Math.PI) / 180;
  return [(lng + 180) / 360, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2];
}

interface WorldPhase {
  rings: Pt[][];
  lines: Pt[][];
  bbox: [number, number, number, number]; // world x0, y0, x1, y1
}
const worldCache = new WeakMap<SplitPhase, WorldPhase>();
const keepCache = new WeakMap<readonly Pt[][], Pt[][]>();

function worldKeep(keep: readonly Pt[][]): Pt[][] {
  let w = keepCache.get(keep);
  if (!w) {
    w = keep.map((l) => l.map(world));
    keepCache.set(keep, w);
  }
  return w;
}

function worldOf(p: SplitPhase): WorldPhase {
  let w = worldCache.get(p);
  if (!w) {
    const rings = p.corridor.map((r) => r.map(world));
    const pts = rings.flat();
    w = {
      rings,
      lines: p.lines.map((l) => l.map(world)),
      bbox: [
        Math.min(...pts.map((q) => q[0])),
        Math.min(...pts.map((q) => q[1])),
        Math.max(...pts.map((q) => q[0])),
        Math.max(...pts.map((q) => q[1]))
      ]
    };
    worldCache.set(p, w);
  }
  return w;
}

/** A phase's corridor in one tile's units, with the edges near the tile. */
interface TilePhase {
  index: number;
  phase: SplitPhase;
  /** Edges whose box meets the region: the crossings. */
  cross: Edge[];
  /** Edges whose v span meets the region: the point-in-polygon ray (to +u) may meet any of them. */
  ray: Edge[];
  /** The removed lines' segments near the tile. */
  segs: Seg[];
}

/** A line segment in tile units, with its unit direction. */
export interface Seg {
  a: Pt;
  b: Pt;
  ux: number;
  uy: number;
}

/** The segments of world-coordinate lines within `pad` tile units of the tile's region. */
export function tileSegs(
  lines: Pt[][],
  n: number,
  x: number,
  y: number,
  extent: number,
  pad: number
) {
  const out: Seg[] = [];
  const [lo, hi] = [-0.5 * extent - pad, 1.5 * extent + pad];
  for (const l of lines)
    for (let i = 1; i < l.length; i++) {
      const a: Pt = [(l[i - 1][0] * n - x) * extent, (l[i - 1][1] * n - y) * extent];
      const b: Pt = [(l[i][0] * n - x) * extent, (l[i][1] * n - y) * extent];
      if (Math.max(a[0], b[0]) < lo || Math.min(a[0], b[0]) > hi) continue;
      if (Math.max(a[1], b[1]) < lo || Math.min(a[1], b[1]) > hi) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len > 0) out.push({ a, b, ux: (b[0] - a[0]) / len, uy: (b[1] - a[1]) / len });
    }
  return out;
}

/**
 * Distance from p to the nearest segment within `band` that runs along the unit direction
 * (ux, uy), either sense (|cos| of the angle at least cosT); Infinity when there is none.
 */
export function alongDist(p: Pt, ux: number, uy: number, segs: Seg[], band: number, cosT: number) {
  let best = Infinity;
  for (const s of segs) {
    if (Math.abs(ux * s.ux + uy * s.uy) < cosT) continue;
    const [ex, ey] = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - s.a[0]) * ex + (p[1] - s.a[1]) * ey) / (ex * ex + ey * ey))
    );
    const d = Math.hypot(p[0] - (s.a[0] + t * ex), p[1] - (s.a[1] + t * ey));
    if (d <= band && d < best) best = d;
  }
  return best;
}

/** A basemap freeway road: a motorway (`highway`) or any link (ramp), whatever its ref or none. */
export function freewayRoad(props: Record<string, unknown>): boolean {
  const link = props.is_link;
  return props.kind === 'highway' || link === true || link === 'true' || link === 1;
}

interface Along {
  /** The kept freeways' segments near the tile. */
  keep: Seg[];
  band: number; // tile units
  cosT: number;
  step: number; // tile units
}

/**
 * Relabels a run inside a corridor step by step: a step goes to the phase, among those whose
 * corridor holds it, with the nearest removed line along it, unless a kept freeway line along it
 * is nearer (then -1, it stays). A step along no removed line goes to the first phase listing the
 * feature whose corridor holds it, only when no kept line runs along it; else -1. Vertices are
 * kept, and points are added only where the label changes.
 */
function refineRun(
  pts: Pt[],
  phases: TilePhase[],
  listed: (p: TilePhase) => boolean,
  along: Along
): { label: number; pts: Pt[] }[] {
  const labelAt = (p: Pt, ux: number, uy: number): number => {
    let best = -1;
    let bestD = Infinity;
    let firstListed = -1;
    for (const ph of phases) {
      if (!inside(p, ph.ray)) continue;
      const d = alongDist(p, ux, uy, ph.segs, along.band, along.cosT);
      if (d < bestD) [best, bestD] = [ph.index, d];
      if (firstListed < 0 && listed(ph)) firstListed = ph.index;
    }
    const dKeep = alongDist(p, ux, uy, along.keep, along.band, along.cosT);
    if (best >= 0) return bestD <= dKeep ? best : -1;
    return dKeep === Infinity ? firstListed : -1;
  };
  const out: { label: number; pts: Pt[] }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) continue;
    const [ux, uy] = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    const k = Math.max(1, Math.ceil(len / along.step));
    const at = (t: number): Pt => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    for (let j = 0; j < k; j++) {
      const label = labelAt(at((j + 0.5) / k), ux, uy);
      const last = out.at(-1);
      if (!last) out.push({ label, pts: [a] });
      else if (last.label !== label) {
        const cut = at(j / k);
        last.pts.push(cut);
        out.push({ label, pts: [cut] });
      }
    }
    out.at(-1)!.pts.push(b);
  }
  return out;
}

/** Consecutive runs with one label joined (each run starts where the one before ends). */
function joined(runs: { label: number; pts: Pt[] }[]): { label: number; pts: Pt[] }[] {
  const out: { label: number; pts: Pt[] }[] = [];
  for (const r of runs) {
    const last = out.at(-1);
    if (last && last.label === r.label) last.pts.push(...r.pts.slice(1));
    else out.push({ label: r.label, pts: [...r.pts] });
  }
  return out;
}

function inside(p: Pt, edges: Edge[]): boolean {
  let c = false;
  for (const [u0, v0, u1, v1] of edges)
    if (v0 > p[1] !== v1 > p[1] && p[0] < ((u1 - u0) * (p[1] - v0)) / (v1 - v0) + u0) c = !c;
  return c;
}

/** Parameters t in (0, 1) where segment a→b crosses an edge. */
function crossings(a: Pt, b: Pt, edges: Edge[], out: number[]): void {
  const ru = b[0] - a[0];
  const rv = b[1] - a[1];
  const [lo0, hi0] = a[0] < b[0] ? [a[0], b[0]] : [b[0], a[0]];
  const [lo1, hi1] = a[1] < b[1] ? [a[1], b[1]] : [b[1], a[1]];
  for (const [u0, v0, u1, v1] of edges) {
    if (Math.max(u0, u1) < lo0 || Math.min(u0, u1) > hi0) continue;
    if (Math.max(v0, v1) < lo1 || Math.min(v0, v1) > hi1) continue;
    const du = u1 - u0;
    const dv = v1 - v0;
    const den = ru * dv - rv * du;
    if (den === 0) continue;
    const qu = u0 - a[0];
    const qv = v0 - a[1];
    const t = (qu * dv - qv * du) / den;
    const s = (qu * rv - qv * ru) / den;
    if (t > 0 && t < 1 && s >= 0 && s <= 1) out.push(t);
  }
}

/** A line split into runs, each labelled with the index into `phases` holding it (-1: none). */
function runsOf(line: Pt[], phases: TilePhase[]): { label: number; pts: Pt[] }[] {
  const runs: { label: number; pts: Pt[] }[] = [];
  const allCross = phases.flatMap((p) => p.cross);
  const labelAt = (p: Pt) => {
    for (const ph of phases) if (inside(p, ph.ray)) return ph.index;
    return -1;
  };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const ts: number[] = [0, 1];
    crossings(a, b, allCross, ts);
    ts.sort((x, y) => x - y);
    const at = (t: number): Pt => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    for (let k = 1; k < ts.length; k++) {
      if (ts[k] - ts[k - 1] <= 1e-9) continue;
      const label = labelAt(at((ts[k - 1] + ts[k]) / 2));
      const last = runs.at(-1);
      if (last && last.label === label) last.pts.push(at(ts[k]));
      else runs.push({ label, pts: [at(ts[k - 1]), at(ts[k])] });
    }
  }
  return runs;
}

/** Rounded to tile units, repeats dropped; null when fewer than two points remain. */
function rounded(pts: Pt[]): { x: number; y: number }[] | null {
  const out: { x: number; y: number }[] = [];
  for (const [u, v] of pts) {
    const q = { x: Math.round(u), y: Math.round(v) };
    const prev = out.at(-1);
    if (!prev || prev.x !== q.x || prev.y !== q.y) out.push(q);
  }
  return out.length >= 2 ? out : null;
}

function featureLike(
  id: number | undefined,
  properties: VectorTileFeatureLike['properties'],
  extent: number,
  parts: { x: number; y: number }[][]
): VectorTileFeatureLike {
  return {
    type: 2,
    id,
    properties,
    extent,
    loadGeometry: () => parts as unknown as Geometry
  };
}

function layerLike(
  name: string,
  version: number,
  extent: number,
  features: VectorTileFeatureLike[]
): VectorTileLayerLike {
  return { version, name, extent, length: features.length, feature: (i) => features[i] };
}

/**
 * Moves the parts of the phases' features inside their corridor from `roads` to `roads_lc`
 * (property lc_project): at every zoom, every listed id; on clip zooms also every freeway road (a
 * `highway` feature or any link, whatever its ref or none) except one whose refs only kept
 * freeways carry (`keepRefs`). An unlisted part moves only when it runs along a removed line
 * (within `bandM`, directions within `parallelDeg`), so a road that merely crosses the corridor
 * stays. Any part nearer a kept freeway line along it (`keep`) than a removed one stays, so a kept
 * freeway that continues a removed one or runs beside it keeps its pieces. A feature is never
 * moved whole: its other parts stay in `roads` with its id and
 * properties (a listed id can be a low-zoom merge that also covers a kept stretch). Other layers
 * and features are re-encoded unchanged. null when nothing moved.
 */
export function splitRoadsTile(
  mvt: Uint8Array,
  z: number,
  x: number,
  y: number,
  phases: readonly SplitPhase[],
  clip: boolean,
  opts: SplitOptions = {}
): Uint8Array | null {
  const n = 2 ** z;
  // Tiles carry a buffer beyond their bounds: look half a tile around.
  const [wx0, wy0, wx1, wy1] = [(x - 0.5) / n, (y - 0.5) / n, (x + 1.5) / n, (y + 1.5) / n];
  const near = phases
    .map((phase, index) => ({ phase, index, w: worldOf(phase) }))
    .filter(
      ({ w }) => w.bbox[0] <= wx1 && w.bbox[2] >= wx0 && w.bbox[1] <= wy1 && w.bbox[3] >= wy0
    );
  if (near.length === 0) return null;

  const tile = new VectorTile(new Pbf(mvt));
  const roads = tile.layers.roads as VectorTileLayer | undefined;
  if (!roads || roads.length === 0) return null;
  const extent = roads.extent;
  const [r0, r1] = [-0.5 * extent, 1.5 * extent];
  // Web Mercator is conformal: a tile unit has one length in every direction at the tile.
  const latC = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n)));
  const mPerUnit = (EARTH_M * Math.cos(latC)) / (n * extent);
  const band = (opts.bandM ?? LC.basemapBandM) / mPerUnit;
  const keepRefs = new Set(opts.keepRefs ?? []);
  const keptRef = (ref: unknown) =>
    typeof ref === 'string' &&
    ref.split(';').every((t) => t.trim() !== '' && keepRefs.has(t.trim()));
  const along: Along = {
    keep: tileSegs(worldKeep(opts.keep ?? []), n, x, y, extent, band),
    band,
    cosT: Math.cos(((opts.parallelDeg ?? LC.basemapParallelDeg) * Math.PI) / 180),
    step: Math.max(1, STEP_M / mPerUnit)
  };
  const tilePhases: TilePhase[] = near.map(({ phase, index, w }) => {
    const cross: Edge[] = [];
    const ray: Edge[] = [];
    for (const ring of w.rings)
      for (let i = 1; i < ring.length; i++) {
        const e: Edge = [
          (ring[i - 1][0] * n - x) * extent,
          (ring[i - 1][1] * n - y) * extent,
          (ring[i][0] * n - x) * extent,
          (ring[i][1] * n - y) * extent
        ];
        const vIn = Math.max(e[1], e[3]) >= r0 && Math.min(e[1], e[3]) <= r1;
        if (!vIn) continue;
        ray.push(e);
        if (Math.max(e[0], e[2]) >= r0 && Math.min(e[0], e[2]) <= r1) cross.push(e);
      }
    return { index, phase, cross, ray, segs: tileSegs(w.lines, n, x, y, extent, band) };
  });

  const kept: VectorTileFeatureLike[] = [];
  const moved: VectorTileFeatureLike[] = [];
  for (let i = 0; i < roads.length; i++) {
    const f: VectorTileFeature = roads.feature(i);
    const listedIn = (p: TilePhase) => f.id !== undefined && p.phase.ids.has(f.id);
    const ruled = clip && freewayRoad(f.properties) && !keptRef(f.properties.ref);
    const cands = f.type !== 2 ? [] : tilePhases.filter((p) => listedIn(p) || ruled);
    if (cands.length === 0) {
      kept.push(f);
      continue;
    }
    const outside: { x: number; y: number }[][] = [];
    const byPhase = new Map<number, { x: number; y: number }[][]>();
    for (const part of f.loadGeometry()) {
      const line = part.map((p) => [p.x, p.y] as Pt);
      // Corridor runs first (exact cuts at its edges), then each inside run step by step.
      const runs = runsOf(line, cands).flatMap((r) =>
        r.label < 0 ? [r] : refineRun(r.pts, cands, listedIn, along)
      );
      for (const run of joined(runs)) {
        const pts = rounded(run.pts);
        if (pts === null) continue;
        if (run.label < 0) outside.push(pts);
        else byPhase.set(run.label, [...(byPhase.get(run.label) ?? []), pts]);
      }
    }
    if (byPhase.size === 0) {
      kept.push(f);
      continue;
    }
    if (outside.length > 0) kept.push(featureLike(f.id, f.properties, extent, outside));
    for (const [index, parts] of [...byPhase].sort((a, b) => a[0] - b[0]))
      moved.push(
        featureLike(f.id, { ...f.properties, lc_project: phases[index].projectId }, extent, parts)
      );
  }
  if (moved.length === 0) return null;

  const layers: Record<string, VectorTileLayerLike> = {};
  for (const [name, l] of Object.entries(tile.layers))
    layers[name] = name === 'roads' ? layerLike('roads', l.version, extent, kept) : l;
  const prior = tile.layers[LC_ROADS_LAYER] as VectorTileLayer | undefined;
  const already: VectorTileFeatureLike[] = [];
  for (let i = 0; i < (prior?.length ?? 0); i++) already.push(prior!.feature(i));
  layers[LC_ROADS_LAYER] = layerLike(LC_ROADS_LAYER, roads.version, extent, [...already, ...moved]);
  return fromVectorTileJs({ layers });
}

/**
 * The refs only kept freeway segments carry (a catalog segment with `removedBy` null), sorted:
 * a basemap road with only these refs is a kept freeway wherever it runs (I-280, CA-1 on the live
 * catalog; US-101 and I-80 are both kept and removed, so they are not).
 */
export function keptOnlyRefs(
  segments: readonly { ref: string | null; removedBy: string | null }[]
): string[] {
  const removed = new Set(segments.filter((s) => s.removedBy !== null).map((s) => s.ref));
  const kept = segments.filter(
    (s) => s.removedBy === null && s.ref !== null && !removed.has(s.ref)
  );
  return [...new Set(kept.map((s) => s.ref!))].sort();
}

/** The `roads_lc` entry of the archive's vector_layers. */
export const LC_ROADS_VECTOR_LAYER = {
  id: LC_ROADS_LAYER,
  fields: { kind: 'String', kind_detail: 'String', ref: 'String', lc_project: 'String' }
};

/**
 * Each basemap phase with its corridor: its lines buffered by `bandM` with flat caps in
 * EPSG:7131, back to [lng, lat] rings (outer and inner rings of every polygon part).
 */
export async function splitPhasesOf(
  db: Duck,
  phases: readonly { project: string; ref: string | null; ids: number[]; lines: Pt[][] }[],
  bandM: number
): Promise<SplitPhase[]> {
  const out: SplitPhase[] = [];
  for (const p of phases) {
    const lines = p.lines.filter((l) => l.length >= 2);
    if (lines.length === 0) continue;
    const g = JSON.stringify({ type: 'MultiLineString', coordinates: lines });
    const [row] = await db.all<{ g: string }>(
      `SELECT ST_AsGeoJSON(ST_Transform(
         ST_Buffer(ST_Transform(ST_GeomFromGeoJSON('${g}'), 'EPSG:4326', 'EPSG:7131',
                                always_xy := true),
                   ${Number(bandM)}, 8, 'CAP_FLAT', 'JOIN_ROUND', 5.0),
         'EPSG:7131', 'EPSG:4326', always_xy := true)) AS g`
    );
    const geom = JSON.parse(row.g) as
      { type: 'Polygon'; coordinates: Pt[][] } | { type: 'MultiPolygon'; coordinates: Pt[][][] };
    const corridor = geom.type === 'Polygon' ? geom.coordinates : geom.coordinates.flat();
    out.push({ projectId: p.project, ids: new Set(p.ids), lines, corridor });
  }
  return out;
}
