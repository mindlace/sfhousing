import type { Day } from '$lib/timelapse/time';

/**
 * The furthest day the user has reached by playback or scrubbing. The future is precomputed, so
 * the UI reveals outcomes only up to this mark; scrubbing back moves the cursor, not the mark.
 */
export class HighWater {
  #value = $state<Day>(0);

  constructor(start: Day) {
    this.#value = start;
  }

  get value(): Day {
    return this.#value;
  }

  /** Raise the mark to `day` if it is further than the current one. */
  reach(day: Day): void {
    if (day > this.#value) this.#value = day;
  }

  /** Set the mark to `day`, even when that lowers it (a new run). */
  reset(day: Day): void {
    this.#value = day;
  }
}
