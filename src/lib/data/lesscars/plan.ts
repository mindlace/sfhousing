// The /lesscars plan format: a fixed fewer-cars plan that the data pipeline reads, checks and
// simulates. Pure TS with relative imports only, like the rest of src/lib/data.
//
// Builder's calls (the spec leaves these open):
// - A project's start is 1 January of `startYear` (the spec gives "a start year").
// - A parking conversion's own start and duration are its clearance; its `build` is the housing.
// - A garage is always an `edge-garage` project referencing a site, so a freed project whose land
//   holds a garage has `build: null`.
// - A parking conversion or garage names exactly one parcel (a multi-lot site is several
//   conversions on one schedule), because the engine keeps or voids each dated reservation per
//   parcel and a half-voided multi-lot site would leave lots idle.
// - `car-shuttle` draws on transit capacity: it is rail construction.
import type { Provenance } from '../../timelapse/types';
import type { ParcelId } from '../parcel';

export const LESSCARS_PLAN_SCHEMA = 1;
export const PROJECT_KINDS = [
  'transit-line',
  'tram-priority',
  'bus-lane',
  'street-change',
  'highway-truncation',
  'street-removal',
  'parking-conversion',
  'edge-garage',
  'car-shuttle'
] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];
export const TRANSIT_KINDS: readonly ProjectKind[] = ['transit-line', 'tram-priority', 'bus-lane'];
export const TRANSIT_MODES = ['subway', 'tram', 'brt'] as const;
export type TransitMode = (typeof TRANSIT_MODES)[number];
export const LANE_USES = [
  'car',
  'bus',
  'bike',
  'pedestrian',
  'sidewalk',
  'service',
  'tram'
] as const;
export type LaneUse = (typeof LANE_USES)[number];
export const CAPACITY_KINDS = ['transit', 'street', 'garage', 'housing'] as const;
export type CapacityKind = (typeof CAPACITY_KINDS)[number];

/** Ids of stops the plan adds start with this; ids without it name existing transit.json stops. */
export const NEW_STOP_PREFIX = 'lc:';

export interface Param {
  value: number;
  provenance: Provenance;
}
export type SegmentRef = { cnn: string[] } | { line: [number, number][]; provenance: Provenance };
/** `lngLat` null means an existing transit.json stop. */
export interface PlanStop {
  id: string;
  name: string;
  lngLat: [number, number] | null;
}
export interface SiteBuild {
  startYear: number;
  durationMonths: Param;
}
interface ProjectBase {
  id: string;
  label: string;
  startYear: number;
  durationMonths: Param;
  dependsOn: string[];
}
export type PlanProject =
  | (ProjectBase & {
      kind: 'transit-line';
      mode: TransitMode;
      stops: PlanStop[];
      peakTph: Param;
      alignment: [number, number][];
    })
  | (ProjectBase & {
      kind: 'tram-priority';
      routeIds: string[];
      segments: SegmentRef[];
      peakTph: Param;
    })
  | (ProjectBase & {
      kind: 'bus-lane';
      routeIds: string[];
      stopIds: string[];
      segments: SegmentRef[];
      peakTph: Param;
    })
  | (ProjectBase & { kind: 'street-change'; segments: SegmentRef[]; lanes: LaneUse[] })
  | (ProjectBase & {
      kind: 'highway-truncation' | 'street-removal';
      segments: SegmentRef[];
      rowHalfWidthM: Param;
      build: SiteBuild | null;
    })
  | (ProjectBase & { kind: 'parking-conversion'; parcel: ParcelId; build: SiteBuild })
  | (ProjectBase & {
      kind: 'edge-garage';
      site: { project: string } | { parcel: ParcelId };
      spaces: Param;
    })
  | (ProjectBase & {
      kind: 'car-shuttle';
      garages: string[];
      alignment: [number, number][];
      peakTph: Param;
    });
export interface CapacityRule {
  kind: CapacityKind;
  maxConcurrent: number;
  provenance: Provenance;
}
/**
 * A display-only map item: streets drawn as changed from the open day of project `from`. It has no
 * capacity, homes or closure of its own (plan-v1's Masonic underpass, filled when the subway opens).
 */
