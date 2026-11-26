// The scenario load's car data (car-ownership Task 11) on fixture-0: `scenarioUrls` names cars.bin
// and car-zones.json, `loadScenario` fetches and decodes cars.bin only for /sim (`opts.cars`) and
// only when the manifest names it, and a bad file is `scenario-invalid`.
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { grossRowOf, grossTableOf } from '$lib/data/gross-table';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import { scenarioRecordOf } from '$lib/data/scenario-codec';
import { parseCalibration } from '$lib/timelapse/model';
import { datasetFetch } from '../world/runner/test/harness';
import {
  MINI_FRONTAGE_URL,
  MINI_POLICY_URL,
  grossBinOf,
  miniDataset
} from '../world/test/mini-dataset';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { MINI_GROSS_URL } from './fixtures/mini-gross';
import { MINI_SCENARIO_URLS, MINI_VERSION, miniCity } from './fixtures/mini-parcels';
import { miniPolicy } from './fixtures/mini-policy';
import { MINI_INVALID_INDEX, miniProjectsJson } from './fixtures/mini-projects';
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

// The load's failure paths on the mini city, asserted on `loadScenario` and `scenarioUrls`
// directly: fetch failures after the retries, files that fail to decode or validate, and the
// manifest's URLs.
const URLS = MINI_SCENARIO_URLS;
type Json = Record<string, unknown>;
type Failure = { status: number } | 'reject' | 'body';

/** Direct deps over `miniDataset`'s bodies: recorded requests and delays, injected failures. */
function miniDeps(bodies: Map<string, unknown>, o: { retryDelaysMs?: readonly number[] } = {}) {
  const requested: string[] = [];
  const delays: number[] = [];
  const warned: string[] = [];
  const failures = new Map<string, Failure[]>();
  const serve = (url: string) => {
    requested.push(url);
    const how = failures.get(url)?.shift();
    const body = bodies.get(url);
    const read =
      <B>(f: (b: unknown) => B) =>
      async (): Promise<B> => {
        if (how === 'body') throw new TypeError(`body read failed: ${url}`);
        return f(body);
      };
    if (how === 'reject') return Promise.reject(new TypeError(`fetch failed: ${url}`));
    if (how !== undefined && how !== 'body') {
      return Promise.resolve({ ok: false, status: how.status, read });
    }
    const ok = body !== undefined;
    return Promise.resolve({ ok, status: ok ? 200 : 404, read });
  };
  const deps: LoadDeps = {
    fetch: (url) =>
      serve(url).then((r) => ({
        ok: r.ok,
        status: r.status,
        json: r.read((b) => structuredClone(b))
      })),
    fetchBytes: (url) =>
      serve(url).then((r) => ({
        ok: r.ok,
        status: r.status,
        arrayBuffer: r.read((b) => (b as Uint8Array).slice().buffer as ArrayBuffer)
      })),
    setTimeout: (fn, ms) => {
      delays.push(ms);
      fn();
      return 0;
    },
    retryDelaysMs: o.retryDelaysMs ?? [],
    warn: (m) => warned.push(m)
  };
  const fail = (url: string, times: number, how: Failure) => {
    const q = failures.get(url) ?? [];
    for (let i = 0; i < times; i++) q.push(how);
    failures.set(url, q);
  };
  return { deps, requested, delays, warned, fail };
}

const miniUrls = (o?: { policy?: boolean; gross?: boolean }) =>
  scenarioUrls(miniDataset(o).manifest())!;

