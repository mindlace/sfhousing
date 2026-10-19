// Main-thread client for the scenario host (spec §4.1, T6): rev barrier, one resync per episode,
// crash and restart, pending summary promises. Modelled on SimClient (client.ts), which it leaves
// alone. The one deliberate difference: an `error` never triggers a resync.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { BBox } from '$lib/plan';
import type { Day } from '$lib/timelapse/time';
import type { WorkerLike } from './client';
import type { ChunksResponse, ParcelSummary, ReadyResponse, Rev } from './protocol';
import type { ScenarioResponse, TimelineResponse, WorkerRequest } from './scenario/types';

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
  /** Seed of the latest non-stale timeline. Survives `initScenario` and `restart` (crash Retry). */
  #currentSeed: number | null = null;
  /** A non-stale timeline has arrived since the last `initScenario`/`restart`: resync may run. */
  #hasTimeline = false;
  #reqId = 0;
  #pending = new Map<number, (s: ParcelSummary | null) => void>();
  #datasetVersion: string | null = null;
  #disposed = false;
  #crashed = false;

  constructor(worker: ScenarioWorkerInput, events: ScenarioClientEvents) {
    this.#worker = worker as ScenarioWorkerLike;
    this.#events = events;
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

  /** Every rev request here is a barrier: it supersedes all earlier timelines. */
  #sendBarrier(req: { type: 'initScenario' | 'reroll' } & Record<string, unknown>): Rev {
    const rev = ++this.#rev;
    this.#barrierRev = rev;
    this.#worker.postMessage({ ...req, rev } as WorkerRequest);
    return rev;
  }

  initScenario(manifest: Manifest, horizon: Day, seed: number | null = null): Rev {
    this.#resyncRev = null;
    // A new scenario has produced no timeline yet; a resync before one would hit an
    // uninitialised host (bad-request). `currentSeed` is kept for the caller's Retry.
    this.#hasTimeline = false;
    return this.#sendBarrier({ type: 'initScenario', manifest, scenario: 'fzp', seed, horizon });
  }

  reroll(seed: number | null): Rev {
    return this.#sendBarrier({ type: 'reroll', seed });
  }

  prefetch(bbox: BBox): void {
    this.#worker.postMessage({ type: 'prefetch', bbox });
  }

  retryChunks(): void {
    this.#worker.postMessage({ type: 'retryChunks' });
  }

  parcelSummary(parcelId: ParcelId, day: Day, projectId?: string): Promise<ParcelSummary | null> {
    if (this.#disposed || this.#crashed) return Promise.resolve(null);
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pending.set(reqId, resolve);
      this.#worker.postMessage({
        type: 'parcelSummary',
        reqId,
        parcelId,
        day,
        ...(projectId !== undefined && { projectId })
      });
    });
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
    this.#resyncRev = null;
    this.#hasTimeline = false;
    this.#datasetVersion = null;
    this.#worker = worker as ScenarioWorkerLike;
    this.#attach(this.#worker);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
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
    this.#resolvePending();
  }

  #resolvePending(): void {
    for (const resolve of this.#pending.values()) resolve(null);
    this.#pending.clear();
  }

  #crash(worker: ScenarioWorkerLike, e: Event): void {
    if (this.#disposed || worker !== this.#worker || this.#crashed) return;
    console.error('[sim] worker crashed', e);
    this.#crashed = true;
    this.#resyncRev = null;
    // onmessageerror can fire while the worker is still alive: detach and terminate it, so a late
    // message (a `ready` above all) cannot revive the UI while `crashed` stays true.
    this.#detach();
    this.#events.onCrash?.(e);
  }

  #receive(msg: ScenarioResponse): void {
    if (this.#disposed || this.#crashed) return;
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
      case 'parcelSummary': {
        const resolve = this.#pending.get(msg.reqId);
        if (!resolve) return;
        this.#pending.delete(msg.reqId);
        resolve(msg.summary);
        return;
      }
      case 'error':
        // Never a resync here (unlike SimClient): resending cannot fix a bad file or request. An
        // error at or after the resync rev only closes the episode.
        if (this.#resyncRev !== null && msg.rev >= this.#resyncRev) this.#resyncRev = null;
        this.#events.onError?.(msg);
        return;
      default: {
        const never: never = msg;
        console.error('[sim] unknown response', never);
      }
    }
  }
}
