// The scenario load's car data (car-ownership Task 11) on fixture-0: `simInputUrls` names cars.bin
// and car-zones.json, `loadSimInput` fetches and decodes cars.bin only for /sim (`opts.cars`) and
// only when the manifest names it, and a bad file is `scenario-invalid`. Then the load's paths on
// the mini city, policy.bin and options.bin among them.
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import { optionTableOf } from '$lib/data/option-table';
import { parseCalibration } from '$lib/timelapse/model';
import { datasetFetch } from '../runner/test/harness';
import {
  MINI_FRONTAGE_URL,
  MINI_POLICY_URL,
  miniDataset,
  optionsBinOf
} from '../test/mini-dataset';
import miniCalibrationJson from '../fixtures/mini-calibration.json';
import { MINI_OPTIONS_URL, miniOptions } from '../fixtures/mini-options';
import { MINI_SCENARIO_URLS, MINI_VERSION, miniCity } from '../fixtures/mini-parcels';
import { miniPolicy } from '../fixtures/mini-policy';
import { MINI_INVALID_INDEX, miniProjectsJson } from '../fixtures/mini-projects';
import { loadSimInput, simInputUrls, type Loaded, type LoadDeps, type LoadFailure } from './load';

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

describe('simInputUrls', () => {
  it('names cars.bin and car-zones.json when the manifest does', () => {
    const m = manifest();
    const u = simInputUrls(m)!;
    expect(u.cars).toBe(`/data/${m.datasetVersion}/scenarios/fzp/cars.bin`);
    expect(u.carZones).toBe(`/data/${m.datasetVersion}/scenarios/fzp/car-zones.json`);
  });

  it('gives null for both without them, or outside /data/<v>/', () => {
    const m = manifest();
    const u = simInputUrls(withoutCars(m))!;
    expect(u.cars).toBeNull();
    expect(u.carZones).toBeNull();
    const fzp = { ...m.scenarios!.fzp, cars: '/data/other/cars.bin' };
    expect(simInputUrls({ ...m, scenarios: { fzp } })!.cars).toBeNull();
  });
});

describe('loadSimInput: cars', () => {
  it('with cars: decodes cars.bin against the parcels', async () => {
    const m = manifest();
    const deps = depsOf();
    const r = loaded(await loadSimInput(deps, simInputUrls(m)!, () => false, { cars: true }));
    expect(r.cars).not.toBeNull();
    expect(r.cars!.zones.length).toBeGreaterThan(0);
    expect(r.cars!.lotZone.length).toBe(r.fzp.parcels.count);
    expect(deps.fetched.filter((u) => u.endsWith('/cars.bin'))).toHaveLength(1);
    // the page fetches the zones' outlines, never the worker
    expect(deps.fetched.some((u) => u.endsWith('/car-zones.json'))).toBe(false);
  });

  it('without the manifest naming it: cars null, never fetched', async () => {
    const deps = depsOf();
    const urls = simInputUrls(withoutCars(manifest()))!;
    const r = loaded(await loadSimInput(deps, urls, () => false, { cars: true }));
    expect(r.cars).toBeNull();
    expect(deps.fetched.some((u) => u.endsWith('/cars.bin'))).toBe(false);
  });

  it('without opts.cars (not /sim): cars null, never fetched', async () => {
    const deps = depsOf();
    const urls = simInputUrls(manifest())!;
    const r = loaded(await loadSimInput(deps, urls, () => false));
    expect(r.cars).toBeNull();
    expect(deps.fetched.some((u) => u.endsWith('/cars.bin'))).toBe(false);
  });

  it('a cars.bin that does not decode is scenario-invalid', async () => {
    const urls = simInputUrls(manifest())!;
    const deps = depsOf({ [urls.cars!]: new Uint8Array([1, 2, 3]) });
    const r = await loadSimInput(deps, urls, () => false, { cars: true });
    expect('code' in r && r.code).toBe('scenario-invalid');
    expect((r as LoadFailure).message.startsWith('scenario cars.bin: ')).toBe(true);
  });
});

