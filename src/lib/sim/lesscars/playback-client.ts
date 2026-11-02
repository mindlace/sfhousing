// Main-thread client for the playback host (Plan 2 Task 5): rev barrier, one resync per episode,
// crash and restart, pending card promises. Modelled on ScenarioClient, which it leaves alone.
import type { LessCarsPlanFile, LessCarsSitesFile } from '$lib/data/lesscars/codec';
import type { Manifest } from '$lib/data/manifest';
import type { BBox } from '$lib/plan';
import type { Day } from '$lib/timelapse/time';
import type { WorkerLike } from '../client';
import type { ChunksResponse, ReadyResponse, Rev } from '../protocol';
import type { ScenarioErrorResponse } from '../scenario-client';
import type { ScenarioResponse, WorkerRequest } from '../scenario/types';
import type { PlaybackCard, PlaybackResponse } from './types';

export type PlaybackInbound = ScenarioResponse | PlaybackResponse;

export interface PlaybackWorkerLike {
  postMessage(msg: WorkerRequest): void;
  onmessage: ((e: { data: PlaybackInbound }) => void) | null;
  /** A script error or failed module load in the worker (a real Worker has both). */
  onerror?: ((e: ErrorEvent) => void) | null;
  onmessageerror?: ((e: MessageEvent) => void) | null;
  terminate(): void;
}

/** `spawnSimWorker()`'s WorkerLike is the same real Worker; accepted without a cast. */
export type PlaybackWorkerInput = PlaybackWorkerLike | WorkerLike;

export interface PlaybackClientEvents {
  onReady?(r: ReadyResponse): void;
  onLoaded?(r: Extract<PlaybackResponse, { type: 'playbackLoaded' }>): void;
  /** Current-rev revisions only. */
  onTimeline?(r: Extract<PlaybackResponse, { type: 'playback' }>): void;
  onChunks?(c: ChunksResponse): void;
  /** Current-rev errors only. */
  onError?(e: ScenarioErrorResponse): void;
  onCrash?(e: Event): void;
}

export class PlaybackClient {
  #worker: PlaybackWorkerLike;
  #events: PlaybackClientEvents;
  #rev = 0;
  #args: { manifest: Manifest; plan: LessCarsPlanFile; sites: LessCarsSitesFile } | null = null;
  #resyncRev: Rev | null = null;
  #reqId = 0;
  #pending = new Map<number, (c: PlaybackCard | null) => void>();
  #disposed = false;
  #crashed = false;

  constructor(worker: PlaybackWorkerInput, events: PlaybackClientEvents) {
    this.#worker = worker as PlaybackWorkerLike;
    this.#events = events;
    this.#attach(this.#worker);
  }

  /** True after a worker crash, until `restart`. */
  get crashed(): boolean {
    return this.#crashed;
  }

  /** Sends initPlayback with a new rev; later responses of older revs are dropped. */
  init(manifest: Manifest, plan: LessCarsPlanFile, sites: LessCarsSitesFile): Rev {
    this.#args = { manifest, plan, sites };
    this.#resyncRev = null;
    return this.#send();
  }

  #send(): Rev {
    const rev = ++this.#rev;
    this.#worker.postMessage({ type: 'initPlayback', rev, ...this.#args! });
    return rev;
  }

  /**
   * SimMap's revision gap: re-sends initPlayback with the last arguments and a new rev, at most
   * once until a current-rev revision 0 arrives (or an error closes the episode).
   */
  resync(): void {
    if (this.#disposed || this.#crashed || this.#resyncRev !== null || !this.#args) return;
    this.#resyncRev = this.#send();
  }

  prefetch(bbox: BBox): void {
    if (this.#disposed || this.#crashed) return;
    this.#worker.postMessage({ type: 'prefetch', bbox });
  }

  retryChunks(): void {
    if (this.#disposed || this.#crashed) return;
    this.#worker.postMessage({ type: 'retryChunks' });
  }

  /** Resolves null on crash, restart or dispose. */
  card(projectId: string, day: Day): Promise<PlaybackCard | null> {
    if (this.#disposed || this.#crashed) return Promise.resolve(null);
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pending.set(reqId, resolve);
      this.#worker.postMessage({ type: 'playbackCard', reqId, projectId, day });
    });
  }

  /**
   * Replaces a crashed (or any) worker with a fresh one. The rev sequence continues, so older
   * responses stay stale. The caller calls `init` again.
   */
  restart(worker: PlaybackWorkerInput): void {
    if (this.#disposed) return;
    this.#detach();
    this.#crashed = false;
    this.#resyncRev = null;
    this.#worker = worker as PlaybackWorkerLike;
    this.#attach(this.#worker);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#detach();
  }

  #attach(worker: PlaybackWorkerLike): void {
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
    for (const resolve of this.#pending.values()) resolve(null);
    this.#pending.clear();
  }

  #crash(worker: PlaybackWorkerLike, e: Event): void {
    if (this.#disposed || worker !== this.#worker || this.#crashed) return;
    console.error('[lesscars] playback worker crashed', e);
    this.#crashed = true;
    this.#resyncRev = null;
    this.#detach();
    this.#events.onCrash?.(e);
  }

  #receive(msg: PlaybackInbound): void {
    if (this.#disposed || this.#crashed) return;
    switch (msg.type) {
      case 'ready':
        this.#events.onReady?.(msg);
        return;
      case 'chunks':
        this.#events.onChunks?.(msg);
        return;
      case 'playbackLoaded':
        if (msg.rev === this.#rev) this.#events.onLoaded?.(msg);
        return;
      case 'playback':
        if (msg.rev !== this.#rev) return;
        if (this.#resyncRev !== null && msg.render.revision === 0 && msg.rev >= this.#resyncRev) {
          this.#resyncRev = null;
        }
        this.#events.onTimeline?.(msg);
        return;
      case 'playbackCard': {
        const resolve = this.#pending.get(msg.reqId);
        if (!resolve) return;
        this.#pending.delete(msg.reqId);
        resolve(msg.card);
        return;
      }
      case 'error':
        if (msg.rev < this.#rev) return;
        // An error closes the resync episode; resending cannot fix a bad file.
        this.#resyncRev = null;
        this.#events.onError?.(msg);
        return;
      default:
        // Scenario-host answers (timeline, parcelSummary, ...) are not this channel's.
        return;
    }
  }
}
