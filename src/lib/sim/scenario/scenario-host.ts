// The scenario host (spec §4.1): a separate host behind the same Worker, beside the editor host
// (host.ts, unchanged). It handles `initScenario` and `reroll`, plus the shared `prefetch`,
// `retryChunks` and `parcelSummary` when the router sends them here. Worker-bundle module:
// zod-free, DOM-free, $app-free.
//
// Structure. Each accepted `initScenario` gets one `Session`, the per-init state, with its own
// cancellation `Token`. Every timer and every async completion of a session goes through its
// token, so a superseded or disposed session can never post: a new `initScenario` (accepted or
// not) and `dispose` cancel the current token, which also clears its timers. Later work (Task 14
// timelines and bands, Task 15 chunks and geometry) hangs off `Session` and schedules through
// `token.later`; a reroll's own work can take a `token.child()`, cancelled with the session.
import type { Manifest } from '$lib/data/manifest';
import type { generate, generateForUnits } from '$lib/generator';
import type { Day } from '$lib/timelapse/time';
import type { FetchLike } from '../chunks';
import { DEFAULT_RETRY_DELAYS_MS } from '../host';
import { checkManifestShape } from '../manifest-shape';
import type { Rev } from '../protocol';
import {
  loadScenario,
  scenarioUrls,
  seedProblem,
  validateInitRequest,
  type FetchBytesLike,
  type Loaded,
  type ScenarioUrls
} from './load';
import type { ScenarioErrorCode, ScenarioRequest, ScenarioResponse } from './types';

export interface ScenarioHostDeps {
  fetch: FetchLike; // JSON files (chunks.ts:9)
  fetchBytes: FetchBytesLike; // parcels.bin
  post(msg: ScenarioResponse, transfer: ArrayBuffer[]): void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number; // ms
  generate?: typeof generate;
  generateForUnits?: typeof generateForUnits;
  retryDelaysMs?: readonly number[]; // default DEFAULT_RETRY_DELAYS_MS (1, 4, 16 s)
  maxConcurrent?: number;
  memoCap?: number;
  bandRuns?: number;
  warn?(msg: string): void; // default console.warn
}

export interface ScenarioHost {
  handle(req: ScenarioRequest): void;
  dispose(): void;
}

/** A cancellation scope: its timers are cleared, and its callbacks dropped, once cancelled. */
export interface Token {
  readonly cancelled: boolean;
  /** `fn` after `ms`, unless the token is cancelled first. Returns the timer handle. */
  later(fn: () => void, ms: number): unknown;
  cancel(): void;
  /** A token cancelled with this one (or on its own). */
  child(): Token;
}

function createToken(deps: Pick<ScenarioHostDeps, 'setTimeout' | 'clearTimeout'>): Token {
  const timers = new Set<unknown>();
  const children = new Set<Token>();
  let cancelled = false;
  const token: Token = {
    get cancelled() {
      return cancelled;
    },
    later(fn, ms) {
      if (cancelled) return undefined;
      const h = deps.setTimeout(() => {
        timers.delete(h);
        if (!cancelled) fn();
      }, ms);
      timers.add(h);
      return h;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      for (const h of timers) deps.clearTimeout(h);
      timers.clear();
      for (const c of children) c.cancel();
      children.clear();
    },
    child() {
      const c = createToken(deps);
      if (cancelled) c.cancel();
      else children.add(c);
      return c;
    }
  };
  return token;
}

/** The per-init state. */
interface Session {
  rev: Rev; // the initScenario's rev
  manifest: Manifest;
  version: string;
  urls: ScenarioUrls;
  horizon: Day;
  seed: number | null; // as requested (null = representative)
  token: Token;
  /** Set once loading has succeeded; until then a reroll is 'not initialised'. */
  loaded: Loaded | null;
}

type InitRequest = Extract<ScenarioRequest, { type: 'initScenario' }>;
type RerollRequest = Extract<ScenarioRequest, { type: 'reroll' }>;

