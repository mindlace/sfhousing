// Main-thread client for the timeline host (ensemble-runner rule 22): the rev barrier on policy
// edits, crash and restart (re-opening with the last policy), and the lookups of ScenarioClient
// unchanged. Mirrors ScenarioClient's crash handling (scenario-client.ts), which it leaves alone.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { BBox } from '$lib/plan';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';
import type { BrushCatalog, BrushQuery } from './levers/brushes';
import { LookupRequests } from './lookup-requests';
import type { ChunksResponse, ParcelSummary, ReadyResponse, Rev } from './protocol';
import type {
  BrushLotsResult,
  HeightLidsResult,
  LotAtResult,
  LotOutlinesResult,
  PreviewResult,
  ScenarioResponse,
  WorkerRequest
} from './scenario/types';
import type { ScenarioWorkerInput, ScenarioWorkerLike } from './scenario-client';
import type {
  TimelineHostRequest,
  TimelineHostResponse,
  TimelineResponse
} from './timeline-protocol';

/** Worlds in the ensemble (rule 22): the page opens every timeline with this many. */
export const WORLDS = 48;
/** The window, in model months (40 years). */
export const WINDOW_MONTHS = 480;

type Of<T extends TimelineResponse['type']> = Extract<TimelineResponse, { type: T }>;

export interface TimelineClientEvents {
  onReady?(r: ReadyResponse): void;
  /** Only for the latest policy edit: an older `rev` is dropped. */
  onFilled?(m: Of<'filled'>): void;
  /** Only for the latest policy edit: an older `rev` is dropped. */
  onRefill?(m: Of<'refill'>): void;
  /** Never dropped: the map's revision numbers are their own sequence. */
  onCells?(m: Of<'cells'>): void;
  /** Never dropped. */
  onLookups?(m: Of<'lookups'>): void;
  /** Only for the latest policy edit: an older `rev` is dropped. */
  onCompiling?(m: Of<'compiling'>): void;
  /** Only for the latest policy edit: an older `rev` is dropped. */
  onCompiled?(m: Of<'compiled'>): void;
  /** Every error, whatever its rev: the caller compares `rev` with what it sent. */
  onError?(m: Of<'error'>): void;
  onChunks?(c: ChunksResponse): void;
  onHeights?(m: Extract<ScenarioResponse, { type: 'heights' }>): void;
  /** The worker crashed. Retry is `restart(spawnSimWorker())`, which re-opens the timeline. */
  onCrash?(e: Event): void;
}

/**
 * The client side of the timeline host.
 *
 * Drop floor (S14): `compiling`, `compiled`, `filled` and `refill` older than the floor are
 * dropped. The floor is the rev of the last `open` / `setPolicy` sent, except that an `error` code
 * `bad-request` at a rev equal to the floor (the worker rejected that edit) lowers it to the last
 * rev seen accepted (the rev of the last `compiled` received, or the open rev before any), because
 * the worker keeps filling under the previous timelines and posts at that rev. A `bad-request` for
 * an older rev changes nothing, and the next sent edit raises the floor again. A `refill` is not
 * dropped for arriving before its rev's `compiled`: it is not older than the floor. `setPolicy`
 * before `open` throws; `restart` re-opens only when a timeline was opened.
 */
export class TimelineClient {
  #worker: ScenarioWorkerLike;
  #events: TimelineClientEvents;
  #lookups: LookupRequests;
  #rev = 0;
  /** The rev of the latest `openTimeline` or `setPolicy` sent: older answers are dropped. */
  #policyRev = 0;
  /** The last rev seen accepted: the highest `compiled` received, or the open rev before any. */
  #acceptedRev = 0;
  #manifest: Manifest | null = null;
  #policy: SimPolicy4 | null = null;
  #lots: Record<string, ParcelId[]> = {};
  #disposed = false;
  #crashed = false;

  constructor(worker: ScenarioWorkerInput, events: TimelineClientEvents) {
    this.#worker = worker as ScenarioWorkerLike;
    this.#events = events;
    this.#lookups = new LookupRequests((msg) => this.#worker.postMessage(msg));
    this.#attach(this.#worker);
  }

  /** True after a worker crash, until `restart`. */
  get crashed(): boolean {
    return this.#crashed;
  }

