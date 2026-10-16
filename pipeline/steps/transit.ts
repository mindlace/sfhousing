// Transit spec §4.2: reduce GTFS feeds to the seed TransitNetwork. Pure TS, deterministic.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModeId, Pattern, TransitNetwork } from '../../src/lib/data/transit';
import { encodeTransit } from '../../src/lib/data/transit-codec';
import { project, segDist2, type XY } from '../../src/lib/plan/geometry';
import {
  activeServices,
  at,
  csv,
  parseGtfsTime,
  pickServiceDate,
  readGtfs,
  type GtfsFiles
} from '../lib/gtfs';
import { rawPath, type Lock } from '../lib/lock';
import {
  ASSIGNMENTS,
  CLIP_BUFFER_M,
  GTFS_FEEDS,
  PEAK,
  PLACE_RADIUS_M,
  VEHICLES,
  assignmentFor,
  placeTokens,
  routeLine,
  routeMode,
  routeName,
  type GtfsFeedSpec
} from '../transit-config';

export class TransitBuildError extends Error {}

export interface FeedInput {
  spec: GtfsFeedSpec;
  files: GtfsFiles;
}
export interface ReduceOpts {
  targetDate: string;
  keep: (lngLat: [number, number]) => boolean;
  strict: boolean;
}
export interface ReduceResult {
  network: TransitNetwork;
  warnings: string[];
  counts: Record<string, number>;
}

interface RawStop {
  id: string;
  name: string;
  lngLat: [number, number];
  stationId: string | null;
  stationName: string | null;
}
type RawPattern = Omit<Pattern, 'stops'> & {
  stops: { stopId: string; tph: number; tpd: number }[];
};

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 3600 + m * 60;
};

