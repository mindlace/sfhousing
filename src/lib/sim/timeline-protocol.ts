// Worker messages of the timeline host (ensemble-runner interface S14) and the lookups it shares
// with the editor's router. Types only, besides the two request checks.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { HeightCity, HeightLids } from '$lib/map/height/types';
import type { PackedCell, TimelineUpdate } from '$lib/map/types';
import type { BBox } from '$lib/plan';
import type { Day } from '$lib/timelapse/time';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { LeverLookups } from './levers/apply';
import type { BrushCatalog, BrushQuery } from './levers/brushes';
import type { LeverCapacity } from './levers/resolve';
import type { LimitOwner } from './levers/source';
import type { LotOutlines } from './outlines';
import type {
  ChunksResponse,
  ParcelSummary,
  ReadyResponse,
  Rev,
  SimRequest,
  SimResponse
} from './protocol';
import type { LoadErrorCode } from './world/input/load';
import type { ScoreStatics, SeriesChunk } from './world/score/types';

/**
 * The glass lids of a view, built on the latest complete city (`lids.limitsRev`). `missing`
 * counts the cells intersecting the bbox whose chunks are not loaded (the page asks again as they
 * load). `no-session`: no session with levers (or it ended before answering); `superseded`: a
 * newer `heightLids` replaced this one; `too-large`: the bbox spans too far for lids.
 */
export type HeightLidsResult =
  | { ok: true; lids: HeightLids; missing: number }
  | { ok: false; reason: 'no-session' | 'superseded' | 'too-large'; message: string };
/**
 * The lot under a point, built or vacant, and the layer that sets its height limit. `parcelId` is
 * null where no loaded lot holds the point. `owner` is null when the lot has no row in the limits
 * table or the session has no limits yet. `no-session`: no session with levers.
 */
export type LotAtResult =
  | { ok: true; parcelId: ParcelId | null; owner: LimitOwner | null }
  | { ok: false; reason: 'no-session'; message: string };
/**
 * The buildings a preview's lots could hold, packed as one cell (`'preview'`), or null when none
 * builds. `built` counts the lots packed; `missing` the requested lots (within the cap) whose
 * record is not loaded. `no-session`: no session with levers (or it ended before answering).
 */
export type PreviewResult =
  | { ok: true; pack: PackedCell | null; built: number; missing: number }
  | { ok: false; reason: 'no-session'; message: string };
/**
 * The outlines of requested lots, for the dashed overlay while the eraser is chosen. `positions`
 * holds lng/lat pairs of every ring of every loaded lot (transferred); `starts` the vertex index
 * where each ring starts (rings + 1 entries); `ringLot` each ring's index into `lots` (the lots
 * answered, in request order). `missing` counts requested lots whose record is not loaded.
 * `no-session`: no session with levers (or it ended before answering).
 */
export type LotOutlinesResult =
  | (LotOutlines & { ok: true; missing: number })
  | { ok: false; reason: 'no-session'; message: string };
/**
 * A brush's lots: `points` holds each lot's label point (lng, lat), transferred. `no-session`: no
 * session with levers (or it ended before answering); `data-missing`: a file the query needs is
 * absent from the manifest or failed to load; `bad-request`: the query is malformed.
 */
export type BrushLotsResult =
  | { ok: true; lots: ParcelId[]; points: Float64Array }
  | { ok: false; reason: 'no-session' | 'data-missing' | 'bad-request'; message: string };

/** The load error codes plus `'timeline'` (a failure of the timeline run itself). */
export type TimelineErrorCode = LoadErrorCode | 'timeline';

/**
 * Opens a timeline session, disposing the editor host's state.
 *
 * `rev` is the page's count of policy edits (`open` is rev 1 of a session; each `setPolicy` is the
 * next): the worker drops work for an older `rev`. The client drops a `compiling` whose `rev` is
 * older than the last `setPolicy` or `open` it sent (progress display only). It delivers
 * `compiled`, `filled` and `refill` in arrival order whatever their `rev`, dropping only those
 * older than the last `open` it sent: a post at an older `rev` was valid when the worker made it,
 * months before an edit are never posted again, and the worker's `refill` at the newer `rev`
 * withdraws what the edit changes. A consumer applies these in order and does not assume `rev`
 * rises from one message to the next; a `filled` chunk belongs to the statics of the last
 * `compiled` delivered before it.
 *
 * The page reconciles the document before sending: `openSimDoc4` with the dataset's calibration
 * and `asOf`, read from the manifest's files. The worker rejects an unreconciled document with
 * `error` code `bad-request` at that `rev`, and the previous timeline keeps filling.
 *
 * `lots` holds the lots of each brush query the document needs (`queriesOf4`), by query key,
 * resolved by the page through `resolveBrush`. `months` is the window length in model months; each
 * side runs one world, on seed 1.
 *
 * `cells` and `lookups` (the responses) carry no `rev` and are never dropped: the map's revision
 * numbers are their own sequence.
 */
