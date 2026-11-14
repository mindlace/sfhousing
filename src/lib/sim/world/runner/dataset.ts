// The timeline host's loaded dataset (ensemble-runner Task 3): the chunk set, the load, the
// generator memo's massing context and the CompileCtx with its yield source. Wiring only: every
// model result comes from a function the hashed folders export.
//
// Mirrors the old host (src/lib/sim/scenario/scenario-host.ts), so timeline-ui can retire it:
// - createChunkSet: scenario-host.ts:555-574 (the loader and its deps), 588-591 (onChunk),
//   602-603 (failed cells), 616-627 (prefetch, without the geometry's extra cells).
// - loadDataset: scenario-host.ts:630-664 (loadScenario with `{ policy: true }`), 681-687 (the
//   MassingCtx), 702-704 (LayerCtx, GrossCache, table); the memo itself is the caller's
//   (scenario-host.ts:474-483, 530-534: cleared on another datasetVersion).
// - yieldSourceOf: scenario-host.ts:935-947, 955 (table or chunk recompute, want its cells),
//   603 (failed cells).
// Worker-bundle module: zod-free, DOM-free, $app-free.
import type { GrossTable } from '$lib/data/gross-table';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { PolicyParcels } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import type { GeneratedBuilding, generate, generateForUnits } from '$lib/generator';
import { cellsIntersecting, createChunkLoader, type FetchLike } from '$lib/sim/chunks';
import type { LayerCtx } from '$lib/sim/levers/layers';
import {
  createTableRecompute,
  createYieldRecompute,
  type GrossCache
} from '$lib/sim/levers/recompute';
import type { Lru } from '$lib/sim/lru';
import type { ChunksResponse } from '$lib/sim/protocol';
import {
  loadScenario,
  type FetchBytesLike,
  type Loaded,
  type LoadFailure,
  type ScenarioUrls
} from '$lib/sim/scenario/load';
import type { MassingCtx } from '$lib/sim/scenario/massing';
import type { CompileCtx, YieldSource } from '../policy/compile';
import { staticsOf, type Statics } from '../statics';

