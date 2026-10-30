// Scenario host init path (spec §4.2, the loading rows of §4.10, AC 12): request validation,
// manifest URLs, concurrent fetches with retries, decode and validation, and recovery.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { checkManifestShape } from '$lib/sim/manifest-shape';
import { parseCalibration } from '$lib/timelapse/model';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { encodePolicyPayload } from '$lib/data/policy-codec';
import { miniBin } from './fixtures/mini-bin';
import { MINI_SCENARIO_URLS, MINI_VERSION, miniCity } from './fixtures/mini-parcels';
import { miniPolicy } from './fixtures/mini-policy';
import {
  MINI_AS_OF,
  MINI_HORIZON,
  MINI_INVALID_INDEX,
  miniProjectsJson
} from './fixtures/mini-projects';
import { precomputeOf } from './input';
import {
  loadScenario,
  scenarioUrls,
  validateInitRequest,
  type LoadDeps,
  type ScenarioUrls
} from './load';
import type { SimInput } from './types';
import { makeScenarioHarness, type ScenarioHarness } from './test/host-harness';

// Pass-through spy: the host must precompute both inputs with its warn (§4.2 step 7).
vi.mock('./input', async (importOriginal) => {
  const m = await importOriginal<typeof import('./input')>();
  return { ...m, precomputeOf: vi.fn(m.precomputeOf) };
});

const URLS = MINI_SCENARIO_URLS;
const INVALID_WARNING =
  `projects.json: skipped 1 invalid project(s); first: ` +
  `projects[${MINI_INVALID_INDEX}].units: must be >= 1`;
/** The load's one note on the rows the engine does not run (mini: the complete row). */
const SKIP_NOTE =
  'projects.json: skipped 1 project(s) the simulation does not run ' +
  '(complete, or permitOnly at filed or entitled)';
const SKIP_NOTE_RE = /^projects\.json: skipped \d+ project\(s\) the simulation does not run /;

type Json = Record<string, unknown>;
const calibration = (): Json => structuredClone(miniCalibrationJson) as Json;
const projects = (): Json => miniProjectsJson() as Json;

/** The load has finished successfully: no error, and a reroll is accepted. */
async function expectLoaded(h: ScenarioHarness): Promise<void> {
  await h.runAll();
  const { started, settled } = h.decodes();
  expect(started).toBeGreaterThan(0);
  expect(settled).toBe(started); // settled, not guessed
  const errors = h.errors().length;
  h.host.handle({ type: 'reroll', rev: h.next(), seed: 2 });
  await h.runAll();
  expect(h.errors()).toHaveLength(errors);
}

/** After an error the host takes a fresh initScenario and loads it (AC 12). */
async function expectRecovers(h: ScenarioHarness): Promise<void> {
  h.restore();
  const before = h.posts.length;
  const rev = h.init();
  expect(h.posts[before]).toEqual({
    type: 'ready',
    rev,
    datasetVersion: MINI_VERSION,
    chunkCount: 4
  });
  await expectLoaded(h);
  expect(h.posts.slice(before).filter((m) => m.type === 'error')).toEqual([]);
}

/** The load's warnings: the shown run's T11-absence lines (§4.2, scenario-host.spec.ts) left out. */
const T11_ABSENT = /^parcel \S+ of \S+ is not in parcels\.bin: /;
const loadWarnings = (h: ScenarioHarness) => h.warnings.filter((w) => !T11_ABSENT.test(w));

// Every warning goes through the harness's deps.warn: nothing may reach the console.
let warnSpy: MockInstance<typeof console.warn>;

beforeEach(() => {
  vi.mocked(precomputeOf).mockClear();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  const calls = warnSpy.mock.calls;
  warnSpy.mockRestore();
  expect(calls).toEqual([]);
});