export interface PlanDisplay {
  id: string;
  label: string;
  segments: SegmentRef[];
  from: string;
}
export interface LessCarsPlan {
  schema: 1;
  id: string;
  label: string;
  capacity: CapacityRule[];
  projects: PlanProject[];
  displays?: PlanDisplay[];
}

export class PlanFormatError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(path === '' ? message : `${path}: ${message}`);
    this.name = 'PlanFormatError';
    this.path = path;
  }
}

function fail(path: string, message: string): never {
  throw new PlanFormatError(path, message);
}

const at = (path: string, key: string | number) => (path === '' ? String(key) : `${path}.${key}`);

/** An object with exactly the given keys: a missing key or an unknown one fails. */
function record(
  v: unknown,
  path: string,
  keys: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) {
    if (!keys.includes(k) && !optional.includes(k)) fail(at(path, k), 'unknown key');
  }
  for (const k of keys) {
    if (!(k in r)) fail(at(path, k), 'missing');
  }
  return r;
}

function array(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, 'expected an array');
  return v;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '') fail(path, 'expected a non-empty string');
  return v;
}

function strings(v: unknown, path: string): string[] {
  return array(v, path).map((x, i) => str(x, at(path, i)));
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected a finite number');
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !allowed.includes(v as T))
    fail(path, `expected one of ${allowed.join(', ')}`);
  return v as T;
}

function year(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v)) fail(path, 'expected an integer year');
  return v;
}

function lngLat(v: unknown, path: string): [number, number] {
  const a = array(v, path);
  if (a.length !== 2) fail(path, 'expected [lng, lat]');
  return [num(a[0], at(path, 0)), num(a[1], at(path, 1))];
}

function line(v: unknown, path: string): [number, number][] {
  const a = array(v, path);
  if (a.length < 2) fail(path, 'expected at least two points');
  return a.map((p, i) => lngLat(p, at(path, i)));
}

/** Validate a Provenance at `path` (shared with the /lesscars output codec). */
export function parseProvenance(v: unknown, path: string): Provenance {
  const r = record(v, path, ['tier', 'label', 'sources', 'method'], ['n', 'window']);
  const tier = r.tier;
  if (tier !== 0 && tier !== 1 && tier !== 2 && tier !== 3 && tier !== 4)
    fail(at(path, 'tier'), 'expected 0, 1, 2, 3 or 4');
  const out: Provenance = {
    tier,
    label: str(r.label, at(path, 'label')),
    sources: array(r.sources, at(path, 'sources')).map((s, i) => {
      const sp = at(at(path, 'sources'), i);
      const sr = record(s, sp, ['label', 'url']);
      return { label: str(sr.label, at(sp, 'label')), url: str(sr.url, at(sp, 'url')) };
    }),
    method: str(r.method, at(path, 'method'))
  };
  if ('n' in r) out.n = num(r.n, at(path, 'n'));
  if ('window' in r) {
    const w = array(r.window, at(path, 'window'));
    if (w.length !== 2) fail(at(path, 'window'), 'expected [from, to]');
    out.window = [str(w[0], at(at(path, 'window'), 0)), str(w[1], at(at(path, 'window'), 1))];
  }
  return out;
}

function parseParam(v: unknown, path: string): Param {
  const r = record(v, path, ['value', 'provenance']);
  return {
    value: num(r.value, at(path, 'value')),
    provenance: parseProvenance(r.provenance, at(path, 'provenance'))
  };
}

function parseDuration(v: unknown, path: string): Param {
  const p = parseParam(v, path);
  if (!(p.value > 0)) fail(at(path, 'value'), 'expected a positive number of months');
  return p;
}

function parseBuild(v: unknown, path: string): SiteBuild {
  const r = record(v, path, ['startYear', 'durationMonths']);
  return {
    startYear: year(r.startYear, at(path, 'startYear')),
    durationMonths: parseDuration(r.durationMonths, at(path, 'durationMonths'))
  };
}

