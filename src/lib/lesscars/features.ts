// The /lesscars plan as day-stamped GeoJSON for the map: street states, plan lines and stops,
// freed sites and edge garages. Pure. Every feature carries the half-open day interval
// [from, to) on which it shows, so what the map draws is a function of the day alone.
//
// Builder's calls:
// - A drawn segment's key is `line:<projectId>:<k>`, k its index in the project's (or display's)
//   `segments` list, so a CNN segment beside it keeps its own index.
// - A project or display whose times are missing is skipped (parsePlanFile guarantees times for
//   every project; no throw on a page module).
import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from 'geojson';
import type { LessCarsPlanFile, LessCarsSitesFile } from '$lib/data/lesscars/codec';
import type { ParcelId } from '$lib/data/parcel';
import type { LaneUse, PlanProject, SegmentRef, TransitMode } from '$lib/data/lesscars/plan';
import type { ProjectTimes } from '$lib/data/lesscars/schedule';
import { OPEN_DAY, type Day } from '$lib/timelapse/time';

export type StreetState = 'works' | 'transit' | 'bike' | 'pedestrian' | 'removed' | 'grade';
/** Map-key order. */
export const STREET_STATES: readonly StreetState[] = [
  'works',
  'transit',
  'bike',
  'pedestrian',
  'removed',
  'grade'
];
/** Every feature is shown on days d with from <= d < to; `to` is OPEN_DAY when it never ends. */
export interface Span {
  from: Day;
  to: Day;
  project: string;
}
/** `segment` is `cnn:<cnn>` or `line:<projectId>:<k>`. */
export type StreetProps = Span & { state: StreetState; segment: string };
export type LineProps = Span & { mode: TransitMode | 'shuttle'; building: 0 | 1; label: string };
export type StopProps = Span & { name: string; mode: TransitMode };
export type SiteProps = Span & { siteId: string };
export type GarageProps = Span & { building: 0 | 1; label: string; spaces: number };
export interface Reservation {
  parcelId: ParcelId;
  kept: boolean;
}

const collection = <G extends Geometry, P>(features: Feature<G, P>[]): FeatureCollection<G, P> => ({
  type: 'FeatureCollection',
  features
});

const timesById = (f: LessCarsPlanFile) => new Map(f.times.map((t) => [t.id, t] as const));

/** The street state a lane layout draws once open; null draws nothing (cars keep the street). */
export function laneState(lanes: readonly LaneUse[]): StreetState | null {
  const has = (u: LaneUse) => lanes.includes(u);
  const transit = has('bus') || has('tram');
  if (!has('car')) {
    if (has('pedestrian')) return 'pedestrian';
    if (transit) return 'transit';
    if (has('bike')) return 'bike';
    return 'pedestrian';
  }
  if (transit) return 'transit';
  if (has('bike')) return 'bike';
  return null;
}

interface StreetEvent {
  day: Day;
  order: number;
  state: StreetState | null;
  project: string;
}
interface StreetKey {
  lines: [number, number][][];
  events: StreetEvent[];
}

/** The state a street project draws at its open, or undefined for a non-street project. */
function openState(p: PlanProject): StreetState | null | undefined {
  switch (p.kind) {
    case 'bus-lane':
    case 'tram-priority':
      return 'transit';
    case 'street-change':
      return laneState(p.lanes);
    case 'street-removal':
    case 'highway-truncation':
      return 'removed';
    default:
      return undefined;
  }
}

export function streetFeatures(f: LessCarsPlanFile): FeatureCollection<LineString, StreetProps> {
  const times = timesById(f);
  const keys = new Map<string, StreetKey>();
  const add = (
    owner: string,
    segments: SegmentRef[],
    events: Omit<StreetEvent, 'order'>[],
    order: number
  ) => {
    segments.forEach((seg, k) => {
      const targets: [string, [number, number][][]][] =
        'cnn' in seg
          ? seg.cnn.flatMap((cnn) => {
              const lines = f.segments[cnn];
              return lines ? [[`cnn:${cnn}`, lines] as [string, [number, number][][]]] : [];
            })
          : [[`line:${owner}:${k}`, [seg.line]]];
      for (const [key, lines] of targets) {
        let entry = keys.get(key);
        if (!entry) keys.set(key, (entry = { lines, events: [] }));
        for (const e of events) entry.events.push({ ...e, order });
      }
    });
  };

  f.plan.projects.forEach((p, i) => {
    const state = openState(p);
    const t = times.get(p.id);
    if (state === undefined || !t || !('segments' in p)) return;
    add(
      p.id,
      p.segments,
      [
        { day: t.startDay, state: 'works', project: p.id },
        { day: t.openDay, state, project: p.id }
      ],
      i
    );
  });
  const n = f.plan.projects.length;
  (f.plan.displays ?? []).forEach((d, i) => {
    const t = times.get(d.from);
    if (!t) return;
    add(d.id, d.segments, [{ day: t.openDay, state: 'grade', project: d.from }], n + i);
  });

  const out: Feature<LineString, StreetProps>[] = [];
  for (const [segment, { lines, events }] of keys) {
    // Stable sort: one project's start precedes its open on equal days.
    events.sort((a, b) => a.day - b.day || a.order - b.order);
    events.forEach((e, i) => {
      const to = i + 1 < events.length ? events[i + 1].day : OPEN_DAY;
      if (e.state === null || !(e.day < to)) return;
      for (const coordinates of lines)
        out.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates },
          properties: { from: e.day, to, project: e.project, state: e.state, segment }
        });
    });
  }
  return collection(out);
}

