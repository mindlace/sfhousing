import { roofArtifactUrls } from '../src/lib/data/roof-paths';
import { parseRoofIndex, type RoofIndex } from '../src/lib/data/building-roofs';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATASET_VERSION_RE, ManifestSchema, type Manifest } from '../src/lib/data/manifest';
import { dataKey } from '../src/lib/server/data/key';
import { localR2Target, contentTypeFor } from '../pipeline/lib/r2';
import { IMMUTABLE } from '../pipeline/config';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SPRITE_SUFFIXES = ['.json', '.png', '@2x.json', '@2x.png'];

/** Paths (relative to /data/<version>/) a complete local copy of the dataset needs. */
export function collectDataPaths(
  manifest: Manifest,
  version: string,
  roofIndex?: RoofIndex
): string[] {
  const prefix = `/data/${version}/`;
  const rel = (url: string): string => {
    if (!url.startsWith(prefix)) throw new Error(`URL ${url} is outside version ${version}`);
    const path = url.slice(prefix.length);
    if (dataKey(version, path) === null) throw new Error(`URL ${url} is not a servable data path`);
    return path;
  };
  const paths = new Set<string>(['manifest.json']);
  for (const c of manifest.chunks) paths.add(rel(c.url));
  paths.add(rel(manifest.buildingsTiles));
  paths.add(rel(manifest.basemapTiles));
  paths.add(rel(manifest.neighborhoods));
  if (manifest.buildingRoofs)
    for (const url of roofArtifactUrls(manifest.buildingRoofs, roofIndex)) paths.add(rel(url));
  for (const s of spriteVariants(manifest, version)) paths.add(s);
  return [...paths].sort();
}

function spriteVariants(manifest: Manifest, version: string): string[] {
  if (!manifest.sprite) return [];
  const base = manifest.sprite.slice(`/data/${version}/`.length);
  return SPRITE_SUFFIXES.map((s) => base + s);
}

/** True for any path derived from `manifest.sprite` (optional: a 404 is tolerated). */
export function isSpritePath(manifest: Manifest, version: string, rel: string): boolean {
  return spriteVariants(manifest, version).includes(rel);
}

export async function copyDataLocal(opts: {
  version: string;
  origin: string;
  projectRoot: string;
  fetch?: typeof fetch;
  put?: (version: string, rel: string, file: string) => Promise<void>;
}): Promise<number> {
  const { version } = opts;
  if (!DATASET_VERSION_RE.test(version)) throw new Error('invalid dataset version');
  const base = opts.origin.replace(/\/$/, ''),
    fetcher = opts.fetch ?? fetch;
  const response = await fetcher(`${base}/data/${version}/manifest.json`);
  if (!response.ok) throw new Error(`manifest fetch failed: ${response.status}`);
  const manifest = ManifestSchema.parse(await response.json());
  if (manifest.datasetVersion !== version) throw new Error('manifest version mismatch');
  collectDataPaths(manifest, version);
  const dir = mkdtempSync(join(tmpdir(), 'sfhousing-data-'));
  const target = opts.put ? undefined : await localR2Target({ projectRoot: opts.projectRoot });
  const put =
    opts.put ??
    (async (v, rel, file) => target!.put(`data/${v}/${rel}`, file, contentTypeFor(rel), IMMUTABLE));
  let loaded = 0;
  const download = async (rel: string, limit?: number) => {
    const response = await fetcher(`${base}/data/${version}/${rel}`);
    if (response.status === 404 && isSpritePath(manifest, version, rel)) return null;
    if (!response.ok || !response.body) throw new Error(`fetch ${rel} failed: ${response.status}`);
    const file = join(dir, rel);
    mkdirSync(dirname(file), { recursive: true });
    let total = 0;
    await pipeline(
      Readable.fromWeb(response.body as never),
      async function* (source) {
        for await (const bytes of source) {
          total += bytes.length;
          if (limit !== undefined && total > limit)
            throw new Error('roof index exceeds byte limit');
          yield bytes;
        }
      },
      createWriteStream(file)
    );
    return file;
  };
  try {
    let index: RoofIndex | undefined, indexRel: string | undefined;
    if (manifest.buildingRoofs?.schemaVersion === 1) {
      indexRel = manifest.buildingRoofs.indexUrl.slice(`/data/${version}/`.length);
      const file = await download(indexRel, 8 * 1024 * 1024);
      index = parseRoofIndex(JSON.parse(readFileSync(file!, 'utf8')), version);
    }
    const paths = collectDataPaths(manifest, version, index).sort((a, b) =>
      a === 'manifest.json' ? 1 : b === 'manifest.json' ? -1 : a.localeCompare(b)
    );
    for (const rel of paths) {
      const file = rel === indexRel ? join(dir, rel) : await download(rel);
      if (!file) continue;
      await put(version, rel, file);
      loaded++;
    }
    rmSync(join(opts.projectRoot, '.wrangler/state/v3/cache'), { recursive: true, force: true });
    return loaded;
  } finally {
    await target?.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const origin = fromIdx >= 0 ? (args[fromIdx + 1] ?? '') : 'https://sfhousing.mindlace.net';
  const version = args.filter((_, i) => fromIdx < 0 || (i !== fromIdx && i !== fromIdx + 1))[0];
  if (!version || !DATASET_VERSION_RE.test(version) || !origin) {
    console.error('usage: data-local.ts <version> [--from <origin>]');
    process.exit(1);
  }
  const loaded = await copyDataLocal({
    version,
    origin,
    projectRoot: new URL('..', import.meta.url).pathname
  });
  console.warn(
    'Warning: glyphs is a {fontstack}/{range}.pbf template; glyph PBFs are not fetched.'
  );
  console.log(`Loaded ${loaded} object(s) into local R2 under data/${version}/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
