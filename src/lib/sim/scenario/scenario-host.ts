// The scenario host (spec §4.1): a separate host behind the same Worker, beside the editor host
// (host.ts, unchanged). It handles `initScenario` and `reroll`, plus the shared `prefetch`,
// `retryChunks` and `parcelSummary` when the router sends them here. Worker-bundle module:
// zod-free, DOM-free, $app-free.
//
// Structure. Each accepted `initScenario` gets one `Session`, the per-init state, with its own
// cancellation `Token`. Every timer and every async completion of a session goes through its
// token, so a superseded or disposed session can never post: a new `initScenario` (accepted or
// not) and `dispose` cancel the current token, which also clears its timers.
//
// Timelines (§4.6, §4.7). Once loaded, a session holds its `Work`: the band state (it depends only
// on the dataset, so every reroll reuses it) and the current shown `Run` (one per `(rev, seed)`;
// a reroll replaces it and cancels its child token). All computation runs in one scheduler: a
// slice is a `setTimeout(0)` macrotask that takes the next job by priority and keeps going while
// the time used so far (`deps.now()`) plus the last measured cost of the next job's kind fits
// in 50 ms; the first job of a slice always runs. Other requests are handled between slices. Job
// priority: (1) the current run's revision 0, after the FZP band runs it needs when its seed is
// null; (2) its twin, posted as a band-only update with `planEffect`; (3) its later geometry
// (Task 15); (4) the band: FZP run then twin per pair, a band-only update every 16 pairs and
// after the last. Twins run through `simulateNet` only, so no twin Schedule ever exists.
import type { Manifest } from '$lib/data/manifest';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { ParcelId } from '$lib/data/parcel';
import type { generate, generateForUnits } from '$lib/generator';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
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
import { BAND_RUNS, bandSeed, createBandState, type BandState } from './band';
import {
  assembleScore,
  monthsOf,
  netOf,
  phasingOf,
  planEffectOf,
  shownSeries,
  type NetSeries
} from './score';
import { simulateDetailed, simulateNet } from './simulate';
import type {
  Schedule,
  ScenarioErrorCode,
  ScenarioRequest,
  ScenarioResponse,
  TimelineScore
} from './types';

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
  /** Test seam: the parcels.bin decoder (default `readScenarioParcels`), so a harness can tell
   *  when the one host-external async step (the inflate) has settled. */
  decodeParcels?(bytes: Uint8Array): Promise<ScenarioParcels>;
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

/** Longest slice of band, twin or geometry work (§4.7, §4.11; tier 4, engineering). */
export const SLICE_MS = 50;
/** A band-only update every this many completed pairs, and after the last (§4.7; tier 4). */
export const BAND_POST_EVERY = 16;

/** One demolition: a parcel's existing building goes at its first construction start. */
export type Demolition = { parcelId: ParcelId; day: Day };

/**
 * Revision 0's complete `demolish` list (T7; it needs no geometry): every parcel of every
 * Schedule with `entered.construction`, at the earliest such day per parcel, sorted by parcel id.
 * A score-only Schedule (no parcels) adds nothing.
 */
