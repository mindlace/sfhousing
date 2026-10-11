import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATASET_VERSION_RE, ManifestSchema, type Manifest } from '../src/lib/data/manifest';
import { dataKey } from '../src/lib/server/data/key';
import { putLocal } from './r2-put-local';

const SPRITE_SUFFIXES = ['.json', '.png', '@2x.json', '@2x.png'];

/** Paths (relative to /data/<version>/) a complete local copy of the dataset needs. */
export function collectDataPaths(manifest: Manifest, version: string): string[] {
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  const origin = fromIdx >= 0 ? (args[fromIdx + 1] ?? '') : 'https://sfhousing.mindlace.net';
  const version = args.filter((_, i) => fromIdx < 0 || (i !== fromIdx && i !== fromIdx + 1))[0];
  if (!version || !DATASET_VERSION_RE.test(version) || !origin) {
    console.error('usage: data-local.ts <version> [--from <origin>]');
    process.exit(1);
  }
  const base = origin.replace(/\/$/, '');
  const mres = await fetch(`${base}/data/${version}/manifest.json`);
  if (!mres.ok) throw new Error(`manifest fetch failed: ${mres.status}`);
  const manifest = ManifestSchema.parse(await mres.json());
  const paths = collectDataPaths(manifest, version);
  const dir = mkdtempSync(join(tmpdir(), 'sfhousing-data-'));
  let loaded = 0;
  try {
    for (const rel of paths) {
      const res = await fetch(`${base}/data/${version}/${rel}`);
      if (res.status === 404 && isSpritePath(manifest, version, rel)) continue;
      if (!res.ok) throw new Error(`fetch ${rel} failed: ${res.status}`);
      const file = join(dir, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      putLocal(version, rel, file);
      loaded++;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