export type OpenTimelineRequest = {
  type: 'openTimeline';
  rev: Rev;
  manifest: Manifest;
  policy: SimPolicy4;
  lots: Record<string, ParcelId[]>;
  months: number;
};

/**
 * A policy edit. Same contract as `OpenTimelineRequest`: `policy` is reconciled by the page
 * (`openSimDoc4`, calibration and `asOf` from the manifest's files) before sending; an
 * unreconciled one is rejected with `error` code `bad-request` at this `rev` and the previous
 * timeline keeps filling. `rev` is the page's count of policy edits; older work is dropped.
 *
 * Every acceptance of an edit is answered by exactly one `refill` at its `rev`; a rejected edit by
 * `error` `bad-request` at its `rev` and no `refill`. The `compiled` at that `rev` comes before the
 * `refill`, and no `filled` at that `rev` comes before it. When the edit withdraws months, `from`
 * is the first calendar month not final at the first changed model month - 1; when it withdraws
 * nothing (kept), `from` is the first calendar month not yet posted (the window length when the
 * window is whole). An edit taken before the dataset loaded opens the session at its `rev` and is
 * answered the same way (`from` 0, after its `compiled`).
 *
 * An edit is accepted unless answered `bad-request`, which can come at any time before its
 * `refill`, also after its `compiling` and after the worker began using it (a compile rejects a
 * document at the first month that cannot be compiled). After a rejected edit the worker's
 * timelines are the last accepted `setPolicy`'s: an edit at `rev` R that a later one replaced is
 * not abandoned until a later edit has its `refill`; if the later ones are all rejected, R settles
 * at its own `rev`. When R was in use and the later edit is rejected before the worker accepted
 * it, R simply settles: its `compiled` (unless already out) and one `refill`. When R is taken up
 * again (it was still compiling, or a later edit was rejected after the worker accepted it), it is
 * accepted afresh: a new `compiled` and a new `refill` at R, even if it had them already (its
 * world may have been restored for the later edit, and the `refill` re-bases `from`). So a `rev`
 * can get more than one `compiled` and `refill`: never dedupe them by `rev`. Otherwise the later
 * edit's `refill`, at a `rev` above R, answers R. In a chain the `bad-request`s can arrive out of
 * `rev` order (R + 2's, then R + 1's once it is taken up again). So the page keeps every document
 * it sent since the last `rev` answered by a `refill`, that `rev`'s own document included (it may
 * undo to it), undoes to
 * the newest one not answered `bad-request` on each `bad-request` (an older `rev`'s included),
 * and is stale from its oldest unsettled edit until a `refill` at that `rev` or a later one has
 * arrived and the filled months reach the playhead. A taken-up edit's `compiling` is older than
 * the last `setPolicy` sent, so the client drops it: no progress shows while it recompiles.
 * Transient: between a late `bad-request` and the taken-up edit's acceptance, `heights`,
 * `lookups` and `cells` can still come from the rejected edit's timelines (in use until then);
 * the acceptance replaces them (new `lookups`, a fresh height build, a rewind on a restore).
 *
 * Exceptions, where filling stops and no `refill` comes until the next accepted edit or open: a
 * throw in the timelines in use (rule 21, `error` `timeline`); a late rejection with nothing to
 * take up (the open's own document); and an edit sent before the dataset loaded that the compiler
 * then rejects (it replaced the opening's document, which is not taken up again).
 */
export type SetPolicyRequest = {
  type: 'setPolicy';
  rev: Rev;
  policy: SimPolicy4;
  lots: Record<string, ParcelId[]>;
};

export type TimelineRequest =
  | OpenTimelineRequest
  | SetPolicyRequest
  /** The model month the playhead is in. */
  | { type: 'viewMonth'; month: number }
  /** Answered by a `cells` whose update is revision 0 with every cell and the whole demolish list. */
  | { type: 'resyncMap' };

