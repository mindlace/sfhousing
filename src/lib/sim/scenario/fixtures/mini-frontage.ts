// The mini city's brush files (plan 3 Task 5): frontage.bin's columns, a three-stop transit
// network and one neighborhood polygon. Fixture values only (tier 4, made up for the brush tests):
// not data. Browser-safe (no `node:` imports); the harness encodes and deflates them.
import { idsHash } from '$lib/data/column-file';
import type { Frontage } from '$lib/data/frontage-codec';
import type { ParcelId } from '$lib/data/parcel';
import type { TransitNetwork } from '$lib/data/transit';
import type { Provenance } from '$lib/timelapse/types';
import type { MiniCity } from './mini-parcels';

const prov: Provenance = {
  tier: 4,
  label: 'Frontage',
  sources: [{ label: 'timelapse-sim mini fixture', url: 'https://example.org/mini-fixture' }],
  method: 'Hand-written simulator fixture (tier 4, made up); not data.'
};

/** Segment 0: MINI ST (arterial); segment 1: MINI AVE (residential). Names sorted. */
export const MINI_STREETS = ['MINI AVE', 'MINI ST'] as const;
/** Lots fronting MINI ST at depth 0. */
export const MINI_ST_LOTS: ParcelId[] = ['0026T009', '2999A001'];
/** A lot fronting MINI AVE at depth 0, and one a lot deep. */
export const MINI_AVE_FRONT: ParcelId = '3512005';
export const MINI_AVE_DEEP: ParcelId = '3512007';

/** frontage.bin for the mini parcels: two named segments. */
export function miniFrontage(city: MiniCity): Frontage {
  const p = city.parcels;
  const entries = new Map<number, [seg: number, depth: number][]>();
  const add = (id: ParcelId, seg: number, depth: number) => {
    const row = p.index.get(id)!;
    entries.set(row, [...(entries.get(row) ?? []), [seg, depth]]);
  };
  for (const id of MINI_ST_LOTS) add(id, 1, 0);
  add(MINI_AVE_FRONT, 0, 0);
  add(MINI_AVE_DEEP, 0, 1);
  const rowStart = new Uint32Array(p.count + 1);
  const seg: number[] = [];
  const depth: number[] = [];
  for (let i = 0; i < p.count; i++) {
    for (const [s, d] of entries.get(i) ?? []) {
      seg.push(s);
      depth.push(d);
    }
    rowStart[i + 1] = seg.length;
  }
  return {
    format: 'sfh-frontage/1',
    datasetVersion: p.datasetVersion,
    count: p.count,
    idsHash: idsHash(p.id),
    provenance: prov,
    names: [...MINI_STREETS],
    segCnn: Uint32Array.from([101, 102]),
    // seg 0 is MINI AVE (name 0, residential = 5), seg 1 MINI ST (name 1, arterial = 3)
    segName: Uint16Array.from([0, 1]),
    segClass: Uint8Array.from([5, 3]),
    rowStart,
    frontSeg: Uint16Array.from(seg),
    frontDepth: Uint8Array.from(depth)
  };
}

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