function reduceFeed(
  { spec, files: g }: FeedInput,
  opts: ReduceOpts,
  warn: (m: string) => void,
  counts: Record<string, number>
): { serviceDate: string; stops: Map<string, RawStop>; patterns: RawPattern[] } {
  const op = spec.operator;
  const { date, warning } = pickServiceDate(g, opts.targetDate);
  if (warning) warn(`${spec.lockId}: ${warning}`);
  const services = activeServices(g, date.replaceAll('-', ''));

  const routes = new Map<
    string,
    { line: string; name: string; mode: ModeId; vehicle: string; cars: number }
  >();
  const rc = csv(g.get('routes.txt'));
  const [rid, rshort, rlong, rtype] = [
    'route_id',
    'route_short_name',
    'route_long_name',
    'route_type'
  ].map(rc.col);
  for (const r of rc.rows()) {
    const type = Number(at(r, rtype));
    if (!spec.routeTypes.includes(type)) continue;
    const id = at(r, rid);
    const line = routeLine(op, id, at(r, rshort));
    const mode = routeMode(op, type, line);
    if (!mode) continue;
    routes.set(id, {
      line,
      name: routeName(op, id, at(r, rshort), at(r, rlong)),
      mode,
      ...assignmentFor(op, line)
    });
  }
  // A renamed route fails the release build. The hand-made fixture carries only a few lines, so
  // a non-strict build skips the check.
  if (opts.strict) {
    const lines = new Set([...routes.values()].map((r) => r.line));
    for (const a of ASSIGNMENTS.filter((x) => x.operator === op)) {
      for (const line of a.lines) {
        if (!lines.has(line)) {
          throw new TransitBuildError(`assigned line ${line} is not in ${spec.lockId}`);
        }
      }
    }
  }

  const trips = new Map<string, { route: string; dir: 0 | 1 }>();
  const tc = csv(g.get('trips.txt'));
  const [troute, tservice, tid, tdir] = ['route_id', 'service_id', 'trip_id', 'direction_id'].map(
    tc.col
  );
  for (const r of tc.rows()) {
    if (routes.has(at(r, troute)) && services.has(at(r, tservice))) {
      trips.set(at(r, tid), { route: at(r, troute), dir: at(r, tdir) === '1' ? 1 : 0 });
    }
  }

  const seqs = new Map<string, [seq: number, stop: string, sec: number, board: boolean][]>();
  const sc = csv(g.get('stop_times.txt'));
  const [strip, sstop, sseq, sdep, sarr, spick] = [
    'trip_id',
    'stop_id',
    'stop_sequence',
    'departure_time',
    'arrival_time',
    'pickup_type'
  ].map(sc.col);
  let untimed = 0;
  for (const r of sc.rows()) {
    const trip = at(r, strip);
    if (!trips.has(trip)) continue;
    const sec = parseGtfsTime(at(r, sdep)) ?? parseGtfsTime(at(r, sarr));
    if (sec === null) untimed++;
    let list = seqs.get(trip);
    if (!list) seqs.set(trip, (list = []));
    // pickup_type 1: no boarding here, so not a peak departure (a missing column reads as 0).
    list.push([Number(at(r, sseq)), at(r, sstop), sec ?? -1, at(r, spick) !== '1']);
  }
  counts['transit.untimed_stop_times'] = (counts['transit.untimed_stop_times'] ?? 0) + untimed;

  const [p0, p1] = [hhmm(PEAK.start), hhmm(PEAK.end)];
  const pats = new Map<
    string,
    { route: string; dir: 0 | 1; stops: string[]; peak: number[]; day: number[] }
  >();
  for (const [trip, rows] of seqs) {
    rows.sort((a, b) => a[0] - b[0]);
    const t = trips.get(trip)!;
    const stops = rows.map((r) => r[1]);
    const key = `${t.route}\u0000${t.dir}\u0000${stops.join('\u0000')}`;
    let p = pats.get(key);
    if (!p) {
      p = { route: t.route, dir: t.dir, stops, peak: stops.map(() => 0), day: stops.map(() => 0) };
      pats.set(key, p);
    }
    // tpd counts every train serving the stop (SB 79 counts trains per day at a station), so a
    // trip's terminal arrival and a pickup_type=1 row both count. Peak tph is boarding capacity:
    // only departures, so neither of those counts there.
    rows.forEach((r, k) => {
      p.day[k]++;
      if (k < rows.length - 1 && r[3] && r[2] >= p0 && r[2] < p1) p.peak[k]++;
    });
  }

  const all = new Map<string, { name: string; lngLat: [number, number]; parent: string }>();
  const stc = csv(g.get('stops.txt'));
  const [sid, sname, slat, slon, sparent] = [
    'stop_id',
    'stop_name',
    'stop_lat',
    'stop_lon',
    'parent_station'
  ].map(stc.col);
  for (const r of stc.rows()) {
    all.set(at(r, sid), {
      name: at(r, sname),
      lngLat: [r6(Number(at(r, slon))), r6(Number(at(r, slat)))],
      parent: at(r, sparent)
    });
  }

  const peakHours = (p1 - p0) / 3600;
  // Patterns with peak departures choose the stops. A pattern with none adds no capacity, but its
  // trips still count in `tpd` (SB 79 counts trains over the whole service day) at those stops.
  const candidates = [...pats.keys()].sort(cmp).map((key) => {
    const p = pats.get(key)!;
    const inClip = p.stops
      .map((s, k) => ({ s, k }))
      .filter(({ s }) => {
        const st = all.get(s);
        return st !== undefined && opts.keep(st.lngLat);
      });
    return { p, inClip, peak: inClip.some(({ k }) => p.peak[k] > 0) };
  });
  const used = new Map<string, RawStop>();
  for (const { inClip, peak } of candidates) {
    if (!peak) continue;
    for (const { s } of inClip) {
      if (used.has(s)) continue;
      const st = all.get(s)!;
      const parent = st.parent ? all.get(st.parent) : undefined;
      used.set(s, {
        id: `${op}:${s}`,
        name: st.name,
        lngLat: st.lngLat,
        stationId: st.parent ? `${op}:${st.parent}` : null,
        stationName: parent?.name ?? null
      });
    }
  }
  const patterns: RawPattern[] = [];
  const seq = new Map<string, number>();
  for (const { p, inClip, peak } of candidates) {
    const kept = peak ? inClip : inClip.filter(({ s, k }) => used.has(s) && p.day[k] > 0);
    if (kept.length === 0) continue;
    const route = routes.get(p.route)!;
    const rd = `${p.route}:${p.dir}`;
    const n = seq.get(rd) ?? 0;
    seq.set(rd, n + 1);
    patterns.push({
      id: `${op}:${p.route}:${p.dir}:${n}`,
      operatorId: op,
      routeId: p.route,
      routeName: route.name,
      mode: route.mode,
      direction: p.dir,
      vehicle: route.vehicle,
      cars: route.cars,
      stops: kept.map(({ s, k }) => ({
        stopId: `${op}:${s}`,
        tph: Math.round((p.peak[k] / peakHours) * 10) / 10,
        tpd: p.day[k]
      }))
    });
  }
  // Spec §4.2 step 7: the operator default is likely wrong for Muni rail and BART.
  const unassigned = new Set<string>();
  for (const p of patterns) {
    if (p.stops.every((s) => s.tph === 0)) continue;
    const { line, mode, vehicle, cars } = routes.get(p.routeId)!;
    if (op === 'caltrain' || (op === 'muni' && mode === 'bus') || unassigned.has(line)) continue;
    if (ASSIGNMENTS.some((a) => a.operator === op && a.lines.includes(line))) continue;
    unassigned.add(line);
    warn(
      `${spec.lockId}: line ${line} (${mode}) has peak service but no vehicle assignment; ` +
        `using ${vehicle} × ${cars}`
    );
  }
  return { serviceDate: date, stops: used, patterns };
}

/**
 * Spec §4.2 step 6. Returns stop id -> placeId (the smallest node id in its group). A node is a
 * stop's station, or the stop itself. Within an operator only the station groups stops; nodes
 * are matched by distance and name only across operators, so a street of same-named bus stops
 * never chains into one place.
 */