describe('validateInitRequest', () => {
  const req = (over: Json) => ({
    type: 'initScenario' as const,
    rev: 1,
    manifest: makeScenarioHarness().manifest(),
    scenario: 'fzp' as const,
    seed: null,
    horizon: MINI_HORIZON,
    ...over
  });

  it('accepts a null seed and the integer seeds 0 and 2^32 - 1', () => {
    expect(validateInitRequest(req({}))).toBeNull();
    expect(validateInitRequest(req({ seed: 0 }))).toBeNull();
    expect(validateInitRequest(req({ seed: 4294967295 }))).toBeNull();
  });

  it('rejects bad seeds, a non-integer horizon and another scenario', () => {
    for (const seed of [-1, 1.5, 4294967296, NaN, Infinity, '1']) {
      expect(validateInitRequest(req({ seed }))).toBe(
        'seed must be null or an integer in [0, 4294967296)'
      );
    }
    for (const horizon of [1.5, NaN, null, '20000']) {
      expect(validateInitRequest(req({ horizon }))).toBe('horizon must be an integer');
    }
    expect(validateInitRequest(req({ scenario: 'x' }))).toBe("scenario must be 'fzp'");
  });
});

describe('scenarioUrls', () => {
  it('returns the three URLs when each is under /data/<v>/', () => {
    const m = makeScenarioHarness().manifest();
    expect(scenarioUrls(m)).toEqual({ ...URLS, policy: null });
  });

  it('is null without scenarios.fzp, or with a missing or outside URL', () => {
    const m = makeScenarioHarness().manifest();
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
});

describe('scenario host: requests (bad-request, manifest-invalid, scenario-missing)', () => {
  it('answers bad-request for each bad seed, horizon and scenario, then recovers', async () => {
    const h = makeScenarioHarness();
    const cases: [Json, string][] = [
      [{ seed: -1 }, 'seed must be null or an integer in [0, 4294967296)'],
      [{ seed: 1.5 }, 'seed must be null or an integer in [0, 4294967296)'],
      [{ seed: 4294967296 }, 'seed must be null or an integer in [0, 4294967296)'],
      [{ horizon: MINI_HORIZON + 0.5 }, 'horizon must be an integer'],
      [{ scenario: 'x' }, "scenario must be 'fzp'"]
    ];
    for (const [over, message] of cases) {
      const before = h.posts.length;
      const rev = h.init(over);
      expect(h.posts.slice(before)).toEqual([{ type: 'error', rev, code: 'bad-request', message }]);
    }
    expect(h.fetches).toEqual([]);
    await expectRecovers(h);
  });

  it('answers manifest-invalid with the shape problem, then recovers', async () => {
    const h = makeScenarioHarness();
    const manifest = { ...h.manifest(), datasetVersion: 'not a version' };
    const rev = h.init({ manifest });
    expect(h.posts).toEqual([
      { type: 'error', rev, code: 'manifest-invalid', message: checkManifestShape(manifest) }
    ]);
    expect(h.fetches).toEqual([]);
    await expectRecovers(h);
  });

  it('answers scenario-missing without scenarios.fzp or with a URL outside /data/<v>/', async () => {
    const h = makeScenarioHarness();
    const m = h.manifest();
    const fzp = m.scenarios!.fzp;
    for (const scenarios of [
      undefined,
      { fzp: { ...fzp, parcels: '/data/fixture-1/scenarios/fzp/parcels.bin' } },
      { fzp: { ...fzp, calibration: '/elsewhere/calibration.json' } }
    ]) {
      const before = h.posts.length;
      const rev = h.init({ manifest: { ...h.manifest(), scenarios } });
      expect(h.posts.slice(before)).toEqual([
        {
          type: 'error',
          rev,
          code: 'scenario-missing',
          message: `dataset ${MINI_VERSION} has no fzp scenario`
        }
      ]);
    }
    expect(h.fetches).toEqual([]);
    await expectRecovers(h);
  });
});

describe('scenario host: ready and fetching', () => {
  it('posts ready { rev, datasetVersion, chunkCount } before fetching the three files at once', async () => {
    const h = makeScenarioHarness();
    const rev = h.init();
    expect(h.posts).toEqual([{ type: 'ready', rev, datasetVersion: MINI_VERSION, chunkCount: 4 }]);
    // Concurrent: all three requests are out before any of them has answered.
    expect(h.fetches.map((f) => [f.url, f.kind, f.at, f.posts])).toEqual([
      [URLS.parcels, 'bytes', 0, 1],
      [URLS.projects, 'json', 0, 1],
      [URLS.calibration, 'json', 0, 1]
    ]);
    await expectLoaded(h);
    expect(h.posts.filter((m) => m.type === 'error')).toEqual([]);
    expect(loadWarnings(h)).toEqual([INVALID_WARNING, SKIP_NOTE]);
  });

  it('fetches the JSON files while parcels.bin is still pending', async () => {
    const h = makeScenarioHarness();
    h.hold(URLS.parcels);
    h.init();
    await h.runAll();
    expect(h.fetches.map((f) => f.url).sort()).toEqual(
      [URLS.parcels, URLS.projects, URLS.calibration].sort()
    );
    h.release(URLS.parcels);
    await expectLoaded(h);
  });

  it('fetches each file once per init and never on reroll', async () => {
    const h = makeScenarioHarness();
    h.init();
    await expectLoaded(h);
    h.host.handle({ type: 'reroll', rev: h.next(), seed: null });
    h.host.handle({ type: 'reroll', rev: h.next(), seed: 7 });
    await h.runAll();
    expect(h.fetches).toHaveLength(3);
    h.init();
    await expectLoaded(h);
    expect(h.fetches.map((f) => f.url)).toEqual([
      URLS.parcels,
      URLS.projects,
      URLS.calibration,
      URLS.parcels,
      URLS.projects,
      URLS.calibration
    ]);
    expect(h.fetches.filter((f) => f.url.includes('/parcels/'))).toEqual([]); // no chunk
  });
});

describe('scenario host: fetch failures (internal)', () => {
  it('retries a parcels.bin whose arrayBuffer() rejects on 1/4/16 s, then gives internal (network)', async () => {
    const h = makeScenarioHarness();
    h.fail(URLS.parcels, 4, 'body');
    const rev = h.init();
    await h.advance(20_999);
    expect(h.fetchesOf(URLS.parcels).map((f) => f.at)).toEqual([0, 1000, 5000]);
    expect(h.errors()).toEqual([]);
    await h.advance(1);
    expect(h.fetchesOf(URLS.parcels).map((f) => f.at)).toEqual([0, 1000, 5000, 21000]);
    expect(h.errors()).toEqual([
      {
        type: 'error',
        rev,
        code: 'internal',
        message: `scenario fetch failed: ${URLS.parcels} (network)`
      }
    ]);
    // The JSON files were fetched once each; nothing is left scheduled.
    expect(h.fetchesOf(URLS.projects)).toHaveLength(1);
    expect(h.fetchesOf(URLS.calibration)).toHaveLength(1);
    expect(h.pendingTimers()).toBe(0);
    await expectRecovers(h);
  });

  it('loads when a body read fails fewer times than there are retries', async () => {
    const h = makeScenarioHarness();
    h.fail(URLS.parcels, 2, 'body');
    h.fail(URLS.calibration, 3, 'body');
    h.init();
    await expectLoaded(h);
    expect(h.fetchesOf(URLS.parcels)).toHaveLength(3);
    expect(h.fetchesOf(URLS.calibration)).toHaveLength(4);
    expect(h.errors()).toEqual([]);
  });

  it('gives internal (HTTP 404) after the retries, on the given retryDelaysMs', async () => {
    const h = makeScenarioHarness({ retryDelaysMs: [10, 20] });
    h.bodies.delete(URLS.projects);
    const rev = h.init();
    await h.runAll();
    expect(h.fetchesOf(URLS.projects).map((f) => f.at)).toEqual([0, 10, 30]);
    expect(h.errors()).toEqual([
      {
        type: 'error',
        rev,
        code: 'internal',
        message: `scenario fetch failed: ${URLS.projects} (HTTP 404)`
      }
    ]);
    expect(h.pendingTimers()).toBe(0);
    await expectRecovers(h);
  });

  it('gives internal (network) when the request itself keeps rejecting', async () => {
    const h = makeScenarioHarness({ retryDelaysMs: [5] });
    h.fail(URLS.calibration, 2, 'reject');
    const rev = h.init();
    await h.runAll();
    expect(h.fetchesOf(URLS.calibration)).toHaveLength(2);
    expect(h.errors()).toEqual([
      {
        type: 'error',
        rev,
        code: 'internal',
        message: `scenario fetch failed: ${URLS.calibration} (network)`
      }
    ]);
    await expectRecovers(h);
  });

  it('reports the status of the last attempt', async () => {
    const h = makeScenarioHarness({ retryDelaysMs: [5] });
    h.fail(URLS.parcels, 1, 'reject');
    h.fail(URLS.parcels, 1, { status: 503 });
    h.init();
    await h.runAll();
    expect(h.errors().map((e) => e.message)).toEqual([
      `scenario fetch failed: ${URLS.parcels} (HTTP 503)`
    ]);
  });
});

describe('scenario host: decode and validation (scenario-invalid, not retried)', () => {
  async function invalid(h: ScenarioHarness): Promise<{ rev: number; message: string }> {
    const rev = h.init();
    await h.runAll();
    const errors = h.errors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ type: 'error', rev, code: 'scenario-invalid' });
    // Never retried: one request per file.
    for (const url of Object.values(URLS)) expect(h.fetchesOf(url)).toHaveLength(1);
    return { rev, message: errors[0].message };
  }

  it('corrupt parcels.bin deflate bytes: inflate failed, exactly one fetch', async () => {
    const h = makeScenarioHarness();
    h.bodies.set(URLS.parcels, new Uint8Array(64).fill(0xff));
    const { message } = await invalid(h);
    expect(message.startsWith('scenario parcels.bin: inflate failed')).toBe(true);
    await expectRecovers(h);
  });

  it('a well-deflated parcels.bin with a bad payload', async () => {
    const h = makeScenarioHarness();
    h.bodies.set(URLS.parcels, new Uint8Array(deflateRawSync(new Uint8Array([1, 2, 3, 4]))));
    const { message } = await invalid(h);
    expect(message.startsWith('scenario parcels.bin: ')).toBe(true);
    await expectRecovers(h);
  });

  it('a file-level projects.json violation', async () => {
    const h = makeScenarioHarness();
    h.bodies.set(URLS.projects, { ...projects(), schema: 2 });
    const { message } = await invalid(h);
    expect(message).toBe('scenario projects.json: schema: must be 1');
    expect(h.warnings).toEqual([]);
    await expectRecovers(h);
  });

  it('a calibration.json that parseCalibration rejects', async () => {
    const h = makeScenarioHarness();
    const bad = { ...calibration(), schema: 3 };
    h.bodies.set(URLS.calibration, bad);
    let expected = '';
    try {
      parseCalibration(bad);
    } catch (e) {
      expected = (e as Error).message;
    }
    expect(expected).not.toBe('');
    const { message } = await invalid(h);
    expect(message).toBe(`scenario calibration.json: ${expected}`);
    await expectRecovers(h);
  });

  it('a calibration whose size.fillLevels differs from FILL_LEVELS (ruling A2)', async () => {
    const h = makeScenarioHarness();
    const cal = calibration();
    (cal.size as { fillLevels: number[] }).fillLevels = [0.2, 0.5, 0.75, 0.9, 1];
    expect(() => parseCalibration(cal)).not.toThrow(); // only the host's check catches it
    h.bodies.set(URLS.calibration, cal);
    const { message } = await invalid(h);
    expect(message).toBe(
      'scenario calibration.json: size.fillLevels [0.2, 0.5, 0.75, 0.9, 1] differs from ' +
        'FILL_LEVELS [0.25, 0.5, 0.75, 0.9, 1] at index 0'
    );
    await expectRecovers(h);
  });
});

