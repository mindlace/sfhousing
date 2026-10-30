/**
 * Brush resolution for /sim policy levers: a brush query (freehand, transit, street, area) becomes
 * the scenario-eligible lot rows it covers, plus a catalog for the pickers. Pure and worker-safe
 * (no zod, DOM or $app). Rows are parcels.bin rows; every resolver returns them ascending and
 * keeps only `parcels.eligible` lots.
 */
import KDBush from 'kdbush';
import { STREET_CLASSES, frontingRows, type Frontage } from '$lib/data/frontage-codec';
import { isNeighborhoodCommercial, type PolicyParcels } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { TransitNetwork } from '$lib/data/transit';
import { CANDIDATE_PAD_M, project, segDist2, segmentBoxes, type XY } from '$lib/plan/geometry';

export const STOP_TYPES = ['regionalRail', 'metro', 'rapidBus', 'frequentBus'] as const;
export type StopType = (typeof STOP_TYPES)[number];
export type StreetClass = (typeof STREET_CLASSES)[number];

/**
 * Summed peak trips per hour at a bus stop for it to count as frequent: a 10-minute combined
 * headway. Tier 4 (our judgement, not cited): it matches the common "every 10 minutes or better"
 * frequent-service threshold, but no SFMTA frequent-network definition is cited here.
 */
export const FREQUENT_BUS_TPH = 6;
/**
 * Muni Rapid routes are the route ids ending in R (5R, 9R, 14R, 28R, 38R, ...). Tier 1: read
 * directly off Muni's own GTFS route ids (SFMTA GTFS feed, routes.txt).
 */
export const RAPID_ROUTE = /^\d+R$/;
/** The operator id whose `R` routes are Rapid (transit.json `<operator>` prefix). */
const RAPID_OPERATOR = 'muni';

export type BrushQuery =
  | { kind: 'freehand'; strokes: { path: [number, number][]; radiusM: number }[] }
  | { kind: 'transit'; stopTypes: StopType[]; maxM: number }
  | { kind: 'street'; classes: StreetClass[]; names: string[]; depth: 0 | 1; ncOnly: boolean }
  | { kind: 'area'; districts: string[]; neighborhoods: string[] };

/** Multipolygon rings per neighborhood, lng/lat. */
export type NeighborhoodShapes = { name: string; rings: [number, number][][][] }[];

export interface BrushData {
  parcels: ScenarioParcels;
  policy: PolicyParcels;
  frontage: Frontage | null;
  transit: TransitNetwork | null;
  neighborhoods: NeighborhoodShapes | null;
}

export interface LotIndex {
  /** Every row (eligible or not) whose label point is within radiusM of the path, ascending. */
  nearPath(path: readonly [number, number][], radiusM: number): number[];
  /** Every row whose label point is within maxM of any point, ascending. */
  nearPoints(points: readonly [number, number][], maxM: number): number[];
}

export class BrushDataMissing extends Error {
  name = 'BrushDataMissing';
  readonly file: 'frontage' | 'transit' | 'neighborhoods';
  constructor(file: 'frontage' | 'transit' | 'neighborhoods') {
    super(`brush needs ${file}, which is not loaded`);
    this.file = file;
  }
}

export interface BrushCatalog {
  streetNames: string[]; // frontage names an eligible lot fronts directly (depth 0)
  districts: { family: string; codes: { code: string; lots: number }[] }[];
  neighborhoods: string[];
  stops: Record<StopType, number>;
  has: { frontage: boolean; transit: boolean; neighborhoods: boolean };
}

const ascending = (rows: Iterable<number>): number[] => [...rows].sort((a, b) => a - b);

/**
 * One KDBush over the projected label points of every row, as `createParcelIndex` builds per
 * chunk; `nearPath` is its `covered` test (segment boxes, then the exact `segDist2`), so a stroke
 * covers here exactly the lots it covers in the editor.
 */
export function createLotIndex(parcels: ScenarioParcels): LotIndex {
  const n = parcels.count;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const tree = n > 0 ? new KDBush(n) : null;
  for (let i = 0; i < n; i++) {
    const [x, y] = project(parcels.labelPoint[2 * i], parcels.labelPoint[2 * i + 1]);
    xs[i] = x;
    ys[i] = y;
    tree!.add(x, y);
  }
  tree?.finish();

  function nearPath(path: readonly [number, number][], radiusM: number): number[] {
    if (!tree || path.length === 0) return [];
    const xy = path.map(([lng, lat]) => project(lng, lat));
    const r2 = radiusM * radiusM;
    const boxes = segmentBoxes(xy, radiusM + CANDIDATE_PAD_M);
    const out = new Set<number>();
    for (let s = 0; s < boxes.length; s++) {
      const a = xy[s];
      const b = xy.length === 1 ? xy[0] : xy[s + 1];
      const q = boxes[s];
      for (const k of tree.range(q[0], q[1], q[2], q[3])) {
        if (out.has(k)) continue;
        const l: XY = [xs[k], ys[k]];
        if (segDist2(l, a, b) <= r2) out.add(k);
      }
    }
    return ascending(out);
  }

  function nearPoints(points: readonly [number, number][], maxM: number): number[] {
    if (!tree) return [];
    const r2 = maxM * maxM;
    const g = maxM + CANDIDATE_PAD_M;
    const out = new Set<number>();
    for (const [lng, lat] of points) {
      const [px, py] = project(lng, lat);
      for (const k of tree.range(px - g, py - g, px + g, py + g)) {
        const dx = xs[k] - px;
        const dy = ys[k] - py;
        if (dx * dx + dy * dy <= r2) out.add(k);
      }
    }
    return ascending(out);
  }

  return { nearPath, nearPoints };
}

