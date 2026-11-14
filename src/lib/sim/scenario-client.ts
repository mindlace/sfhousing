// Main-thread client for the scenario host (spec §4.1, T6): rev barrier, one resync per episode,
// crash and restart, pending summary promises. Modelled on SimClient (client.ts), which it leaves
// alone. The one deliberate difference: an `error` never triggers a resync.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { BBox } from '$lib/plan';
import type { Day } from '$lib/timelapse/time';
import type { WorkerLike } from './client';
import type { BrushCatalog, BrushQuery } from './levers/brushes';
import { LookupRequests } from './lookup-requests';
import type { SimLevers } from './levers/types';
import type { ChunksResponse, ParcelSummary, ReadyResponse, Rev } from './protocol';
import type {
  BrushLotsResult,
  HeightLidsResult,
  LotAtResult,
  LotOutlinesResult,
  PreviewResult,
  RanksResponse,
  ScenarioResponse,
  TimelineResponse,
  WorkerRequest
} from './scenario/types';

export interface ScenarioWorkerLike {
  postMessage(msg: WorkerRequest): void;
  onmessage: ((e: { data: ScenarioResponse }) => void) | null;
  /** A script error or failed module load in the worker (a real Worker has both). */
  onerror?: ((e: ErrorEvent) => void) | null;
  onmessageerror?: ((e: MessageEvent) => void) | null;
  terminate(): void;
}

/**
 * What the constructor and `restart` take. `spawnSimWorker()` returns the editor's `WorkerLike`,
 * whose `onmessage` is typed for `SimResponse` and is not assignable to `ScenarioWorkerLike`'s
 * (contravariance); it is the same real Worker, so it is accepted here without a cast.
 */
export type ScenarioWorkerInput = ScenarioWorkerLike | WorkerLike;

export type ScenarioErrorResponse = Extract<ScenarioResponse, { type: 'error' }>;

export interface ScenarioClientEvents {
  onReady?(r: ReadyResponse): void;
  /** Every timeline, stale ones included; the caller drops a stale one with `isStale`. */
  onTimeline?(t: TimelineResponse): void;
  onChunks?(c: ChunksResponse): void;
  /** Every lever status, a superseded revision's `resolving` included. */
  onLevers?(l: Extract<ScenarioResponse, { type: 'levers' }>): void;
  /** Every revision's height regions and contours, a superseded revision's included. */
  onHeights?(m: Extract<ScenarioResponse, { type: 'heights' }>): void;
  /** The band's seeds, best to worst, once per band; the page decides staleness. */
  onRanks?(r: RanksResponse): void;
  /** Never answered by a resync. */
  onError?(e: ScenarioErrorResponse): void;
  /**
   * The worker crashed (onerror/onmessageerror). Retry is `restart(spawnSimWorker())`, then only
   * `initScenario` with the current seed.
   */
  onCrash?(e: Event): void;
}

export class ScenarioClient {
  #worker: ScenarioWorkerLike;
  #events: ScenarioClientEvents;
  #rev = 0;
  #barrierRev = 0;
  #resyncRev: Rev | null = null;
  /** The latest lever revision's rev until its `current`; null when none is pending. */
  #leversRev: Rev | null = null;
  /** The latest `initScenario` rev: a load error is posted at it, below a later `setLevers`. */
  #sessionRev = 0;
  /** Seed of the latest non-stale timeline. Survives `initScenario` and `restart` (crash Retry). */
  #currentSeed: number | null = null;
  /** A non-stale timeline has arrived since the last `initScenario`/`restart`: resync may run. */
  #hasTimeline = false;
  #lookups: LookupRequests;
  #datasetVersion: string | null = null;
  #disposed = false;
  #crashed = false;

  constructor(worker: ScenarioWorkerInput, events: ScenarioClientEvents) {
    this.#worker = worker as ScenarioWorkerLike;
    this.#events = events;
    this.#lookups = new LookupRequests((msg) => this.#worker.postMessage(msg));
    this.#attach(this.#worker);
  }

  /** True after a worker crash, until `restart`. */
  get crashed(): boolean {
    return this.#crashed;
  }

  /**
   * Seed of the latest accepted (non-stale) timeline, or null before any. Kept across `restart`
   * and `initScenario`, so crash Retry is `restart(spawnSimWorker())` then
   * `initScenario(manifest, horizon, client.currentSeed)`.
   */
  get currentSeed(): number | null {
    return this.#currentSeed;
  }