describe('scenarioUrls on the mini manifest', () => {
  const base = { ...URLS, policy: null, gross: null, cars: null, carZones: null };

  it('returns the three URLs, and ignores scenarios.fzp.frontage', () => {
    const m = miniDataset().manifest();
    expect(m.scenarios!.fzp.frontage).toBe(MINI_FRONTAGE_URL); // an older dataset names it
    expect(scenarioUrls(m)).toEqual(base);
  });

  it('is null without scenarios.fzp, or with a missing or outside URL', () => {
    const m = miniDataset().manifest();
    expect(scenarioUrls({ ...m, scenarios: undefined })).toBeNull();
    const fzp = m.scenarios!.fzp;
    for (const bad of [
      { ...fzp, parcels: '/data/fixture-1/scenarios/fzp/parcels.bin' },
      { ...fzp, projects: 'https://example.com/projects.json' },
      { ...fzp, calibration: undefined as unknown as string },
      { ...fzp, calibration: 7 as unknown as string }
    ]) {
      expect(scenarioUrls({ ...m, scenarios: { fzp: bad } })).toBeNull();
    }
  });

  it('names the policy URL when the manifest has one, else null', () => {
    expect(scenarioUrls(miniDataset({ policy: true }).manifest())).toEqual({
      ...base,
      policy: MINI_POLICY_URL
    });
    // A load without levers never needs policy.bin, so a bad one leaves the other three usable.
    const m = miniDataset().manifest();
    for (const policy of ['/data/fixture-1/scenarios/fzp/policy.bin', 7]) {
      const bad = { ...m.scenarios!.fzp, policy: policy as string };
      expect(scenarioUrls({ ...m, scenarios: { fzp: bad } })).toEqual(base);
    }
  });

  it('names the gross URL when the manifest has one, else null', () => {
    expect(scenarioUrls(miniDataset({ gross: true }).manifest())).toEqual({
      ...base,
      gross: MINI_GROSS_URL
    });
    const m = miniDataset().manifest();
    const bad = { ...m.scenarios!.fzp, gross: '/data/fixture-1/scenarios/fzp/gross.bin' };
    expect(scenarioUrls({ ...m, scenarios: { fzp: bad } })).toEqual(base);
  });
});

describe('loadScenario on the mini city: fetch failures (internal)', () => {
  it('retries a parcels.bin whose body read rejects on the delays, then gives internal (network)', async () => {
    const d = miniDeps(miniDataset().bodies, { retryDelaysMs: [1000, 4000, 16000] });
    d.fail(URLS.parcels, 4, 'body');
    const r = await loadScenario(d.deps, miniUrls(), () => false);
    expect(r).toEqual({
      code: 'internal',
      message: `scenario fetch failed: ${URLS.parcels} (network)`
    });
    expect(d.requested.filter((u) => u === URLS.parcels)).toHaveLength(4);
    expect(d.delays).toEqual([1000, 4000, 16000]);
    expect(d.requested.filter((u) => u === URLS.projects)).toHaveLength(1);
    expect(d.requested.filter((u) => u === URLS.calibration)).toHaveLength(1);
  });

  it('loads when a body read fails fewer times than there are retries', async () => {
    const d = miniDeps(miniDataset().bodies, { retryDelaysMs: [1, 1, 1] });
    d.fail(URLS.parcels, 2, 'body');
    d.fail(URLS.calibration, 3, 'body');
    const r = await loadScenario(d.deps, miniUrls(), () => false);
    expect('code' in r).toBe(false);
    expect(d.requested.filter((u) => u === URLS.parcels)).toHaveLength(3);
    expect(d.requested.filter((u) => u === URLS.calibration)).toHaveLength(4);
  });

  it('gives internal (HTTP 404) after the retries, on the given delays', async () => {
    const ds = miniDataset();
    ds.bodies.delete(URLS.projects);
    const d = miniDeps(ds.bodies, { retryDelaysMs: [10, 20] });
    const r = await loadScenario(d.deps, miniUrls(), () => false);
    expect(r).toEqual({
      code: 'internal',
      message: `scenario fetch failed: ${URLS.projects} (HTTP 404)`
    });
    expect(d.requested.filter((u) => u === URLS.projects)).toHaveLength(3);
    expect(d.delays).toEqual([10, 20]);
  });

  it('gives internal (network) when the request itself keeps rejecting', async () => {
    const d = miniDeps(miniDataset().bodies, { retryDelaysMs: [5] });
    d.fail(URLS.calibration, 2, 'reject');
    const r = await loadScenario(d.deps, miniUrls(), () => false);
    expect(r).toEqual({
      code: 'internal',
      message: `scenario fetch failed: ${URLS.calibration} (network)`
    });
    expect(d.requested.filter((u) => u === URLS.calibration)).toHaveLength(2);
  });

  it('reports the status of the last attempt', async () => {
    const d = miniDeps(miniDataset().bodies, { retryDelaysMs: [5] });
    d.fail(URLS.parcels, 1, 'reject');
    d.fail(URLS.parcels, 1, { status: 503 });
    const r = await loadScenario(d.deps, miniUrls(), () => false);
    expect(r).toMatchObject({
      code: 'internal',
      message: `scenario fetch failed: ${URLS.parcels} (HTTP 503)`
    });
  });

  it('a gross.bin that 404s on every attempt fails the load', async () => {
    const d = miniDeps(miniDataset({ gross: true }).bodies, { retryDelaysMs: [1, 1, 1] });
    d.fail(MINI_GROSS_URL, 4, { status: 404 });
    const r = await loadScenario(d.deps, miniUrls({ policy: true, gross: true }), () => false, {
      policy: true
    });
    expect(r).toMatchObject({ code: 'internal' });
    expect((r as LoadFailure).message).toContain(MINI_GROSS_URL);
    expect(d.requested.filter((u) => u === MINI_GROSS_URL)).toHaveLength(4);
  });
});

