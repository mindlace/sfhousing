import type { Provenance } from '../../../timelapse/types';
import type { LessCarsPlan } from '../plan';

const prov: Provenance = {
  tier: 4,
  label: 'Invented fixture value',
  sources: [{ label: 'Fixture', url: 'https://example.org/fixture' }],
  method: 'Invented for tests.'
};

const param = (value: number) => ({ value, provenance: prov });

/** One project of every kind, with capacity rules for all four kinds. Test fixture only. */
export const TINY_PLAN: LessCarsPlan = {
  schema: 1,
  id: 'tiny',
  label: 'Tiny plan',
  capacity: [
    { kind: 'transit', maxConcurrent: 2, provenance: prov },
    { kind: 'street', maxConcurrent: 3, provenance: prov },
    { kind: 'garage', maxConcurrent: 1, provenance: prov },
    { kind: 'housing', maxConcurrent: 4, provenance: prov }
  ],
  projects: [
    {
      id: 'subway',
      label: 'Subway',
      kind: 'transit-line',
      startYear: 2028,
      durationMonths: param(60),
      dependsOn: [],
      mode: 'subway',
      stops: [
        { id: 'lc:a', name: 'A Street', lngLat: [-122.43, 37.77] },
        { id: 'lc:b', name: 'B Street', lngLat: [-122.41, 37.78] },
        { id: 'existing-1', name: 'Existing', lngLat: null }
      ],
      peakTph: param(20),
      alignment: [
        [-122.43, 37.77],
        [-122.41, 37.78]
      ]
    },
    {
      id: 'tram',
      label: 'Tram priority',
      kind: 'tram-priority',
      startYear: 2029,
      durationMonths: param(12),
      dependsOn: [],
      routeIds: ['N'],
      segments: [{ cnn: ['1001', '1002'] }],
      peakTph: param(12)
    },
    {
      id: 'buslane',
      label: 'Bus lanes',
      kind: 'bus-lane',
      startYear: 2028,
      durationMonths: param(6),
      dependsOn: [],
      routeIds: ['14'],
      stopIds: ['existing-1'],
      segments: [
        {
          line: [
            [-122.42, 37.76],
            [-122.41, 37.76]
          ],
          provenance: prov
        }
      ],
      peakTph: param(10)
    },
    {
      id: 'ped',
      label: 'Pedestrian street',
      kind: 'street-change',
      startYear: 2030,
      durationMonths: param(12),
      dependsOn: ['buslane'],
      segments: [{ cnn: ['2001'] }],
      lanes: ['pedestrian', 'bike', 'sidewalk']
    },
    {
      id: 'hwy',
      label: 'Highway truncation',
      kind: 'highway-truncation',
      startYear: 2033,
      durationMonths: param(24),
      dependsOn: ['subway'],
      segments: [{ cnn: ['3001'] }],
      rowHalfWidthM: param(20),
      build: null
    },
    {
      id: 'removal',
      label: 'Street removal',
      kind: 'street-removal',
      startYear: 2031,
      durationMonths: param(12),
      dependsOn: ['buslane'],
      segments: [{ cnn: ['4001'] }],
      rowHalfWidthM: param(10),
      build: { startYear: 2033, durationMonths: param(24) }
    },
    {
      id: 'parking',
      label: 'Parking conversion',
      kind: 'parking-conversion',
      startYear: 2031,
      durationMonths: param(6),
      dependsOn: ['buslane'],
      parcel: '0001001',
      build: { startYear: 2032, durationMonths: param(24) }
    },
    {
      id: 'garage',
      label: 'Edge garage',
      kind: 'edge-garage',
      startYear: 2035,
      durationMonths: param(18),
      dependsOn: ['hwy'],
      site: { project: 'hwy' },
      spaces: param(500)
    },
    {
      id: 'shuttle',
      label: 'Car shuttle',
      kind: 'car-shuttle',
      startYear: 2037,
      durationMonths: param(12),
      dependsOn: ['garage'],
      garages: ['garage'],
      alignment: [
        [-122.5, 37.72],
        [-122.45, 37.75]
      ],
      peakTph: param(15)
    }
  ]
};

/** A deep copy of `TINY_PLAN` with `edit` applied. */
export function tinyPlan(edit?: (p: LessCarsPlan) => void): LessCarsPlan {
  const copy = structuredClone(TINY_PLAN);
  edit?.(copy);
  return copy;
}