describe('scenario host: invalid projects and asOf', () => {
  it('skips invalid projects with exactly one aggregated warning', async () => {
    const h = makeScenarioHarness();
    const json = projects();
    (json.projects as Json[])[2].units = 0;
    h.bodies.set(URLS.projects, json);
    h.init();
    await expectLoaded(h);
    expect(loadWarnings(h)).toEqual([
      'projects.json: skipped 2 invalid project(s); first: projects[2].units: must be >= 1',
      SKIP_NOTE
    ]);
    const fzp = vi.mocked(precomputeOf).mock.calls[0][0];
    const ids = fzp.projects.map((p) => p.id);
    const all = (json.projects as { id: string }[]).map((p) => p.id);
    expect(ids).toEqual(all.filter((_, i) => i !== 2 && i !== MINI_INVALID_INDEX));
  });

  it('notes the rows the engine does not run exactly once per load, not per input or run', async () => {
    const h = makeScenarioHarness();
    h.init();
    await expectLoaded(h); // both inputs simulated, and a reroll on top
    const notes = () => h.warnings.filter((w) => SKIP_NOTE_RE.test(w));
    expect(notes()).toEqual([SKIP_NOTE]);
    h.init(); // a second load: one more note, for that load
    await expectLoaded(h);
    expect(notes()).toEqual([SKIP_NOTE, SKIP_NOTE]);
  });

  it('a file whose every project is invalid is an empty, valid pipeline', async () => {
    const h = makeScenarioHarness();
    const json = projects();
    for (const p of json.projects as Json[]) p.units = -1;
    h.bodies.set(URLS.projects, json);
    h.init();
    await expectLoaded(h);
    const n = (json.projects as unknown[]).length;
    expect(loadWarnings(h)).toEqual([
      `projects.json: skipped ${n} invalid project(s); first: projects[0].units: must be >= 1`
    ]);
    expect(vi.mocked(precomputeOf).mock.calls[0][0].projects).toEqual([]);
  });

  it('answers bad-request when projects.asOf >= horizon, then recovers', async () => {
    for (const horizon of [MINI_AS_OF, MINI_AS_OF - 1]) {
      const h = makeScenarioHarness({ horizon });
      const rev = h.init();
      await h.runAll();
      expect(h.errors()).toEqual([
        {
          type: 'error',
          rev,
          code: 'bad-request',
          message: `horizon ${horizon} is not after projects.json asOf ${MINI_AS_OF}`
        }
      ]);
      // not loaded: a reroll is refused
      const r = h.next();
      h.host.handle({ type: 'reroll', rev: r, seed: 1 });
      expect(h.errors().at(-1)).toEqual({
        type: 'error',
        rev: r,
        code: 'bad-request',
        message: 'not initialised'
      });
    }
    const h = makeScenarioHarness({ horizon: MINI_AS_OF + 1 });
    h.init();
    await expectLoaded(h);
  });

  it('precomputes the FZP input and its baseZoning twin with the host warn', async () => {
    const h = makeScenarioHarness();
    h.init();
    await expectLoaded(h);
    // The load's two calls come first (a later engine call hits the memo without a warn).
    const calls = vi.mocked(precomputeOf).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0][1]).toBeTypeOf('function');
    expect(calls[1][1]).toBeTypeOf('function');
    const [fzp, warnFzp] = calls[0] as [SimInput, (m: string) => void];
    const [twin, warnTwin] = calls[1] as [SimInput, (m: string) => void];
    expect(twin).not.toBe(fzp);
    expect(twin.projects).toBe(fzp.projects);
    expect(twin.parcels.envelopeStories).toBe(fzp.parcels.baseStories);
    expect(twin.parcels.hostable).toBe(fzp.parcels.hostableBase);
    expect(fzp.asOf).toBe(MINI_AS_OF);
    // Both warns reach deps.warn; the twin's copy of an identical message is not repeated.
    warnFzp('probe');
    warnTwin('probe');
    warnTwin('twin only');
    expect(loadWarnings(h)).toEqual([INVALID_WARNING, SKIP_NOTE, 'probe', 'twin only']);
  });
});