export function demolishOf(schedules: readonly Schedule[]): Demolition[] {
  const first = new Map<ParcelId, Day>();
  for (const sc of schedules) {
    const c = sc.entered.construction;
    if (c === undefined) continue;
    for (const id of sc.parcelIds) {
      const d = first.get(id);
      if (d === undefined || c < d) first.set(id, c);
    }
  }
  const ids = [...first.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return ids.map((parcelId) => ({ parcelId, day: first.get(parcelId)! }));
}

/**
 * The geometry of one shown run: the seam Task 15 fills (chunks, massing, packing). The host
 * owns the scheduling and the posting; the geometry only answers what is pending and packs one
 * slice at a time, so each of its steps is a scheduler job (kind 'pack') like any other.
 */
export interface RunGeometry {
  /**
   * True while revision 0 should wait for more packing: a ready anchored cell is still unpacked
   * and the revision-0 cap (2.5 s; `elapsedMs` since the request) has not passed.
   */
  revision0Pending(elapsedMs: number): boolean;
  /** Packs one slice of revision 0's cells (called only while `revision0Pending`). */
  packRevision0(): void;
  /** Revision 0's cells and their transferables; called once, as revision 0 is posted. */
  revision0Cells(): { cells: TimedPackedCell[]; transfer: ArrayBuffer[] };
  /** True when a later packing slice (a newly ready chunk) is waiting. */
  laterPending(): boolean;
  /** Packs one later slice; the host posts its cells as the next revision. */
  packLater(): { cells: TimedPackedCell[]; transfer: ArrayBuffer[] };
  /** The complete demolish list (revision 0 only). */
  demolish(): Demolition[];
  /** T6 `complete`: no ready anchored cell is waiting to be packed. */
  complete(): boolean;
}

/** The run's Schedules and Masters, as `simulateDetailed` made them (the FZP run only). */
export type RunDetail = ReturnType<typeof simulateDetailed>;

/**
 * Until geometry streams (Task 15): no chunk is loaded, so no anchored cell is ready, nothing
 * is pending and every message is `complete`. The demolish list needs no geometry.
 */
function placeholderGeometry(detail: RunDetail): RunGeometry {
  return {
    revision0Pending: () => false,
    packRevision0: () => {},
    revision0Cells: () => ({ cells: [], transfer: [] }),
    laterPending: () => false,
    packLater: () => ({ cells: [], transfer: [] }),
    demolish: () => demolishOf(detail.schedules),
    complete: () => true
  };
}

/** One shown run: one `(rev, seed)`, whose revisions count up from 0. */
interface Run {
  rev: Rev;
  requested: number | null; // as requested (null = representative)
  seed: number | null; // resolved: null until the representative is known
  /** The run's own work scope (geometry timers, Task 15); cancelled when a reroll replaces it. */
  token: Token;
  requestedAt: number; // deps.now() at the request
  revision: number; // the last posted; -1 before revision 0
  shown: TimelineScore['shown'] | null;
  net: NetSeries | null; // the shown run's, for planEffect
  geometry: RunGeometry | null;
  planEffect: TimelineScore['planEffect'] | null; // null until the twin is done
}

/** A loaded session's timeline work. */
interface Work {
  loaded: Loaded;
  horizon: Day;
  months: Day[]; // one array for every run, so simulateNet's month table is cached
  phasing: TimelineScore['phasing'];
  band: BandState;
  /** FZP band run i's `completedNetNew`, kept until pair i is done. */
  fzpNew: (Int32Array | undefined)[];
  run: Run;
  pending: boolean; // a slice is scheduled
  cost: Partial<Record<JobKind, number>>; // last measured ms per job kind
}

type JobKind = 'net' | 'shown' | 'pack';
type Job = { kind: JobKind; run(): void };

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
  /** The timeline work, created with `loaded`. */
  work: Work | null;
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
      loaded: null,
      work: null
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
        warn,
        decodeParcels: deps.decodeParcels
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

  /** Loading has succeeded: the band state and the first run, then the first slice. */
  function loadedHook(st: Session): void {
    const loaded = st.loaded!;
    const asOf = loaded.fzp.asOf;
    st.work = {
      loaded,
      horizon: st.horizon,
      months: monthsOf(asOf, st.horizon),
      phasing: phasingOf(loaded.fzp.projects, asOf),
      band: createBandState(deps.bandRuns ?? BAND_RUNS),
      fzpNew: [],
      run: newRun(st, st.rev, st.seed),
      pending: false,
      cost: {}
    };
    kick(st);
  }

  function newRun(st: Session, rev: Rev, seed: number | null): Run {
    return {
      rev,
      requested: seed,
      seed,
      token: st.token.child(),
      requestedAt: deps.now(),
      revision: -1,
      shown: null,
      net: null,
      geometry: null,
      planEffect: null
    };
  }

  function reroll(req: RerollRequest): void {
    const st = s;
    if (!st || !st.loaded || !st.work) return error(req.rev, 'bad-request', 'not initialised');
    const bad = seedProblem(req.seed);
    if (bad !== null) return error(req.rev, 'bad-request', bad);
    // The old seed's geometry and twin work goes with its run; the band work is the session's.
    st.work.run.token.cancel();
    st.work.run = newRun(st, req.rev, req.seed);
    kick(st);
  }

  // --- the scheduler ---

  /** Schedules the next slice unless one is pending. */
  function kick(st: Session): void {
    const w = st.work;
    if (!w || w.pending || !live(st)) return;
    w.pending = true;
    st.token.later(() => {
      w.pending = false;
      try {
        slice(st, w);
      } catch (e) {
        if (!live(st)) return;
        const rev = w.run.rev;
        end();
        error(rev, 'internal', String(e));
      }
    }, 0);
  }

  /**
   * One macrotask: jobs in priority order while they fit in `SLICE_MS`, judged by the time used
   * so far plus the last measured cost of the next job's kind (a kind not yet measured waits for
   * a fresh slice). The first job always runs, so a job longer than a slice gets one of its own.
   */
  function slice(st: Session, w: Work): void {
    const start = deps.now();
    for (let first = true; ; first = false) {
      if (!live(st)) return;
      const job = nextJob(w);
      if (job === null) return; // idle until a reroll kicks again
      if (!first) {
        const est = w.cost[job.kind];
        if (est === undefined || deps.now() - start + est > SLICE_MS) return kick(st);
      }
      const t0 = deps.now();
      job.run();
      w.cost[job.kind] = deps.now() - t0;
    }
  }

  function nextJob(w: Work): Job | null {
    const run = w.run;
    const band = w.band;
    if (run.revision < 0) {
      if (run.shown === null) {
        // a null seed needs every FZP band run for its representative (§4.6)
        if (run.requested === null && band.fzpCount < band.total) {
          const i = band.fzpCount;
          return { kind: 'net', run: () => bandFzp(w, i) };
        }
        return { kind: 'shown', run: () => shownRun(w, run) };
      }
      return {
        kind: 'pack',
        run: () => {
          run.geometry!.packRevision0();
          settleRevision0(w, run);
        }
      };
    }
    if (run.planEffect === null) return { kind: 'net', run: () => shownTwin(w, run) };
    if (run.geometry!.laterPending()) {
      return {
        kind: 'pack',
        run: () => {
          const { cells, transfer } = run.geometry!.packLater();
          postTimeline(w, run, { cells, removedCells: [], demolish: [] }, transfer);
        }
      };
    }
    // the band: FZP band runs and pairs are each done in index order, so pairs <= fzpCount
    if (band.pairs >= band.total) return null;
    const i = band.pairs;
    if (i < band.fzpCount) return { kind: 'net', run: () => bandTwin(w, i) };
    const j = band.fzpCount;
    return { kind: 'net', run: () => bandFzp(w, j) };
  }

  // --- the jobs ---

  function bandFzp(w: Work, i: number): void {
    const r = simulateNet(w.loaded.fzp, bandSeed(i), w.horizon, w.months);
    w.band.setFzp(i, r.completedNet);
    w.fzpNew[i] = r.completedNetNew;
  }

  function bandTwin(w: Work, i: number): void {
    const t = simulateNet(w.loaded.twin, bandSeed(i), w.horizon, w.months);
    const f = w.fzpNew[i]!;
    const effect = new Int32Array(f.length);
    for (let k = 0; k < f.length; k++) effect[k] = f[k] - t.completedNetNew[k];
    w.fzpNew[i] = undefined;
    w.band.setPair(i, effect);
    const pairs = w.band.pairs;
    const due = pairs % BAND_POST_EVERY === 0 || pairs === w.band.total;
    // band work never runs ahead of the run's twin update, which carries the band itself
    if (due && w.run.planEffect !== null) postBandOnly(w, w.run);
  }

  function shownRun(w: Work, run: Run): void {
    if (run.requested === null) run.seed = w.band.representativeSeed();
    const detail = simulateDetailed(w.loaded.fzp, run.seed!, w.horizon);
    run.shown = shownSeries(detail, w.loaded.fzp.asOf, w.horizon, w.months);
    run.net = netOf(run.shown);
    run.geometry = placeholderGeometry(detail); // Task 15: the run's real geometry
    settleRevision0(w, run);
  }

  /** Posts revision 0 once no packing is pending for it (or its cap has passed). */
  function settleRevision0(w: Work, run: Run): void {
    const g = run.geometry!;
    if (g.revision0Pending(deps.now() - run.requestedAt)) return;
    const { cells, transfer } = g.revision0Cells();
    postTimeline(w, run, { cells, removedCells: [], demolish: g.demolish() }, transfer);
  }

  /** The shown seed's twin: `planEffect`, then its Schedules-free series are dropped. */
  function shownTwin(w: Work, run: Run): void {
    const t = simulateNet(w.loaded.twin, run.seed!, w.horizon, w.months);
    run.planEffect = planEffectOf(run.net!, t);
    postBandOnly(w, run);
  }

  // --- posting ---

  function postBandOnly(w: Work, run: Run): void {
    postTimeline(w, run, { cells: [], removedCells: [], demolish: [] }, []);
  }

  /**
   * The run's next revision, with the seed's full score. `planEffect` and `planEffectBand` are
   * `[]` in revision 0 and until the twin is done (§4.5 "Empty until computed").
   */
  function postTimeline(
    w: Work,
    run: Run,
    render: Omit<TimelineUpdate, 'revision'>,
    transfer: ArrayBuffer[]
  ): void {
    run.revision++;
    const effect = run.revision > 0 ? run.planEffect : null;
    const score = assembleScore({
      months: w.months,
      shown: run.shown!,
      planEffect: effect ?? [],
      planEffectBand: effect ? w.band.planEffectBand() : [],
      band: w.band.band(),
      baseline: w.loaded.projects.rhnaCompletedNet,
      phasing: w.phasing
    });
    post(
      {
        type: 'timeline',
        rev: run.rev,
        seed: run.seed!,
        render: { revision: run.revision, ...render },
        score,
        bandRuns: w.band.pairs,
        bandRunsTotal: w.band.total,
        complete: run.geometry!.complete()
      },
      transfer
    );
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
