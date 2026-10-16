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
    ...(m.transit ? [m.transit] : []),
    m.buildingsTiles,
    m.basemapTiles,
    ...Object.values(FONT_STACKS).map((s) =>
      m.glyphs.replace('{fontstack}', s).replace('{range}', '0-255')
    )
  ];
  for (const p of heads) await check('HEAD', p, 200);
  for (const p of [m.buildingsTiles, m.basemapTiles]) await check('GET', p, 206, '0-126');
  return { ok: failures.length === 0, failures };
}