export function assignPlaces(stops: RawStop[]): Map<string, string> {
  const nodes = new Map<string, { op: string; xy: XY; tokens: Set<string> }>();
  const nodeOf = (s: RawStop) => s.stationId ?? s.id;
  for (const s of [...stops].sort((a, b) => cmp(a.id, b.id))) {
    const k = nodeOf(s);
    if (!nodes.has(k)) {
      nodes.set(k, {
        op: s.id.slice(0, s.id.indexOf(':')),
        xy: project(s.lngLat[0], s.lngLat[1]),
        tokens: placeTokens(s.stationName ?? s.name)
      });
    }
  }
  const keys = [...nodes.keys()].sort(cmp);
  const parent = new Map(keys.map((k) => [k, k]));
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const r2 = PLACE_RADIUS_M * PLACE_RADIUS_M;
  for (let i = 0; i < keys.length; i++) {
    const a = nodes.get(keys[i])!;
    for (let j = i + 1; j < keys.length; j++) {
      const b = nodes.get(keys[j])!;
      if (a.op === b.op) continue;
      const dx = a.xy[0] - b.xy[0];
      const dy = a.xy[1] - b.xy[1];
      if (dx * dx + dy * dy > r2) continue;
      if (![...a.tokens].some((t) => b.tokens.has(t))) continue;
      const [ra, rb] = [find(keys[i]), find(keys[j])];
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
    }
  }
  return new Map(stops.map((s) => [s.id, find(nodeOf(s))]));
}

type Ring = [number, number][];

/** Spec §4.2 step 3: inside any neighborhood polygon, or within `bufferM` of one. */
export function clipFilter(
  neighborhoods: { features: { geometry: { type: string; coordinates: unknown } }[] },
  bufferM: number
): (lngLat: [number, number]) => boolean {
  const rings: XY[][] = [];
  for (const f of neighborhoods.features) {
    const polys =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as Ring[]]
        : (f.geometry.coordinates as Ring[][]);
    for (const poly of polys) rings.push(poly[0].map(([lng, lat]) => project(lng, lat)));
  }
  const b2 = bufferM * bufferM;
  return ([lng, lat]) => {
    const p = project(lng, lat);
    for (const ring of rings) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi)
          inside = !inside;
        if (segDist2(p, ring[j], ring[i]) <= b2) return true;
      }
      if (inside) return true;
    }
    return false;
  };
}

export function reduceTransit(feeds: FeedInput[], opts: ReduceOpts): ReduceResult {
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const parts = feeds.map((f) => ({ f, r: reduceFeed(f, opts, (m) => warnings.push(m), counts) }));
  const raw = parts.flatMap(({ r }) => [...r.stops.values()]).sort((a, b) => cmp(a.id, b.id));
  const index = new Map(raw.map((s, i) => [s.id, i]));
  const places = assignPlaces(raw);
  const patterns: Pattern[] = parts
    .flatMap(({ r }) => r.patterns)
    .sort((a, b) => cmp(a.id, b.id))
    .map((p) => ({
      ...p,
      stops: p.stops.map((s) => ({ stop: index.get(s.stopId)!, tph: s.tph, tpd: s.tpd }))
    }));
  const network: TransitNetwork = {
    peak: { start: PEAK.start, end: PEAK.end },
    operators: parts.map(({ f, r }) => ({
      id: f.spec.operator,
      label: f.spec.operatorLabel,
      serviceDate: r.serviceDate
    })),
    vehicles: Object.fromEntries(
      Object.entries(VEHICLES).map(([k, v]) => [
        k,
        { label: v.label, seats: v.seats, capacity: v.capacity }
      ])
    ),
    stops: raw.map((s) => ({
      id: s.id,
      name: s.name,
      lngLat: s.lngLat,
      stationId: s.stationId,
      placeId: places.get(s.id)!
    })),
    patterns
  };
  counts['transit.stops'] = network.stops.length;
  counts['transit.patterns'] = network.patterns.length;
  return { network, warnings, counts };
}

/**
 * Build step: read every gtfs-* lock entry, reduce, write `<outDir>/transit.json`. Needs
 * `<outDir>/neighborhoods.geojson` (written earlier in the build) for the clip.
 */
export function writeTransit(a: {
  lock: Lock;
  rawDir: string;
  byName: boolean;
  outDir: string;
  targetDate: string;
  strict: boolean;
}): { bytes: number; counts: Record<string, number>; warnings: string[] } {
  const feeds: FeedInput[] = Object.values(GTFS_FEEDS).map((spec) => {
    const entry = a.lock.sources.find((s) => s.id === spec.lockId);
    if (!entry) throw new TransitBuildError(`lock has no ${spec.lockId} entry`);
    const files = entry.files.map((f) => ({ name: f.name, path: rawPath(a.rawDir, f, a.byName) }));
    return { spec, files: readGtfs(files) };
  });
  const nb = JSON.parse(readFileSync(join(a.outDir, 'neighborhoods.geojson'), 'utf8'));
  const r = reduceTransit(feeds, {
    targetDate: a.targetDate,
    keep: clipFilter(nb, CLIP_BUFFER_M),
    strict: a.strict
  });
  const body = Buffer.from(encodeTransit(r.network));
  writeFileSync(join(a.outDir, 'transit.json'), body);
  return {
    bytes: body.length,
    counts: { ...r.counts, 'transit.bytes': body.length },
    warnings: r.warnings
  };
}
