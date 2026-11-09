// The scenario host (spec §4.1): a separate host behind the same Worker, beside the editor host
// (host.ts, unchanged). It handles `initScenario`, `reroll` and `setLevers`, plus the shared
// `prefetch`, `retryChunks` and `parcelSummary` when the router sends them here. Worker-bundle
// module: zod-free, DOM-free, $app-free.
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
//
// Levers (plan 2 Task 12). An `initScenario` with `levers` (/sim) also loads policy.bin; one
// without (/fzp) takes the path above unchanged. A lever revision (that init, or a `setLevers`)
// is pending until it is `current`: while one is, the scheduler runs only its 'recompute' job,
// ahead of every other job (resolve the envelopes, then compute the touched lots' yields from
// their chunk records as they arrive), so no timeline of the old levers, or of half-resolved new
// ones, is posted. A later `setLevers` replaces the pending revision (latest wins); a reroll
// gives the pending run its rev and seed. At `current` the work takes the plan and twin inputs, a
// fresh band state and a fresh run. The `LayerCtx` and the yield `GrossCache` are the session's.
// With `scenarios.fzp.gross` the session also loads gross.bin, and the recompute is a table lookup
// instead (gross-table Task 5): no `resolving` post and no chunk; the city still builds first.
//
// Brushes (plan 3 Task 5). `resolveBrush` and `brushCatalog` are answered only in a session with
// levers (else `no-session`, catalog null). A request that arrives before the load waits for it;
// one that needs an optional brush file (transit.json, neighborhoods.geojson) waits
// for that file, fetched once per session on the first request needing it. Every waiting request
// is answered `no-session` when its session ends (a new init, a failed load, dispose). The
// `LotIndex` is built once per session on the base parcels; the resolver memoises on object
// identity, so the session's own decoded objects are passed every time. /fzp never fetches them.
//
// Height limits (height-lids Task 8). Each lever revision's resolve step starts a staged city
// build (`city.ts`) on its effective stories; its steps run next (job kind 'heights'), ahead of
// the recompute, and the finished city is posted as `heights` (before the revision's `current`)
// and kept as the session's `limits`. A `heightLids { bbox }` waits for limits, then runs a
// staged lid build (`lids.ts`) on the loaded lots in the view, ahead of every job but a pending
// revision's resolve and city steps. A new `heightLids` answers an older waiting or running one
// `superseded`; a new city restarts a running lid build on its limits, so an answer never mixes
// revisions. A session end answers a waiting request `no-session`.
import type { GrossTable } from '$lib/data/gross-table';
import type { Manifest } from '$lib/data/manifest';
import type { PolicyParcels } from '$lib/data/policy-codec';
import { envelopeOf, scenarioRecordOf, type ScenarioParcels } from '$lib/data/scenario-codec';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import {
  fnv1a32,
  generate,
  generateForUnits,
  lotBuildableStories,
  type GeneratedBuilding
} from '$lib/generator';
import { packCell, packTransferables } from '$lib/map/pack';
import {
  createCityBuild,
  type CityModel,
  type CityResult,
  type StagedBuild
} from '$lib/map/height/city';
import {
  LID_PAD_M,
  LidTooLarge,
  createLidBuild,
  type LidBuild,
  type LidLot
} from '$lib/map/height/lids';
import { countableMask } from '$lib/map/height/room';
import type { HeightCity, HeightLids, LabelSet } from '$lib/map/height/types';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { packTimedTransferables } from '$lib/map/pack-timed';
import type { TimedPackedCell, TimelineUpdate } from '$lib/map/types';
import { decodeTransit } from '$lib/data/transit-codec';
import type { TransitNetwork } from '$lib/data/transit';
import type { Day } from '$lib/timelapse/time';
import { cellsIntersecting, createChunkLoader, type ChunkLoader, type FetchLike } from '../chunks';
import { packOutlines } from '../outlines';
import { toLngLat } from '$lib/generator/geo';
import { DEFAULT_RETRY_DELAYS_MS } from '../host';
import { createLru } from '../lru';
import { checkManifestShape } from '../manifest-shape';
import type { ParcelSummary, Rev } from '../protocol';
import { applyLevers } from '../levers/apply';
import {
  BrushDataMissing,
  brushCatalog,
  createLotIndex,
  parseNeighborhoods,
  resolveBrushRows,
  type BrushData,
  type BrushQuery,
  type LotIndex,
  type NeighborhoodShapes
} from '../levers/brushes';
import type { LayerCtx } from '../levers/layers';
import { limitSources, ownerOf, type LimitOwner, type LimitSources } from '../levers/source';
import {
  createTableRecompute,
  createYieldRecompute,
  type GrossCache,
  type YieldRecompute
} from '../levers/recompute';
import { allNeeds, fillNeeds, resolveEnvelopes, type Resolution } from '../levers/resolve';
import { parseSimLevers, type SimLevers } from '../levers/types';
import { chooseProject, projectCard, revisionAt, type CardCtx } from './card';
import { createGeometry, type Geometry } from './geometry';
import { lotAtPoint } from './lot-at';
import { massingFor, simKey, type MassingCtx } from './massing';
import {
  brushQueryProblem,
  datasetUrl,
  fetchWithRetry,
  leversProblem,
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
import { PREVIEW_MAX_LOTS } from './preview';
import type {
  BrushLotsResult,
  HeightLidsResult,
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
  /** The most lots one `previewBuildings` builds (default `PREVIEW_MAX_LOTS`). */
  previewMaxLots?: number;
  warn?(msg: string): void; // default console.warn
  /** Test seam: the parcels.bin decoder (default `readScenarioParcels`), so a harness can tell
   *  when the one host-external async step (the inflate) has settled. */
  decodeParcels?(bytes: Uint8Array): Promise<ScenarioParcels>;
  /** Test seam: the policy.bin decoder (default `readPolicyParcels`), its inflate likewise. */
  decodePolicy?(bytes: Uint8Array, parcels: ScenarioParcels): Promise<PolicyParcels>;
  /** Test seam: the gross.bin decoder (default `readGrossTable`), its inflate likewise. */
  decodeGross?(bytes: Uint8Array): Promise<GrossTable>;
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

export function createToken(deps: Pick<ScenarioHostDeps, 'setTimeout' | 'clearTimeout'>): Token {
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
  /** The failed cells of the loader's latest report. */
  failed: string[];
}

/** A lever revision not yet in force. */
interface PendingLevers {
  rev: Rev; // the initScenario or setLevers that named the levers
  levers: SimLevers;
  runRev: Rev; // the run it starts: `rev`, or a later reroll's
  seed: number | null; // that run's requested seed
  /** Set by the first 'recompute' job. */
  state: {
    resolution: Resolution;
    recompute: YieldRecompute;
    cells: Set<string>; // cells of the needs not loaded at the start
  } | null;
  failed: string[]; // the needed cells that failed to load, as last posted
  stalled: boolean; // every remaining need waits on a chunk: idle until one arrives
}

/** A lever session's state, beside its `Work`. */
interface LeverWork {
  base: Loaded; // as loaded: `base.fzp` is the input every lever revision compiles against
  ctx: LayerCtx; // one per session: the after-switch table and the twin memo key on it
  gross: GrossCache; // one per session: kept across lever revisions
  /** The session's gross table (`scenarios.fzp.gross`): lever revisions look yields up in it
   *  instead of recomputing them from chunks. Null on the fallback (no table in the manifest). */
  table: GrossTable | null;
  pending: PendingLevers | null;
  /** 1 on the rows protected under the levers in force (set at `current`); null before. */
  protectedMask: Uint8Array | null;
  /** The latest complete city: its rev, the per-lot stories and sources it was built on, its model. */
  limits: { rev: Rev; stories: Uint8Array; sources: LimitSources; model: CityModel } | null;
  /** The city build of the latest resolved revision, until done. */
  city: {
    rev: Rev;
    build: StagedBuild<CityResult>;
    stories: Uint8Array;
    sources: LimitSources;
  } | null;
  /** The running lid build of `Session.lidWant`, on `limits` at `limitsRev`. */
  lid: { reqId: number; limitsRev: Rev; build: LidBuild; missing: number } | null;
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
  /** The current levers' references; undefined = `REFERENCES` (/fzp). */
  references: TimelineScore['references'] | undefined;
  /** Null for /fzp. */
  levers: LeverWork | null;
}

/** The optional brush files and what each decodes to. */
interface BrushFiles {
  transit: TransitNetwork;
  neighborhoods: NeighborhoodShapes;
}
type BrushFile = keyof BrushFiles;
const BRUSH_FILES: readonly BrushFile[] = ['transit', 'neighborhoods'];

/** One brush request not yet answered: it waits on the load, or on a brush file. */
interface BrushWaiter {
  reqId: number;
  query: BrushQuery | null; // null for `brushCatalog`
}

/** A lever session's brush state. */
interface BrushSession {
  waiting: Set<BrushWaiter>;
  index: LotIndex | null; // built on the first request after load
  /** Each file's fetch and decode, started on the first request needing it; null = unavailable. */
  files: { [K in BrushFile]?: Promise<BrushFiles[K] | null> };
}

type JobKind = 'recompute' | 'heights' | 'net' | 'shown' | 'geometry' | 'pack' | 'post';
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
  /** The latest lever document and the rev that named it; null for /fzp (no levers). */
  levers: { rev: Rev; levers: SimLevers } | null;
  /** Null for /fzp: brush requests are answered `no-session`. */
  brush: BrushSession | null;
  /** The latest `heightLids` not yet answered (lever sessions only). */
  lidWant: { reqId: number; bbox: [number, number, number, number] } | null;
}

type InitRequest = Extract<ScenarioRequest, { type: 'initScenario' }>;
type RerollRequest = Extract<ScenarioRequest, { type: 'reroll' }>;
type SetLeversRequest = Extract<ScenarioRequest, { type: 'setLevers' }>;

const NO_LEVERS_SESSION = 'setLevers needs a session initialised with levers';

/** Each distinct buffer of `arrays`, once (a transfer list may not name one twice). */
function buffersOf(arrays: readonly ArrayBufferView[]): ArrayBuffer[] {
  return [...new Set(arrays.map((a) => a.buffer as ArrayBuffer))];
}

const labelOwners = (l: LabelSet): ArrayBufferView[] =>
  l.owners && l.ownerStarts ? [l.owners, l.ownerStarts] : [];

function cityTransfer(c: HeightCity): ArrayBuffer[] {
  return buffersOf([
    ...Object.values(c.chains),
    c.labels.position,
    c.labels.minZoom,
    ...labelOwners(c.labels)
  ]);
}

function lidsTransfer(l: HeightLids): ArrayBuffer[] {
  const w = l.walls;
  return buffersOf([
    ...Object.values(l.pieces),
    ...l.faces.flatMap((f) => f.rings),
    ...Object.values(l.rims),
    w.a,
    w.b,
    w.zLo,
    w.zHi,
    w.piece,
    l.labels.position,
    l.labels.minZoom,
    ...labelOwners(l.labels),
    l.paintLabels.position,
    l.paintLabels.minZoom,
    ...labelOwners(l.paintLabels)
  ]);
}

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
    const st = s;
    s?.token.cancel();
    s?.chunks.loader.dispose();
    s = null;
    // every request still waiting on this session is answered now: it will never be otherwise
    if (st?.brush) {
      const waiting = [...st.brush.waiting];
      st.brush.waiting.clear();
      for (const w of waiting) noSession(w.reqId, w.query === null);
    }
    const want = st?.lidWant;
    if (want) {
      st!.lidWant = null;
      lidsNoSession(want.reqId);
    }
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
      work: null,
      // validateInitRequest has accepted it; parsing gives a fresh copy the host owns
      levers:
        req.levers === undefined ? null : { rev: req.rev, levers: parseSimLevers(req.levers) },
      brush: req.levers === undefined ? null : { waiting: new Set(), index: null, files: {} },
      lidWant: null
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
          if (!live(st)) return;
          post({ type: 'chunks', ...r });
          onFailed(st, r.failed);
        }
      }),
      byCell: new Map(),
      records: new Map(),
      wanted: new Set(),
      failed: []
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
    const p = st.work?.levers?.pending;
    if (p?.state?.cells.has(cellId)) p.stalled = false;
    kick(st);
  }

  /**
   * The loader's failed cells: a pending lever revision on the fallback (no gross table) re-posts
   * `resolving` when they change.
   */
  function onFailed(st: Session, failed: string[]): void {
    st.chunks.failed = failed;
    const lw = st.work?.levers;
    const p = lw?.pending;
    // the table path waits on no chunk, so a failed cell never holds its revision
    if (!p?.state || p.state.recompute.total === 0 || lw!.table) return;
    const cells = p.state.cells;
    const mine = failed.filter((c) => cells.has(c));
    if (mine.length === p.failed.length && mine.every((c, k) => c === p.failed[k])) return;
    p.failed = mine;
    postResolving(p);
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
        decodeParcels: deps.decodeParcels,
        decodePolicy: deps.decodePolicy,
        decodeGross: deps.decodeGross
      },
      st.urls,
      () => !live(st),
      st.levers ? { policy: true } : undefined
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
      bandPostDue: false,
      references: undefined,
      levers: null
    };
    if (st.levers) {
      // The run above never runs: the lever revision's own run replaces it at `current`.
      st.work.levers = {
        base: loaded,
        ctx: { parcels: loaded.fzp.parcels, policy: loaded.policy! },
        gross: new Map(),
        table: loaded.gross,
        pending: pendingOf(st.levers.rev, st.levers.levers, st.seed),
        protectedMask: null,
        limits: null,
        city: null,
        lid: null
      };
    }
    // the brush requests that waited for the load
    if (st.brush) for (const w of [...st.brush.waiting]) startBrush(st, w);
    kick(st);
  }

  function pendingOf(rev: Rev, levers: SimLevers, seed: number | null): PendingLevers {
    return { rev, levers, runRev: rev, seed, state: null, failed: [], stalled: false };
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
    const p = st.work.levers?.pending;
    if (p) {
      // the run that starts once the pending levers are current is this reroll's
      p.runRev = req.rev;
      p.seed = req.seed;
      return;
    }
    // Replacing the run drops the old seed's geometry and twin work: `nextJob` reads only
    // `w.run`, and a reroll is handled between slices. The band work is the session's.
    st.work.run = newRun(req.rev, req.seed);
    kick(st);
  }

  /**
   * A new lever revision replaces any pending one (latest wins), and the current run's jobs stop
   * until it is current. Before loading has finished, the latest levers are the ones it starts.
   */
  function setLevers(req: SetLeversRequest): void {
    const st = s;
    if (!st || !st.levers) return error(req.rev, 'bad-request', NO_LEVERS_SESSION);
    const bad = leversProblem(req.levers);
    if (bad !== null) return error(req.rev, 'bad-request', bad);
    const levers = parseSimLevers(req.levers); // a fresh copy the host owns
    st.levers = { rev: req.rev, levers };
    const w = st.work;
    if (!w) return;
    const lw = w.levers!;
    lw.pending = pendingOf(req.rev, levers, lw.pending ? lw.pending.seed : w.run.requested);
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
        const rev = w.levers?.pending?.runRev ?? w.run.rev;
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
      const job = nextJob(st, w);
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

  function nextJob(st: Session, w: Work): Job | null {
    // A pending lever revision's resolve step, then its city, then a wanted lid view on the
    // newest limits, then its recompute: the timeline jobs wait until it is current.
    const lw = w.levers;
    if (lw) {
      const p = lw.pending;
      if (p && p.state === null) return { kind: 'recompute', run: () => leverStep(w, lw, p) };
      const c = lw.city;
      if (c) return { kind: 'heights', run: () => cityStep(w, lw, c) };
      if (st.lidWant && lw.limits) return { kind: 'heights', run: () => lidStep(st, w, lw) };
      if (p) return p.stalled ? null : { kind: 'recompute', run: () => leverStep(w, lw, p) };
    }
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

  /**
   * One step of the pending lever revision: first resolve its envelopes, then compute its Needs in
   * what is left of the slice, then, once all are done, put the levers in force and post `current`.
   * With the session's gross table the Needs are table lookups: no `resolving` post, no chunk.
   * Without it (the fallback) the resolve step posts `resolving` and wants the needed chunks when
   * it has Needs, and each step computes the ready ones from their records.
   */
  function leverStep(w: Work, lw: LeverWork, p: PendingLevers): void {
    if (p.state === null) {
      const base = lw.base.fzp;
      const resolution = resolveEnvelopes(lw.ctx, p.levers, base.asOf);
      const needs = allNeeds(resolution);
      const now = () => deps.now();
      const recompute = lw.table
        ? createTableRecompute(base.parcels, needs, lw.table, { now })
        : createYieldRecompute(
            base.parcels,
            needs,
            {
              record: (id) => w.chunks.records.get(id),
              cellLoaded: (cellId) => w.chunks.byCell.has(cellId),
              now
            },
            lw.gross
          );
      const cells = new Set(recompute.cellsNeeded()); // once per revision; always empty on a table
      p.state = { resolution, recompute, cells };
      // The city goes out before the recompute: a revision waiting on chunks (or held by a
      // failed one) still shows its heights as you paint. Its stories are final once resolved.
      lw.city = cityOf(lw, p.rev, p.levers, resolution);
      if (recompute.total === 0 || lw.table) return; // the table finishes in the next job
      p.failed = w.chunks.failed.filter((c) => cells.has(c));
      postResolving(p);
      w.chunks.loader.want(cells);
      return;
    }
    const r = p.state.recompute;
    const before = r.done;
    if (!r.step(Math.max(0, SLICE_PLAN_MS - (deps.now() - w.sliceStart)))) {
      // a step computes at least one ready need, so no progress means all wait on chunks
      if (r.done === before) p.stalled = true;
      else if (!lw.table) postResolving(p);
      return;
    }
    for (const id of r.missing)
      logOnce(
        `lever-missing:${id}`,
        `lever recompute: no record for lot ${id} in its loaded cell; its yield is 0`
      );
    const filled = fillNeeds(p.state.resolution, r.result());
    const li = applyLevers(lw.base.fzp, lw.ctx, p.levers, filled);
    lw.pending = null;
    const mask = new Uint8Array(lw.base.fzp.parcels.count);
    for (const row of filled.protectedRows) mask[row] = 1;
    lw.protectedMask = mask;
    post({
      type: 'levers',
      rev: p.rev,
      phase: 'current',
      lookups: li.lookups,
      capacity: li.capacity,
      unknownLots: li.unknownLots
    });
    w.loaded = { ...lw.base, fzp: li.plan, twin: li.twin };
    w.references = li.references;
    w.band = createBandState(deps.bandRuns ?? BAND_RUNS);
    w.fzpNew = [];
    w.bandPostDue = false;
    w.massing = { ...w.massing, input: li.plan };
    w.run = newRun(p.runRev, p.seed);
  }

  function postResolving(p: PendingLevers): void {
    const r = p.state!.recompute;
    post({
      type: 'levers',
      rev: p.rev,
      phase: 'resolving',
      done: r.done,
      total: r.total,
      failedCells: [...p.failed]
    });
  }

  // --- height limits (height-lids Task 8) ---

  /** What is left of the slice plan (a staged build always runs at least one unit). */
  const sliceLeft = (w: Work) => Math.max(0, SLICE_PLAN_MS - (deps.now() - w.sliceStart));
  const clock = () => deps.now();

  /**
   * A resolved revision's city build: its effective stories (a protected lot at FZP), the
   * winning source per lot, and which lots count toward room to grow.
   */
  function cityOf(
    lw: LeverWork,
    rev: Rev,
    levers: SimLevers,
    r: Resolution
  ): NonNullable<LeverWork['city']> {
    const parcels = lw.base.fzp.parcels;
    const plan = r.plan;
    const stories = plan.table.stories;
    const sources = limitSources(lw.ctx, levers, r.protectedRows);
    const build = createCityBuild({
      rev,
      labelPoint: parcels.labelPoint,
      lotAreaM2: parcels.lotAreaM2,
      existingStories: parcels.existingStories,
      stories,
      countable: countableMask(plan.table, parcels.eligible, plan.needs, r.protectedRows),
      sources
    });
    return { rev, build, stories, sources };
  }

  /** One slice of the city build; once done, `heights` goes out and the city becomes `limits`. */
  function cityStep(w: Work, lw: LeverWork, c: NonNullable<LeverWork['city']>): void {
    if (!c.build.step(sliceLeft(w), clock)) return;
    const { city, model } = c.build.result();
    lw.city = null;
    lw.limits = { rev: c.rev, stories: c.stories, sources: c.sources, model };
    // a lid build on older limits starts again on these
    if (lw.lid && lw.lid.limitsRev !== c.rev) lw.lid = null;
    post({ type: 'heights', rev: c.rev, city }, cityTransfer(city));
  }

  /**
   * One slice of the wanted lid view. With none running, the job starts one on the current limits
   * (gathers its lots, allocates its raster) and ends: its units run from the next slice.
   */
  function lidStep(st: Session, w: Work, lw: LeverWork): void {
    const want = st.lidWant!;
    const limits = lw.limits!;
    const lid = lw.lid;
    if (lid === null) {
      const { lots, missing } = lidLots(st, lw, want.bbox);
      let build: LidBuild;
      try {
        build = createLidBuild({
          limitsRev: limits.rev,
          sourceIds: limits.sources.ruleIds,
          bbox: want.bbox,
          lots,
          stories: limits.stories,
          sources: limits.sources.source,
          model: limits.model
        });
      } catch (e) {
        if (!(e instanceof LidTooLarge)) throw e;
        st.lidWant = null;
        return postLids(want.reqId, { ok: false, reason: 'too-large', message: e.message });
      }
      lw.lid = { reqId: want.reqId, limitsRev: limits.rev, build, missing };
      // gathering the lots and allocating the raster take a job of their own: the build's first
      // unit waits for the next slice, so this macrotask stays within the slice
      return;
    }
    if (!lid.build.step(sliceLeft(w), clock)) return;
    const lids = lid.build.result();
    lw.lid = null;
    st.lidWant = null;
    postLids(lid.reqId, { ok: true, lids, missing: lid.missing }, lidsTransfer(lids));
  }

  /**
   * The lid lots of a view: the loaded records of the cells around the bbox padded by
   * `LID_PAD_M` whose label point lies in it, as rows of the limits tables. `missing` counts the
   * cells intersecting the bbox itself that are not loaded.
   */
  function lidLots(
    st: Session,
    lw: LeverWork,
    bbox: readonly number[]
  ): { lots: LidLot[]; missing: number } {
    const dLng = LID_PAD_M / M_PER_DEG_LNG;
    const dLat = LID_PAD_M / M_PER_DEG_LAT;
    const [w0, s0, e0, n0] = [bbox[0] - dLng, bbox[1] - dLat, bbox[2] + dLng, bbox[3] + dLat];
    const index = lw.base.fzp.parcels.index;
    const byCell = st.chunks.byCell;
    const lots: LidLot[] = [];
    for (const cellId of cellsIntersecting(st.manifest, [w0, s0, e0, n0])) {
      for (const rec of byCell.get(cellId) ?? []) {
        const [lng, lat] = rec.labelPoint;
        if (lng < w0 || lng > e0 || lat < s0 || lat > n0) continue;
        const row = index.get(rec.id);
        if (row === undefined) continue;
        lots.push({ row, rings: rec.polygon.map((ring) => toLngLat(ring, rec.labelPoint)) });
      }
    }
    const missing = cellsIntersecting(st.manifest, bbox).filter((c) => !byCell.has(c)).length;
    return { lots, missing };
  }

  function postLids(reqId: number, result: HeightLidsResult, transfer: ArrayBuffer[] = []): void {
    post({ type: 'heightLids', reqId, result }, transfer);
  }

  function lidsNoSession(reqId: number): void {
    const message = 'height lids need a loaded session initialised with levers';
    postLids(reqId, { ok: false, reason: 'no-session', message });
  }

  /** A `heightLids`: answers the one it replaces `superseded`, then waits for its turn. */
  function heightLids(reqId: number, bbox: [number, number, number, number]): void {
    const st = s;
    if (!st?.levers) return lidsNoSession(reqId);
    const prev = st.lidWant;
    if (prev) {
      const message = 'a newer heightLids replaced this one';
      postLids(prev.reqId, { ok: false, reason: 'superseded', message });
    }
    st.lidWant = { reqId, bbox: [bbox[0], bbox[1], bbox[2], bbox[3]] };
    if (st.work?.levers) st.work.levers.lid = null;
    kick(st);
  }

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
      phasing: w.phasing,
      ...(w.references ? { references: w.references } : {})
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
    // the shown levers' envelopes under /sim; for /fzp `work.loaded` is `st.loaded`
    const parcels = (st.work?.loaded ?? st.loaded).fzp.parcels;
    const i = parcels.index.get(req.parcelId);
    const envelope = i === undefined ? null : envelopeOf(parcels, i);
    const out: ParcelSummary = {
      parcelId: req.parcelId,
      neighborhood: rec.neighborhood,
      landUse: rec.landUse,
      eligible: rec.eligible,
      ...(rec.underwater ? { underwater: true as const } : {}),
      // T11 has no row for a parcel absent from parcels.bin: the chunk record's units are the
      // only value there is (logged as absent when a project names it)
      existingUnits: i === undefined ? rec.existingUnits : parcels.existingUnits[i],
      envelope: envelope && envelope.maxStories > 0 ? envelope : null,
      generated: null
    };
    // The lot-limits line (map overlays plan 2 Task 7): `/sim` only (a lever session), for an
    // eligible lot with plan stories. `allowed` is `envelope.maxStories`; the FZP stories for a
    // protected lot (protection beats every rule and stroke).
    const lw = st.work?.levers;
    if (lw && i !== undefined && rec.eligible && out.envelope) {
      const allowed = out.envelope.maxStories;
      // the layer that sets `allowed`, from the limits held now; a protected lot reads FZP
      const owner = lw.limits ? limitOwnerAt(lw.limits.sources, i) : null;
      const ownerField = owner ? { owner } : {};
      if (lw.protectedMask?.[i]) {
        out.limits = {
          allowed,
          buildable: null,
          protected: true,
          ...(lw.limits ? { owner: { kind: 'fzp' as const } } : {})
        };
      } else {
        const key = simKey(req.parcelId, allowed);
        let b = memo.get(key);
        if (b === undefined) {
          const plan = (st.work?.loaded ?? st.loaded).fzp.parcels;
          b = gen(
            scenarioRecordOf(plan, i, rec),
            { maxStories: allowed },
            fnv1a32(req.parcelId),
            'max'
          );
          memo.set(key, b);
        }
        out.limits = {
          allowed,
          buildable: b ? b.stories : lotBuildableStories(rec.polygon, allowed, out.existingUnits),
          protected: false,
          ...ownerField
        };
      }
    }
    const w = st.work;
    const run = w?.run;
    if (!w || !run?.geometry) return out; // no shown run yet
    const chosen = chooseProject(run.geometry.schedulesOn(req.parcelId), req.day, req.projectId);
    if (chosen === null) return out;
    const ctx = cardCtxOf(w, run);
    out.project = projectCard(chosen, req.day, ctx);
    // A master without phases is massed like any project (large-site massing §4.7); only a
    // footprint fallback (a null or throwing generator) has no building to describe.
    const m = ctx.building(chosen, revisionAt(chosen, req.day));
    if (!('footprint' in m))
      out.generated = { typology: m.typology, stories: m.stories, units: m.units };
    return out;
  }

  /** The owner of limits row `row`, or null for a row the limits table does not cover. */
  function limitOwnerAt(sources: LimitSources, row: number): LimitOwner | null {
    return row < sources.source.length ? ownerOf(sources, row) : null;
  }

  // --- lotAt (sim UX plan 4 Task 3) ---

  /**
   * The lot under `point` (lng, lat) among the loaded records of the cells within `LID_PAD_M`
   * (a lot may reach past its cell), and who sets its limit on the limits the worker holds now.
   * Answered at once: it never waits on a pending lever revision.
   */
  function lotAt(reqId: number, point: [number, number]): void {
    const st = s;
    if (!st?.brush || !st.work?.levers) {
      const message = 'lot lookup needs a session initialised with levers';
      return post({ type: 'lotAt', reqId, result: { ok: false, reason: 'no-session', message } });
    }
    const lw = st.work.levers;
    const dLng = LID_PAD_M / M_PER_DEG_LNG;
    const dLat = LID_PAD_M / M_PER_DEG_LAT;
    const box = [point[0] - dLng, point[1] - dLat, point[0] + dLng, point[1] + dLat];
    const near: ParcelRecord[] = [];
    for (const cellId of cellsIntersecting(st.manifest, box))
      for (const rec of st.chunks.byCell.get(cellId) ?? []) near.push(rec);
    const rec = lotAtPoint(near, point, (r) =>
      r.polygon.map((ring) => toLngLat(ring, r.labelPoint))
    );
    const row = rec ? lw.base.fzp.parcels.index.get(rec.id) : undefined;
    const owner =
      rec && row !== undefined && lw.limits ? limitOwnerAt(lw.limits.sources, row) : null;
    post({ type: 'lotAt', reqId, result: { ok: true, parcelId: rec ? rec.id : null, owner } });
  }

  // --- brushes (plan 3 Task 5) ---

  function noSession(reqId: number, isCatalog: boolean): void {
    if (isCatalog) return post({ type: 'brushCatalog', reqId, catalog: null });
    const message = 'brushes need a loaded session initialised with levers';
    post({ type: 'brushLots', reqId, result: { ok: false, reason: 'no-session', message } });
  }

  /** A brush request: answered at once without a lever session or for a bad query, else waits. */
  function brushRequest(reqId: number, isCatalog: boolean, query?: unknown): void {
    const st = s;
    if (!st?.brush) return noSession(reqId, isCatalog);
    if (!isCatalog) {
      const bad = brushQueryProblem(query);
      if (bad !== null) {
        return post({
          type: 'brushLots',
          reqId,
          result: { ok: false, reason: 'bad-request', message: bad }
        });
      }
    }
    const w: BrushWaiter = { reqId, query: isCatalog ? null : (query as BrushQuery) };
    st.brush.waiting.add(w);
    if (st.loaded) startBrush(st, w);
  }

  /**
   * The ring outlines of the requested lots whose records are loaded (map overlays plan Task 5).
   * Answered at once: a lot not loaded yet counts as `missing`, and the page asks again on a chunk.
   */
  function lotOutlines(reqId: number, lots: readonly ParcelId[]): void {
    const st = s;
    if (!st?.brush) {
      const message = 'outlines need a session initialised with levers';
      return post({
        type: 'lotOutlines',
        reqId,
        result: { ok: false, reason: 'no-session', message }
      });
    }
    const found: ParcelRecord[] = [];
    let missing = 0;
    for (const id of lots) {
      const rec = st.chunks.records.get(id);
      if (rec) found.push(rec);
      else missing++;
    }
    const { outlines, transfer } = packOutlines(found);
    post({ type: 'lotOutlines', reqId, result: { ok: true, ...outlines, missing } }, transfer);
  }

  /**
   * The buildings the first `previewMaxLots` requested lots could hold (/sim's live preview, map
   * overlays plan Task 6), packed as one cell. Per lot, in order: a lot protected under the
   * levers in force builds nothing; one whose record is not loaded is `missing`; any other builds
   * at the stroke's `stories` (the generator clamps at the lot's physical max). The generator memo
   * is shared with the timeline's simulated buildings (`simKey`: the same generate call), so a lot
   * the timeline later builds at that height costs nothing twice. Answered at once, in one
   * handler: the cap keeps it within a slice (measured in the spec).
   */
  function previewBuildings(reqId: number, lots: readonly ParcelId[], stories: number): void {
    const st = s;
    const w = st?.work;
    const lw = w?.levers;
    if (!st?.brush || !w || !lw) {
      const message = 'previews need a loaded session initialised with levers';
      return post({
        type: 'previewBuildings',
        reqId,
        result: { ok: false, reason: 'no-session', message }
      });
    }
    const plan = w.loaded.fzp.parcels;
    const mask = lw.protectedMask;
    const items: { building: GeneratedBuilding; existingUnits: number }[] = [];
    const seen = new Set<ParcelId>();
    let missing = 0;
    for (const id of lots.slice(0, deps.previewMaxLots ?? PREVIEW_MAX_LOTS)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const i = plan.index.get(id);
      if (i === undefined) continue; // not in the scenario: nothing can be built there
      if (mask?.[i]) continue;
      const rec = w.chunks.records.get(id);
      if (!rec) {
        missing++;
        continue;
      }
      if (stories <= 0) continue;
      const key = simKey(id, stories);
      let b = memo.get(key);
      if (b === undefined) {
        b = gen(scenarioRecordOf(plan, i, rec), { maxStories: stories }, fnv1a32(id), 'max');
        memo.set(key, b);
      }
      if (b) items.push({ building: b, existingUnits: plan.existingUnits[i] });
    }
    const pack = items.length > 0 ? packCell('preview', items) : null;
    post(
      { type: 'previewBuildings', reqId, result: { ok: true, pack, built: items.length, missing } },
      pack ? packTransferables(pack) : []
    );
  }

  /** The files a request needs: every one for the catalog, else the query kind's. */
  function filesFor(q: BrushQuery | null): readonly BrushFile[] {
    if (q === null) return BRUSH_FILES;
    switch (q.kind) {
      case 'freehand':
        return [];
      case 'transit':
        return ['transit'];
      case 'area':
        return q.neighborhoods.length > 0 ? ['neighborhoods'] : [];
      default:
        throw new Error(`Unhandled brush: ${JSON.stringify(q satisfies never)}`);
    }
  }

  /** Once the session has loaded: answers now, or once the files it needs have settled. */
  function startBrush(st: Session, w: BrushWaiter): void {
    const need = filesFor(w.query);
    if (need.length === 0) return answerBrush(st, w, {});
    void Promise.all(need.map((f) => brushFile(st, f))).then((got) => {
      const files: Partial<BrushFiles> = {};
      need.forEach((f, k) => {
        if (got[k] !== null) (files as Record<string, unknown>)[f] = got[k];
      });
      answerBrush(st, w, files);
    });
  }

  function answerBrush(st: Session, w: BrushWaiter, files: Partial<BrushFiles>): void {
    const b = st.brush!;
    if (!live(st) || !b.waiting.delete(w)) return; // answered no-session when the session ended
    const loaded = st.loaded!;
    const data: BrushData = {
      parcels: loaded.fzp.parcels, // as loaded: `work.loaded` is replaced per lever revision
      policy: loaded.policy!,
      transit: files.transit ?? null,
      neighborhoods: files.neighborhoods ?? null
    };
    if (w.query === null) {
      let catalog = null;
      try {
        catalog = brushCatalog(data);
      } catch (e) {
        warn(`brushCatalog: ${e instanceof Error ? e.message : String(e)}`);
      }
      return post({ type: 'brushCatalog', reqId: w.reqId, catalog });
    }
    let result: BrushLotsResult;
    try {
      b.index ??= createLotIndex(data.parcels);
      const rows = resolveBrushRows(data, b.index, w.query);
      const lp = data.parcels.labelPoint;
      const points = new Float64Array(2 * rows.length);
      rows.forEach((r, k) => {
        points[2 * k] = lp[2 * r];
        points[2 * k + 1] = lp[2 * r + 1];
      });
      result = { ok: true, lots: rows.map((r) => data.parcels.id[r]), points };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (e instanceof BrushDataMissing) result = { ok: false, reason: 'data-missing', message };
      else {
        // the client's promise must still resolve
        warn(`resolveBrush: ${message}`);
        result = { ok: false, reason: 'bad-request', message };
      }
    }
    // `points` is a fresh Float64Array, so its buffer is an ArrayBuffer
    const transfer = result.ok ? [result.points.buffer as ArrayBuffer] : [];
    post({ type: 'brushLots', reqId: w.reqId, result }, transfer);
  }

  /**
   * One brush file per session, fetched and decoded on first use. Null when the manifest names
   * no usable URL, the server answers 4xx, the fetch fails or the file is bad (each logged). Only
   * a transient failure (network, 5xx or body read, after the retries) is not cached, so the next
   * request needing the file fetches it again. A session that ends during a retry delay never
   * settles its promise; its waiters were answered by `end()`, and its cache goes with it.
   */
  function brushFile<K extends BrushFile>(st: Session, file: K): Promise<BrushFiles[K] | null> {
    const memo = st.brush!.files as Record<BrushFile, Promise<unknown> | undefined>;
    const hit = memo[file];
    if (hit) return hit as Promise<BrushFiles[K] | null>;
    const p: Promise<unknown> = fetchBrushFile(st, file).then((r) => {
      if (r.transient && memo[file] === p) delete memo[file];
      return r.value;
    });
    memo[file] = p;
    return p as Promise<BrushFiles[K] | null>;
  }

  /** A 4xx on an optional brush file is permanent (absent from this version); 5xx retries. */
  const brushPermanent = (status: number) => status >= 400 && status < 500;

  async function fetchBrushFile(
    st: Session,
    file: BrushFile
  ): Promise<{ value: unknown; transient: boolean }> {
    const done = (value: unknown, transient = false) => ({ value, transient });
    const m = st.manifest;
    const url = datasetUrl(m, file === 'transit' ? m.transit : m.neighborhoods);
    if (url === null) {
      warn(`brushes: dataset ${st.version} has no ${file} file`);
      return done(null);
    }
    const loadDeps = {
      setTimeout: (fn: () => void, ms: number) => st.token.later(fn, ms),
      retryDelaysMs
    };
    const stop = () => !live(st);
    const r = await fetchWithRetry(
      url,
      () => deps.fetch(url).then((x) => ({ ok: x.ok, status: x.status, read: () => x.json() })),
      loadDeps,
      stop,
      brushPermanent
    );
    if (r.kind === 'stopped') return done(null);
    if (r.kind === 'failed') {
      warn(`brushes: ${r.message}`);
      return done(null, !r.permanent);
    }
    try {
      if (file === 'transit') return done(decodeTransit(r.value));
      return done(parseNeighborhoods(r.value));
    } catch (e) {
      warn(`brushes: ${file} is invalid: ${e instanceof Error ? e.message : String(e)}`);
      return done(null); // a bad file is permanent for this dataset version
    }
  }

  function dispatch(req: ScenarioRequest): void {
    switch (req.type) {
      case 'initScenario':
        return initScenario(req);
      case 'reroll':
        return reroll(req);
      case 'setLevers':
        return setLevers(req);
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
      case 'resolveBrush':
        return brushRequest(req.reqId, false, req.query);
      case 'brushCatalog':
        return brushRequest(req.reqId, true);
      case 'lotOutlines':
        return lotOutlines(req.reqId, req.lots);
      case 'lotAt':
        return lotAt(req.reqId, req.point);
      case 'previewBuildings':
        return previewBuildings(req.reqId, req.lots, req.stories);
      case 'heightLids':
        return heightLids(req.reqId, req.bbox);
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
