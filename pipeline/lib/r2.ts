import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { R2_BUCKET } from '../config';
import { run as defaultRun, type RunResult } from './exec';

export interface R2Target {
  exists(key: string): Promise<boolean>;
  put(key: string, file: string, contentType: string, cacheControl: string): Promise<void>;
  /** Download `key` to `file`. Returns false when the object does not exist; throws on any other failure. */
  get(key: string, file: string): Promise<boolean>;
}

export type RunFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; input?: string }
) => Promise<RunResult>;

const WRANGLER = resolve(import.meta.dirname, '../../node_modules/.bin/wrangler');
const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Wrangler's not-found text, pinned against wrangler 4.149.0 (`r2 object get` on a missing key
 * exits 1 and prints "The specified key does not exist." to stderr, wrapped in ANSI colour codes).
 */
const NOT_FOUND = /The specified key does not exist/i;

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.pmtiles': 'application/vnd.pmtiles',
  '.pbf': 'application/x-protobuf'
};

/** Content-Type stored with an artifact, by extension (the worker overrides it by extension too). */
export function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** R2 through `wrangler r2 object …`, `--local` (Miniflare) or `--remote`. */
export function wranglerTarget(opts: { local: boolean; bucket?: string; run?: RunFn }): R2Target {
  const bucket = opts.bucket ?? R2_BUCKET;
  const run = opts.run ?? defaultRun;
  const where = opts.local ? '--local' : '--remote';
  const wr = (args: string[]) =>
    run(WRANGLER, ['r2', 'object', ...args, where], { cwd: ROOT, input: '' });
  const target: R2Target = {
    async get(key, file) {
      const r = await wr(['get', `${bucket}/${key}`, '--file', file]);
      if (r.code === 0) return true;
      if (NOT_FOUND.test(r.stderr) || NOT_FOUND.test(r.stdout)) {
        // wrangler leaves an empty file behind on not-found
        if (existsSync(file)) rmSync(file, { force: true });
        return false;
      }
      throw new Error(`wrangler r2 object get ${key} failed (exit ${r.code}): ${r.stderr.trim()}`);
    },
    /**
     * Wrangler has no HEAD for R2 objects (`r2 object` only has get/put/delete), so this downloads
     * the object to a temp file and discards it. Fine for the tiny manifest probe. For the
     * `sources/<sha>` archive probes it costs a full download of every archive that is already
     * published (basemap/Overture archives can be hundreds of MB); the missing-archive case, the
     * common first-publish one, fails fast. Accepted: re-uploads are rare and no new dependency
     * (S3 client) is warranted.
     */
    async exists(key) {
      const dir = mkdtempSync(join(tmpdir(), 'sfh-r2-'));
      try {
        return await target.get(key, join(dir, 'probe'));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    async put(key, file, contentType, cacheControl) {
      const r = await wr([
        'put',
        `${bucket}/${key}`,
        '--file',
        file,
        '--content-type',
        contentType,
        '--cache-control',
        cacheControl
      ]);
      if (r.code !== 0) {
        throw new Error(
          `wrangler r2 object put ${key} failed (exit ${r.code}): ${r.stderr.trim()}`
        );
      }
    }
  };
  return target;
}
