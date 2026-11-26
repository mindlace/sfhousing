// Cars per household by zone (Census block group) at the playhead -> map data (car-ownership
// Task 12). Pure apart from the fetch. The zones' polygons are `car-zones.json` (property `z`, the
// zone index); the values are `TimelineView.cars.zones[month]`, NaN for a zone with no households.
import type { Feature, FeatureCollection, Geometry } from 'geojson';

/** The Layers panel's row. */
export const CARS_LABEL = 'Cars per household';
/** Under the legend. */
export const CARS_CAPTION = 'By Census block group, at the playhead.';

/** The legend's bin edges, cars per household; a value at an edge falls in the bin above it. */
export const CARS_BINS = [0.5, 0.75, 1, 1.5] as const;
export const CARS_LEGEND = ['Under 0.5', '0.5–0.75', '0.75–1', '1–1.5', '1.5+'] as const;

/** The bin (1 to 5) of a number of cars per household. */
export function carsBin(v: number): 1 | 2 | 3 | 4 | 5 {
  let b = 1;
  for (const t of CARS_BINS) if (v >= t) b++;
  return b as 1 | 2 | 3 | 4 | 5;
}

export interface ZoneProps {
  z: number;
  /** Cars per household; null for a zone with no households (no data, never 0). */
  v: number | null;
}

/**
 * Each zone of `geo` with `v` = `values[z]`; null where that is NaN or missing. The geometry is
 * shared, not copied: the source is rebuilt on every playhead month.
 */
export function zonesCollection(
  geo: FeatureCollection,
  values: Float32Array
): FeatureCollection<Geometry, ZoneProps> {
  return {
    type: 'FeatureCollection',
    features: geo.features.map((f): Feature<Geometry, ZoneProps> => {
      const z = Number(f.properties?.z);
      const x = Number.isInteger(z) && z >= 0 && z < values.length ? values[z] : Number.NaN;
      return {
        type: 'Feature',
        properties: { z, v: Number.isFinite(x) ? x : null },
        geometry: f.geometry
      };
    })
  };
}

export async function loadCarZones(
  url: string,
  fetchFn: (u: string) => Promise<Response> = (u) => fetch(u)
): Promise<FeatureCollection> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`car zones ${url}: HTTP ${res.status}`);
  const geo = (await res.json()) as FeatureCollection;
  if (geo?.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error(`car zones ${url}: not a FeatureCollection`);
  }
  return geo;
}