  /** From the latest `ready`. */
  get datasetVersion(): string | null {
    return this.#datasetVersion;
  }

  /**
   * True from an `initScenario` with levers, or a `setLevers`, until that revision's `levers`
   * `current` (or an error at or after its rev).
   */
  get leversPending(): boolean {
    return this.#leversRev !== null;
  }

  /** Every rev request here is a barrier: it supersedes all earlier timelines. */
  #sendBarrier(
    req: { type: 'initScenario' | 'reroll' | 'setLevers' } & Record<string, unknown>
  ): Rev {
    const rev = ++this.#rev;
    this.#barrierRev = rev;
    this.#worker.postMessage({ ...req, rev } as WorkerRequest);
    return rev;
  }

  /**
   * `levers` absent = /fzp (no policy.bin, no `levers` responses). `awaitLevers` (sent only with
   * levers): the levers lack their brush lots, so the worker runs nothing until the first
   * `setLevers`.
   */
  initScenario(
    manifest: Manifest,
    horizon: Day,
    seed: number | null = null,
    levers?: SimLevers,
    awaitLevers?: boolean
  ): Rev {
    this.#resyncRev = null;
    // A new scenario has produced no timeline yet; a resync before one would hit an
    // uninitialised host (bad-request). `currentSeed` is kept for the caller's Retry.
    this.#hasTimeline = false;
    const rev = this.#sendBarrier({
      type: 'initScenario',
      manifest,
      scenario: 'fzp',
      seed,
      horizon,
      ...(levers !== undefined && { levers }),
      ...(levers !== undefined && awaitLevers === true && { awaitLevers: true })
    });
    this.#sessionRev = rev;
    this.#leversRev = levers === undefined ? null : rev;
    return rev;
  }

  /** A barrier like `reroll`: timelines older than it are stale. Needs an init with levers. */
  setLevers(levers: SimLevers): Rev {
    const rev = this.#sendBarrier({ type: 'setLevers', levers });
    this.#leversRev = rev;
    return rev;
  }

  /** `opts.swap` (the run slider): the worker answers revision 0 fast, for install over the map. */
  reroll(seed: number | null, opts?: { swap?: boolean }): Rev {
    return this.#sendBarrier({ type: 'reroll', seed, ...(opts?.swap === true && { swap: true }) });
  }

  prefetch(bbox: BBox): void {
    this.#worker.postMessage({ type: 'prefetch', bbox });
  }

  retryChunks(): void {
    this.#worker.postMessage({ type: 'retryChunks' });
  }

  parcelSummary(parcelId: ParcelId, day: Day, projectId?: string): Promise<ParcelSummary | null> {
    return this.#lookups.parcelSummary(parcelId, day, projectId);
  }

  /**
   * The lots a brush covers (eligible only), with their label points. Answered by a session
   * initialised with levers once it has loaded; `no-session` otherwise, and on crash, `restart`
   * and `dispose`.
   */
  resolveBrush(query: BrushQuery): Promise<BrushLotsResult> {
    return this.#lookups.resolveBrush(query);
  }

  /** The ring outlines of lots; see `LookupRequests.lotOutlines`. */
  lotOutlines(lots: ParcelId[]): Promise<LotOutlinesResult> {
    return this.#lookups.lotOutlines(lots);
  }

  /** The lot under `point` (lng, lat) and its height-limit layer; see `LookupRequests.lotAt`. */
  lotAt(point: [number, number]): Promise<LotAtResult> {
    return this.#lookups.lotAt(point);
  }

  /** The buildings `lots` could hold at `stories`; see `LookupRequests.previewBuildings`. */
  previewBuildings(lots: ParcelId[], stories: number): Promise<PreviewResult> {
    return this.#lookups.previewBuildings(lots, stories);
  }

  /** The glass lids of the loaded lots in `bbox`; see `LookupRequests.heightLids`. */
  heightLids(bbox: [number, number, number, number]): Promise<HeightLidsResult> {
    return this.#lookups.heightLids(bbox);
  }

  /** The brush pickers' catalog; null without a lever session, and on crash, restart, dispose. */
  brushCatalog(): Promise<BrushCatalog | null> {
    return this.#lookups.brushCatalog();
  }

  /**
   * map-view's onResyncNeeded (a T7 revision gap) calls this: one `reroll(currentSeed)` per
   * episode, asking for a fresh revision-0 snapshot of the same run. No-op until a timeline has
   * arrived. The episode ends on the non-stale revision-0 timeline answering it, or an error.
   */
  resync(): void {
    if (this.#disposed || this.#crashed || this.#resyncRev !== null) return;
    if (!this.#hasTimeline || this.#currentSeed === null) return;
    this.#resyncRev = this.reroll(this.#currentSeed);
  }

  /** True for a timeline older than the latest `initScenario`/`reroll`. */
  isStale(t: TimelineResponse): boolean {
    return t.rev < this.#barrierRev;
  }

  /**
   * Replaces a crashed (or any) worker with a fresh one. The rev sequence continues, so older
   * timelines stay stale. Send only `initScenario` next, with the current seed.
   */
  restart(worker: ScenarioWorkerInput): void {
    if (this.#disposed) return;
    this.#detach();
    this.#crashed = false;
    this.#lookups.closed = false;
    this.#resyncRev = null;
    this.#leversRev = null; // the fresh worker knows no levers until the next initScenario
    this.#hasTimeline = false;
    this.#datasetVersion = null;
    this.#worker = worker as ScenarioWorkerLike;
    this.#attach(this.#worker);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lookups.closed = true;
    this.#detach();
  }

  #attach(worker: ScenarioWorkerLike): void {
    worker.onmessage = (e) => this.#receive(e.data);
    worker.onerror = (e) => this.#crash(worker, e);
    worker.onmessageerror = (e) => this.#crash(worker, e);
  }

  #detach(): void {
    const w = this.#worker;
    w.onmessage = null;
    w.onerror = null;
    w.onmessageerror = null;
    w.terminate();
    this.#lookups.resolveAll();
  }

  #crash(worker: ScenarioWorkerLike, e: Event): void {
    if (this.#disposed || worker !== this.#worker || this.#crashed) return;
    console.error('[sim] worker crashed', e);
    this.#crashed = true;
    this.#lookups.closed = true;
    this.#resyncRev = null;
    // onmessageerror can fire while the worker is still alive: detach and terminate it, so a late
    // message (a `ready` above all) cannot revive the UI while `crashed` stays true.
    this.#detach();
    this.#events.onCrash?.(e);
  }

  #receive(msg: ScenarioResponse): void {
    if (this.#disposed || this.#crashed) return;
    if (this.#lookups.receive(msg)) return;
    switch (msg.type) {
      case 'ready':
        this.#datasetVersion = msg.datasetVersion;
        this.#events.onReady?.(msg);
        return;
      case 'timeline':
        if (!this.isStale(msg)) {
          this.#currentSeed = msg.seed;
          this.#hasTimeline = true;
          if (this.#resyncRev !== null && msg.render.revision === 0 && msg.rev >= this.#resyncRev) {
            this.#resyncRev = null;
          }
        }
        this.#events.onTimeline?.(msg);
        return;
      case 'chunks':
        this.#events.onChunks?.(msg);
        return;
      case 'parcelSummary':
      case 'brushLots':
      case 'lotOutlines':
      case 'lotAt':
      case 'previewBuildings':
      case 'brushCatalog':
      case 'heightLids':
        return; // an answer nobody waits for (`LookupRequests.receive` took the others)
      case 'heights':
        this.#events.onHeights?.(msg);
        return;
      case 'ranks':
        this.#events.onRanks?.(msg);
        return;
      case 'error':
        // Never a resync here (unlike SimClient): resending cannot fix a bad file or request. An
        // error at or after the resync rev only closes the episode.
        if (this.#resyncRev !== null && msg.rev >= this.#resyncRev) this.#resyncRev = null;
        // An error ends the lever revision when it is that revision's own, or when it ended the
        // session (at or after the init rev, and not a bad-request for some later request). A
        // load failure is posted at the init rev, below a setLevers sent before the load.
        if (
          this.#leversRev !== null &&
          (msg.rev === this.#leversRev ||
            msg.rev === this.#sessionRev ||
            (msg.rev >= this.#sessionRev && msg.code !== 'bad-request'))
        ) {
          this.#leversRev = null;
        }
        this.#events.onError?.(msg);
        return;
      case 'levers':
        if (msg.phase === 'current' && this.#leversRev !== null && msg.rev >= this.#leversRev) {
          this.#leversRev = null;
        }
        this.#events.onLevers?.(msg);
        return;
      default: {
        const never: never = msg;
        console.error('[sim] unknown response', never);
      }
    }
  }
}
