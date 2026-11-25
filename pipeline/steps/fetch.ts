import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDuck } from '../lib/duck';
import { nodeHttp, type Http } from '../lib/http';
import { rawPath, readLock, sha256File, writeLock, type Lock, type LockEntry } from '../lib/lock';
import { wranglerTarget, type R2Target } from '../lib/r2';
import { DATASF, fetchDatasf, type DatasfId } from '../sources/datasf';
import { fetchOverture, fetchOvertureParts, latestOvertureRelease } from '../sources/overture';
import { fetchGtfs } from '../sources/gtfs';
import { archiveSpec, fetchGtfsArchive } from '../sources/gtfs-archive';
import { fetchCensus, fetchDmv } from '../sources/census';
import { CENSUS_IDS, DMV_ID } from '../census-config';
import { LIDAR_ID, LIDAR_LOCK, fetchLidar, writeLidarLock, type LidarOpts } from '../sources/lidar';
import { run as realRun } from '../lib/exec';
import { fetchBasemap, fetchFonts } from '../sources/protomaps';
import { SFBOS_EXEMPTIONS_ID, fetchSfbosExemptions } from '../sources/sfbos';
import { GTFS_ARCHIVE_IDS, GTFS_IDS, type GtfsLockId } from '../transit-config';

const ROOT = resolve(import.meta.dirname, '../..');
export const LOCK_PATH = join(ROOT, 'pipeline/sources.lock.json');
export const RAW_DIR = join(ROOT, 'pipeline/.cache/raw');

export const LIDAR_LOCK_PATH = LIDAR_LOCK.live;

const PARTS_ID = 'overture-building-parts';

export const FETCH_IDS = [
  ...(Object.keys(DATASF) as DatasfId[]),
  'overture-buildings',
  PARTS_ID,
  'protomaps-basemap',
  'protomaps-fonts',
  ...GTFS_IDS,
  SFBOS_EXEMPTIONS_ID,
  ...CENSUS_IDS,
  DMV_ID,
  LIDAR_ID,
  ...GTFS_ARCHIVE_IDS
] as const;

/** `--only gtfs-archive` fetches every archived feed (GTFS_ARCHIVES). */
export const GTFS_ARCHIVE_GROUP = 'gtfs-archive';

/**
 * What a plain `fetch` refreshes. The LiDAR is a slow, explicit fetch (`--only usgs-lidar-sf`);
 * the parts come with `overture-buildings` (same release), so they are not listed twice. The
 * archived GTFS feeds are fixed past versions, fetched only when asked for
 * (`--only gtfs-archive`).
 */
export const DEFAULT_FETCH_IDS: readonly string[] = FETCH_IDS.filter(
  (i) => i !== LIDAR_ID && i !== PARTS_ID && !GTFS_ARCHIVE_IDS.includes(i)
);

export interface FetchOpts {
  only?: string;
  release?: string;
  basemapDate?: string;
  restore?: boolean;
  local?: boolean;
  /** `--restore --lidar`: restore the LiDAR lock's tiles instead of the main lock's files. */
  lidar?: boolean;
  /** usgs-lidar-sf: tiles to rasterize (default the city's), parallel jobs, report only. */
  tiles?: [number, number][];
  jobs?: number;
  dryRun?: boolean;
  /** Injected rasterizer runner (and work dir) for tests. */
  lidarDeps?: { run: typeof realRun; workDir?: string };
  lockPath?: string;
  lidarLockPath?: string;
  rawDir?: string;
  http?: Http;
  r2?: R2Target;
}

/**
 * `fetch --restore`: for each lock file missing from the raw cache, download its R2 archive
 * (`sources/<sha256>.<ext>`) and verify the sha256 before it lands under the sha name.
 */
export async function restoreRaw(
  lock: Lock,
  rawDir: string,
  r2: R2Target
): Promise<{ restored: number; present: number }> {
  let restored = 0;
  let present = 0;
  mkdirSync(rawDir, { recursive: true });
  for (const entry of lock.sources) {
    for (const f of entry.files) {
      const dest = rawPath(rawDir, f);
      if (existsSync(dest)) {
        present++;
        continue;
      }
      const part = `${dest}.part`;
      try {
        if (!(await r2.get(f.archiveKey, part))) {
          throw new Error(`${entry.id}: archive ${f.archiveKey} not found in R2`);
        }
        const actual = await sha256File(part);
        if (actual !== f.sha256) {
          throw new Error(
            `${entry.id}: sha256 mismatch for ${f.name} (expected ${f.sha256}, got ${actual})`
          );
        }
        renameSync(part, dest);
        restored++;
      } finally {
        rmSync(part, { force: true });
      }
    }
  }
  return { restored, present };
}

