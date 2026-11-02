// The /lesscars playback protocol (Plan 2 Task 4): the third worker host's requests and answers.
// Types only and worker-safe (no runtime exports). Errors reuse the scenario `error` response
// (`ScenarioErrorCode`); `ready` and `chunks` are the shared ones.
import type { LessCarsPlanFile, LessCarsSitesFile } from '$lib/data/lesscars/codec';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId } from '$lib/data/parcel';
import type { TimelineUpdate } from '$lib/map/types';
import type { Day } from '$lib/timelapse/time';
import type { Rev } from '../protocol';

/** What a tap on a /lesscars building shows: one project at the scrubbed day. */
export interface PlaybackCard {
  projectId: string;
  kind: 'market' | 'freed' | 'parking';
  /** The plan project's label for an initiative build; null for a market project. */
  planLabel: string | null;
  /** 'Block B, Lot L' (blockLot) of the first parcel; the site id for freed land. */
  where: string;
  units: number;
  existingUnits: number;
  stories: number | null;
  status: 'planning' | 'construction' | 'complete' | 'stopped';
  /** The construction start, once it is on or before the day; else null. */
  constructionDay: Day | null;
  /** The completion, once it is on or before the day; else null. */
  completeDay: Day | null;
}

export type PlaybackRequest =
  | {
      type: 'initPlayback';
      rev: Rev;
      manifest: Manifest;
      plan: LessCarsPlanFile;
      sites: LessCarsSitesFile;
    }
  | { type: 'playbackCard'; reqId: number; projectId: string; day: Day };

export type PlaybackResponse =
  | {
      type: 'playbackLoaded';
      rev: Rev;
      seed: number;
      /** Label points of every parcel the plan names (parking and garage parcels) in parcels.bin. */
      places: Record<ParcelId, [number, number]>;
      reservations: { parcelId: ParcelId; kept: boolean }[];
    }
  | { type: 'playback'; rev: Rev; render: TimelineUpdate; complete: boolean }
  | { type: 'playbackCard'; reqId: number; card: PlaybackCard | null };
