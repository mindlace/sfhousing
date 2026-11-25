// Archived agency GTFS for past years (car back-cast): one feed per operator and year, checked
// before it enters the lock. The copies come from keyless archives (transit-config.ts,
// GTFS_ARCHIVE_HOSTS); docs/dev/cars-data.md records what was found and what was skipped.
import { SF_GRID_BBOX } from '../../src/lib/transit/grid';
import type { Http } from '../lib/http';
import { at, calendarRange, csv, gtfsFromZip, pickServiceDate, type GtfsFiles } from '../lib/gtfs';
import type { LockEntry } from '../lib/lock';
import { storeBytes } from '../lib/raw';
import { GTFS_ARCHIVES, GTFS_FEEDS, type GtfsArchiveSpec } from '../transit-config';

export class GtfsArchiveError extends Error {}

export function archiveSpec(id: string): GtfsArchiveSpec | undefined {
  return GTFS_ARCHIVES.find((a) => a.lockId === id);
}

/**
 * A feed enters the lock only if it parses, has a route of the operator's route types and a stop
 * in San Francisco, and is in force on 1 April of its year: its calendar covers that day and a
 * Tuesday with service follows it inside the calendar. Returns the service dates and the stop
 * count.
 */
export function checkArchive(
  g: GtfsFiles,
  spec: Pick<GtfsArchiveSpec, 'lockId' | 'year' | 'operator'>
): { start: string; end: string; stops: number } {
  const fail = (why: string) => {
    throw new GtfsArchiveError(`${spec.lockId}: ${why}`);
  };
  for (const t of ['routes.txt', 'trips.txt', 'stops.txt', 'stop_times.txt'])
    if (!g.has(t)) fail(`not a GTFS zip (no ${t})`);
  // An archive can file another agency's feed under the operator (OpenMobilityData's Caltrain
  // 2020-02-24 is SamTrans): it must have a route of the operator's route types.
  const types = GTFS_FEEDS[`gtfs-${spec.operator}`].routeTypes;
  const rc = csv(g.get('routes.txt'));
  const rtype = rc.col('route_type');
  let ours = 0;
  for (const r of rc.rows()) if (types.includes(Number(at(r, rtype)))) ours++;
  if (ours === 0) fail(`no route of route_type ${types.join('/')} (another agency's feed?)`);
  const [w, s, e, n] = SF_GRID_BBOX;
  const sc = csv(g.get('stops.txt'));
  const [lat, lon] = ['stop_lat', 'stop_lon'].map(sc.col);
  let stops = 0;
  let inSf = 0;
  for (const r of sc.rows()) {
    stops++;
    const [x, y] = [Number(at(r, lon)), Number(at(r, lat))];
    if (x >= w && x <= e && y >= s && y <= n) inSf++;
  }
  if (inSf === 0) fail('no stop in San Francisco');
  const range = calendarRange(g);
  if (!range) return fail('no service calendar');
  const april = `${spec.year}0401`;
  if (range.start > april || range.end < april)
    fail(`service ${range.start}..${range.end} does not cover ${april}`);
  const { warning } = pickServiceDate(g, `${spec.year}-04-01`);
  if (warning) fail(`no Tuesday with service from ${april}: ${warning}`);
  return { ...range, stops };
}

/** Download one archived feed, check it, and describe it as a lock entry. */
export async function fetchGtfsArchive(
  spec: GtfsArchiveSpec,
  rawDir: string,
  http: Http,
  now: Date = new Date()
): Promise<LockEntry> {
  const res = await http.get(spec.url);
  if (res.status !== 200) throw new GtfsArchiveError(`GET ${spec.url}: HTTP ${res.status}`);
  let g: GtfsFiles;
  try {
    g = gtfsFromZip(res.body);
  } catch (err) {
    throw new GtfsArchiveError(`${spec.lockId}: not a zip (${(err as Error).message})`);
  }
  const { start, end, stops } = checkArchive(g, spec);
  return {
    id: spec.lockId,
    files: [storeBytes(rawDir, `${spec.lockId}.zip`, spec.url, res.body)],
    retrievedAt: now.toISOString(),
    upstreamVersion: `${start}..${end}`,
    rowCount: stops,
    license: spec.license,
    label: spec.label,
    homepage: spec.homepage
  };
}
