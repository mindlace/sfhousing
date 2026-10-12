import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { R2_BUCKET } from '../config';
import { run as defaultRun, type RunResult } from './exec';

export interface R2Target {
  dispose?(): Promise<void>;
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
     * common first-publish one, fails fast. This transport is retained for compatibility;
     * city-scale roof publication needs a reusable remote backend before release validation.
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

/** One local worker for the complete operation, sharing Wrangler's v3 resource layout. */
export async function localR2Target(
  opts: { projectRoot?: string; bucket?: string } = {}
): Promise<R2Target & { dispose(): Promise<void> }> {
  const { Miniflare, convertV4MiniflareOptions } = await import('miniflare');
  const { createReadStream, createWriteStream, statSync } = await import('node:fs');
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: `export default {async fetch(request,env){
        if(request.method!=='PUT') return new Response(null,{status:405});
        await env.BUCKET.put(decodeURIComponent(new URL(request.url).pathname.slice(1)),request.body,{httpMetadata:JSON.parse(request.headers.get('X-R2-Metadata'))});
        return new Response(null,{status:204});
      }}`,
      resourcePersistencePath: join(opts.projectRoot ?? ROOT, '.wrangler/state/v3'),
      r2Buckets: { BUCKET: opts.bucket ?? R2_BUCKET }
    })
  );
  try {
    const bucket = await mf.getR2Bucket('BUCKET');
    return {
      exists: async (key) => (await bucket.head(key)) !== null,
      put: async (key, file, contentType, cacheControl) => {
        const response = await mf.dispatchFetch(`http://localhost/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: createReadStream(file),
          duplex: 'half',
          headers: {
            'Content-Length': String(statSync(file).size),
            'X-R2-Metadata': JSON.stringify({ contentType, cacheControl })
          }
        });
        if (response.status !== 204)
          throw new Error(`local R2 put ${key}: ${response.status} ${await response.text()}`);
      },
      get: async (key, file) => {
        const obj = await bucket.get(key);
        if (!obj) return false;
        await pipeline(Readable.fromWeb(obj.body as never), createWriteStream(file));
        return true;
      },
      dispose: () => mf.dispose()
    };
  } catch (error) {
    await mf.dispose();
    throw error;
  }
}
