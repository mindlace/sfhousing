import type { ParcelId } from '$lib/data/parcel';
import { parcelRankOf } from '$lib/sim/scenario/input';
import type { SimInput } from '$lib/sim/scenario/types';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';

/** What no policy can change. */
export interface Statics {
  /** The dataset date. */
  asOf: Day;
  /** Row i is row i of every `ZoningView`. */
  parcelId: ParcelId[];
  rank: Uint32Array;
  projects: InFlightProject[];
  districtMaxStories: number | null;
}

/** Builds the statics from the loaded dataset. */
export function staticsOf(input: SimInput): Statics {
  return {
    asOf: input.asOf,
    parcelId: input.parcels.id,
    rank: parcelRankOf(input.parcels.id),
    projects: input.projects,
    districtMaxStories: input.districtMaxStories
  };
}