function parseSegment(v: unknown, path: string): SegmentRef {
  if (typeof v === 'object' && v !== null && 'cnn' in v) {
    const r = record(v, path, ['cnn']);
    return { cnn: strings(r.cnn, at(path, 'cnn')) };
  }
  const r = record(v, path, ['line', 'provenance']);
  return {
    line: line(r.line, at(path, 'line')),
    provenance: parseProvenance(r.provenance, at(path, 'provenance'))
  };
}

function segments(v: unknown, path: string): SegmentRef[] {
  const a = array(v, path);
  if (a.length === 0) fail(path, 'expected at least one segment');
  return a.map((s, i) => parseSegment(s, at(path, i)));
}

function parseStop(v: unknown, path: string): PlanStop {
  const r = record(v, path, ['id', 'name', 'lngLat']);
  const id = str(r.id, at(path, 'id'));
  const name = str(r.name, at(path, 'name'));
  const isNew = id.startsWith(NEW_STOP_PREFIX);
  if (r.lngLat === null) {
    if (isNew) fail(at(path, 'lngLat'), `a new stop (${NEW_STOP_PREFIX} id) needs a lngLat`);
    return { id, name, lngLat: null };
  }
  if (!isNew)
    fail(
      at(path, 'id'),
      `a new stop id starts with ${NEW_STOP_PREFIX}; an existing stop has a null lngLat`
    );
  return { id, name, lngLat: lngLat(r.lngLat, at(path, 'lngLat')) };
}

const BASE_KEYS = ['id', 'label', 'kind', 'startYear', 'durationMonths', 'dependsOn'] as const;

function parseProject(v: unknown, path: string): PlanProject {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected an object');
  const kind = oneOf((v as Record<string, unknown>).kind, at(path, 'kind'), PROJECT_KINDS);
  const own: Record<ProjectKind, readonly string[]> = {
    'transit-line': ['mode', 'stops', 'peakTph', 'alignment'],
    'tram-priority': ['routeIds', 'segments', 'peakTph'],
    'bus-lane': ['routeIds', 'stopIds', 'segments', 'peakTph'],
    'street-change': ['segments', 'lanes'],
    'highway-truncation': ['segments', 'rowHalfWidthM', 'build'],
    'street-removal': ['segments', 'rowHalfWidthM', 'build'],
    'parking-conversion': ['parcel', 'build'],
    'edge-garage': ['site', 'spaces'],
    'car-shuttle': ['garages', 'alignment', 'peakTph']
  };
  const r = record(v, path, [...BASE_KEYS, ...own[kind]]);
  const base = {
    id: str(r.id, at(path, 'id')),
    label: str(r.label, at(path, 'label')),
    startYear: year(r.startYear, at(path, 'startYear')),
    durationMonths: parseDuration(r.durationMonths, at(path, 'durationMonths')),
    dependsOn: strings(r.dependsOn, at(path, 'dependsOn'))
  };
  const tph = () => parseParam(r.peakTph, at(path, 'peakTph'));
  const segs = () => segments(r.segments, at(path, 'segments'));
  switch (kind) {
    case 'transit-line':
      return {
        ...base,
        kind,
        mode: oneOf(r.mode, at(path, 'mode'), TRANSIT_MODES),
        stops: array(r.stops, at(path, 'stops')).map((s, i) =>
          parseStop(s, at(at(path, 'stops'), i))
        ),
        peakTph: tph(),
        alignment: line(r.alignment, at(path, 'alignment'))
      };
    case 'tram-priority':
      return {
        ...base,
        kind,
        routeIds: strings(r.routeIds, at(path, 'routeIds')),
        segments: segs(),
        peakTph: tph()
      };
    case 'bus-lane':
      return {
        ...base,
        kind,
        routeIds: strings(r.routeIds, at(path, 'routeIds')),
        stopIds: strings(r.stopIds, at(path, 'stopIds')),
        segments: segs(),
        peakTph: tph()
      };
    case 'street-change':
      return {
        ...base,
        kind,
        segments: segs(),
        lanes: array(r.lanes, at(path, 'lanes')).map((l, i) =>
          oneOf(l, at(at(path, 'lanes'), i), LANE_USES)
        )
      };
    case 'highway-truncation':
    case 'street-removal':
      return {
        ...base,
        kind,
        segments: segs(),
        rowHalfWidthM: parseParam(r.rowHalfWidthM, at(path, 'rowHalfWidthM')),
        build: r.build === null ? null : parseBuild(r.build, at(path, 'build'))
      };
    case 'parking-conversion':
      return {
        ...base,
        kind,
        parcel: str(r.parcel, at(path, 'parcel')),
        build: parseBuild(r.build, at(path, 'build'))
      };
    case 'edge-garage': {
      const sp = at(path, 'site');
      const s = r.site;
      const site =
        typeof s === 'object' && s !== null && 'project' in s
          ? { project: str(record(s, sp, ['project']).project, at(sp, 'project')) }
          : { parcel: str(record(s, sp, ['parcel']).parcel, at(sp, 'parcel')) };
      return { ...base, kind, site, spaces: parseParam(r.spaces, at(path, 'spaces')) };
    }
    case 'car-shuttle':
      return {
        ...base,
        kind,
        garages: strings(r.garages, at(path, 'garages')),
        alignment: line(r.alignment, at(path, 'alignment')),
        peakTph: tph()
      };
  }
}

