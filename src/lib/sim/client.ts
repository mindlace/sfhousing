// Main-thread client for the sim worker (spec §4.9): rev counter, resync dedupe, summary promises.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { BuildoutMode } from '$lib/generator';
import type { BBox, Plan, PlanOp } from '$lib/plan';
import type {
  ChunksResponse,
  DiffResponse,
  ErrorResponse,
  ParcelSummary,
  ReadyResponse,
  Rev,
  SimRequest,
  SimResponse
} from './protocol';

export interface WorkerLike {
  postMessage(msg: SimRequest): void;
  onmessage: ((e: { data: SimResponse }) => void) | null;
  terminate(): void;
}

export interface SimClientEvents {
  onReady?(r: ReadyResponse): void;
  onDiff?(d: DiffResponse): void;
  onChunks?(c: ChunksResponse): void;
  onError?(e: ErrorResponse): void;
}

type RevRequest = Extract<SimRequest, { rev: Rev }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class SimClient {
  #worker: WorkerLike;
  #events: SimClientEvents;
  #getPlan: () => Plan;
  #rev = 0;
  #barrierRev = 0;
  #resyncRev: Rev | null = null;
  #reqId = 0;
  #pending = new Map<number, (s: ParcelSummary | null) => void>();
  #datasetVersion: string | null = null;
  #disposed = false;

  constructor(worker: WorkerLike, events: SimClientEvents, getPlan: () => Plan) {
    this.#worker = worker;
    this.#events = events;
    this.#getPlan = getPlan;
    worker.onmessage = (e) => this.#receive(e.data);
  }

  /** From the latest `ready`. */
  get datasetVersion(): string | null {
    return this.#datasetVersion;
  }

  #send(req: DistributiveOmit<RevRequest, 'rev'>, barrier: boolean): Rev {
    const rev = ++this.#rev;
    if (barrier) this.#barrierRev = rev;
    this.#worker.postMessage({ ...req, rev } as RevRequest);
    return rev;
  }

  init(manifest: Manifest, mode: BuildoutMode = 'max'): Rev {
    this.#resyncRev = null;
    return this.#send({ type: 'init', manifest, mode }, true);
  }

  load(plan: Plan): Rev {
    return this.#send({ type: 'load', plan }, true);
  }

  preview(op: PlanOp): Rev {
    return this.#send({ type: 'preview', op }, false);
  }

  cancelPreview(): Rev {
    return this.#send({ type: 'cancelPreview' }, true);
  }

  commit(op: PlanOp): Rev {
    return this.#send({ type: 'commit', op }, true);
  }

  undo(opId: string): Rev {
    return this.#send({ type: 'undo', opId }, true);
  }

  prefetch(bbox: BBox): void {
    this.#worker.postMessage({ type: 'prefetch', bbox });
  }

  retryChunks(): void {
    this.#worker.postMessage({ type: 'retryChunks' });
  }

  parcelSummary(parcelId: ParcelId): Promise<ParcelSummary | null> {
    if (this.#disposed) return Promise.resolve(null);
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pending.set(reqId, resolve);
      this.#worker.postMessage({ type: 'parcelSummary', reqId, parcelId });
    });
  }

  /** map-view onResyncNeeded and bad-request both call this; one load per episode. */
  resync(): void {
    if (this.#disposed || this.#resyncRev !== null) return;
    this.#resyncRev = this.load(this.#getPlan());
  }

  /** True for a preview diff older than the latest commit/cancelPreview/undo/load (R5). */
  isStalePreview(d: DiffResponse): boolean {
    return d.phase === 'preview' && d.rev < this.#barrierRev;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#worker.onmessage = null;
    this.#worker.terminate();
    for (const resolve of this.#pending.values()) resolve(null);
    this.#pending.clear();
  }

  #receive(msg: SimResponse): void {
    switch (msg.type) {
      case 'ready':
        this.#datasetVersion = msg.datasetVersion;
        this.#events.onReady?.(msg);
        return;
      case 'diff':
        if (this.#resyncRev !== null && msg.phase === 'load' && msg.rev >= this.#resyncRev) {
          this.#resyncRev = null;
        }
        this.#events.onDiff?.(msg);
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
      case 'error': {
        // An error answering the resync load itself must not start another: the plan is the
        // problem, and resending it would loop.
        const answersResync = this.#resyncRev !== null && msg.rev === this.#resyncRev;
        if (this.#resyncRev !== null && msg.rev >= this.#resyncRev) this.#resyncRev = null;
        this.#events.onError?.(msg);
        if (msg.code === 'bad-request' && !answersResync) this.resync();
        return;
      }
      default: {
        const never: never = msg;
        console.error('[sim] unknown response', never);
      }
    }
  }
}

export function spawnSimWorker(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}
