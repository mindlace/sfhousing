// The mini city's brush files (plan 3 Task 5): a three-stop transit
// network and one neighborhood polygon. Fixture values only (tier 4, made up for the brush tests):
// not data. Browser-safe (no `node:` imports); the harness encodes and deflates them.
import type { ParcelId } from '$lib/data/parcel';
import type { TransitNetwork } from '$lib/data/transit';
import type { MiniCity } from './mini-parcels';

/** The lots the three stops stand on: regional rail, Metro, a Muni Rapid bus. */
export const MINI_STOP_LOTS: ParcelId[] = ['0026T009', '2999A001', '3512005'];

/** transit.json's network: three stops, one per type, each on a lot's label point. */
export function miniTransit(city: MiniCity): TransitNetwork {
  const p = city.parcels;
  const at = (id: ParcelId): [number, number] => {
    const i = p.index.get(id)!;
    return [p.labelPoint[2 * i], p.labelPoint[2 * i + 1]];
  };
  const specs = [
    { name: 'Rail', op: 'bart', mode: 'heavy-rail', route: 'R' },
    { name: 'Metro', op: 'muni', mode: 'light-rail', route: 'N' },
    { name: 'Rapid', op: 'muni', mode: 'bus', route: '9R' }
  ] as const;
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [
      { id: 'bart', label: 'BART', serviceDate: '2026-10-01' },
      { id: 'muni', label: 'Muni', serviceDate: '2026-10-01' }
    ],
    vehicles: { v: { label: 'Vehicle', seats: null, capacity: 50 } },
    stops: specs.map((s, k) => ({
      id: `${s.op}:${s.name}`,
      name: s.name,
      lngLat: at(MINI_STOP_LOTS[k]),
      stationId: null,
      placeId: `${s.op}:${s.name}`
    })),
    patterns: specs.map((s, k) => ({
      id: `${s.name}:p`,
      operatorId: s.op,
      routeId: s.route,
      routeName: s.route,
      mode: s.mode,
      direction: 0,
      vehicle: 'v',
      cars: 1,
      stops: [{ stop: k, tph: 4, tpd: 40 }]
    }))
  };
}

export const MINI_NEIGHBORHOOD = 'Mini Mission';

/** neighborhoods.geojson: one polygon, the bbox of the manifest's first cell (50_25). */
export function miniNeighborhoods(city: MiniCity): unknown {
  const [w, s, e, n] = city.manifest.chunks[0].bbox;
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: MINI_NEIGHBORHOOD },
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [w, s],
              [e, s],
              [e, n],
              [w, n],
              [w, s]
            ]
          ]
        }
      }
    ]
  };
}
