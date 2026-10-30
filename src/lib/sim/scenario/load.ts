// Scenario loading (spec §4.2 steps 1, 2, 4-7; the loading rows of §4.10): request checks,
// manifest URLs, the three concurrent fetches with retries, decode and validation, and the two
// SimInputs with their precompute. Worker-bundle module: zod-free, DOM-free, $app-free.
import type { Manifest } from '$lib/data/manifest';
import { readPolicyParcels, type PolicyParcels } from '$lib/data/policy-codec';
import { readScenarioParcels, type ScenarioParcels } from '$lib/data/scenario-codec';
import { parseCalibration } from '$lib/timelapse/model';
import { ProjectsFormatError, parseProjectsFile, type ProjectsFile } from '$lib/timelapse/projects';
import type { Calibration } from '$lib/timelapse/types';
import type { FetchLike } from '../chunks';
import { isSkipped } from './engine';
import { ScenarioInputError, buildSimInput, precomputeOf } from './input';
import { applyPolicies, baseZoning } from './policy';
import type { ScenarioErrorCode, ScenarioRequest, SimInput } from './types';

/** `parcels.bin` goes through this, because `FetchLike` has only `json()` (§4.2 step 4). */
export type FetchBytesLike = (
  url: string
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export type InitRequest = Extract<ScenarioRequest, { type: 'initScenario' }>;
/** `policy` is null when the manifest has no usable `scenarios.fzp.policy` (only /sim needs it). */
export type ScenarioUrls = {
  parcels: string;
  projects: string;
  calibration: string;
  policy: string | null;
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

/** §4.2 step 1: null when the request is acceptable, else its first problem (`bad-request`). */
export function validateInitRequest(req: InitRequest): string | null {
  if (req.scenario !== 'fzp') return "scenario must be 'fzp'";
  const seed = seedProblem(req.seed);
  if (seed !== null) return seed;
  if (!Number.isInteger(req.horizon)) return 'horizon must be an integer';
  return null;
}

/**
 * §4.2 step 2: the three FZP file URLs, or null when `scenarios.fzp` is absent or any URL is
 * missing or not under `/data/<datasetVersion>/` (the host answers `scenario-missing`). The
 * manifest has passed `checkManifestShape`, which does not look at `scenarios`. The optional
 * `policy` URL (plan 2) is null when absent or outside the prefix: /fzp never needs it, so it
 * never makes the result null.
 */
export function scenarioUrls(m: Manifest): ScenarioUrls | null {
  const fzp: unknown = (m.scenarios as { fzp?: unknown } | undefined)?.fzp;
  if (typeof fzp !== 'object' || fzp === null) return null;
  const prefix = `/data/${m.datasetVersion}/`;
  const f = fzp as Record<string, unknown>;
  const urls = { parcels: f.parcels, projects: f.projects, calibration: f.calibration };
  for (const u of Object.values(urls)) {
    if (typeof u !== 'string' || !u.startsWith(prefix)) return null;
  }
  const policy = typeof f.policy === 'string' && f.policy.startsWith(prefix) ? f.policy : null;
  return { ...(urls as Omit<ScenarioUrls, 'policy'>), policy };
}

/** One opened response: `read()` is the body read (`json()` or `arrayBuffer()`). */
export interface Opened<T> {
  ok: boolean;
  status: number;
  read(): Promise<T>;
}
export type FetchResult<T> =
  { kind: 'ok'; value: T } | { kind: 'failed'; message: string } | { kind: 'stopped' };

/**
 * §4.2 step 4: one file with retries. An attempt fails when the request rejects, when `ok` is
 * false, or when the body read rejects (a body read is part of the fetch, so it is retried).
 * Attempt k + 1 waits `retryDelaysMs[k]`; after the last, the message names the last attempt's
 * status, or `(network)` when it had no usable response. `stop()` is checked after every await:
 * a stopped fetch makes no further request and schedules nothing.
 */
export async function fetchWithRetry<T>(
  url: string,
  open: () => Promise<Opened<T>>,
  deps: Pick<LoadDeps, 'setTimeout' | 'retryDelaysMs'>,
  stop: () => boolean
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
    } catch {
      status = null; // no response, or the body read failed
    }
    if (stop()) return { kind: 'stopped' };
    if (k >= deps.retryDelaysMs.length) {
      const why = status === null ? '(network)' : `(HTTP ${status})`;
      return { kind: 'failed', message: `scenario fetch failed: ${url} ${why}` };
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
      policy = await readPolicyParcels(new Uint8Array(policyBin), parcels);
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