export interface DatasetDeps {
  fetch: FetchLike;
  fetchBytes: FetchBytesLike;
  /** A timer the session can cancel (the old host's `Token.later`). */
  later(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
  now(): number;
  warn(msg: string): void;
  retryDelaysMs: readonly number[];
  maxConcurrent: number;
  /** True once the session is superseded or disposed: nothing more is taken or reported. */
  stopped(): boolean;
  /** A chunk's records are in `byCell` and `records`. */
  onChunk(cellId: string): void;
  /** Every change of a chunk's status, as the `chunks` post. */
  onChunksReport(r: ChunksResponse): void;
  decodeParcels?(bytes: Uint8Array): Promise<ScenarioParcels>;
  decodePolicy?(bytes: Uint8Array, parcels: ScenarioParcels): Promise<PolicyParcels>;
  decodeGross?(bytes: Uint8Array): Promise<GrossTable>;
  /** Seam: the load itself (the bench city); default `loadScenario(…, { policy: true })`. */
  load?(urls: ScenarioUrls): Promise<Loaded | LoadFailure>;
}

/** A session's chunks: its loader and every ready record. */
export interface ChunkSet {
  byCell: Map<string, ParcelRecord[]>;
  records: Map<ParcelId, ParcelRecord>;
  /** The failed cells of the loader's latest report. */
  failed: string[];
  want(cells: Iterable<string>): void;
  /** The cells of a viewport bbox ([w, s, e, n]). */
  prefetch(bbox: readonly number[]): void;
  retryFailed(): void;
  dispose(): void;
}

/** The generator calls and the once-only log the massing context closes over. */
export interface GenDeps {
  gen: typeof generate;
  genForUnits: typeof generateForUnits;
  /** Logs once per key (the caller keeps the keys, cleared with the memo). */
  logOnce(key: string, msg: string): void;
}

export interface Dataset {
  manifest: Manifest;
  urls: ScenarioUrls;
  loaded: Loaded;
  /** `{ parcels: loaded.fzp.parcels, policy: loaded.policy }`. */
  layers: LayerCtx;
  statics: Statics;
  chunks: ChunkSet;
  memo: Lru<string, GeneratedBuilding | null>;
  /** On `loaded.fzp`, the chunk records and the memo: `MapStreamDeps.massing`. */
  massing: MassingCtx;
  /** The compile context of a `windowMonths` window; every call shares one yield source. */
  ctx(windowMonths: number): CompileCtx;
}

export function createChunkSet(manifest: Manifest, deps: DatasetDeps): ChunkSet {
  const set: ChunkSet = {
    byCell: new Map(),
    records: new Map(),
    failed: [],
    want: (cells) => loader.want(cells),
    prefetch: (bbox) => loader.want(cellsIntersecting(manifest, bbox)),
    retryFailed: () => loader.retryFailed(),
    dispose: () => loader.dispose()
  };
  const loader = createChunkLoader(manifest, {
    fetch: deps.fetch,
    setTimeout: deps.later,
    clearTimeout: deps.clearTimeout,
    retryDelaysMs: deps.retryDelaysMs,
    maxConcurrent: deps.maxConcurrent,
    onLoaded(cellId, recs) {
      if (deps.stopped()) return;
      set.byCell.set(cellId, recs);
      for (const r of recs) set.records.set(r.id, r);
      deps.onChunk(cellId);
    },
    onReport(r) {
      if (deps.stopped()) return;
      set.failed = r.failed;
      deps.onChunksReport({ type: 'chunks', ...r });
    }
  });
  return set;
}

/**
 * S13 YieldSource: the gross table when loaded, else chunk records; wants each recompute's
 * cellsNeeded(). `gross` is the session's cache, kept across compiles.
 */
export function yieldSourceOf(
  loaded: Loaded,
  chunks: ChunkSet,
  gross: GrossCache,
  now: () => number
): YieldSource {
  const table = loaded.gross;
  return {
    recompute(parcels, needs) {
      if (table) return createTableRecompute(parcels, needs, table, { now });
      const r = createYieldRecompute(
        parcels,
        needs,
        {
          record: (id) => chunks.records.get(id),
          cellLoaded: (cellId) => chunks.byCell.has(cellId),
          now
        },
        gross
      );
      const cells = r.cellsNeeded();
      if (cells.length > 0) chunks.want(cells);
      return r;
    },
    failedCells: () => chunks.failed
  };
}

export async function loadDataset(
  manifest: Manifest,
  urls: ScenarioUrls,
  chunks: ChunkSet,
  deps: DatasetDeps,
  memo: Lru<string, GeneratedBuilding | null>,
  gen: GenDeps
): Promise<Dataset | LoadFailure> {
  const load =
    deps.load ??
    ((u: ScenarioUrls) =>
      loadScenario(
        {
          fetch: deps.fetch,
          fetchBytes: deps.fetchBytes,
          setTimeout: deps.later,
          retryDelaysMs: deps.retryDelaysMs,
          warn: deps.warn,
          decodeParcels: deps.decodeParcels,
          decodePolicy: deps.decodePolicy,
          decodeGross: deps.decodeGross
        },
        u,
        deps.stopped,
        { policy: true }
      ));
  const loaded = await load(urls);
  if ('code' in loaded) return loaded;
  if (loaded.policy === null) {
    // loadScenario with `{ policy: true }` never answers so; only the `load` seam could
    return {
      code: 'scenario-missing',
      message: 'dataset has no policy.bin (scenarios.fzp.policy)'
    };
  }
  const layers: LayerCtx = { parcels: loaded.fzp.parcels, policy: loaded.policy };
  const yields = yieldSourceOf(loaded, chunks, new Map(), deps.now);
  const massing: MassingCtx = {
    input: loaded.fzp,
    records: (id) => chunks.records.get(id),
    memo,
    gen: gen.gen,
    genForUnits: gen.genForUnits,
    logOnce: (projectId, msg) => gen.logOnce(`massing:${projectId}`, msg)
  };
  return {
    manifest,
    urls,
    loaded,
    layers,
    statics: staticsOf(loaded.fzp),
    chunks,
    memo,
    massing,
    ctx: (windowMonths) => ({
      input: loaded.fzp,
      layers,
      windowMonths,
      yields,
      now: deps.now
    })
  };
}
