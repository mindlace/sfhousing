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
// a reroll replaces it, and since every job is taken from the current `w.run` at the start of a
// slice, the old run's work simply stops). All computation runs in one scheduler: a
// slice is a `setTimeout(0)` macrotask that takes the next job by priority and keeps going while
// the time used so far (`deps.now()`) plus the estimated cost of the next job's kind (the
// largest of its last few measured costs) fits in 45 ms, 5 ms short of the 50 ms slice so that
// a job over its estimate still ends within it; the first job of a slice always runs, and the
// shown run's job (simulate and score only) runs in a slice of its own. Other requests are
// handled between slices. Job priority: (1) the current run's revision 0, after the FZP band
// runs it needs when its seed is null: the shown run, then in the next slice its geometry
// set-up, then its geometry packing for up to 2.5 s; (2) its twin, posted as a band-only update
// with `planEffect`; (3) its later geometry, one revision per packing slice; (4) the band: FZP
// run then twin per pair, a band-only update every 16 pairs and after the last. Twins run
// through `simulateNet` only, so no twin Schedule ever exists.
//
// Geometry (§4.2, §4.7, §4.8). Each session has its own chunk loader, driven only by `prefetch`
// (the viewport) plus the extra cells of the multi-parcel projects anchored there; chunks report
// as the editor's do. Each run's `Geometry` (geometry.ts) packs the ready anchored cells. The
// generator memo lives across sessions and is cleared when an init names another datasetVersion.
import type { Manifest } from '$lib/data/manifest';
import { envelopeOf, type ScenarioParcels } from '$lib/data/scenario-codec';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { generate, generateForUnits, type GeneratedBuilding } from '$lib/generator';
import { packTimedTransferables } from '$lib/map/pack-timed';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import type { Day } from '$lib/timelapse/time';
import { cellsIntersecting, createChunkLoader, type ChunkLoader, type FetchLike } from '../chunks';
import { DEFAULT_RETRY_DELAYS_MS } from '../host';
import { createLru } from '../lru';
import { checkManifestShape } from '../manifest-shape';
import type { ParcelSummary, Rev } from '../protocol';
import { chooseProject, projectCard, revisionAt, type CardCtx } from './card';
import { createGeometry, type Geometry } from './geometry';
import { massingFor, type MassingCtx } from './massing';
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
  Massing,
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
}

function createToken(deps: Pick<ScenarioHostDeps, 'setTimeout' | 'clearTimeout'>): Token {
  const timers = new Set<unknown>();
  let cancelled = false;
  return {
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
    }
  };
}

/** Longest slice of band, twin or geometry work (§4.7, §4.11; tier 4, engineering). */
export const SLICE_MS = 50;
/**
 * The length the scheduler plans a slice to: the 5 ms below `SLICE_MS` absorb a job that runs
 * over its estimate (a collection, a cold generator), so the slice still ends within `SLICE_MS`
 * (tier 4, engineering; measured in scenario.bench.spec.ts).
 */
export const SLICE_PLAN_MS = SLICE_MS - 5;
/** A job kind's cost estimate is the largest of its last this many measured costs (tier 4). */
const COST_WINDOW = 4;
/** A band-only update every this many completed pairs, and after the last (§4.7; tier 4). */
export const BAND_POST_EVERY = 16;
/** Revision 0 packs ready anchored cells for at most this long after the request (§4.7; tier 4). */
export const REVISION0_CAP_MS = 2500;
/**
 * Generator-memo cap in entries (§4.8; tier 4, engineering): about 60 MB at the ≈0.8–1.0 KB per
 * entry measured in host.ts. Keys are content-based, so pipeline massings hit across seeds.
 */
export const MEMO_CAP = 60_000;

/** A card's massing for a project the map does not draw yet: a footprint entry, no building. */
const NOT_DRAWN: Massing = { footprint: [] };