// The load's failure paths on the mini city, asserted on `loadSimInput` and `simInputUrls`
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

const miniUrls = () => simInputUrls(miniDataset().manifest())!;

describe('simInputUrls on the mini manifest', () => {
  const base = {
    ...URLS,
    policy: MINI_POLICY_URL,
    options: MINI_OPTIONS_URL,
    cars: null,
    carZones: null
  };

  it('returns the URLs, and ignores scenarios.fzp.frontage and gross', () => {
    const m = miniDataset().manifest();
    expect(m.scenarios!.fzp.frontage).toBe(MINI_FRONTAGE_URL); // an older dataset names it
    expect(simInputUrls(m)).toEqual(base);
    const gross = { ...m.scenarios!.fzp, gross: `/data/${MINI_VERSION}/scenarios/fzp/gross.bin` };
    expect(simInputUrls({ ...m, scenarios: { fzp: gross } })).toEqual(base);
  });

  it('is null without scenarios.fzp, or with a missing or outside URL', () => {
    const m = miniDataset().manifest();
    expect(simInputUrls({ ...m, scenarios: undefined })).toBeNull();
    const fzp = m.scenarios!.fzp;
    for (const bad of [
      { ...fzp, parcels: '/data/fixture-1/scenarios/fzp/parcels.bin' },
      { ...fzp, projects: 'https://example.com/projects.json' },
      { ...fzp, calibration: undefined as unknown as string },
      { ...fzp, calibration: 7 as unknown as string }
    ]) {
      expect(simInputUrls({ ...m, scenarios: { fzp: bad } })).toBeNull();
    }
  });

  it('gives null for a policy or options URL that is absent or outside /data/<v>/', () => {
    const m = miniDataset().manifest();
    for (const key of ['policy', 'options'] as const) {
      for (const url of [`/data/fixture-1/scenarios/fzp/${key}.bin`, 7, undefined]) {
        const bad = { ...m.scenarios!.fzp, [key]: url as string };
        expect(simInputUrls({ ...m, scenarios: { fzp: bad } })).toEqual({ ...base, [key]: null });
      }
    }
  });
});

describe('loadSimInput on the mini city: fetch failures (internal)', () => {
  it('retries a parcels.bin whose body read rejects on the delays, then gives internal (network)', async () => {
    const d = miniDeps(miniDataset().bodies, { retryDelaysMs: [1000, 4000, 16000] });
    d.fail(URLS.parcels, 4, 'body');
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
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
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
    expect('code' in r).toBe(false);
    expect(d.requested.filter((u) => u === URLS.parcels)).toHaveLength(3);
    expect(d.requested.filter((u) => u === URLS.calibration)).toHaveLength(4);
  });

  it('gives internal (HTTP 404) after the retries, on the given delays', async () => {
    const ds = miniDataset();
    ds.bodies.delete(URLS.projects);
    const d = miniDeps(ds.bodies, { retryDelaysMs: [10, 20] });
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
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
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
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
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
    expect(r).toMatchObject({
      code: 'internal',
      message: `scenario fetch failed: ${URLS.parcels} (HTTP 503)`
    });
  });

  it('an options.bin that 404s on every attempt fails the load', async () => {
    const d = miniDeps(miniDataset().bodies, { retryDelaysMs: [1, 1, 1] });
    d.fail(MINI_OPTIONS_URL, 4, { status: 404 });
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
    expect(r).toMatchObject({ code: 'internal' });
    expect((r as LoadFailure).message).toContain(MINI_OPTIONS_URL);
    expect(d.requested.filter((u) => u === MINI_OPTIONS_URL)).toHaveLength(4);
  });
});

