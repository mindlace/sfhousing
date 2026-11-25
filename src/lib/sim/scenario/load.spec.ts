// The scenario load's car data (car-ownership Task 11) on fixture-0: `scenarioUrls` names cars.bin
// and car-zones.json, `loadScenario` fetches and decodes cars.bin only for /sim (`opts.cars`) and
// only when the manifest names it, and a bad file is `scenario-invalid`.
import { describe, expect, it } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import { datasetFetch } from '../world/runner/test/harness';
import { loadScenario, scenarioUrls, type Loaded, type LoadDeps, type LoadFailure } from './load';

const FIXTURE = 'e2e/fixtures/data/fixture-0';

/** fixture-0's fetches, recording every URL asked for; `bytes` overrides one URL's bytes. */
function depsOf(bytes: Record<string, Uint8Array> = {}): LoadDeps & { fetched: string[] } {
  const f = datasetFetch(FIXTURE);
  const fetched: string[] = [];
  return {
    fetched,
    fetch: (url) => {
      fetched.push(url);
      return f.fetch(url);
    },
    fetchBytes: (url) => {
      fetched.push(url);
      const b = bytes[url];
      if (b === undefined) return f.fetchBytes(url);
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: async () => b.slice().buffer as ArrayBuffer
      });
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    retryDelaysMs: [],
    warn: () => {}
  };
}

const manifest = (): Manifest => datasetFetch(FIXTURE).manifest;

/** The manifest without `scenarios.fzp.cars` and `carZones` (a dataset built before them). */
function withoutCars(m: Manifest): Manifest {
  const fzp = { ...m.scenarios!.fzp };
  delete fzp.cars;
  delete fzp.carZones;
  return { ...m, scenarios: { fzp } };
}

function loaded(r: Loaded | LoadFailure): Loaded {
  if ('code' in r) throw new Error(`load failed: ${r.code} ${r.message}`);
  return r;
}

describe('scenarioUrls', () => {
  it('names cars.bin and car-zones.json when the manifest does', () => {
    const m = manifest();
    const u = scenarioUrls(m)!;
    expect(u.cars).toBe(`/data/${m.datasetVersion}/scenarios/fzp/cars.bin`);
    expect(u.carZones).toBe(`/data/${m.datasetVersion}/scenarios/fzp/car-zones.json`);
  });

  it('gives null for both without them, or outside /data/<v>/', () => {
    const m = manifest();
    const u = scenarioUrls(withoutCars(m))!;
    expect(u.cars).toBeNull();
    expect(u.carZones).toBeNull();
    const fzp = { ...m.scenarios!.fzp, cars: '/data/other/cars.bin' };
    expect(scenarioUrls({ ...m, scenarios: { fzp } })!.cars).toBeNull();
  });
});

describe('loadScenario: cars', () => {
  it('with cars: decodes cars.bin against the parcels', async () => {
    const m = manifest();
    const deps = depsOf();
    const r = loaded(
      await loadScenario(deps, scenarioUrls(m)!, () => false, { policy: true, cars: true })
    );
    expect(r.cars).not.toBeNull();
    expect(r.cars!.zones.length).toBeGreaterThan(0);
    expect(r.cars!.lotZone.length).toBe(r.fzp.parcels.count);
    expect(deps.fetched.filter((u) => u.endsWith('/cars.bin'))).toHaveLength(1);
    // the page fetches the zones' outlines, never the worker
    expect(deps.fetched.some((u) => u.endsWith('/car-zones.json'))).toBe(false);
  });

  it('without the manifest naming it: cars null, never fetched', async () => {
    const deps = depsOf();
    const urls = scenarioUrls(withoutCars(manifest()))!;
    const r = loaded(await loadScenario(deps, urls, () => false, { policy: true, cars: true }));
    expect(r.cars).toBeNull();
    expect(deps.fetched.some((u) => u.endsWith('/cars.bin'))).toBe(false);
  });

  it('without opts.cars (not /sim): cars null, never fetched', async () => {
    const deps = depsOf();
    const urls = scenarioUrls(manifest())!;
    const r = loaded(await loadScenario(deps, urls, () => false, { policy: true }));
    expect(r.cars).toBeNull();
    expect(deps.fetched.some((u) => u.endsWith('/cars.bin'))).toBe(false);
  });

  it('a cars.bin that does not decode is scenario-invalid', async () => {
    const urls = scenarioUrls(manifest())!;
    const deps = depsOf({ [urls.cars!]: new Uint8Array([1, 2, 3]) });
    const r = await loadScenario(deps, urls, () => false, { policy: true, cars: true });
    expect('code' in r && r.code).toBe('scenario-invalid');
    expect((r as LoadFailure).message.startsWith('scenario cars.bin: ')).toBe(true);
  });
});
