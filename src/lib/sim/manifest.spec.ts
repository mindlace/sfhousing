import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ManifestError } from '$lib/data/manifest';
import { loadManifest } from './manifest';

const FIXTURE_TEXT = readFileSync(
  fileURLToPath(new URL('../../../e2e/fixtures/data/fixture-0/manifest.json', import.meta.url)),
  'utf8'
);

/** fixture-0's manifest with datasetVersion and every /data/fixture-0/ url rewritten to `v`. */
const manifestFor = (v: string): unknown =>
  JSON.parse(
    FIXTURE_TEXT.replaceAll('/data/fixture-0/', `/data/${v}/`).replace(
      '"datasetVersion":"fixture-0"',
      `"datasetVersion":"${v}"`
    )
  );

type Route = unknown; // number | JSON body | string | (() => never)
/** Fake fetch: a number is an empty response with that status; a value is a 200 JSON body. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetchFn = async (url: string): Promise<Response> => {
    calls.push(url);
    const r = routes[url];
    if (typeof r === 'function') return r();
    if (r === undefined) return new Response(null, { status: 404 });
    if (typeof r === 'number') return new Response(null, { status: r });
    return new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200 });
  };
  return { calls, fetchFn };
}

const URL7 = '/data/fixture-7/manifest.json';
const URL8 = '/data/fixture-8/manifest.json';

describe('loadManifest', () => {
  it("returns the plan's manifest when present (one fetch)", async () => {
    const { calls, fetchFn } = fakeFetch({ [URL7]: manifestFor('fixture-7') });
    const r = await loadManifest('fixture-7', 'fixture-8', fetchFn);
    expect(r.fellBack).toBe(false);
    expect(r.manifest.datasetVersion).toBe('fixture-7');
    expect(calls).toEqual([URL7]);
  });

  it('falls back to current on a plan-version 404', async () => {
    const { calls, fetchFn } = fakeFetch({ [URL7]: 404, [URL8]: manifestFor('fixture-8') });
    const r = await loadManifest('fixture-7', 'fixture-8', fetchFn);
    expect(r.fellBack).toBe(true);
    expect(r.manifest.datasetVersion).toBe('fixture-8');
    expect(calls).toEqual([URL7, URL8]);
  });

  it('rejects when plan === current and it 404s (one fetch)', async () => {
    const { calls, fetchFn } = fakeFetch({ [URL8]: 404 });
    await expect(loadManifest('fixture-8', 'fixture-8', fetchFn)).rejects.toThrow(/404/);
    expect(calls).toEqual([URL8]);
  });

  it('rejects on a 5xx for the plan version without a fallback fetch', async () => {
    const { calls, fetchFn } = fakeFetch({ [URL7]: 503, [URL8]: manifestFor('fixture-8') });
    await expect(loadManifest('fixture-7', 'fixture-8', fetchFn)).rejects.toThrow(/503/);
    expect(calls).toEqual([URL7]);
  });

  it('rejects on a double 404', async () => {
    const { calls, fetchFn } = fakeFetch({ [URL7]: 404, [URL8]: 404 });
    await expect(loadManifest('fixture-7', 'fixture-8', fetchFn)).rejects.toThrow(/404/);
    expect(calls).toEqual([URL7, URL8]);
  });

  it('rejects on a network error', async () => {
    const { fetchFn } = fakeFetch({
      [URL7]: () => {
        throw new TypeError('Failed to fetch');
      }
    });
    await expect(loadManifest('fixture-7', 'fixture-8', fetchFn)).rejects.toThrow(
      'Failed to fetch'
    );
  });

  it('rejects invalid JSON', async () => {
    const { fetchFn } = fakeFetch({ [URL7]: '{not json' });
    await expect(loadManifest('fixture-7', 'fixture-8', fetchFn)).rejects.toThrow();
  });

  it('rejects a schema-invalid manifest with ManifestError', async () => {
    const bad = { ...(manifestFor('fixture-7') as object), chunks: 'nope' };
    const { fetchFn } = fakeFetch({ [URL7]: bad });
    await expect(loadManifest('fixture-7', 'fixture-8', fetchFn)).rejects.toBeInstanceOf(
      ManifestError
    );
  });

  it('rejects a manifest whose datasetVersion differs from the requested one', async () => {
    const { fetchFn } = fakeFetch({ [URL7]: manifestFor('fixture-9') });
    await expect(loadManifest('fixture-7', 'fixture-8', fetchFn)).rejects.toThrow(
      /datasetVersion is fixture-9/
    );
  });

  it('fetches current directly for an invalid planVersion (fellBack: true)', async () => {
    const { calls, fetchFn } = fakeFetch({ [URL8]: manifestFor('fixture-8') });
    const r = await loadManifest('nope', 'fixture-8', fetchFn);
    expect(r.fellBack).toBe(true);
    expect(r.manifest.datasetVersion).toBe('fixture-8');
    expect(calls).toEqual([URL8]);
  });

  it('rejects an invalid currentVersion without fetching', async () => {
    const { calls, fetchFn } = fakeFetch({});
    await expect(loadManifest('fixture-7', 'nope', fetchFn)).rejects.toThrow(
      /invalid current datasetVersion/
    );
    expect(calls).toEqual([]);
  });
});