/** The run's Schedules and Masters, as `simulateDetailed` made them (the FZP run only). */
export type RunDetail = ReturnType<typeof simulateDetailed>;

/** One shown run: one `(rev, seed)`, whose revisions count up from 0. */
interface Run {
  rev: Rev;
  requested: number | null; // as requested (null = representative)
  seed: number | null; // resolved: null until the representative is known
  requestedAt: number; // deps.now() at the request
  revision: number; // the last posted; -1 before revision 0
  shown: TimelineScore['shown'] | null;
  net: NetSeries | null; // the shown run's, for planEffect
  detail: RunDetail | null; // with the shown run
  geometry: Geometry | null; // with the shown run
  /** Revision 0's cells packed so far, by cell id (a repack replaces its entry). */
  r0: Map<string, TimedPackedCell>;
  card: CardCtx | null; // built on the first parcelSummary
  planEffect: TimelineScore['planEffect'] | null; // null until the twin is done
}

/** A session's chunks: its loader and every ready record. */
interface Chunks {
  loader: ChunkLoader;
  byCell: Map<string, ParcelRecord[]>;
  records: Map<ParcelId, ParcelRecord>;
  /** Every cell `prefetch` has asked for (the viewport's, at any time). */
  wanted: Set<string>;
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
  chunks: Chunks;
  massing: Omit<MassingCtx, 'records'>;
  pending: boolean; // a slice is scheduled
  sliceStart: number; // deps.now() at the current slice's start
  /** Estimated ms per job kind (`measure`); for 'pack', per packed cell. */
  cost: Partial<Record<JobKind, number>>;
  /** The last `COST_WINDOW` measured ms per job kind. */
  costs: Partial<Record<JobKind, number[]>>;
  /** A due band post could not go out yet; the next timeline (which carries the band) is it. */
  bandPostDue: boolean;
}

