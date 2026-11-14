// The page's pending request/answer promises for the worker's lookups (parcel summary, brushes,
// outlines, lot-at, preview, glass lids, brush catalog), shared by ScenarioClient and
// TimelineClient. Each answers `no-session` (or null) when the owner ends the session.
import type { ParcelId } from '$lib/data/parcel';
import type { Day } from '$lib/timelapse/time';
import type { BrushCatalog, BrushQuery } from './levers/brushes';
import type { ParcelSummary } from './protocol';
import type {
  BrushLotsResult,
  HeightLidsResult,
  LotAtResult,
  LotOutlinesResult,
  PreviewResult,
  WorkerRequest
} from './scenario/types';

const ended = 'the worker session ended before answering';
const noSession = (): BrushLotsResult => ({ ok: false, reason: 'no-session', message: ended });
const noSessionOutlines = (): LotOutlinesResult => ({
  ok: false,
  reason: 'no-session',
  message: ended
});
const noSessionLotAt = (): LotAtResult => ({ ok: false, reason: 'no-session', message: ended });
const noSessionPreview = (): PreviewResult => ({ ok: false, reason: 'no-session', message: ended });
const noSessionLids = (): HeightLidsResult => ({ ok: false, reason: 'no-session', message: ended });

export class LookupRequests {
  #post: (msg: WorkerRequest) => void;
  #reqId = 0;
  #pending = new Map<number, (s: ParcelSummary | null) => void>();
  #pendingBrush = new Map<number, (r: BrushLotsResult) => void>();
  #pendingOutlines = new Map<number, (r: LotOutlinesResult) => void>();
  #pendingLotAt = new Map<number, (r: LotAtResult) => void>();
  #pendingPreview = new Map<number, (r: PreviewResult) => void>();
  #pendingCatalog = new Map<number, (c: BrushCatalog | null) => void>();
  #pendingLids = new Map<number, (r: HeightLidsResult) => void>();

  /**
   * Set by the owner while it is disposed or crashed: a request then answers `no-session` (null)
   * at once and posts nothing.
   */
  closed = false;

  constructor(post: (msg: WorkerRequest) => void) {
    this.#post = post;
  }

  parcelSummary(parcelId: ParcelId, day: Day, projectId?: string): Promise<ParcelSummary | null> {
    if (this.closed) return Promise.resolve(null);
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pending.set(reqId, resolve);
      this.#post({
        type: 'parcelSummary',
        reqId,
        parcelId,
        day,
        ...(projectId !== undefined && { projectId })
      });
    });
  }

  /**
   * The lots a brush covers (eligible only), with their label points. Answered by a session
   * initialised with levers once it has loaded; `no-session` otherwise, and on crash, `restart`
   * and `dispose`.
   */
  resolveBrush(query: BrushQuery): Promise<BrushLotsResult> {
    if (this.closed) return Promise.resolve(noSession());
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pendingBrush.set(reqId, resolve);
      this.#post({ type: 'resolveBrush', reqId, query });
    });
  }

  /**
   * The ring outlines of lots (the loaded ones; `missing` counts the rest). Answered by a session
   * initialised with levers; `no-session` otherwise, and on crash, `restart` and `dispose`.
   */
  lotOutlines(lots: ParcelId[]): Promise<LotOutlinesResult> {
    if (this.closed) return Promise.resolve(noSessionOutlines());
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pendingOutlines.set(reqId, resolve);
      this.#post({ type: 'lotOutlines', reqId, lots });
    });
  }

  /**
   * The lot under `point` (lng, lat) and the layer that sets its height limit, from the limits the
   * worker holds now. Answered by a session initialised with levers; `no-session` otherwise, and
   * on crash, `restart` and `dispose`.
   */
  lotAt(point: [number, number]): Promise<LotAtResult> {
    if (this.closed) return Promise.resolve(noSessionLotAt());
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pendingLotAt.set(reqId, resolve);
      this.#post({ type: 'lotAt', reqId, point });
    });
  }

  /**
   * The buildings `lots` could hold at `stories` (/sim's live preview of a Paint stroke). Answered
   * by a session initialised with levers; `no-session` otherwise, and on crash, `restart` and
   * `dispose`.
   */
  previewBuildings(lots: ParcelId[], stories: number): Promise<PreviewResult> {
    if (this.closed) return Promise.resolve(noSessionPreview());
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pendingPreview.set(reqId, resolve);
      this.#post({ type: 'previewBuildings', reqId, lots, stories });
    });
  }

  /**
   * The glass lids of the loaded lots in `bbox` (lng/lat), on the latest complete city. A newer
   * call answers this one `superseded`. Answered by a session initialised with levers;
   * `no-session` otherwise, and on crash, `restart` and `dispose`.
   */
  heightLids(bbox: [number, number, number, number]): Promise<HeightLidsResult> {
    if (this.closed) return Promise.resolve(noSessionLids());
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pendingLids.set(reqId, resolve);
      this.#post({ type: 'heightLids', reqId, bbox });
    });
  }

  /** The brush pickers' catalog; null without a lever session, and on crash, restart, dispose. */
  brushCatalog(): Promise<BrushCatalog | null> {
    if (this.closed) return Promise.resolve(null);
    const reqId = ++this.#reqId;
    return new Promise((resolve) => {
      this.#pendingCatalog.set(reqId, resolve);
      this.#post({ type: 'brushCatalog', reqId });
    });
  }

  /** True when `msg` answered a pending request. */
  receive(msg: { type: string }): boolean {
    const m = msg as { type: string; reqId: number } & Record<string, unknown>;
    const take = <T>(map: Map<number, (v: T) => void>, value: T): boolean => {
      const resolve = map.get(m.reqId);
      if (!resolve) return false;
      map.delete(m.reqId);
      resolve(value);
      return true;
    };
    switch (m.type) {
      case 'parcelSummary':
        return take(this.#pending, m.summary as ParcelSummary | null);
      case 'brushLots':
        return take(this.#pendingBrush, m.result as BrushLotsResult);
      case 'lotOutlines':
        return take(this.#pendingOutlines, m.result as LotOutlinesResult);
      case 'lotAt':
        return take(this.#pendingLotAt, m.result as LotAtResult);
      case 'previewBuildings':
        return take(this.#pendingPreview, m.result as PreviewResult);
      case 'brushCatalog':
        return take(this.#pendingCatalog, m.catalog as BrushCatalog | null);
      case 'heightLids':
        return take(this.#pendingLids, m.result as HeightLidsResult);
      default:
        return false;
    }
  }

  /** Every pending request answered: summaries and the catalog null, the rest `no-session`. */
  resolveAll(): void {
    for (const resolve of this.#pending.values()) resolve(null);
    this.#pending.clear();
    for (const resolve of this.#pendingBrush.values()) resolve(noSession());
    this.#pendingBrush.clear();
    for (const resolve of this.#pendingOutlines.values()) resolve(noSessionOutlines());
    this.#pendingOutlines.clear();
    for (const resolve of this.#pendingLotAt.values()) resolve(noSessionLotAt());
    this.#pendingLotAt.clear();
    for (const resolve of this.#pendingPreview.values()) resolve(noSessionPreview());
    this.#pendingPreview.clear();
    for (const resolve of this.#pendingCatalog.values()) resolve(null);
    this.#pendingCatalog.clear();
    for (const resolve of this.#pendingLids.values()) resolve(noSessionLids());
    this.#pendingLids.clear();
  }
}