  /** Posts a timeline-host request; `WorkerRequest` (the scenario union) does not list them. */
  #post(req: TimelineHostRequest): void {
    this.#worker.postMessage(req as WorkerRequest);
  }

  #sendOpen(): Rev {
    const rev = ++this.#rev;
    this.#policyRev = rev;
    this.#acceptedRev = rev;
    this.#post({
      type: 'openTimeline',
      rev,
      manifest: this.#manifest!,
      policy: this.#policy!,
      lots: this.#lots,
      worlds: WORLDS,
      months: WINDOW_MONTHS
    });
    return rev;
  }

  /** `policy` must be reconciled (`openSimDoc4`); see `OpenTimelineRequest`. */
  open(manifest: Manifest, policy: SimPolicy4, lots: Record<string, ParcelId[]>): Rev {
    this.#manifest = manifest;
    this.#policy = policy;
    this.#lots = lots;
    return this.#sendOpen();
  }

  /** A policy edit: answers for older edits are dropped from here on. */
  setPolicy(policy: SimPolicy4, lots: Record<string, ParcelId[]>): Rev {
    if (this.#manifest === null) throw new Error('open first');
    this.#policy = policy;
    this.#lots = lots;
    const rev = ++this.#rev;
    this.#policyRev = rev;
    this.#post({ type: 'setPolicy', rev, policy, lots });
    return rev;
  }

  /** The model month the playhead is in. */
  viewMonth(month: number): void {
    this.#post({ type: 'viewMonth', month });
  }

  /** Asks for the whole map again (a `cells` of revision 0). */
  resyncMap(): void {
    this.#post({ type: 'resyncMap' });
  }

  prefetch(bbox: BBox): void {
    this.#post({ type: 'prefetch', bbox });
  }

  retryChunks(): void {
    this.#post({ type: 'retryChunks' });
  }

  parcelSummary(parcelId: ParcelId, day: Day, projectId?: string): Promise<ParcelSummary | null> {
    return this.#lookups.parcelSummary(parcelId, day, projectId);
  }

  resolveBrush(query: BrushQuery): Promise<BrushLotsResult> {
    return this.#lookups.resolveBrush(query);
  }

  lotOutlines(lots: ParcelId[]): Promise<LotOutlinesResult> {
    return this.#lookups.lotOutlines(lots);
  }

  lotAt(point: [number, number]): Promise<LotAtResult> {
    return this.#lookups.lotAt(point);
  }

  previewBuildings(lots: ParcelId[], stories: number): Promise<PreviewResult> {
    return this.#lookups.previewBuildings(lots, stories);
  }

  heightLids(bbox: [number, number, number, number]): Promise<HeightLidsResult> {
    return this.#lookups.heightLids(bbox);
  }

  brushCatalog(): Promise<BrushCatalog | null> {
    return this.#lookups.brushCatalog();
  }

  /**
   * Replaces a crashed (or any) worker with a fresh one and, when a timeline was open, re-opens it
   * with the last policy and lots at a new rev, so older answers stay stale.
   */
  restart(worker: ScenarioWorkerInput): void {
    if (this.#disposed) return;
    this.#detach();
    this.#crashed = false;
    this.#lookups.closed = false;
    this.#worker = worker as ScenarioWorkerLike;
    this.#attach(this.#worker);
    if (this.#manifest !== null && this.#policy !== null) this.#sendOpen();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#lookups.closed = true;
    this.#detach();
  }

  #attach(worker: ScenarioWorkerLike): void {
    worker.onmessage = (e) => this.#receive(e.data as TimelineHostResponse);
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
    // onmessageerror can fire while the worker is still alive: detach and terminate it.
    this.#detach();
    this.#events.onCrash?.(e);
  }

  #receive(msg: TimelineHostResponse): void {
    if (this.#disposed || this.#crashed) return;
    if (this.#lookups.receive(msg)) return;
    switch (msg.type) {
      case 'ready':
        this.#events.onReady?.(msg);
        return;
      case 'compiling':
        if (msg.rev >= this.#policyRev) this.#events.onCompiling?.(msg);
        return;
      case 'compiled':
        this.#acceptedRev = Math.max(this.#acceptedRev, msg.rev);
        if (msg.rev >= this.#policyRev) this.#events.onCompiled?.(msg);
        return;
      case 'filled':
        if (msg.rev >= this.#policyRev) this.#events.onFilled?.(msg);
        return;
      case 'refill':
        if (msg.rev >= this.#policyRev) this.#events.onRefill?.(msg);
        return;
      case 'cells':
        this.#events.onCells?.(msg);
        return;
      case 'lookups':
        this.#events.onLookups?.(msg);
        return;
      case 'error':
        if (msg.code === 'bad-request' && msg.rev === this.#policyRev) {
          this.#policyRev = this.#acceptedRev;
        }
        this.#events.onError?.(msg);
        return;
      case 'chunks':
        this.#events.onChunks?.(msg);
        return;
      case 'heights':
        this.#events.onHeights?.(msg);
        return;
      case 'parcelSummary':
      case 'brushLots':
      case 'brushCatalog':
      case 'lotOutlines':
      case 'previewBuildings':
      case 'heightLids':
      case 'lotAt':
        return; // an answer nobody waits for
      default: {
        const never: never = msg;
        console.error('[sim] unknown response', never);
      }
    }
  }
}
