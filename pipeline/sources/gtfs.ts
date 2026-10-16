import type { Http } from '../lib/http';
import { csv, feedVersion, gtfsFromZip } from '../lib/gtfs';
import type { LockEntry } from '../lib/lock';
import { storeBytes } from '../lib/raw';
import { GTFS_FEEDS, type GtfsLockId } from '../transit-config';

/** Transit spec §4.1: one zip per operator feed, straight from the agency URL. */
export async function fetchGtfs(
  id: GtfsLockId,
  rawDir: string,
  http: Http,
  now: Date = new Date()
): Promise<LockEntry> {
  const spec = GTFS_FEEDS[id];
  const res = await http.get(spec.url);
  if (res.status !== 200) throw new Error(`GET ${spec.url}: HTTP ${res.status}`);
  const g = gtfsFromZip(res.body);
  if (!g.has('stops.txt') || !g.has('stop_times.txt'))
    throw new Error(`${id}: not a GTFS zip (no stops.txt / stop_times.txt)`);
  let rowCount = 0;
  for (const _ of csv(g.get('stops.txt')).rows()) rowCount++;
  return {
    id,
    files: [storeBytes(rawDir, `${id}.zip`, spec.url, res.body)],
    retrievedAt: now.toISOString(),
    upstreamVersion: feedVersion(g),
    rowCount,
    license: spec.license,
    label: spec.label,
    homepage: spec.homepage
  };
}