function parseCapacity(v: unknown, path: string): CapacityRule {
  const r = record(v, path, ['kind', 'maxConcurrent', 'provenance']);
  const n = r.maxConcurrent;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0)
    fail(at(path, 'maxConcurrent'), 'expected a non-negative integer');
  return {
    kind: oneOf(r.kind, at(path, 'kind'), CAPACITY_KINDS),
    maxConcurrent: n,
    provenance: parseProvenance(r.provenance, at(path, 'provenance'))
  };
}

function parseDisplay(v: unknown, path: string): PlanDisplay {
  const r = record(v, path, ['id', 'label', 'segments', 'from']);
  return {
    id: str(r.id, at(path, 'id')),
    label: str(r.label, at(path, 'label')),
    segments: segments(r.segments, at(path, 'segments')),
    from: str(r.from, at(path, 'from'))
  };
}

/** Validate a plan document. Throws `PlanFormatError` naming the first bad field by dotted path. */
export function parseLessCarsPlan(json: unknown): LessCarsPlan {
  const r = record(json, '', ['schema', 'id', 'label', 'capacity', 'projects'], ['displays']);
  if (r.schema !== LESSCARS_PLAN_SCHEMA) fail('schema', `expected 1, got ${String(r.schema)}`);
  const plan: LessCarsPlan = {
    schema: 1,
    id: str(r.id, 'id'),
    label: str(r.label, 'label'),
    capacity: array(r.capacity, 'capacity').map((c, i) => parseCapacity(c, at('capacity', i))),
    projects: array(r.projects, 'projects').map((p, i) => parseProject(p, at('projects', i)))
  };
  if ('displays' in r)
    plan.displays = array(r.displays, 'displays').map((d, i) => parseDisplay(d, at('displays', i)));
  return plan;
}

/** The capacity a project draws on while it is under way. */
export function capacityKindOf(p: PlanProject): CapacityKind {
  switch (p.kind) {
    case 'transit-line':
    case 'tram-priority':
    case 'bus-lane':
    case 'car-shuttle':
      return 'transit';
    case 'street-change':
    case 'highway-truncation':
    case 'street-removal':
    case 'parking-conversion':
      return 'street';
    case 'edge-garage':
      return 'garage';
  }
}

/** Whether the project takes its street or highway away from cars once built. */
export function closesToCars(p: PlanProject): boolean {
  if (p.kind === 'street-removal' || p.kind === 'highway-truncation') return true;
  if (p.kind === 'street-change') return !p.lanes.includes('car');
  return false;
}
