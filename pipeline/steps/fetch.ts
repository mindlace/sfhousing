import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDuck } from '../lib/duck';
import { nodeHttp, type Http } from '../lib/http';
import { rawPath, readLock, sha256File, writeLock, type Lock, type LockEntry } from '../lib/lock';
import { wranglerTarget, type R2Target } from '../lib/r2';
import { DATASF, fetchDatasf, type DatasfId } from '../sources/datasf';
import { fetchOverture } from '../sources/overture';
import { fetchGtfs } from '../sources/gtfs';
import { fetchBasemap, fetchFonts } from '../sources/protomaps';
import { SFBOS_EXEMPTIONS_ID, fetchSfbosExemptions } from '../sources/sfbos';
import { GTFS_IDS, type GtfsLockId } from '../transit-config';

const ROOT = resolve(import.meta.dirname, '../..');
export const LOCK_PATH = join(ROOT, 'pipeline/sources.lock.json');
export const RAW_DIR = join(ROOT, 'pipeline/.cache/raw');

export const FETCH_IDS = [
  ...(Object.keys(DATASF) as DatasfId[]),
  'overture-buildings',
  'protomaps-basemap',
  'protomaps-fonts',
  ...GTFS_IDS,
  SFBOS_EXEMPTIONS_ID
] as const;

export interface FetchOpts {
  only?: string;
  release?: string;
  basemapDate?: string;
  restore?: boolean;
  local?: boolean;
  lockPath?: string;
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
  const rawDir = opts.rawDir ?? RAW_DIR;
  if (opts.restore) {
    if (!existsSync(lockPath)) {
      console.error(`no ${lockPath} to restore from`);
      return 1;
    }
    const r2 = opts.r2 ?? wranglerTarget({ local: opts.local ?? false });
    const { restored, present } = await restoreRaw(readLock(lockPath), rawDir, r2);
    console.log(`restore: ${restored} downloaded, ${present} already present`);
    return 0;
  }
  const ids: readonly string[] = opts.only ? opts.only.split(',') : FETCH_IDS;
  const unknown = ids.filter((i) => !(FETCH_IDS as readonly string[]).includes(i));
  if (unknown.length > 0) {
    console.error(`unknown source(s): ${unknown.join(', ')} (known: ${FETCH_IDS.join(', ')})`);
    return 2;
  }
  const http = opts.http ?? nodeHttp;
  const fetched: LockEntry[] = [];
  for (const id of ids) {
    const t0 = Date.now();
    console.log(`fetch ${id} ...`);
    let entry: LockEntry;
    if (id in DATASF) entry = await fetchDatasf(id as DatasfId, rawDir, http);
    else if (id === 'overture-buildings') {
      const db = await openDuck({ httpfs: true });
      try {
        entry = await fetchOverture(opts.release, rawDir, db, http);
      } finally {
        db.close();
      }
    } else if (id === 'protomaps-basemap') {
      entry = await fetchBasemap(opts.basemapDate, rawDir, new Date());
    } else if ((GTFS_IDS as readonly string[]).includes(id)) {
      entry = await fetchGtfs(id as GtfsLockId, rawDir, http);
    } else if (id === SFBOS_EXEMPTIONS_ID) {
      entry = await fetchSfbosExemptions(rawDir, http);
    } else entry = await fetchFonts(rawDir, http);
    console.log(
      `  ${id}: ${entry.files.length} file(s), ${entry.rowCount} rows, ${entry.upstreamVersion} (${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
    fetched.push(entry);
  }
  // Entries not refetched under --only are kept.
  const kept = existsSync(lockPath)
    ? readLock(lockPath).sources.filter((s) => !fetched.some((f) => f.id === s.id))
    : [];
  writeLock(lockPath, { sources: [...kept, ...fetched] });
  console.log(`wrote ${lockPath} (${kept.length + fetched.length} sources)`);
  return 0;
}