/** Fetch live sources into the raw cache and rewrite the lock; returns a process exit code. */
export async function fetchAll(opts: FetchOpts = {}): Promise<number> {
  const lockPath = opts.lockPath ?? LOCK_PATH;
  const lidarLockPath = opts.lidarLockPath ?? LIDAR_LOCK_PATH;
  const rawDir = opts.rawDir ?? RAW_DIR;
  if (opts.restore) {
    // Plain --restore never reads the LiDAR lock; --lidar reads only it.
    const from = opts.lidar ? lidarLockPath : lockPath;
    if (!existsSync(from)) {
      console.error(`no ${from} to restore from`);
      return 1;
    }
    const r2 = opts.r2 ?? wranglerTarget({ local: opts.local ?? false });
    const { restored, present } = await restoreRaw(readLock(from), rawDir, r2);
    console.log(`restore: ${restored} downloaded, ${present} already present`);
    return 0;
  }
  const ids: readonly string[] = opts.only
    ? opts.only.split(',').flatMap((i) => (i === GTFS_ARCHIVE_GROUP ? GTFS_ARCHIVE_IDS : [i]))
    : DEFAULT_FETCH_IDS;
  const unknown = ids.filter((i) => !(FETCH_IDS as readonly string[]).includes(i));
  if (unknown.length > 0) {
    console.error(`unknown source(s): ${unknown.join(', ')} (known: ${FETCH_IDS.join(', ')})`);
    return 2;
  }
  const http = opts.http ?? nodeHttp;
  const fetched: LockEntry[] = [];
  let release: string | undefined;
  for (const id of ids) {
    // The parts ride with overture-buildings when both are asked for.
    if (id === PARTS_ID && ids.includes('overture-buildings')) continue;
    if (id === PARTS_ID && !opts.release) {
      console.error(`--only ${PARTS_ID} needs --release (it must match overture-buildings)`);
      return 2;
    }
    const t0 = Date.now();
    console.log(`fetch ${id} ...`);
    let entry: LockEntry;
    if (id === LIDAR_ID) {
      const lo: LidarOpts = {
        tiles: opts.tiles,
        jobs: opts.jobs,
        dryRun: opts.dryRun,
        workDir: opts.lidarDeps?.workDir
      };
      const e = await fetchLidar(
        rawDir,
        lo,
        opts.lidarDeps ? { run: opts.lidarDeps.run } : undefined
      );
      if (e) {
        writeLidarLock(lidarLockPath, e);
        console.log(`  ${id}: ${e.files.length} tile(s), ${e.upstreamVersion}`);
        console.log(`wrote ${lidarLockPath}`);
      }
      continue;
    }
    if (id in DATASF) entry = await fetchDatasf(id as DatasfId, rawDir, http);
    else if (id === 'overture-buildings' || id === PARTS_ID) {
      // One release for both: `latest` is resolved once, and the buildings bring the parts along.
      release ??= opts.release ?? (await latestOvertureRelease(http));
      const db = await openDuck({ httpfs: true });
      try {
        entry =
          id === PARTS_ID
            ? await fetchOvertureParts(release, rawDir, db)
            : await fetchOverture(release, rawDir, db, http);
        if (id === 'overture-buildings') {
          const parts = await fetchOvertureParts(release, rawDir, db);
          console.log(`  ${PARTS_ID}: ${parts.files.length} file(s), ${parts.rowCount} rows`);
          fetched.push(parts);
        }
      } finally {
        db.close();
      }
    } else if (id === 'protomaps-basemap') {
      entry = await fetchBasemap(opts.basemapDate, rawDir, new Date());
    } else if ((GTFS_IDS as readonly string[]).includes(id)) {
      entry = await fetchGtfs(id as GtfsLockId, rawDir, http);
    } else if (GTFS_ARCHIVE_IDS.includes(id)) {
      entry = await fetchGtfsArchive(archiveSpec(id)!, rawDir, http);
    } else if (id === SFBOS_EXEMPTIONS_ID) {
      entry = await fetchSfbosExemptions(rawDir, http);
    } else if (CENSUS_IDS.includes(id)) {
      entry = await fetchCensus(id, rawDir, http);
    } else if (id === DMV_ID) {
      entry = await fetchDmv(rawDir, http);
    } else entry = await fetchFonts(rawDir, http);
    console.log(
      `  ${id}: ${entry.files.length} file(s), ${entry.rowCount} rows, ${entry.upstreamVersion} (${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
    fetched.push(entry);
  }
  if (fetched.length === 0) return 0;
  // Entries not refetched under --only are kept.
  const kept = existsSync(lockPath)
    ? readLock(lockPath).sources.filter((s) => !fetched.some((f) => f.id === s.id))
    : [];
  writeLock(lockPath, { sources: [...kept, ...fetched] });
  console.log(`wrote ${lockPath} (${kept.length + fetched.length} sources)`);
  return 0;
}
