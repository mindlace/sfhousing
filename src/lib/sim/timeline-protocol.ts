// Worker messages of the timeline host (ensemble-runner interface S14). They replace
// `initScenario`, `reroll`, `setLevers`, `timeline`, `ranks` and `levers` on /sim; every other
// message of the scenario protocol keeps its shape. Types only, besides the two request checks.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { TimelineUpdate } from '$lib/map/types';
import type { SimPolicy4 } from '$lib/timeline/policy4';
import type { LeverLookups } from './levers/apply';
import type { LeverCapacity } from './levers/resolve';
import type { Rev } from './protocol';
import type { ScenarioErrorCode, ScenarioRequest, ScenarioResponse } from './scenario/types';
import type { ScoreStatics, SeriesChunk } from './world/score/types';

/** Today's error codes plus `'timeline'` (a failure of the timeline run itself). */
export type TimelineErrorCode = ScenarioErrorCode | 'timeline';

/**
 * Opens a timeline session, routed and checked as `initScenario` is and, like it, disposing the
 * editor host's state.
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

/** Today's requests the timeline host also answers (shapes unchanged). */
export type SharedRequest = Extract<
  ScenarioRequest,
  {
    type:
      | 'parcelSummary'
      | 'resolveBrush'
      | 'brushCatalog'
      | 'lotOutlines'
      | 'previewBuildings'
      | 'heightLids'
      | 'lotAt'
      | 'prefetch'
      | 'retryChunks';
  }
>;

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

/** Everything the timeline host posts: its own messages and today's shared answers. */
export type TimelineHostResponse =
  TimelineResponse | Exclude<ScenarioResponse, { type: 'error' | 'timeline' | 'ranks' | 'levers' }>;

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
