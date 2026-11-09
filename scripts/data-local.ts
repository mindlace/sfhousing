import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DATASET_VERSION_RE,
  GLYPH_RANGES,
  ManifestSchema,
  manifestFiles,
  type Manifest
} from '../src/lib/data/manifest';
import { FONT_STACKS } from '../pipeline/config';
import { dataKey } from '../src/lib/server/data/key';
import { putLocal } from './r2-put-local';

/** Every file of the dataset, with the entries a 404 is tolerated for. */
function dataFiles(manifest: Manifest, version: string): { rel: string; optional: boolean }[] {
  const prefix = `/data/${version}/`;
  const rel = (url: string, optional: boolean): string => {
    if (!url.startsWith(prefix)) throw new Error(`URL ${url} is outside version ${version}`);
    const path = url.slice(prefix.length);
    // Sprite variants (`@2x`) are never checked: the data route would refuse them either way.
    if (!optional && dataKey(version, path) === null)
      throw new Error(`URL ${url} is not a servable data path`);
    return path;
  };
  return manifestFiles(manifest, { stacks: Object.values(FONT_STACKS), ranges: GLYPH_RANGES }).map(
    (f) => ({ rel: rel(f.url, f.optional), optional: f.optional })
  );
}

/** Paths (relative to /data/<version>/) a complete local copy of the dataset needs. */
export function collectDataPaths(manifest: Manifest, version: string): string[] {
  const paths = new Set<string>(['manifest.json']);
  for (const f of dataFiles(manifest, version)) paths.add(f.rel);
  return [...paths].sort();
}

/** True for a path the manifest marks optional (sprite variants): a 404 is tolerated. */
export function isOptionalPath(manifest: Manifest, version: string, rel: string): boolean {
  return dataFiles(manifest, version).some((f) => f.optional && f.rel === rel);
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
      if (res.status === 404 && isOptionalPath(manifest, version, rel)) continue;
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
  console.log(`Loaded ${loaded} object(s) into local R2 under data/${version}/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