/** The building stage on [start, open) and the built stage on [open, OPEN_DAY). */
function stages(t: ProjectTimes): { building: 0 | 1; from: Day; to: Day }[] {
  return [
    { building: 1, from: t.startDay, to: t.openDay },
    { building: 0, from: t.openDay, to: OPEN_DAY }
  ];
}

export function lineFeatures(f: LessCarsPlanFile): FeatureCollection<LineString, LineProps> {
  const times = timesById(f);
  const out: Feature<LineString, LineProps>[] = [];
  for (const p of f.plan.projects) {
    if (p.kind !== 'transit-line' && p.kind !== 'car-shuttle') continue;
    const t = times.get(p.id);
    if (!t) continue;
    const mode = p.kind === 'transit-line' ? p.mode : 'shuttle';
    for (const s of stages(t))
      out.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: p.alignment },
        properties: { ...s, project: p.id, mode, label: p.label }
      });
  }
  return collection(out);
}

export function stopFeatures(f: LessCarsPlanFile): FeatureCollection<Point, StopProps> {
  const times = timesById(f);
  const byId = new Map<string, Feature<Point, StopProps>>();
  for (const p of f.plan.projects) {
    if (p.kind !== 'transit-line') continue;
    const t = times.get(p.id);
    if (!t) continue;
    for (const s of p.stops) {
      if (!s.lngLat) continue;
      const prev = byId.get(s.id);
      if (prev && prev.properties.from <= t.openDay) continue;
      byId.set(s.id, {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: s.lngLat },
        properties: { from: t.openDay, to: OPEN_DAY, project: p.id, name: s.name, mode: p.mode }
      });
    }
  }
  return collection([...byId.values()]);
}

export function siteFeatures(
  f: LessCarsPlanFile,
  s: LessCarsSitesFile
): FeatureCollection<Polygon, SiteProps> {
  const times = timesById(f);
  const out: Feature<Polygon, SiteProps>[] = [];
  for (const site of s.sites) {
    const from = times.get(site.projectId)?.availableDay;
    if (from == null) continue;
    out.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: site.outline },
      properties: { from, to: OPEN_DAY, project: site.projectId, siteId: site.siteId }
    });
  }
  return collection(out);
}

/** The centre of the bounding box of a project's site outlines, or null when none was carved. */
function sitesCentre(s: LessCarsSitesFile, project: string): [number, number] | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const site of s.sites) {
    if (site.projectId !== project) continue;
    for (const ring of site.outline)
      for (const [x, y] of ring) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  }
  return x0 <= x1 ? [(x0 + x1) / 2, (y0 + y1) / 2] : null;
}

export function garageFeatures(
  f: LessCarsPlanFile,
  s: LessCarsSitesFile,
  places: Readonly<Record<ParcelId, [number, number]>>,
  reservations: readonly Reservation[]
): FeatureCollection<Point, GarageProps> {
  const times = timesById(f);
  const kept = new Set(reservations.filter((r) => r.kept).map((r) => r.parcelId));
  const out: Feature<Point, GarageProps>[] = [];
  for (const p of f.plan.projects) {
    if (p.kind !== 'edge-garage') continue;
    const t = times.get(p.id);
    if (!t) continue;
    // A voided or not-yet-known reservation draws nothing: the summary does not count it.
    const at =
      'project' in p.site
        ? sitesCentre(s, p.site.project)
        : kept.has(p.site.parcel)
          ? (places[p.site.parcel] ?? null)
          : null;
    if (!at) continue;
    for (const st of stages(t))
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: at },
        properties: { ...st, project: p.id, label: p.label, spaces: p.spaces.value }
      });
  }
  return collection(out);
}

/** Sorted unique `from` and `to` days (OPEN_DAY excluded) of all given collections. */
export function eventDays(...fcs: FeatureCollection<Geometry, Span>[]): Day[] {
  const days = new Set<Day>();
  for (const fc of fcs)
    for (const { properties: p } of fc.features) {
      days.add(p.from);
      if (p.to !== OPEN_DAY) days.add(p.to);
    }
  return [...days].sort((a, b) => a - b);
}

/** How many event days are <= day: equal epochs show identical maps. */
export function epochOf(days: readonly Day[], day: Day): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (days[mid] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
