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
    (f) => ({ rel: rel(f.url, f.optional), optional: f.optional || f.key === 'glyphs' })
  );
}

/** Paths (relative to /data/<version>/) a complete local copy of the dataset needs. */
export function collectDataPaths(manifest: Manifest, version: string): string[] {
  const paths = new Set<string>(['manifest.json']);
  for (const f of dataFiles(manifest, version)) paths.add(f.rel);
  return [...paths].sort();
}

/** True for sprite variants and glyph ranges: a 404 is tolerated (a source may ship only some). */
export function isOptionalPath(manifest: Manifest, version: string, rel: string): boolean {
  return dataFiles(manifest, version).some((f) => f.optional && f.rel === rel);
}

const USAGE = 'usage: data-local.ts <version> [--from <origin>] [--out <dir>]';

/** `<version> [--from <origin>] [--out <dir>]`, flags in either order; or the reason it is refused. */
export function parseDataLocalArgs(
  argv: string[]
): { version: string; origin: string; out: string | null } | { error: string } {
  let version: string | null = null;
  let origin = 'https://sfhousing.mindlace.net';
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from' || a === '--out') {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--from') origin = v;
      else out = v;
      i += 1;
    } else if (a.startsWith('-')) {
      return { error: `unknown flag ${a}` };
    } else if (version !== null) {
      return { error: `unexpected argument ${a}` };
    } else version = a;
  }
  if (version === null || !DATASET_VERSION_RE.test(version)) return { error: USAGE };
  return { version, origin, out };
}

async function main(): Promise<void> {
  const args = parseDataLocalArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    process.exit(1);
  }
  const { version, origin, out } = args;
  const base = origin.replace(/\/$/, '');
  const mres = await fetch(`${base}/data/${version}/manifest.json`);
  if (!mres.ok) throw new Error(`manifest fetch failed: ${mres.status}`);
  const manifest = ManifestSchema.parse(await mres.json());
  const paths = collectDataPaths(manifest, version);
  // With --out the files stay in that directory and are not put into local R2.
  const dir = out ?? mkdtempSync(join(tmpdir(), 'sfhousing-data-'));
  const optional = new Set(
    dataFiles(manifest, version)
      .filter((f) => f.optional)
      .map((f) => f.rel)
  );
  let loaded = 0;
  let skippedGlyphs = 0;
  try {
    for (const rel of paths) {
      const res = await fetch(`${base}/data/${version}/${rel}`);
      if (res.status === 404 && optional.has(rel)) {
        if (rel.startsWith('fonts/')) skippedGlyphs++;
        continue;
      }
      if (!res.ok) throw new Error(`fetch ${rel} failed: ${res.status}`);
      const file = join(dir, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      if (out === null) putLocal(version, rel, file);
      loaded++;
    }
  } finally {
    if (out === null) rmSync(dir, { recursive: true, force: true });
  }
  if (skippedGlyphs > 0)
    console.log(`Skipped ${skippedGlyphs} glyph range(s) the source does not ship`);
  console.log(
    out === null
      ? `Loaded ${loaded} object(s) into local R2 under data/${version}/`
      : `Wrote ${loaded} file(s) into ${out}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
