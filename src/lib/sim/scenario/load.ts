// Scenario loading (spec §4.2 steps 1, 2, 4-7; the loading rows of §4.10): request checks,
// manifest URLs, the three concurrent fetches with retries, decode and validation, and the two
// SimInputs with their precompute. Worker-bundle module: zod-free, DOM-free, $app-free.
import { STREET_CLASSES } from '$lib/data/frontage-codec';
import type { Manifest } from '$lib/data/manifest';
import { readPolicyParcels, type PolicyParcels } from '$lib/data/policy-codec';
import { readScenarioParcels, type ScenarioParcels } from '$lib/data/scenario-codec';
import { parseCalibration } from '$lib/timelapse/model';
import { ProjectsFormatError, parseProjectsFile, type ProjectsFile } from '$lib/timelapse/projects';
import type { Calibration } from '$lib/timelapse/types';
import type { FetchLike } from '../chunks';
import { STOP_TYPES } from '../levers/brushes';
import { parseSimLevers } from '../levers/types';
import { isSkipped } from './engine';
import { ScenarioInputError, buildSimInput, precomputeOf } from './input';
import { applyPolicies, baseZoning } from './policy';
import type { ScenarioErrorCode, ScenarioRequest, SimInput } from './types';

/** `parcels.bin` goes through this, because `FetchLike` has only `json()` (§4.2 step 4). */
export type FetchBytesLike = (
  url: string
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export type InitRequest = Extract<ScenarioRequest, { type: 'initScenario' }>;
/**
 * `policy` and `frontage` are null when the manifest has no usable `scenarios.fzp.policy` /
 * `scenarios.fzp.frontage` (only /sim needs them; frontage only for street brushes).
 */
export type ScenarioUrls = {
  parcels: string;
  projects: string;
  calibration: string;
  policy: string | null;
  frontage: string | null;
};

export interface Loaded {
  fzp: SimInput;
  twin: SimInput; // applyPolicies([baseZoning], fzp)
  projects: ProjectsFile; // as validated: invalid projects already left out
  policy: PolicyParcels | null; // bound to the decoded parcels; null without `opts.policy`
}
export interface LoadFailure {
  code: ScenarioErrorCode;
  message: string;
}

export interface LoadDeps {
  fetch: FetchLike;
  fetchBytes: FetchBytesLike;
  setTimeout(fn: () => void, ms: number): unknown;
  retryDelaysMs: readonly number[];
  warn(msg: string): void;
  /** The T11 decoder; default `readScenarioParcels`. A seam for tests to observe the decode. */
  decodeParcels?(bytes: Uint8Array): Promise<ScenarioParcels>;
  /** The policy.bin decoder; default `readPolicyParcels`. The same kind of seam. */
  decodePolicy?(bytes: Uint8Array, parcels: ScenarioParcels): Promise<PolicyParcels>;
}

const SEED_END = 4294967296; // 2³², as a literal (ruling A3)

/** null for a seed the request may carry: null or an integer in [0, 2³²). */
export function seedProblem(seed: unknown): string | null {
  if (seed === null) return null;
  if (typeof seed === 'number' && Number.isInteger(seed) && seed >= 0 && seed < SEED_END) {
    return null;
  }
  return 'seed must be null or an integer in [0, 4294967296)';
}

/** null for a lever document `parseSimLevers` accepts, else its problem (`bad-request`). */
export function leversProblem(levers: unknown): string | null {
  try {
    parseSimLevers(levers);
    return null;
  } catch (e) {
    return `levers ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * §4.2 step 1: null when the request is acceptable, else its first problem (`bad-request`).
 * `levers` (plan 2) is checked only when present.
 */
export function validateInitRequest(req: InitRequest): string | null {
  if (req.scenario !== 'fzp') return "scenario must be 'fzp'";
  const seed = seedProblem(req.seed);
  if (seed !== null) return seed;
  if (!Number.isInteger(req.horizon)) return 'horizon must be an integer';
  if (req.levers !== undefined) return leversProblem(req.levers);
  return null;
}

/** `u` when it is a URL under `/data/<datasetVersion>/` of `m`, else null. */
export function datasetUrl(m: Manifest, u: unknown): string | null {
  return typeof u === 'string' && u.startsWith(`/data/${m.datasetVersion}/`) ? u : null;
}

/**
 * §4.2 step 2: the three FZP file URLs, or null when `scenarios.fzp` is absent or any URL is
 * missing or not under `/data/<datasetVersion>/` (the host answers `scenario-missing`). The
 * manifest has passed `checkManifestShape`, which does not look at `scenarios`. The optional
 * `policy` (plan 2) and `frontage` (plan 3) URLs are null when absent or outside the prefix:
 * /fzp never needs them, so they never make the result null.
 */
export function scenarioUrls(m: Manifest): ScenarioUrls | null {
  const fzp: unknown = (m.scenarios as { fzp?: unknown } | undefined)?.fzp;
  if (typeof fzp !== 'object' || fzp === null) return null;
  const f = fzp as Record<string, unknown>;
  const urls = { parcels: f.parcels, projects: f.projects, calibration: f.calibration };
  for (const u of Object.values(urls)) if (datasetUrl(m, u) === null) return null;
  return {
    ...(urls as Pick<ScenarioUrls, 'parcels' | 'projects' | 'calibration'>),
    policy: datasetUrl(m, f.policy),
    frontage: datasetUrl(m, f.frontage)
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const positive = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v) && v > 0;
const strings = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string');
const among = (v: unknown, known: readonly string[]): boolean =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && known.includes(x));
const lngLat = (v: unknown): boolean =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * null for a brush query the host may resolve, else its first problem (`bad-request`). The
 * resolver itself answers `[]` for a bad radius, so the host checks: radii and `maxM` positive and
 * finite, coordinates finite, kinds, stop types and street classes known.
 */
export function brushQueryProblem(q: unknown): string | null {
  if (!isRecord(q)) return 'query is not an object';
  switch (q.kind) {
    case 'freehand': {
      if (!Array.isArray(q.strokes)) return 'strokes is not an array';
      for (const [k, s] of q.strokes.entries()) {
        if (!isRecord(s)) return `strokes.${k} is not an object`;
        if (!positive(s.radiusM)) return `strokes.${k}.radiusM must be positive and finite`;
        if (!Array.isArray(s.path) || !s.path.every(lngLat))
          return `strokes.${k}.path must be finite [lng, lat] pairs`;
      }
      return null;
    }
    case 'transit':
      if (!among(q.stopTypes, STOP_TYPES)) return 'stopTypes must be known stop types';
      if (!positive(q.maxM)) return 'maxM must be positive and finite';
      return null;
    case 'street':
      if (!among(q.classes, STREET_CLASSES)) return 'classes must be known street classes';
      if (!strings(q.names)) return 'names must be strings';
      if (q.depth !== 0 && q.depth !== 1) return 'depth must be 0 or 1';
      if (typeof q.ncOnly !== 'boolean') return 'ncOnly must be a boolean';
      return null;
    case 'area':
      if (!strings(q.districts)) return 'districts must be strings';
      if (!strings(q.neighborhoods)) return 'neighborhoods must be strings';
      return null;
    default:
      return `unknown brush kind ${JSON.stringify(q.kind)}`;
  }
}

/** One opened response: `read()` is the body read (`json()` or `arrayBuffer()`). */
export interface Opened<T> {
  ok: boolean;
  status: number;
  read(): Promise<T>;
}
/** `permanent`: the failure was a status `permanent` accepted, so it was not retried. */
export type FetchResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'failed'; message: string; permanent: boolean }
  | { kind: 'stopped' };

/**
 * §4.2 step 4: one file with retries. An attempt fails when the request rejects, when `ok` is
 * false, or when the body read rejects (a body read is part of the fetch, so it is retried).
 * Attempt k + 1 waits `retryDelaysMs[k]`; after the last, the message names the last attempt's
 * status, or `(network)` when it had no usable response. `stop()` is checked after every await:
 * a stopped fetch makes no further request and schedules nothing. A status for which
 * `permanent(status)` is true fails at once, unretried (default: none, every status retries).
 */
export async function fetchWithRetry<T>(
  url: string,
  open: () => Promise<Opened<T>>,
  deps: Pick<LoadDeps, 'setTimeout' | 'retryDelaysMs'>,
  stop: () => boolean,
  permanent: (status: number) => boolean = () => false
): Promise<FetchResult<T>> {
  for (let k = 0; ; k++) {
    let status: number | null;
    try {
      const res = await open();
      if (stop()) return { kind: 'stopped' };
      if (res.ok) {
        const value = await res.read();
        return stop() ? { kind: 'stopped' } : { kind: 'ok', value };
      }
      status = res.status;
      if (permanent(status)) {
        return {
          kind: 'failed',
          message: `fetch failed: ${url} (HTTP ${status})`,
          permanent: true
        };
      }
    } catch {
      status = null; // no response, or the body read failed
    }
    if (stop()) return { kind: 'stopped' };
    if (k >= deps.retryDelaysMs.length) {
      const why = status === null ? '(network)' : `(HTTP ${status})`;
      return { kind: 'failed', message: `scenario fetch failed: ${url} ${why}`, permanent: false };
    }
    await new Promise<void>((resolve) => deps.setTimeout(resolve, deps.retryDelaysMs[k]));
    if (stop()) return { kind: 'stopped' };
  }
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A `ProjectsFormatError` message without its `projects.json ` prefix: `<path>: <problem>`. */
function projectsProblem(message: string): string {
  return message.startsWith('projects.json ') ? message.slice('projects.json '.length) : message;
}

/** `onInvalid`'s message without its `projects.json <path>: ` prefix. */
function invalidProblem(path: string, message: string): string {
  const prefix = `projects.json ${path}: `;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

const CANCELLED: LoadFailure = { code: 'internal', message: 'cancelled' };

class Stopped {}

/**
 * §4.2 steps 4-7. Fetches the three files concurrently (each with `fetchWithRetry`; the first
 * permanent failure ends the load and stops the others), then, once every byte has arrived,
 * decodes and validates them (never retried), builds the FZP input and its `baseZoning` twin,
 * and precomputes both with `deps.warn`. `projects.asOf ≥ horizon` is the caller's check.
 *
 * With `opts.policy` (/sim, plan 2) `policy.bin` is a fourth concurrent fetch, decoded after
 * parcels.bin and bound to it: no `urls.policy` gives `scenario-missing` before any fetch, and a
 * decode error gives `scenario-invalid`. Without it the policy URL is never requested.
 *
 * Once `cancelled()` is true the result is meaningless (a `LoadFailure` the caller ignores), and
 * a load cancelled while waiting on a retry timer the caller cleared never settles. An
 * unexpected throw (not a decode or validation failure) rejects.
 */
export async function loadScenario(
  deps: LoadDeps,
  urls: ScenarioUrls,
  cancelled: () => boolean,
  opts?: { policy: boolean }
): Promise<Loaded | LoadFailure> {
  const wantPolicy = opts?.policy === true;
  if (wantPolicy && urls.policy === null) {
    return {
      code: 'scenario-missing',
      message: 'dataset has no policy.bin (scenarios.fzp.policy)'
    };
  }
  let failed = false;
  const stop = () => failed || cancelled();
  const must = async <T>(p: Promise<FetchResult<T>>): Promise<T> => {
    const r = await p;
    if (r.kind === 'ok') return r.value;
    throw r.kind === 'failed'
      ? ({ code: 'internal', message: r.message } as LoadFailure)
      : new Stopped();
  };
  const json = (url: string) =>
    must(
      fetchWithRetry(
        url,
        () => deps.fetch(url).then((r) => ({ ok: r.ok, status: r.status, read: () => r.json() })),
        deps,
        stop
      )
    );
  const bytes = (url: string) =>
    must(
      fetchWithRetry(
        url,
        () =>
          deps
            .fetchBytes(url)
            .then((r) => ({ ok: r.ok, status: r.status, read: () => r.arrayBuffer() })),
        deps,
        stop
      )
    );

  let bin: ArrayBuffer;
  let projectsJson: unknown;
  let calibrationJson: unknown;
  let policyBin: ArrayBuffer | null;
  try {
    [bin, projectsJson, calibrationJson, policyBin] = await Promise.all([
      bytes(urls.parcels),
      json(urls.projects),
      json(urls.calibration),
      wantPolicy ? bytes(urls.policy!) : null
    ]);
  } catch (e) {
    failed = true; // the other files stop at their next step
    return e instanceof Stopped ? CANCELLED : (e as LoadFailure);
  }
  if (cancelled()) return CANCELLED;

  const invalid = (file: string, problem: string): LoadFailure => ({
    code: 'scenario-invalid',
    message: `scenario ${file}: ${problem}`
  });

  // Step 5: decoding starts only now, so a failure is a bad file, never a network error.
  let parcels: ScenarioParcels;
  try {
    parcels = await (deps.decodeParcels ?? readScenarioParcels)(new Uint8Array(bin));
  } catch (e) {
    return invalid('parcels.bin', messageOf(e));
  }
  if (cancelled()) return CANCELLED;

  let policy: PolicyParcels | null = null;
  if (policyBin !== null) {
    try {
      policy = await (deps.decodePolicy ?? readPolicyParcels)(new Uint8Array(policyBin), parcels);
    } catch (e) {
      return invalid('policy.bin', messageOf(e));
    }
    if (cancelled()) return CANCELLED;
  }

  let calibration: Calibration;
  try {
    calibration = parseCalibration(calibrationJson);
  } catch (e) {
    return invalid('calibration.json', messageOf(e));
  }

  const skipped: [path: string, message: string][] = [];
  let projects: ProjectsFile;
  try {
    // No `parcelIds`: a parcel absent from T11 is handled by the host, not rejected (§4.2).
    projects = parseProjectsFile(projectsJson, {
      onInvalid: (path, message) => skipped.push([path, message])
    });
  } catch (e) {
    return invalid(
      'projects.json',
      e instanceof ProjectsFormatError ? projectsProblem(e.message) : messageOf(e)
    );
  }
  if (skipped.length > 0) {
    const [path, message] = skipped[0];
    deps.warn(
      `projects.json: skipped ${skipped.length} invalid project(s); ` +
        `first: ${path}: ${invalidProblem(path, message)}`
    );
  }
  // Once per load, for the FZP input and its twin alike (they share the projects): the rows the
  // engine does not run (§4.4.3). The engine stays pure and logs nothing.
  let notRun = 0;
  for (const p of projects.projects) if (isSkipped(p)) notRun++;
  if (notRun > 0) {
    deps.warn(
      `projects.json: skipped ${notRun} project(s) the simulation does not run ` +
        '(complete, or permitOnly at filed or entitled)'
    );
  }

  // Step 6: the FZP input (A2 fillLevels check) and its twin.
  let fzp: SimInput;
  try {
    fzp = buildSimInput({ parcels, projects, calibration }, deps.warn);
  } catch (e) {
    if (e instanceof ScenarioInputError) return invalid(e.file, e.message);
    throw e;
  }
  const twin = applyPolicies([baseZoning], fzp);

  // Step 7: precompute both now, with the warn (the engine's later calls pass none and hit the
  // identity memo). The twin shares columns, so an identical warning is not repeated. This
  // dedupe is a choice of this module (one line per fact in the log), not a spec rule.
  const said = new Set<string>();
  const warnOnce = (msg: string) => {
    if (said.has(msg)) return;
    said.add(msg);
    deps.warn(msg);
  };
  precomputeOf(fzp, warnOnce);
  precomputeOf(twin, warnOnce);
  return { fzp, twin, projects, policy };
}
