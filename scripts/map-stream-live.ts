// `npx tsx scripts/map-stream-live.ts <version> <outDir> [--from <origin>]`: copies a published
// dataset's manifest, scenario files and parcel chunks into <outDir>, laid out as under
// /data/<version>/, so `liveInput(dir)` and `dirRecords(dir)` read it. Skips files already present.
// Default origin https://sfhousing.mindlace.net. Not part of the bundle.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseManifest, type Manifest } from '../src/lib/data/manifest';
import { scenarioUrls } from '../src/lib/sim/scenario/load';

/**
 * Paths relative to /data/<version>/: manifest.json, scenarioUrls' parcels, projects and
 * calibration (and policy, gross when present), and every manifest.chunks[].url. Throws on a URL
 * outside the version.
 */
export function liveFiles(manifest: Manifest): string[] {
  const prefix = `/data/${manifest.datasetVersion}/`;
  const rel = (url: string): string => {
    if (!url.startsWith(prefix)) throw new Error(`${url} is outside ${prefix}`);
    return url.slice(prefix.length);
  };
  const out = new Set<string>(['manifest.json']);
  const urls = scenarioUrls(manifest);
  if (urls) {
    for (const u of [urls.parcels, urls.projects, urls.calibration, urls.policy, urls.gross]) {
      if (u) out.add(rel(u));
    }
  }
  for (const c of manifest.chunks) out.add(rel(c.url));
  return [...out];
}

async function main(argv: string[]): Promise<void> {
  const args = argv.filter((a, i) => a !== '--from' && argv[i - 1] !== '--from');
  const [version, outDir] = args;
  const fromAt = argv.indexOf('--from');
  const origin = fromAt >= 0 ? argv[fromAt + 1] : 'https://sfhousing.mindlace.net';
  if (!version || !outDir)
    throw new Error('usage: map-stream-live.ts <version> <outDir> [--from <origin>]');
  const base = `${origin}/data/${version}/`;
  const get = async (path: string): Promise<Buffer> => {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`${base + path}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const save = (path: string, bytes: Buffer) => {
    const to = join(outDir, path);
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, bytes);
  };
  const manifestPath = join(outDir, 'manifest.json');
  if (!existsSync(manifestPath)) save('manifest.json', await get('manifest.json'));
  const manifest = parseManifest(
    JSON.parse(await (await import('node:fs/promises')).readFile(manifestPath, 'utf8'))
  );
  if (manifest.datasetVersion !== version) {
    throw new Error(`manifest says ${manifest.datasetVersion}, asked for ${version}`);
  }
  const files = liveFiles(manifest);
  let fetched = 0;
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const path = files[next++];
      if (existsSync(join(outDir, path))) continue;
      save(path, await get(path));
      fetched++;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`${files.length} files, ${fetched} fetched, into ${outDir}`);
}

if (process.argv[1]?.endsWith('map-stream-live.ts')) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
