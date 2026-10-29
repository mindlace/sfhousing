import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verify } from '../steps/verify';

const golden = readFileSync(
  join(import.meta.dirname, 'fixtures/mini/golden/manifest.json'),
  'utf8'
);
const m = JSON.parse(golden) as { datasetVersion: string; chunks: { url: string }[] };
const V = m.datasetVersion;

function fakeFetch(
  over: (url: string, init: RequestInit) => Response | undefined = () => undefined,
  manifestBody: string = golden
) {
  const seen: string[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const path = new URL(url).pathname;
    seen.push(`${init.method ?? 'GET'} ${path}`);
    const o = over(path, init);
    if (o) return o;
    if (path === `/data/${V}/manifest.json`) return new Response(manifestBody, { status: 200 });
    const range = new Headers(init.headers).get('range');
    if (init.method !== 'HEAD' && path.endsWith('.pmtiles') && range) {
      return new Response('x', { status: 206 });
    }
    return new Response('x', { status: 200 });
  }) as typeof fetch;
  return { f, seen };
}

describe('verify', () => {
  it('is ok when everything answers as expected', async () => {
    const { f, seen } = fakeFetch();
    const r = await verify({ datasetVersion: V, origin: 'http://o', fetch: f });
    expect(r).toEqual({ ok: true, failures: [] });
    expect(seen).toContain(`HEAD /data/${V}/fonts/NotoSans-Medium/0-255.pbf`);
    expect(seen).toContain(`GET /data/${V}/buildings.pmtiles`);
    expect(seen).toContain(`HEAD /data/${V}/transit.json`);
  });
  it('HEAD-checks the policy and frontage urls when the manifest names them', async () => {
    const withKeys = JSON.parse(golden) as {
      scenarios: { fzp: Record<string, string> };
    };
    withKeys.scenarios.fzp.policy = `/data/${V}/scenarios/fzp/policy.bin`;
    withKeys.scenarios.fzp.frontage = `/data/${V}/scenarios/fzp/frontage.bin`;
    const { f, seen } = fakeFetch(undefined, JSON.stringify(withKeys));
    const r = await verify({ datasetVersion: V, origin: 'http://o', fetch: f });
    expect(r).toEqual({ ok: true, failures: [] });
    expect(seen).toContain(`HEAD /data/${V}/scenarios/fzp/policy.bin`);
    expect(seen).toContain(`HEAD /data/${V}/scenarios/fzp/frontage.bin`);
  });
  it('does not request policy or frontage when the manifest lacks them', async () => {
    const { f, seen } = fakeFetch();
    await verify({ datasetVersion: V, origin: 'http://o', fetch: f });
    expect(seen.some((s) => s.includes('policy.bin') || s.includes('frontage.bin'))).toBe(false);
  });
  it('collects a missing chunk and a PMTiles that ignores Range', async () => {
    const chunk = new URL(m.chunks[0].url, 'http://o').pathname;
    const { f } = fakeFetch((p) => {
      if (p === chunk) return new Response('no', { status: 404 });
      if (p === `/data/${V}/basemap.pmtiles`) return new Response('x', { status: 200 });
      return undefined;
    });
    const r = await verify({ datasetVersion: V, origin: 'http://o', fetch: f });
    expect(r.ok).toBe(false);
    expect(r.failures.some((x) => x.includes(chunk) && x.includes('404'))).toBe(true);
    expect(r.failures.some((x) => x.includes('basemap.pmtiles') && x.includes('200'))).toBe(true);
  });
  it('fails (does not throw) on an unreachable or invalid manifest', async () => {
    const { f } = fakeFetch((p) =>
      p.endsWith('manifest.json') ? new Response('{}', { status: 200 }) : undefined
    );
    const r = await verify({ datasetVersion: V, origin: 'http://o', fetch: f });
    expect(r.ok).toBe(false);
    expect(r.failures[0]).toMatch(/manifest/);
  });
});