/** The requests the timeline host answers beside its own (the editor's shapes, with `day`). */
export type SharedRequest =
  | { type: 'prefetch'; bbox: BBox }
  | { type: 'retryChunks' }
  | { type: 'parcelSummary'; reqId: number; parcelId: ParcelId; day: Day; projectId?: string }
  | { type: 'resolveBrush'; reqId: number; query: BrushQuery }
  | { type: 'brushCatalog'; reqId: number }
  // The ring outlines of lots, for the overlay while the eraser is chosen.
  | { type: 'lotOutlines'; reqId: number; lots: ParcelId[] }
  // The buildings a Paint stroke's lots could hold at `stories`. The page sends the lots nearest
  // first.
  | { type: 'previewBuildings'; reqId: number; lots: ParcelId[]; stories: number }
  // The glass lids of the loaded lots in a view (lng/lat bbox), on the latest complete city.
  | { type: 'heightLids'; reqId: number; bbox: [number, number, number, number] }
  // The lot under a point (lng, lat) and who sets its limit, answered at once from the limits the
  // worker holds.
  | { type: 'lotAt'; reqId: number; point: [number, number] };

export type TimelineHostRequest = TimelineRequest | SharedRequest;

export type TimelineResponse =
  | { type: 'compiling'; rev: Rev; done: number; total: number; failedCells: string[] }
  | {
      type: 'compiled';
      rev: Rev;
      capacity: LeverCapacity;
      unknownLots: number;
      statics: ScoreStatics;
    }
  /** `through` is the last final calendar-month index; `series.from` the first index carried. */
  | { type: 'filled'; rev: Rev; through: number; series: SeriesChunk }
  /**
   * Every calendar month from index `from` on is withdrawn until filled again. Exactly one answers
   * each accepted `setPolicy` (see `SetPolicyRequest`): one at `rev` >= R settles edit R.
   */
  | { type: 'refill'; rev: Rev; from: number }
  /** No `rev`: never dropped. */
  | { type: 'cells'; render: TimelineUpdate }
  /** No `rev`: never dropped. A new object each time the permitting in view changes. */
  | { type: 'lookups'; month: number; lookups: LeverLookups }
  | { type: 'error'; rev: Rev; code: TimelineErrorCode; message: string };

/** The answers the timeline host posts beside its own messages. */
export type SharedResponse =
  | ReadyResponse
  | ChunksResponse
  | { type: 'parcelSummary'; reqId: number; summary: ParcelSummary | null }
  | { type: 'brushLots'; reqId: number; result: BrushLotsResult }
  | { type: 'brushCatalog'; reqId: number; catalog: BrushCatalog | null }
  | { type: 'lotOutlines'; reqId: number; result: LotOutlinesResult }
  | { type: 'previewBuildings'; reqId: number; result: PreviewResult }
  // A policy revision's height regions and contours, once per revision; the chain and label
  // buffers are transferred.
  | { type: 'heights'; rev: Rev; city: HeightCity }
  | { type: 'heightLids'; reqId: number; result: HeightLidsResult }
  | { type: 'lotAt'; reqId: number; result: LotAtResult };

/** Everything the timeline host posts: its own messages and the shared answers. */
export type TimelineHostResponse = TimelineResponse | SharedResponse;

/** Everything the Worker accepts and posts: the editor's and the timeline host's. */
export type WorkerRequest = SimRequest | TimelineHostRequest;
export type WorkerResponse = SimResponse | TimelineHostResponse;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function lotsProblem(lots: unknown): string | null {
  if (!isObject(lots)) return 'lots must be an object of parcel id arrays';
  for (const [key, ids] of Object.entries(lots)) {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
      return `lots[${JSON.stringify(key)}] must be an array of strings`;
    }
  }
  return null;
}

/** A message for the first thing wrong with an `openTimeline` request, or null when it is sound. */
export function openTimelineProblem(req: unknown): string | null {
  if (!isObject(req)) return 'openTimeline must be an object';
  if (!isInt(req.rev)) return 'rev must be an integer';
  if (!isObject(req.manifest)) return 'manifest must be an object';
  if (!isObject(req.policy)) return 'policy must be an object';
  const lots = lotsProblem(req.lots);
  if (lots !== null) return lots;
  if (!isInt(req.months) || req.months < 1) return 'months must be an integer >= 1';
  return null;
}

/** A message for the first thing wrong with a `setPolicy` request, or null when it is sound. */
export function setPolicyProblem(req: unknown): string | null {
  if (!isObject(req)) return 'setPolicy must be an object';
  if (!isInt(req.rev)) return 'rev must be an integer';
  if (!isObject(req.policy)) return 'policy must be an object';
  return lotsProblem(req.lots);
}