type JobKind = 'net' | 'shown' | 'geometry' | 'pack' | 'post';
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
  chunks: Chunks;
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
  const gen = deps.generate ?? generate;
  const genForUnits = deps.generateForUnits ?? generateForUnits;

  // Valid within one datasetVersion (content keys hold no version): kept across sessions of the
  // same version, cleared for another. The once-only log keys go with it.
  const memo = createLru<string, GeneratedBuilding | null>(deps.memoCap ?? MEMO_CAP);
  const logged = new Set<string>();
  let memoVersion: string | null = null;
  const logOnce = (key: string, msg: string) => {
    if (logged.has(key)) return;
    logged.add(key);
    warn(msg);
  };

  let s: Session | null = null;
  let latestRev = 0;

  const post = (msg: ScenarioResponse, transfer: ArrayBuffer[] = []) => deps.post(msg, transfer);
  const error = (rev: Rev, code: ScenarioErrorCode, message: string) =>
    post({ type: 'error', rev, code, message });

  /** True while `st` is the current, uncancelled session. */
  const live = (st: Session) => s === st && !st.token.cancelled;

  function end(): void {
    s?.token.cancel();
    s?.chunks.loader.dispose();
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
    if (version !== memoVersion) {
      memo.clear();
      logged.clear();
      memoVersion = version;
    }
    // `st` is assigned before any loader callback can run: they only come asynchronously.
    const st = {
      rev: req.rev,
      manifest,
      version,
      urls,
      horizon: req.horizon,
      seed: req.seed,
      token: createToken(deps),
      loaded: null,
      work: null
    } as Omit<Session, 'chunks'> as Session;
    st.chunks = {
      loader: createChunkLoader(manifest, {
        fetch: deps.fetch,
        setTimeout: deps.setTimeout,
        clearTimeout: deps.clearTimeout,
        retryDelaysMs,
        maxConcurrent: deps.maxConcurrent ?? 4,
        onLoaded: (cellId, recs) => onChunk(st, cellId, recs),
        onReport: (r) => {
          if (live(st)) post({ type: 'chunks', ...r });
        }
      }),
      byCell: new Map(),
      records: new Map(),
      wanted: new Set()
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

  // --- chunks ---

  /** A chunk is ready: its records, then the current run's geometry, then a slice. */
  function onChunk(st: Session, cellId: string, recs: ParcelRecord[]): void {
    if (!live(st)) return; // a superseded session's loader
    st.chunks.byCell.set(cellId, recs);
    for (const r of recs) st.chunks.records.set(r.id, r);
    st.work?.run.geometry?.onRecords(cellId, recs);
    kick(st);
  }

  /** The viewport's cells, plus the extra cells of the multi-parcel projects anchored there. */
  function prefetch(st: Session, bbox: readonly number[]): void {
    const cells = cellsIntersecting(st.manifest, bbox);
    for (const c of cells) st.chunks.wanted.add(c);
    const all = new Set(cells);
    const g = st.work?.run.geometry;
    if (g) for (const c of g.cellsFor(cells)) all.add(c);
    st.chunks.loader.want(all);
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
      run: newRun(st.rev, st.seed),
      chunks: st.chunks,
      massing: {
        input: loaded.fzp,
        memo,
        gen,
        genForUnits,
        logOnce: (projectId, msg) => logOnce(`massing:${projectId}`, msg)
      },
      pending: false,
      sliceStart: 0,
      cost: {},
      costs: {},
      bandPostDue: false
    };
    kick(st);
  }

  function newRun(rev: Rev, seed: number | null): Run {
    return {
      rev,
      requested: seed,
      seed,
      requestedAt: deps.now(),
      revision: -1,
      shown: null,
      net: null,
      detail: null,
      geometry: null,
      r0: new Map(),
      card: null,
      planEffect: null
    };
  }

  function reroll(req: RerollRequest): void {
    const st = s;
    if (!st || !st.loaded || !st.work) return error(req.rev, 'bad-request', 'not initialised');
    const bad = seedProblem(req.seed);
    if (bad !== null) return error(req.rev, 'bad-request', bad);
    // Replacing the run drops the old seed's geometry and twin work: `nextJob` reads only
    // `w.run`, and a reroll is handled between slices. The band work is the session's.
    st.work.run = newRun(req.rev, req.seed);
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

  /** Records one measured cost of `kind`; its estimate is the largest of the recent ones. */
  function measure(w: Work, kind: JobKind, ms: number): void {
    const recent = (w.costs[kind] ??= []);
    recent.push(ms);
    if (recent.length > COST_WINDOW) recent.shift();
    w.cost[kind] = Math.max(...recent);
  }

  /**
   * One macrotask: jobs in priority order while they fit in `SLICE_PLAN_MS`, judged by the time
   * used so far plus the estimated cost of the next job's kind (a kind not yet measured waits
   * for a fresh slice). The first job always runs, so a job longer than a slice gets one of its
   * own. The shown run (simulate and score) always has a slice to itself: it starts a fresh
   * slice and ends it, so no geometry or band job adds to its macrotask; its geometry set-up
   * (`shownGeometry`) opens the next slice.
   */
  function slice(st: Session, w: Work): void {
    const start = deps.now();
    w.sliceStart = start;
    for (let first = true; ; first = false) {
      if (!live(st)) return;
      const job = nextJob(w);
      if (job === null) return; // idle until a reroll or a chunk kicks again
      if (!first) {
        if (job.kind === 'shown') return kick(st); // the shown run has a slice of its own
        const est = w.cost[job.kind];
        if (est === undefined || deps.now() - start + est > SLICE_PLAN_MS) return kick(st);
      }
      const t0 = deps.now();
      job.run();
      if (job.kind !== 'pack') measure(w, job.kind, deps.now() - t0); // packCells: per cell
      if (job.kind === 'shown') return kick(st);
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
      // the slice after the shown run's: its geometry, then revision 0 if nothing is to pack
      if (run.geometry === null) return { kind: 'geometry', run: () => shownGeometry(w, run) };
      return {
        kind: 'pack',
        run: () => {
          // the cap may have passed since the last settle: then revision 0 goes as it is
          if (revision0Pending(run)) packCells(w, run, run.r0, true);
          settleRevision0(w, run);
        }
      };
    }
    if (run.planEffect === null) return { kind: 'net', run: () => shownTwin(w, run) };
    if (w.bandPostDue) return { kind: 'post', run: () => postBandOnly(w, run) };
    if (run.geometry!.packable().length > 0) {
      return {
        kind: 'pack',
        run: () => {
          const packed = new Map<string, TimedPackedCell>();
          packCells(w, run, packed, false);
          const cells = [...packed.values()];
          const transfer = cells.flatMap(packTimedTransferables);
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
    if (pairs % BAND_POST_EVERY !== 0 && pairs !== w.band.total) return;
    // The run's twin update carries the band itself, and band work never runs ahead of it; were
    // it ever to, the due post is deferred to the next timeline, never dropped.
    if (w.run.revision >= 0 && w.run.planEffect !== null) postBandOnly(w, w.run);
    else w.bandPostDue = true;
  }

  function shownRun(w: Work, run: Run): void {
    if (run.requested === null) run.seed = w.band.representativeSeed();
    const detail = simulateDetailed(w.loaded.fzp, run.seed!, w.horizon);
    run.shown = shownSeries(detail, w.loaded.fzp.asOf, w.horizon, w.months);
    run.net = netOf(run.shown);
    run.detail = detail;
  }

  /**
   * The shown run's geometry, in the slice after the shown run's own (whose macrotask holds only
   * simulate and score): the anchored cells, the extra cells its multi-parcel projects want, and
   * revision 0 at once when no ready cell waits to be packed.
   */
  function shownGeometry(w: Work, run: Run): void {
    const detail = run.detail!;
    run.geometry = createGeometry({
      input: w.loaded.fzp,
      schedules: detail.schedules,
      records: w.chunks.byCell,
      recordOf: (id) => w.chunks.records.get(id),
      massingCtx: w.massing,
      warnOnce: logOnce
    });
    // the viewport was asked for before this run's multi-parcel projects were known
    w.chunks.loader.want(run.geometry.cellsFor(w.chunks.wanted));
    settleRevision0(w, run);
  }

  /** Revision 0 waits for packing while a ready anchored cell is unpacked, for up to the cap. */
  function revision0Pending(run: Run): boolean {
    if (run.geometry!.packable().length === 0) return false;
    return deps.now() - run.requestedAt < REVISION0_CAP_MS;
  }

  /**
   * Packs ready cells into `into` while they fit the slice plan, judged by the estimated cost of
   * one cell; the first cell always packs (the scheduler judged it fits, or the slice is fresh).
   * Revision 0 (`capped`) also stops at the cap.
   */
  function packCells(w: Work, run: Run, into: Map<string, TimedPackedCell>, capped: boolean): void {
    const g = run.geometry!;
    for (let first = true; ; first = false) {
      const cellId = g.packable()[0];
      if (cellId === undefined) return;
      if (!first) {
        if (deps.now() - w.sliceStart + (w.cost.pack ?? Infinity) > SLICE_PLAN_MS) return;
        if (capped && !revision0Pending(run)) return;
      }
      const t0 = deps.now();
      into.set(cellId, g.pack(cellId));
      measure(w, 'pack', deps.now() - t0);
    }
  }

  /** Posts revision 0 once no packing is pending for it (or its cap has passed). */
  function settleRevision0(w: Work, run: Run): void {
    if (revision0Pending(run)) return;
    const cells = [...run.r0.values()];
    run.r0 = new Map();
    const transfer = cells.flatMap(packTimedTransferables);
    postTimeline(w, run, { cells, removedCells: [], demolish: run.geometry!.demolish() }, transfer);
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
    w.bandPostDue = false; // every timeline carries the band so far
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

  // --- parcelSummary (§4.9) ---

  /**
   * The card context of a run with a shown run, built once per run. Its `building` is the
   * run's massing only for a project whose every T11 cell is ready; otherwise it is a footprint
   * entry (card `massing: 'none'`, no `generated`), so a card never describes a partial-lot
   * building the map does not draw, and no partial-lot key enters the memo.
   */
  function cardCtxOf(w: Work, run: Run): CardCtx {
    if (run.card) return run.card;
    const g = run.geometry!;
    const ctx: MassingCtx = { ...w.massing, records: (id) => w.chunks.records.get(id) };
    run.card = {
      asOf: w.loaded.fzp.asOf,
      input: w.loaded.fzp,
      rows: new Map(w.loaded.fzp.projects.map((p) => [p.id, p])),
      masters: new Map(run.detail!.masters.map((m) => [m.masterId, m])),
      qualityRules: new Map(w.loaded.projects.qualityRules.map((q) => [q.id, q])),
      building: (sc, k) => (g.allReady(sc) ? massingFor(sc, k, ctx) : NOT_DRAWN),
      logOnce: (key, msg) => logOnce(`card:${key}`, msg)
    };
    return run.card;
  }

  /**
   * Null when the parcel's record is not loaded (never fetches), and until the scenario files
   * are (T11 holds the assessor units the card labels). The record gives the neighbourhood, land
   * use and eligibility; T11 the assessor units and the FZP envelope; the shown run the project
   * at `day` (§4.9's choice) and its building at that day's revision.
   */
  function parcelSummary(
    req: Extract<ScenarioRequest, { type: 'parcelSummary' }>
  ): ParcelSummary | null {
    const st = s;
    const rec = st?.chunks.records.get(req.parcelId);
    if (!st || !rec || !st.loaded) return null;
    const parcels = st.loaded.fzp.parcels;
    const i = parcels.index.get(req.parcelId);
    const envelope = i === undefined ? null : envelopeOf(parcels, i);
    const out: ParcelSummary = {
      parcelId: req.parcelId,
      neighborhood: rec.neighborhood,
      landUse: rec.landUse,
      eligible: rec.eligible,
      // T11 has no row for a parcel absent from parcels.bin: the chunk record's units are the
      // only value there is (logged as absent when a project names it)
      existingUnits: i === undefined ? rec.existingUnits : parcels.existingUnits[i],
      envelope: envelope && envelope.maxStories > 0 ? envelope : null,
      generated: null
    };
    const w = st.work;
    const run = w?.run;
    if (!w || !run?.geometry) return out; // no shown run yet
    const chosen = chooseProject(run.geometry.schedulesOn(req.parcelId), req.day, req.projectId);
    if (chosen === null) return out;
    const ctx = cardCtxOf(w, run);
    out.project = projectCard(chosen, req.day, ctx);
    if (!(chosen.multiPhase && chosen.phase === null)) {
      const m = ctx.building(chosen, revisionAt(chosen, req.day));
      if (!('footprint' in m))
        out.generated = { typology: m.typology, stories: m.stories, units: m.units };
    }
    return out;
  }

  function dispatch(req: ScenarioRequest): void {
    switch (req.type) {
      case 'initScenario':
        return initScenario(req);
      case 'reroll':
        return reroll(req);
      case 'parcelSummary': {
        let summary: ParcelSummary | null;
        try {
          summary = parcelSummary(req);
        } catch (e) {
          warn(`parcelSummary ${req.parcelId}: ${e instanceof Error ? e.message : String(e)}`);
          summary = null; // the client's promise must still resolve
        }
        return post({ type: 'parcelSummary', reqId: req.reqId, summary });
      }
      case 'prefetch':
        if (s) prefetch(s, req.bbox);
        return;
      case 'retryChunks':
        s?.chunks.loader.retryFailed();
        return;
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