describe('loadScenario on the mini city: decode and validation (scenario-invalid, not retried)', () => {
  async function invalid(bodies: Map<string, unknown>) {
    const d = miniDeps(bodies, { retryDelaysMs: [1, 1, 1] });
    const r = await loadScenario(d.deps, miniUrls({ policy: true, gross: true }), () => false, {
      policy: true
    });
    expect(r).toMatchObject({ code: 'scenario-invalid' });
    // Never retried: one request per file.
    for (const url of d.requested) expect(d.requested.filter((u) => u === url)).toHaveLength(1);
    return { message: (r as LoadFailure).message, warned: d.warned };
  }
  const withBody = (url: string, body: unknown) => {
    const ds = miniDataset({ policy: true, gross: true });
    ds.bodies.set(url, body);
    return ds.bodies;
  };

  it('corrupt parcels.bin deflate bytes: inflate failed', async () => {
    const { message } = await invalid(withBody(URLS.parcels, new Uint8Array(64).fill(0xff)));
    expect(message.startsWith('scenario parcels.bin: inflate failed')).toBe(true);
  });

  it('a well-deflated parcels.bin with a bad payload', async () => {
    const bad = new Uint8Array(deflateRawSync(new Uint8Array([1, 2, 3, 4])));
    const { message } = await invalid(withBody(URLS.parcels, bad));
    expect(message.startsWith('scenario parcels.bin: ')).toBe(true);
  });

  it('a policy.bin that does not decode', async () => {
    const { message } = await invalid(withBody(MINI_POLICY_URL, new Uint8Array([1, 2, 3])));
    expect(message).toMatch(/^scenario policy\.bin: /);
  });

  it('a gross.bin that does not decode', async () => {
    const { message } = await invalid(withBody(MINI_GROSS_URL, new Uint8Array([1, 2, 3])));
    expect(message).toMatch(/^scenario gross\.bin: /);
  });

  const grossRows = () => {
    const city = miniCity();
    return Array.from({ length: city.parcels.count }, (_, i) =>
      grossRowOf(
        scenarioRecordOf(city.parcels, i, city.records.get(city.parcels.id[i] as ParcelId)!)
      )
    );
  };

  it('a gross.bin with another row count', async () => {
    const short = grossBinOf(grossTableOf(MINI_VERSION, grossRows().slice(1)));
    const { message } = await invalid(withBody(MINI_GROSS_URL, short));
    expect(message).toContain('scenario gross.bin: ');
  });

  it('a gross.bin from another datasetVersion', async () => {
    const other = grossBinOf(grossTableOf('fixture-61', grossRows()));
    const { message } = await invalid(withBody(MINI_GROSS_URL, other));
    expect(message).toMatch(/^scenario gross\.bin: .*fixture-61/);
  });

  it('a file-level projects.json violation', async () => {
    const json = { ...(miniProjectsJson() as Json), schema: 2 };
    const { message, warned } = await invalid(withBody(URLS.projects, json));
    expect(message).toBe('scenario projects.json: schema: must be 1');
    expect(warned).toEqual([]);
  });

  it('a calibration.json that parseCalibration rejects', async () => {
    const bad = { ...(structuredClone(miniCalibrationJson) as Json), schema: 3 };
    let expected = '';
    try {
      parseCalibration(bad);
    } catch (e) {
      expected = (e as Error).message;
    }
    expect(expected).not.toBe('');
    const { message } = await invalid(withBody(URLS.calibration, bad));
    expect(message).toBe(`scenario calibration.json: ${expected}`);
  });

  it('a calibration whose size.fillLevels differs from FILL_LEVELS', async () => {
    const cal = structuredClone(miniCalibrationJson) as Json;
    (cal.size as { fillLevels: number[] }).fillLevels = [0.2, 0.5, 0.75, 0.9, 1];
    expect(() => parseCalibration(cal)).not.toThrow(); // only the load's check catches it
    const { message } = await invalid(withBody(URLS.calibration, cal));
    expect(message).toBe(
      'scenario calibration.json: size.fillLevels [0.2, 0.5, 0.75, 0.9, 1] differs from ' +
        'FILL_LEVELS [0.25, 0.5, 0.75, 0.9, 1] at index 0'
    );
  });
});

