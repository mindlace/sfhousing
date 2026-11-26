import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { moveIntoPlace } from '../lib/atomic.js';
import { boxesKey, inputsFileOf, readBoxesIndex, writeBoxesIndex } from '../lib/boxes-index.js';
import { sharedCache, type SharedCache } from '../lib/cache-root.js';
import { BOXES_ID, boxesUpstreamVersion, type BoxesInputs } from '../lib/lidar/artifact.js';
import { readLock, sha256File, verifyRaw, type LockEntry } from '../lib/lock.js';

export interface CacheImportOpts {
  /** An old pipeline/.cache. */
  from: string;
  /** Default sharedCache(). */
  to?: SharedCache;
  /** Default <from>/../sources.lock.json (the old worktree's lock). */
  lockPath?: string;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

export interface CacheImportReport {
  raw: { moved: number; duplicate: number; mismatched: string[]; left: string[] };
  ept: { moved: number; duplicate: number };
  lidarWork: { moved: number; duplicate: number; partial: number };
  /** The key written, or null. */
  boxesIndex: string | null;
}

const isDir = (p: string): boolean => existsSync(p) && statSync(p).isDirectory();

/** Remove `dir` when it holds nothing. */
function rmdirIfEmpty(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
}

/** Every regular file under `dir`, as paths relative to it. */
function filesUnder(dir: string, base = dir): string[] {
  const found: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) found.push(...filesUnder(p, base));
    else if (e.isFile()) found.push(relative(base, p));
  }
  return found;
}

/** Remove empty directories under `dir`, and `dir` itself when it ends up empty. */
function pruneEmpty(dir: string): void {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmpty(join(dir, e.name));
  }
  rmdirIfEmpty(dir);
}

function moveRaw(from: string, to: string, err: (l: string) => void) {
  const r: CacheImportReport['raw'] = { moved: 0, duplicate: 0, mismatched: [], left: [] };
  return (async () => {
    if (!isDir(from)) return r;
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, e.name);
      if (!e.isFile() || !/^[0-9a-f]{64}$/.test(e.name)) {
        r.left.push(e.name);
        continue;
      }
      const dest = join(to, e.name);
      if (existsSync(dest)) {
        rmSync(src);
        r.duplicate++;
      } else if ((await sha256File(src)) === e.name) {
        moveIntoPlace(src, dest);
        r.moved++;
      } else {
        r.mismatched.push(e.name);
        err(`raw/${e.name}: content does not match its name; left in place`);
      }
    }
    rmdirIfEmpty(from);
    return r;
  })();
}

function moveEpt(from: string, to: string): CacheImportReport['ept'] {
  const r = { moved: 0, duplicate: 0 };
  if (!isDir(from)) return r;
  for (const rel of filesUnder(from)) {
    const src = join(from, rel);
    const dest = join(to, rel);
    if (existsSync(dest)) {
      rmSync(src);
      r.duplicate++;
    } else {
      mkdirSync(dirname(dest), { recursive: true });
      moveIntoPlace(src, dest);
      r.moved++;
    }
  }
  pruneEmpty(from);
  return r;
}

function moveLidarWork(from: string, to: string): CacheImportReport['lidarWork'] {
  const r = { moved: 0, duplicate: 0, partial: 0 };
  if (!isDir(from)) return r;
  for (const h of readdirSync(from, { withFileTypes: true })) {
    if (!h.isDirectory()) continue;
    const hashDir = join(from, h.name);
    for (const t of readdirSync(hashDir, { withFileTypes: true })) {
      const src = join(hashDir, t.name);
      if (t.name.startsWith('.')) {
        rmSync(src, { recursive: true, force: true });
        r.partial++;
        continue;
      }
      if (!t.isDirectory()) continue;
      const dest = join(to, h.name, t.name);
      if (existsSync(dest)) {
        rmSync(src, { recursive: true, force: true });
        r.duplicate++;
      } else {
        mkdirSync(dirname(dest), { recursive: true });
        moveIntoPlace(src, dest);
        r.moved++;
      }
    }
    rmdirIfEmpty(hashDir);
  }
  rmdirIfEmpty(from);
  return r;
}

/** Index the lock's building-boxes entry when its files verify in shared raw; returns the key. */
async function indexBoxes(
  lockPath: string,
  shared: SharedCache,
  out: (l: string) => void
): Promise<string | null> {
  let entry: LockEntry | undefined;
  if (existsSync(lockPath)) entry = readLock(lockPath).sources.find((s) => s.id === BOXES_ID);
  if (!entry) {
    out(`boxes-index: no ${BOXES_ID} entry in ${lockPath}`);
    return null;
  }
  const skip = (why: string): null => {
    out(`boxes-index: skipped, ${why}`);
    return null;
  };
  let key: string;
  try {
    key = inputsFileOf(entry).sha256;
  } catch (e) {
    return skip((e as Error).message);
  }
  const bad = await verifyRaw({ sources: [entry] }, shared.raw);
  if (bad.length > 0) return skip(bad[0]);
  let inputs: BoxesInputs;
  try {
    inputs = JSON.parse(readFileSync(join(shared.raw, key), 'utf8')) as BoxesInputs;
    if (boxesUpstreamVersion(inputs) !== entry.upstreamVersion) {
      return skip('inputs.json does not match the entry upstreamVersion');
    }
    if (boxesKey(inputs) !== key) return skip('inputs.json is not in canonical form');
  } catch (e) {
    return skip(`inputs.json: ${(e as Error).message}`);
  }
  if (readBoxesIndex(shared.boxesIndex, key)) {
    out(`boxes-index: ${key} already indexed`);
    return null;
  }
  writeBoxesIndex(shared.boxesIndex, key, entry);
  out(`boxes-index: wrote ${key}`);
  return key;
}

/** Move an old pipeline/.cache's raw, ept and lidar-work into the shared cache; index its boxes. */
export async function cacheImport(
  o: CacheImportOpts
): Promise<{ code: number; report: CacheImportReport }> {
  const out = o.out ?? ((l: string) => console.log(l));
  const err = o.err ?? ((l: string) => console.error(l));
  const to = o.to ?? sharedCache();
  const from = resolve(o.from);
  const report: CacheImportReport = {
    raw: { moved: 0, duplicate: 0, mismatched: [], left: [] },
    ept: { moved: 0, duplicate: 0 },
    lidarWork: { moved: 0, duplicate: 0, partial: 0 },
    boxesIndex: null
  };
  const root = resolve(to.root);
  if (!isDir(from)) {
    err(`${from} is not a directory`);
    return { code: 2, report };
  }
  if (from === root || from.startsWith(root + sep)) {
    err(`${from} is the shared cache; give an old pipeline/.cache`);
    return { code: 2, report };
  }

  report.raw = await moveRaw(join(from, 'raw'), to.raw, err);
  report.ept = moveEpt(join(from, 'ept'), to.ept);
  report.lidarWork = moveLidarWork(join(from, 'lidar-work'), to.lidarWork);
  const { raw, ept, lidarWork } = report;
  out(
    `raw: ${raw.moved} moved, ${raw.duplicate} already shared, ${raw.mismatched.length} mismatched, ${raw.left.length} left`
  );
  out(`ept: ${ept.moved} moved, ${ept.duplicate} already shared`);
  out(
    `lidar-work: ${lidarWork.moved} moved, ${lidarWork.duplicate} already shared, ${lidarWork.partial} partial removed`
  );
  report.boxesIndex = await indexBoxes(
    o.lockPath ?? join(from, '..', 'sources.lock.json'),
    to,
    out
  );
  return { code: raw.mismatched.length > 0 ? 1 : 0, report };
}
