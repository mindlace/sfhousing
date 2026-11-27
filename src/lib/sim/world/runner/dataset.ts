// The timeline host's loaded dataset (ensemble-runner Task 3): the chunk set, the load, the
// generator memo's massing context and the CompileCtx. Wiring only: every model result comes
// from a function the hashed folders export.
//
// - createChunkSet: the loader and its deps, onChunk, failed cells, prefetch.
// - loadDataset: loadSimInput, the MassingCtx and the LayerCtx (parcels, policy.bin, options.bin);
//   the memo itself is the caller's (cleared on another datasetVersion).
// - the world core (car-ownership Task 11): `withFunding(createFundingSystem(), cars)`, built once
//   per load because the car system is the dataset's (`carSystemOf`, world/cars/dataset.ts).
// Worker-bundle module: zod-free, DOM-free, $app-free.
import type { Manifest } from '$lib/data/manifest';
import type { OptionTable } from '$lib/data/option-table';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { PolicyParcels } from '$lib/data/policy-codec';
import type { ScenarioParcels } from '$lib/data/scenario-codec';
import {
  generateForm,
  type GeneratedBuilding,
  type generate,
  type generateForUnits
} from '$lib/generator';
import { cellsIntersecting, createChunkLoader, type FetchLike } from '$lib/sim/chunks';
import type { LayerCtx } from '$lib/sim/levers/layers';
import type { Lru } from '$lib/sim/lru';
import type { ChunksResponse } from '$lib/sim/protocol';
import {
  loadSimInput,
  type FetchBytesLike,
  type Loaded,
  type LoadFailure,
  type SimInputUrls
} from '$lib/sim/world/input/load';
import type { MassingCtx } from '$lib/sim/world/massing';
import { carSystemOf } from '../cars/dataset';
import { createFundingSystem } from '../funding';
import type { CompileCtx } from '../policy/compile';
import { staticsOf, type Statics } from '../statics';
import type { CarSystem } from '../types';
import { withFunding } from '../world';
import type { WorldCore } from './ensemble';

export interface DatasetDeps {
  fetch: FetchLike;
  fetchBytes: FetchBytesLike;
  /** A timer the session can cancel. */
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
  decodeOptions?(bytes: Uint8Array): Promise<OptionTable>;
  /** Seam: the load itself (the bench city); default `loadSimInput(…, { cars })`. */
  load?(urls: SimInputUrls): Promise<Loaded | LoadFailure>;
  /** True: no car system, even with cars.bin (`reach-check --cars off`). */
  carsOff?: boolean;
}

/** A session's chunks: its loader and every ready record. */
export interface ChunkSet {
  byCell: Map<string, ParcelRecord[]>;
  records: Map<ParcelId, ParcelRecord>;
  /** The failed cells of the loader's latest report. */
  failed: string[];
  /** Every cell `want` (or `prefetch`) has asked for: the map stream's `cellsFor` input. */
  wanted: Set<string>;
  want(cells: Iterable<string>): void;
  /** Loads `cells` without adding them to `wanted` (the `cellsFor` additions, S17). */
  wantAlso(cells: Iterable<string>): void;
  /** The cells of a viewport bbox ([w, s, e, n]). */
  prefetch(bbox: readonly number[]): void;
  retryFailed(): void;
  dispose(): void;
}

/** The generator calls and the once-only log the massing context closes over. */
export interface GenDeps {
  gen: typeof generate;
  genForUnits: typeof generateForUnits;
  /** Masses a simulated project's chosen option; default `generateForm`. */
  genForm?: typeof generateForm;
  /** Logs once per key (the caller keeps the keys, cleared with the memo). */
  logOnce(key: string, msg: string): void;
}

export interface Dataset {
  manifest: Manifest;
  urls: SimInputUrls;
  loaded: Loaded;
  /** `{ parcels: loaded.fzp.parcels, policy: loaded.policy, options: loaded.options }`. */
  layers: LayerCtx;
  statics: Statics;
  /** The dataset's car system (`carSystemOf`); null without car data or with `carsOff`. */
  cars: CarSystem | null;
  /** `withFunding(createFundingSystem(), cars)`: both ensembles' worlds step with it. */
  core: WorldCore;
  chunks: ChunkSet;
  memo: Lru<string, GeneratedBuilding | null>;
  /** On `loaded.fzp`, the chunk records and the memo: `MapStreamDeps.massing`. */
  massing: MassingCtx;
  /** The compile context of a `windowMonths` window. */
  ctx(windowMonths: number): CompileCtx;
}

export function createChunkSet(manifest: Manifest, deps: DatasetDeps): ChunkSet {
  const set: ChunkSet = {
    byCell: new Map(),
    records: new Map(),
    failed: [],
    wanted: new Set(),
    want(cells) {
      const list = [...cells];
      for (const c of list) set.wanted.add(c);
      loader.want(list);
    },
    wantAlso: (cells) => loader.want(cells),
    prefetch: (bbox) => set.want(cellsIntersecting(manifest, bbox)),
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

export async function loadDataset(
  manifest: Manifest,
  urls: SimInputUrls,
  chunks: ChunkSet,
  deps: DatasetDeps,
  memo: Lru<string, GeneratedBuilding | null>,
  gen: GenDeps
): Promise<Dataset | LoadFailure> {
  const load =
    deps.load ??
    ((u: SimInputUrls) =>
      loadSimInput(
        {
          fetch: deps.fetch,
          fetchBytes: deps.fetchBytes,
          setTimeout: deps.later,
          retryDelaysMs: deps.retryDelaysMs,
          warn: deps.warn,
          decodeParcels: deps.decodeParcels,
          decodePolicy: deps.decodePolicy,
          decodeOptions: deps.decodeOptions
        },
        u,
        deps.stopped,
        { cars: deps.carsOff !== true }
      ));
  const loaded = await load(urls);
  if ('code' in loaded) return loaded;
  const layers: LayerCtx = {
    parcels: loaded.fzp.parcels,
    policy: loaded.policy,
    options: loaded.options
  };
  const massing: MassingCtx = {
    input: loaded.fzp,
    records: (id) => chunks.records.get(id),
    memo,
    gen: gen.gen,
    genForUnits: gen.genForUnits,
    genForm: gen.genForm ?? generateForm,
    logOnce: (projectId, msg) => gen.logOnce(`massing:${projectId}`, msg)
  };
  const cars = carSystemOf(loaded, { off: deps.carsOff });
  return {
    manifest,
    urls,
    loaded,
    layers,
    statics: staticsOf(loaded.fzp),
    cars,
    core: withFunding(createFundingSystem(), cars),
    chunks,
    memo,
    massing,
    ctx: (windowMonths) => ({
      input: loaded.fzp,
      layers,
      windowMonths,
      now: deps.now
    })
  };
}