export function createScenarioHost(deps: ScenarioHostDeps): ScenarioHost {
  const retryDelaysMs = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const warn = deps.warn ?? ((msg: string) => console.warn(`[sim] ${msg}`));

  let s: Session | null = null;
  let latestRev = 0;

  const post = (msg: ScenarioResponse, transfer: ArrayBuffer[] = []) => deps.post(msg, transfer);
  const error = (rev: Rev, code: ScenarioErrorCode, message: string) =>
    post({ type: 'error', rev, code, message });

  /** True while `st` is the current, uncancelled session. */
  const live = (st: Session) => s === st && !st.token.cancelled;

  function end(): void {
    s?.token.cancel();
    s = null;
  }

  function fail(st: Session, code: ScenarioErrorCode, message: string): void {
    end();
    error(st.rev, code, message);
  }

  function initScenario(req: InitRequest): void {
    end(); // any initScenario, accepted or not, supersedes the previous one
    const bad = validateInitRequest(req);
    if (bad !== null) return error(req.rev, 'bad-request', bad);
    const shape = checkManifestShape(req.manifest);
    if (shape !== null) return error(req.rev, 'manifest-invalid', shape);
    const manifest = req.manifest;
    const version = manifest.datasetVersion;
    const urls = scenarioUrls(manifest);
    if (urls === null) {
      return error(req.rev, 'scenario-missing', `dataset ${version} has no fzp scenario`);
    }
    const st: Session = {
      rev: req.rev,
      manifest,
      version,
      urls,
      horizon: req.horizon,
      seed: req.seed,
      token: createToken(deps),
      loaded: null
    };
    s = st;
    post({
      type: 'ready',
      rev: req.rev,
      datasetVersion: version,
      chunkCount: manifest.chunks.length
    });
    load(st);
  }

  function load(st: Session): void {
    loadScenario(
      {
        fetch: deps.fetch,
        fetchBytes: deps.fetchBytes,
        setTimeout: (fn, ms) => st.token.later(fn, ms),
        retryDelaysMs,
        warn
      },
      st.urls,
      () => !live(st)
    ).then(
      (r) => {
        if (!live(st)) return;
        if ('code' in r) return fail(st, r.code, r.message);
        const asOf = r.projects.asOf;
        if (asOf >= st.horizon) {
          return fail(
            st,
            'bad-request',
            `horizon ${st.horizon} is not after projects.json asOf ${asOf}`
          );
        }
        st.loaded = r;
        loadedHook(st);
      },
      (e: unknown) => {
        if (live(st)) fail(st, 'internal', String(e));
      }
    );
  }

  /** Loading has succeeded: the first run starts here (Task 14). */
  function loadedHook(st: Session): void {
    void st;
  }

  function reroll(req: RerollRequest): void {
    const st = s;
    if (!st || !st.loaded) return error(req.rev, 'bad-request', 'not initialised');
    const bad = seedProblem(req.seed);
    if (bad !== null) return error(req.rev, 'bad-request', bad);
    // Task 14: cancel the old seed's geometry and twin work, post the new revision 0.
  }

  function dispatch(req: ScenarioRequest): void {
    switch (req.type) {
      case 'initScenario':
        return initScenario(req);
      case 'reroll':
        return reroll(req);
      case 'parcelSummary':
        // No records are loaded until geometry streams (Task 15): the summary is null.
        return post({ type: 'parcelSummary', reqId: req.reqId, summary: null });
      case 'prefetch':
      case 'retryChunks':
        return; // the chunk loader arrives with geometry (Task 15)
      default: {
        const never: never = req;
        throw new Error(`unknown request ${String((never as { type?: unknown }).type)}`);
      }
    }
  }

  return {
    handle(req) {
      if ('rev' in req) latestRev = Math.max(latestRev, req.rev);
      try {
        dispatch(req);
      } catch (e) {
        error('rev' in req ? req.rev : latestRev, 'internal', String(e));
      }
    },
    dispose() {
      end();
    }
  };
}