const stopsMemo = new WeakMap<TransitNetwork, Record<StopType, Set<number>>>();

/**
 * Stop indices per type. Rail types read the pattern mode; `rapidBus` is a Muni bus route matching
 * RAPID_ROUTE; `frequentBus` sums peak tph over every bus pattern at the stop. Memoised per network
 * object: a decoded network is never mutated, so edit a copy rather than the one already queried.
 */
function stopsByType(net: TransitNetwork): Record<StopType, Set<number>> {
  const hit = stopsMemo.get(net);
  if (hit) return hit;
  const out: Record<StopType, Set<number>> = {
    regionalRail: new Set(),
    metro: new Set(),
    rapidBus: new Set(),
    frequentBus: new Set()
  };
  const busTph = new Map<number, number>();
  for (const p of net.patterns) {
    for (const ps of p.stops) {
      if (p.mode === 'heavy-rail' || p.mode === 'commuter-rail') out.regionalRail.add(ps.stop);
      // Muni Metro only: streetcar (F) and cable car are separate modes, so never Metro.
      else if (p.mode === 'light-rail') out.metro.add(ps.stop);
      else if (p.mode === 'bus') {
        if (p.operatorId === RAPID_OPERATOR && RAPID_ROUTE.test(p.routeId))
          out.rapidBus.add(ps.stop);
        busTph.set(ps.stop, (busTph.get(ps.stop) ?? 0) + ps.tph);
      }
    }
  }
  // Round the sum to the wire's 0.1 tph precision so 5.9 + 0.1 counts as 6.
  for (const [stop, tph] of busTph)
    if (Math.round(tph * 10) >= FREQUENT_BUS_TPH * 10) out.frequentBus.add(stop);
  stopsMemo.set(net, out);
  return out;
}

/** Locations of the stops of any of `types`, each stop once, in stop order. */
export function stopPoints(net: TransitNetwork, types: readonly StopType[]): [number, number][] {
  if (types.length === 0) return [];
  const by = stopsByType(net);
  const stops = new Set<number>();
  for (const t of types) for (const s of by[t]) stops.add(s);
  return ascending(stops).map((s) => [net.stops[s].lngLat[0], net.stops[s].lngLat[1]]);
}

/** A district's family: the code without its trailing parenthetical ('RH-1(D)' -> 'RH-1'). */
export function districtFamily(code: string): string {
  return code.replace(/\s*\([^()]*\)\s*$/, '');
}

const components = (code: string): string[] =>
  code
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c !== '');

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** neighborhoods.geojson (a FeatureCollection of named Polygon/MultiPolygon features). */
export function parseNeighborhoods(geojson: unknown): NeighborhoodShapes {
  if (!isObj(geojson) || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features))
    throw new Error('neighborhoods.geojson is not a FeatureCollection');
  const out: NeighborhoodShapes = [];
  for (const f of geojson.features) {
    if (!isObj(f) || !isObj(f.properties) || !isObj(f.geometry)) continue;
    const name = f.properties.name;
    const g = f.geometry;
    if (typeof name !== 'string' || !Array.isArray(g.coordinates)) continue;
    if (g.type === 'Polygon') out.push({ name, rings: [g.coordinates as [number, number][][]] });
    else if (g.type === 'MultiPolygon')
      out.push({ name, rings: g.coordinates as [number, number][][][] });
  }
  return out;
}

/** Even-odd over every ring of the multipolygon (holes and separate parts alike). */
function inShape(rings: [number, number][][][], x: number, y: number): boolean {
  let inside = false;
  for (const poly of rings)
    for (const ring of poly)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
  return inside;
}

type Shape = NeighborhoodShapes[number];
/** Rows (ascending, eligible or not) whose label point is in the shape, per parcels per shape. */
const shapeMemo = new WeakMap<ScenarioParcels, WeakMap<Shape, Uint32Array>>();

/**
 * The rows inside one neighborhood, computed once per (parcels, shape) object pair: a bounding-box
 * prefilter, then even-odd only for the lots inside the box. Per shape rather than one row ->
 * shape column, so overlapping shapes stay exact.
 */
function shapeRows(parcels: ScenarioParcels, shape: Shape): Uint32Array {
  let memo = shapeMemo.get(parcels);
  if (!memo) shapeMemo.set(parcels, (memo = new WeakMap()));
  const hit = memo.get(shape);
  if (hit) return hit;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of shape.rings)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
  const lp = parcels.labelPoint;
  const rows: number[] = [];
  for (let i = 0; i < parcels.count; i++) {
    const x = lp[2 * i];
    const y = lp[2 * i + 1];
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (inShape(shape.rings, x, y)) rows.push(i);
  }
  const out = Uint32Array.from(rows);
  memo.set(shape, out);
  return out;
}

