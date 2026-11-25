import type { Day } from '$lib/timelapse/time';
import type { Drop, RunFeed } from '../drops';

export interface FeedBounds {
  west: number;
  east: number;
  south: number;
  north: number;
}

/**
 * A reactive `RunFeed` for specs: tests set `drops`, `day` and `running`. `project` maps
 * longitude and latitude linearly onto a box of `size`, north at y 0, and is null outside it.
 */
export class FakeFeed implements RunFeed {
  drops: readonly Drop[] = $state.raw([]);
  day: Day = $state(0);
  running: boolean = $state(false);
  readonly size: { w: number; h: number };
  readonly bounds: FeedBounds;

  constructor(
    size: { w: number; h: number },
    bounds: FeedBounds = { west: -122.52, east: -122.35, south: 37.7, north: 37.82 }
  ) {
    this.size = size;
    this.bounds = bounds;
  }

  project(lng: number, lat: number): { x: number; y: number } | null {
    const { west, east, south, north } = this.bounds;
    if (lng < west || lng > east || lat < south || lat > north) return null;
    return {
      x: ((lng - west) / (east - west)) * this.size.w,
      y: ((north - lat) / (north - south)) * this.size.h
    };
  }

  /** A drop whose point projects back to (x, y). */
  dropAt(row: number, x: number, y: number, day: Day, homes = 1, policy = false): Drop {
    const { west, east, south, north } = this.bounds;
    return {
      row,
      lng: west + (x / this.size.w) * (east - west),
      lat: north - (y / this.size.h) * (north - south),
      day,
      worth: { home: homes },
      policy
    };
  }
}
