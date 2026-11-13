import type { ParcelId } from '$lib/data/parcel';
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