function streetRows(d: BrushData, q: Extract<BrushQuery, { kind: 'street' }>): number[] {
  const f = d.frontage;
  if (!f) throw new BrushDataMissing('frontage');
  const classes = new Set<number>(q.classes.map((c) => STREET_CLASSES.indexOf(c)));
  const names = new Set<number>();
  for (const name of q.names) {
    const k = f.names.indexOf(name);
    if (k >= 0) names.add(k);
  }
  if (classes.size === 0 && names.size === 0) return [];
  let rows = frontingRows(f, (s) => classes.has(f.segClass[s]) || names.has(f.segName[s]), q.depth);
  if (q.ncOnly) {
    const p = d.policy;
    rows = rows.filter((i) => isNeighborhoodCommercial(p.useDistricts[p.useDistrict[i]]));
  }
  return rows;
}

function areaRows(d: BrushData, q: Extract<BrushQuery, { kind: 'area' }>): number[] {
  const out = new Set<number>();
  if (q.districts.length > 0) {
    const chosen = new Set(q.districts);
    const p = d.policy;
    const hit = p.useDistricts.map((code) => components(code).some((c) => chosen.has(c)));
    for (let i = 0; i < p.count; i++) if (hit[p.useDistrict[i]]) out.add(i);
  }
  if (q.neighborhoods.length > 0) {
    // Tier 3: membership by label point, not by lot outline (parcels.bin has none), so a lot
    // straddling a boundary falls in the neighborhood holding its label point.
    if (!d.neighborhoods) throw new BrushDataMissing('neighborhoods');
    const chosen = new Set(q.neighborhoods);
    for (const shape of d.neighborhoods)
      if (chosen.has(shape.name)) for (const i of shapeRows(d.parcels, shape)) out.add(i);
  }
  return ascending(out);
}

/** Rows, ascending, eligible only. Throws BrushDataMissing when a needed file is null. */
export function resolveBrushRows(d: BrushData, index: LotIndex, q: BrushQuery): number[] {
  let rows: number[];
  switch (q.kind) {
    case 'freehand': {
      const all = new Set<number>();
      for (const s of q.strokes) for (const r of index.nearPath(s.path, s.radiusM)) all.add(r);
      rows = ascending(all);
      break;
    }
    case 'transit': {
      if (!d.transit) throw new BrushDataMissing('transit');
      // Tier 4: straight-line distance from the lot's label point to the stop. SB 79 measures from
      // the parcel edge, and parcels.bin carries no outline.
      rows = index.nearPoints(stopPoints(d.transit, q.stopTypes), q.maxM);
      break;
    }
    case 'street':
      rows = streetRows(d, q);
      break;
    case 'area':
      rows = areaRows(d, q);
      break;
    default:
      throw new Error(`Unhandled brush: ${JSON.stringify(q satisfies never)}`);
  }
  const el = d.parcels.eligible;
  return rows.filter((i) => el[i] === 1);
}

export function brushCatalog(d: BrushData): BrushCatalog {
  const { parcels: sp, policy: p, frontage: f, transit: net, neighborhoods: nb } = d;
  const el = sp.eligible;

  const streetNames: string[] = [];
  if (f) {
    const seen = new Set<number>();
    for (let i = 0; i < f.count; i++) {
      if (el[i] !== 1) continue;
      for (let e = f.rowStart[i]; e < f.rowStart[i + 1]; e++)
        if (f.frontDepth[e] === 0) seen.add(f.segName[f.frontSeg[e]]);
    }
    for (const k of ascending(seen)) streetNames.push(f.names[k]); // names is sorted
  }

  const perCode = new Map<string, number>();
  const perDistrict = new Uint32Array(p.useDistricts.length);
  for (let i = 0; i < p.count; i++) if (el[i] === 1) perDistrict[p.useDistrict[i]]++;
  p.useDistricts.forEach((code, k) => {
    if (perDistrict[k] === 0) return;
    for (const c of new Set(components(code)))
      perCode.set(c, (perCode.get(c) ?? 0) + perDistrict[k]);
  });
  const families = new Map<string, { code: string; lots: number }[]>();
  for (const [code, lots] of perCode) {
    const fam = districtFamily(code);
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam)!.push({ code, lots });
  }
  const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const districts = [...families]
    .sort(([a], [b]) => byStr(a, b))
    .map(([family, codes]) => ({ family, codes: codes.sort((a, b) => byStr(a.code, b.code)) }));

  const stops = { regionalRail: 0, metro: 0, rapidBus: 0, frequentBus: 0 } as Record<
    StopType,
    number
  >;
  if (net) {
    const by = stopsByType(net);
    for (const t of STOP_TYPES) stops[t] = by[t].size;
  }

  return {
    streetNames,
    districts,
    neighborhoods: nb ? [...new Set(nb.map((s) => s.name))].sort(byStr) : [],
    stops,
    has: { frontage: f !== null, transit: net !== null, neighborhoods: nb !== null }
  };
}