describe('loadScenario on the mini city: policy.bin and the projects', () => {
  it('with opts.policy, fetches policy.bin once and returns it bound to the parcels', async () => {
    const d = miniDeps(miniDataset({ policy: true }).bodies);
    const r = await loadScenario(d.deps, miniUrls({ policy: true }), () => false, { policy: true });
    if ('code' in r) throw new Error(r.message);
    expect(d.requested.filter((u) => u === MINI_POLICY_URL)).toHaveLength(1);
    expect(r.policy).not.toBeNull();
    expect(r.policy!.count).toBe(r.fzp.parcels.count);
    expect(r.policy!.sb79Status).toEqual(miniPolicy(miniCity()).sb79Status);
  });

  it('without opts.policy, never requests the policy URL and returns no policy', async () => {
    const d = miniDeps(miniDataset({ policy: true }).bodies);
    const r = await loadScenario(d.deps, miniUrls({ policy: true }), () => false);
    if ('code' in r) throw new Error(r.message);
    expect(d.requested).not.toContain(MINI_POLICY_URL);
    expect(d.requested).toHaveLength(3);
    expect(r.policy).toBeNull();
  });

  it('gives scenario-missing for opts.policy without scenarios.fzp.policy', async () => {
    const d = miniDeps(miniDataset().bodies);
    const r = await loadScenario(d.deps, miniUrls(), () => false, { policy: true });
    expect(r).toEqual({
      code: 'scenario-missing',
      message: 'dataset has no policy.bin (scenarios.fzp.policy)'
    });
    expect(d.requested).toEqual([]);
  });

  it('skips invalid projects with exactly one aggregated warning', async () => {
    const ds = miniDataset();
    const json = miniProjectsJson() as Json;
    (json.projects as Json[])[2].units = 0;
    ds.bodies.set(URLS.projects, json);
    const d = miniDeps(ds.bodies);
    const r = await loadScenario(d.deps, miniUrls(), () => false);
    if ('code' in r) throw new Error(r.message);
    expect(d.warned.filter((w) => w.startsWith('projects.json: skipped'))).toEqual([
      'projects.json: skipped 2 invalid project(s); first: projects[2].units: must be >= 1',
      'projects.json: skipped 1 project(s) the simulation does not run ' +
        '(complete, or permitOnly at filed or entitled)'
    ]);
    const ids = r.projects.projects.map((p) => p.id);
    const all = (json.projects as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual(all.filter((_, i) => i !== 2 && i !== MINI_INVALID_INDEX));
  });

  it('a file whose every project is invalid is an empty, valid pipeline', async () => {
    const ds = miniDataset();
    const json = miniProjectsJson() as Json;
    for (const p of json.projects as Json[]) p.units = -1;
    ds.bodies.set(URLS.projects, json);
    const d = miniDeps(ds.bodies);
    const r = await loadScenario(d.deps, miniUrls(), () => false);
    if ('code' in r) throw new Error(r.message);
    const n = (json.projects as unknown[]).length;
    expect(d.warned).toContain(
      `projects.json: skipped ${n} invalid project(s); first: projects[0].units: must be >= 1`
    );
    expect(r.projects.projects).toEqual([]);
  });
});