describe('scenario host: reroll before loading, supersession and dispose', () => {
  it("answers a reroll before any init, or before loading has finished, 'not initialised'", async () => {
    const h = makeScenarioHarness();
    const r0 = h.next();
    h.host.handle({ type: 'reroll', rev: r0, seed: null });
    h.hold(URLS.calibration);
    h.init();
    const r1 = h.next();
    h.host.handle({ type: 'reroll', rev: r1, seed: 3 });
    expect(h.errors()).toEqual([
      { type: 'error', rev: r0, code: 'bad-request', message: 'not initialised' },
      { type: 'error', rev: r1, code: 'bad-request', message: 'not initialised' }
    ]);
    h.release(URLS.calibration);
    await expectLoaded(h);
    expect(h.errors()).toHaveLength(2);
  });

  it('answers a reroll with a bad seed bad-request once loaded', async () => {
    const h = makeScenarioHarness();
    h.init();
    await expectLoaded(h);
    const rev = h.next();
    h.host.handle({ type: 'reroll', rev, seed: -1 });
    expect(h.errors()).toEqual([
      {
        type: 'error',
        rev,
        code: 'bad-request',
        message: 'seed must be null or an integer in [0, 4294967296)'
      }
    ]);
  });

  it('ignores a superseded init: its completion posts nothing', async () => {
    const h = makeScenarioHarness();
    const badUrl = `/data/${MINI_VERSION}/scenarios/fzp/bad-projects.json`;
    h.bodies.set(badUrl, { ...projects(), schema: 2 });
    h.hold(badUrl);
    const m = h.manifest();
    const first = h.init({
      manifest: { ...m, scenarios: { fzp: { ...m.scenarios!.fzp, projects: badUrl } } }
    });
    const second = h.init();
    await expectLoaded(h);
    h.release(badUrl);
    await h.runAll();
    expect(h.posts.filter((p) => 'rev' in p && p.rev === first)).toEqual([
      { type: 'ready', rev: first, datasetVersion: MINI_VERSION, chunkCount: 4 }
    ]);
    expect(h.errors()).toEqual([]);
    expect(h.posts.filter((p) => p.type === 'ready').map((p) => p.rev)).toEqual([first, second]);
  });

  it('ignores a superseded init whose decode completes after the new init', async () => {
    const h = makeScenarioHarness();
    const badUrl = `/data/${MINI_VERSION}/scenarios/fzp/bad-projects.json`;
    h.bodies.set(badUrl, { ...projects(), schema: 2 }); // would be scenario-invalid
    h.holdDecodes();
    const m = h.manifest();
    const first = h.init({
      manifest: { ...m, scenarios: { fzp: { ...m.scenarios!.fzp, projects: badUrl } } }
    });
    await h.runAll();
    expect(h.decodes()).toEqual({ started: 1, settled: 0 }); // the first load is mid-decode
    const second = h.init();
    await h.runAll();
    expect(h.decodes()).toEqual({ started: 2, settled: 0 });
    h.releaseDecodes();
    await expectLoaded(h);
    expect(h.decodes()).toEqual({ started: 2, settled: 2 }); // both completions ran
    expect(h.posts.filter((p) => 'rev' in p && p.rev === first)).toEqual([
      { type: 'ready', rev: first, datasetVersion: MINI_VERSION, chunkCount: 4 }
    ]);
    expect(h.errors()).toEqual([]);
    expect(h.posts.filter((p) => p.type === 'ready').map((p) => p.rev)).toEqual([first, second]);
  });

  it('a rejected init also cancels the previous one', async () => {
    const h = makeScenarioHarness({ retryDelaysMs: [100] });
    h.fail(URLS.parcels, 2, 'body');
    h.init();
    await h.flush();
    expect(h.pendingTimers()).toBe(1);
    const rev = h.init({ seed: -5 });
    expect(h.pendingTimers()).toBe(0);
    await h.runAll();
    expect(h.errors()).toEqual([
      {
        type: 'error',
        rev,
        code: 'bad-request',
        message: 'seed must be null or an integer in [0, 4294967296)'
      }
    ]);
    const r = h.next();
    h.host.handle({ type: 'reroll', rev: r, seed: 1 });
    expect(h.errors().at(-1)?.message).toBe('not initialised');
  });

  it('dispose cancels retries and completions', async () => {
    const h = makeScenarioHarness();
    h.fail(URLS.parcels, 4, 'body');
    h.init();
    await h.flush();
    expect(h.pendingTimers()).toBe(1);
    h.host.dispose();
    expect(h.pendingTimers()).toBe(0);
    await h.runAll();
    expect(h.posts.map((p) => p.type)).toEqual(['ready']);
    expect(h.fetchesOf(URLS.parcels)).toHaveLength(1);
  });

  it('dispose during the decode: the completion runs, does no more work, posts nothing', async () => {
    const h = makeScenarioHarness(); // valid files: without the cancel it would load
    h.holdDecodes();
    h.init();
    await h.runAll();
    expect(h.decodes()).toEqual({ started: 1, settled: 0 });
    h.host.dispose();
    h.releaseDecodes();
    await h.runAll();
    expect(h.decodes()).toEqual({ started: 1, settled: 1 });
    expect(h.posts.map((p) => p.type)).toEqual(['ready']);
    expect(vi.mocked(precomputeOf)).not.toHaveBeenCalled();
  });

  it('a load that throws unexpectedly gives internal, then recovers', async () => {
    const h = makeScenarioHarness();
    vi.mocked(precomputeOf).mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const rev = h.init();
    await h.runAll();
    expect(h.errors()).toEqual([{ type: 'error', rev, code: 'internal', message: 'Error: boom' }]);
    const r = h.next();
    h.host.handle({ type: 'reroll', rev: r, seed: 1 });
    expect(h.errors().at(-1)?.message).toBe('not initialised');
    await expectRecovers(h);
  });

  it('a request that throws synchronously gives internal under its rev, then recovers', async () => {
    const h = makeScenarioHarness();
    h.host.handle({ type: 'bogus', rev: 41 } as never);
    expect(h.posts).toEqual([
      { type: 'error', rev: 41, code: 'internal', message: 'Error: unknown request bogus' }
    ]);
    await expectRecovers(h);
  });

  it('answers parcelSummary for an unloaded record with null; chunk requests never throw', async () => {
    const h = makeScenarioHarness();
    h.init();
    await expectLoaded(h);
    h.host.handle({ type: 'parcelSummary', reqId: 9, parcelId: '0026T001A', day: MINI_AS_OF });
    h.host.handle({ type: 'retryChunks' });
    expect(h.posts.filter((p) => p.type === 'parcelSummary')).toEqual([
      { type: 'parcelSummary', reqId: 9, summary: null }
    ]);
    expect(h.errors()).toEqual([]);
  });
});