describe('loadSimInput on the mini city: decode and validation (scenario-invalid, not retried)', () => {
  async function invalid(bodies: Map<string, unknown>) {
    const d = miniDeps(bodies, { retryDelaysMs: [1, 1, 1] });
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
    expect(r).toMatchObject({ code: 'scenario-invalid' });
    // Never retried: one request per file.
    for (const url of d.requested) expect(d.requested.filter((u) => u === url)).toHaveLength(1);
    return { message: (r as LoadFailure).message, warned: d.warned };
  }
  const withBody = (url: string, body: unknown) => {
    const ds = miniDataset();
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

  it('an options.bin that does not decode', async () => {
    const { message } = await invalid(withBody(MINI_OPTIONS_URL, new Uint8Array([1, 2, 3])));
    expect(message).toMatch(/^scenario options\.bin: /);
  });

  const optionRows = () => {
    const t = miniOptions(miniCity());
    return Array.from({ length: t.count }, () => ({ options: [], locationValue: 1 }));
  };

  it('an options.bin with another row count', async () => {
    const short = optionsBinOf(optionTableOf(MINI_VERSION, optionRows().slice(1)));
    const { message } = await invalid(withBody(MINI_OPTIONS_URL, short));
    expect(message).toMatch(/^scenario options\.bin: .*rows/);
  });

  it('an options.bin from another datasetVersion', async () => {
    const other = optionsBinOf(optionTableOf('fixture-61', optionRows()));
    const { message } = await invalid(withBody(MINI_OPTIONS_URL, other));
    expect(message).toMatch(/^scenario options\.bin: .*fixture-61/);
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

  it('a calibration with no choice model', async () => {
    const cal = structuredClone(miniCalibrationJson) as Json;
    delete cal.choice;
    expect(() => parseCalibration(cal)).not.toThrow(); // only the load's check catches it
    const { message } = await invalid(withBody(URLS.calibration, cal));
    expect(message).toBe('scenario calibration.json: no choice model (choice)');
  });
});

describe('loadSimInput on the mini city: policy.bin and the projects', () => {
  it('fetches policy.bin and options.bin once, binding the FZP cap to the parcels', async () => {
    const d = miniDeps(miniDataset().bodies);
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
    if ('code' in r) throw new Error(r.message);
    expect(d.requested.filter((u) => u === MINI_POLICY_URL)).toHaveLength(1);
    expect(d.requested.filter((u) => u === MINI_OPTIONS_URL)).toHaveLength(1);
    expect(d.requested).toHaveLength(5);
    const policy = miniPolicy(miniCity());
    expect(r.policy.count).toBe(r.fzp.parcels.count);
    expect(r.policy.sb79Status).toEqual(policy.sb79Status);
    expect(r.fzp.parcels.fzpCap).toEqual(policy.fzpYieldCap);
    expect(r.fzp.options).toBe(r.options);
    expect(r.options.count).toBe(r.fzp.parcels.count);
    expect(r.twin.options).toBe(r.options);
    expect(r.twin.parcels.fzpCap).toBe(r.fzp.parcels.baseCap);
  });

  it('gives scenario-missing without scenarios.fzp.policy or options, before any fetch', async () => {
    for (const key of ['policy', 'options'] as const) {
      const d = miniDeps(miniDataset().bodies);
      const r = await loadSimInput(d.deps, { ...miniUrls(), [key]: null }, () => false);
      expect(r).toEqual({
        code: 'scenario-missing',
        message: `dataset has no ${key}.bin (scenarios.fzp.${key})`
      });
      expect(d.requested).toEqual([]);
    }
  });

  it('skips invalid projects with exactly one aggregated warning', async () => {
    const ds = miniDataset();
    const json = miniProjectsJson() as Json;
    (json.projects as Json[])[2].units = 0;
    ds.bodies.set(URLS.projects, json);
    const d = miniDeps(ds.bodies);
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
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
    const r = await loadSimInput(d.deps, miniUrls(), () => false);
    if ('code' in r) throw new Error(r.message);
    const n = (json.projects as unknown[]).length;
    expect(d.warned).toContain(
      `projects.json: skipped ${n} invalid project(s); first: projects[0].units: must be >= 1`
    );
    expect(r.projects.projects).toEqual([]);
  });
});
