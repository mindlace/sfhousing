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
 * next): the worker drops work for an older `rev`, and the client drops `compiling`, `compiled`,
 * `filled` and `refill` with an older `rev` than its drop floor. The floor is the last
 * `setPolicy` / `open` rev it sent, except that an `error` code `bad-request` at a rev equal to the
 * floor lowers it to the last rev seen accepted (the last `compiled` received, or the open rev
 * before any), because the worker keeps filling under the previous timelines and posts at that
 * rev; a `bad-request` for an older rev changes nothing. A `refill` may precede its rev's
 * `compiled` and is not dropped for it.
 *
 * The page reconciles the document before sending: `openSimDoc4` with the dataset's calibration
 * and `asOf`, read from the manifest's files. The worker rejects an unreconciled document with
 * `error` code `bad-request` at that `rev`, and the previous timeline keeps filling.
 *
 * `lots` holds the lots of each brush query the document needs (`queriesOf4`), by query key,
 * resolved by the page through `resolveBrush`. `worlds` and `months` are the ensemble size and the
 * window length in model months.
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
  worlds: number;
  months: number;
};

/**
 * A policy edit. Same contract as `OpenTimelineRequest`: `policy` is reconciled by the page
 * (`openSimDoc4`, calibration and `asOf` from the manifest's files) before sending; an
 * unreconciled one is rejected with `error` code `bad-request` at this `rev` and the previous
 * timeline keeps filling. `rev` is the page's count of policy edits; older work is dropped.
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
  /** Every calendar month from index `from` on is withdrawn until filled again. */
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
  if (!isInt(req.worlds) || req.worlds < 1) return 'worlds must be an integer >= 1';
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
