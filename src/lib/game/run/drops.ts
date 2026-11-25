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

export function planDrops(markers: Iterable<Marker>, asOf: Day, to: Day): Drop[] {
  const byRow = new Map<number, Marker>();
  for (const m of markers) byRow.set(m.row, m);
  const out: Drop[] = [];
  for (const m of byRow.values()) {
    if (!(m.completed > asOf && m.completed <= to)) continue;
    const net = m.homes - m.existing;
    if (!(net > 0)) continue;
    out.push({
      row: m.row,
      lng: m.lng,
      lat: m.lat,
      day: m.completed,
      worth: { home: net },
      policy: m.policy
    });
  }
  return out.sort((a, b) => a.day - b.day || a.row - b.row);
}

export interface RunFeed {
  drops: readonly Drop[];
  day: Day;
  running: boolean;
  project(lng: number, lat: number): { x: number; y: number } | null;
}
