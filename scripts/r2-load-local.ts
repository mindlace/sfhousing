import { readdirSync, rmSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DATASET_VERSION_RE } from '../src/lib/data/manifest';
import { localR2Target, contentTypeFor } from '../pipeline/lib/r2';
import { IMMUTABLE } from '../pipeline/config';

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  );
}

/**
 * Load every file under `dir` into local R2 at data/<version>/, then drop wrangler's persisted
 * Cache API state: the adapter worker caches /data responses (immutable, 1y) in caches.default
 * and `wrangler dev` persists it, so a reloaded version would otherwise keep serving old bytes.
 */
export async function loadLocal(
  dir: string,
  version: string,
  projectRoot: string,
  put?: (version: string, rel: string, file: string) => void | Promise<void>
): Promise<number> {
  const root = resolve(dir);
  const files = walk(root)
    .filter((f) => f !== join(root, 'README.md') && !basename(f).startsWith('.'))
    .sort();
  const target = put ? undefined : await localR2Target({ projectRoot });
  const write =
    put ??
    (async (v, rel, file) => target!.put(`data/${v}/${rel}`, file, contentTypeFor(rel), IMMUTABLE));
  try {
    for (const file of files) await write(version, relative(root, file).split(sep).join('/'), file);
    rmSync(join(projectRoot, '.wrangler/state/v3/cache'), { recursive: true, force: true });
    return files.length;
  } finally {
    await target?.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dirArg, version] = process.argv.slice(2);
  if (!dirArg || !version || !DATASET_VERSION_RE.test(version)) {
    console.error('usage: r2-load-local.ts <dir> <version>  (version must match the I12 pattern)');
    process.exit(1);
  }
  const n = await loadLocal(dirArg, version, fileURLToPath(new URL('..', import.meta.url)));
  console.log(`Loaded ${n} object(s) into local R2 under data/${version}/ (local cache purged)`);
}