describe('loadScenario: policy.bin (plan 2 Task 10)', () => {
  const POLICY_URL = `/data/${MINI_VERSION}/scenarios/fzp/policy.bin`;
  const WITH_POLICY: ScenarioUrls = { ...URLS, policy: POLICY_URL };
  const policyBin = () =>
    new Uint8Array(deflateRawSync(encodePolicyPayload(miniPolicy(miniCity()))));

  /** Direct deps over in-memory bodies; every request is recorded. */
  function direct(bodies: Record<string, unknown>) {
    const requested: string[] = [];
    const warned: string[] = [];
    const serve = (url: string) => {
      requested.push(url);
      const body = bodies[url];
      const ok = body !== undefined;
      return Promise.resolve({ ok, status: ok ? 200 : 404, body });
    };
    const deps: LoadDeps = {
      fetch: (url) => serve(url).then((r) => ({ ...r, json: async () => structuredClone(r.body) })),
      fetchBytes: (url) =>
        serve(url).then((r) => ({
          ...r,
          arrayBuffer: async () => (r.body as Uint8Array).slice().buffer
        })),
      setTimeout: (fn) => fn(),
      retryDelaysMs: [],
      warn: (m) => warned.push(m)
    };
    return { deps, requested, warned };
  }
  const files = (): Record<string, unknown> => ({
    [URLS.parcels]: miniBin(),
    [URLS.projects]: projects(),
    [URLS.calibration]: calibration(),
    [POLICY_URL]: policyBin()
  });

  it('scenarioUrls names the policy URL when the manifest has one, else null', () => {
    const m = makeScenarioHarness().manifest();
    expect(scenarioUrls(m)).toEqual({ ...URLS, policy: null });
    const fzp = { ...m.scenarios!.fzp, policy: POLICY_URL };
    expect(scenarioUrls({ ...m, scenarios: { fzp } })).toEqual(WITH_POLICY);
    // /fzp never needs policy.bin, so a bad one leaves the other three usable.
    for (const policy of ['/data/fixture-1/scenarios/fzp/policy.bin', 7]) {
      const bad = { ...fzp, policy: policy as string };
      expect(scenarioUrls({ ...m, scenarios: { fzp: bad } })).toEqual({ ...URLS, policy: null });
    }
  });

  it('with opts.policy, fetches policy.bin once and returns it bound to the parcels', async () => {
    const d = direct(files());
    const r = await loadScenario(d.deps, WITH_POLICY, () => false, { policy: true });
    if ('code' in r) throw new Error(r.message);
    expect(d.requested.filter((u) => u === POLICY_URL)).toHaveLength(1);
    expect(r.policy).not.toBeNull();
    expect(r.policy!.count).toBe(r.fzp.parcels.count);
    expect(r.policy!.sb79Status).toEqual(miniPolicy(miniCity()).sb79Status);
  });

  it('without opts.policy, never requests the policy URL and returns no policy', async () => {
    const d = direct(files());
    const r = await loadScenario(d.deps, WITH_POLICY, () => false);
    if ('code' in r) throw new Error(r.message);
    expect(d.requested).not.toContain(POLICY_URL);
    expect(d.requested).toHaveLength(3);
    expect(r.policy).toBeNull();
  });

  it('gives scenario-missing for opts.policy without scenarios.fzp.policy', async () => {
    const d = direct(files());
    const r = await loadScenario(d.deps, { ...URLS, policy: null }, () => false, { policy: true });
    expect(r).toEqual({
      code: 'scenario-missing',
      message: 'dataset has no policy.bin (scenarios.fzp.policy)'
    });
    expect(d.requested).toEqual([]);
  });

  it('gives scenario-invalid for a policy.bin that does not decode', async () => {
    const d = direct({ ...files(), [POLICY_URL]: new Uint8Array([1, 2, 3]) });
    const r = await loadScenario(d.deps, WITH_POLICY, () => false, { policy: true });
    expect(r).toMatchObject({ code: 'scenario-invalid' });
    expect((r as { message: string }).message).toMatch(/^scenario policy\.bin: /);
  });
});
