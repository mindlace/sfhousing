import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface LockFile {
  url: string;
  sha256: string;
  bytes: number;
  archiveKey: string;
  /** Local filename under the raw dir (e.g. "page-000.geojson"). */
  name: string;
}

export interface LockSpatial {
  horizontalCrs: string;
  verticalCrs: string | null;
  horizontalUnits: string;
  verticalUnits: string;
  acquisitionStart: string | null;
  acquisitionEnd: string | null;
  coverage: { id: string; bbox: [number, number, number, number] }[];
  supportBufferM: number;
  permission: 'confirmed' | 'unconfirmed' | 'denied';
  alignment: 'verified' | 'unverified' | 'not-applicable';
  status?: 'available' | 'unavailable' | 'disabled';
  objects: { name: string; url: string; sha256: string }[];
  tiles?: {
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
    transform: number[];
  }[];
}

export interface LockEntry {
  spatial?: LockSpatial;
  id: string;
  files: LockFile[];
  retrievedAt: string;
  upstreamVersion: string;
  rowCount: number;
  license: string;
  label?: string;
  homepage: string;
}

/** Sorted by id. */
export interface Lock {
  sources: LockEntry[];
}

/** Recursively sorted object keys (undefined values dropped); arrays keep their order. */
export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortKeys(val);
    }
    return out;
  }
  return v;
}

/** JSON with keys sorted recursively and no whitespace. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}

/** sha256 of canonicalJson(lock): recorded in report.json, re-checked by `upload`. */
export function lockSha256(lock: Lock): string {
  return createHash('sha256').update(canonicalJson(lock)).digest('hex');
}

export function readLock(p: string): Lock {
  return JSON.parse(fs.readFileSync(p, 'utf8')) as Lock;
}

/** Canonical JSON, 2-space indent, trailing newline; sources sorted by id. */
export function writeLock(p: string, lock: Lock): void {
  const sorted: Lock = {
    sources: [...lock.sources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  };
  fs.writeFileSync(p, JSON.stringify(sortKeys(sorted), null, 2) + '\n');
}

export function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

/** Where a lock file's raw bytes live: `${rawDir}/${sha256}`, or `${rawDir}/${name}` when byName. */
export function rawPath(rawDir: string, f: LockFile, byName = false): string {
  return path.join(rawDir, byName ? f.name : f.sha256);
}

/** Verify every raw file against the lock (see rawPath). Returns mismatch messages; [] = ok. */
export async function verifyRaw(
  lock: Lock,
  rawDir: string,
  opts: { byName?: boolean } = {}
): Promise<string[]> {
  const msgs: string[] = [];
  for (const entry of lock.sources) {
    for (const f of entry.files) {
      const p = rawPath(rawDir, f, opts.byName);
      if (!fs.existsSync(p)) {
        msgs.push(`${entry.id}: missing raw file ${f.name} (${f.sha256})`);
        continue;
      }
      const actual = await sha256File(p);
      if (actual !== f.sha256) {
        msgs.push(
          `${entry.id}: sha256 mismatch for ${f.name} (expected ${f.sha256}, got ${actual})`
        );
      }
    }
  }
  return msgs;
}

export function archiveKeyFor(sha256: string, name: string): string {
  return `sources/${sha256}${path.extname(name)}`;
}
