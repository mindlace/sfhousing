// R1 (contracts stub): drops from the city markers. run-play makes it real.
import type { Day } from '$lib/timelapse/time';
import type { Units } from '../state';

export interface Marker {
  row: number;
  lng: number;
  lat: number;
  completed: Day;
  homes: number;
  existing: number;
  policy: boolean;
}

export interface Drop {
  row: number;
  lng: number;
  lat: number;
  day: Day;
  worth: Units;
  policy: boolean;
}

export function planDrops(_markers: Iterable<Marker>, _asOf: Day, _to: Day): Drop[] {
  throw new Error('not implemented');
}

export interface RunFeed {
  drops: readonly Drop[];
  day: Day;
  running: boolean;
  project(lng: number, lat: number): { x: number; y: number } | null;
}
