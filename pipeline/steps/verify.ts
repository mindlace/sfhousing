import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { roofArtifactUrls } from '../../src/lib/data/roof-paths';
import { parseRoofIndex, ROOF_INDEX_MAX_BYTES } from '../../src/lib/data/building-roofs';
import { checkRoofArtifacts, readBounded } from '../roofs/check';
import { parseManifest, type Manifest } from '../../src/lib/data/manifest';
import { FONT_STACKS } from '../config';

export interface VerifyArgs {
  datasetVersion: string;
  origin: string;
  fetch?: typeof fetch;
}

/** Spec §4.10: check a published version through a running origin. Collects all failures. */
export async function verify(a: VerifyArgs): Promise<{ ok: boolean; failures: string[] }> {
  const f = a.fetch ?? fetch;
  const failures: string[] = [];
  const base = a.origin.replace(/\/+$/, '');
  const abs = (p: string) => `${base}${p}`;

  const manifestPath = `/data/${a.datasetVersion}/manifest.json`;
  let m: Manifest;
  try {
    const r = await f(abs(manifestPath));
    if (r.status !== 200) {
      return { ok: false, failures: [`manifest ${manifestPath}: expected 200, got ${r.status}`] };
    }
    m = parseManifest(await r.json());
  } catch (e) {
    return { ok: false, failures: [`manifest ${manifestPath}: ${(e as Error).message}`] };
  }
  if (m.datasetVersion !== a.datasetVersion) {
    failures.push(`manifest declares ${m.datasetVersion}, expected ${a.datasetVersion}`);
  }

  const check = async (
    method: 'HEAD' | 'GET',
    path: string,
    expected: number,
    range?: string
  ): Promise<void> => {
    try {
      const r = await f(abs(path), { method, headers: range ? { Range: `bytes=${range}` } : {} });
      await r.arrayBuffer().catch(() => undefined);
      if (r.status !== expected)
        failures.push(`${method} ${path}: expected ${expected}, got ${r.status}`);
    } catch (e) {
      failures.push(`${method} ${path}: ${(e as Error).message}`);
    }
  };

  const heads = [
    ...m.chunks.map((c) => c.url),
    m.neighborhoods,
    m.buildingsTiles,
    m.basemapTiles,
    ...Object.values(FONT_STACKS).map((s) =>
      m.glyphs.replace('{fontstack}', s).replace('{range}', '0-255')
    )
  ];
  for (const p of heads) await check('HEAD', p, 200);
  for (const p of [m.buildingsTiles, m.basemapTiles]) await check('GET', p, 206, '0-126');
  if (m.buildingRoofs) {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-verify-roofs-'));
    try {
      const save = async (path: string, limit?: number) => {
        const r = await f(abs(path));
        if (r.status !== 200 || !r.body) throw new Error(`${path}: expected 200, got ${r.status}`);
        const file = join(dir, path.slice(`/data/${m.datasetVersion}/`.length));
        mkdirSync(dirname(file), { recursive: true });
        let total = 0;
        await pipeline(
          Readable.fromWeb(r.body as never),
          async function* (source) {
            for await (const bytes of source) {
              total += bytes.length;
              if (limit !== undefined && total > limit)
                throw new Error(`roof body too large: ${path}`);
              yield bytes;
            }
          },
          createWriteStream(file)
        );
        return file;
      };
      const descriptor = m.buildingRoofs;
      roofArtifactUrls(descriptor, undefined);
      const indexPath = await save(descriptor.indexUrl, ROOF_INDEX_MAX_BYTES);
      const index =
        descriptor.schemaVersion === 1
          ? parseRoofIndex(
              JSON.parse(readBounded(indexPath, ROOF_INDEX_MAX_BYTES).toString()),
              m.datasetVersion
            )
          : undefined;
      const urls = roofArtifactUrls(descriptor, index);
      for (const path of urls.slice(1)) {
        const ref = index?.chunks.find((c) => c.headerUrl === path || c.meshUrl === path);
        await save(
          path,
          ref
            ? ref.headerUrl === path
              ? ref.headerBytes
              : ref.meshBytes
            : path === descriptor.reportUrl
              ? ROOF_INDEX_MAX_BYTES
              : undefined
        );
      }
      failures.push(...(await checkRoofArtifacts(dir, m)).failures);
    } catch (error) {
      failures.push(`roofs: ${(error as Error).message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { ok: failures.length === 0, failures };
}
