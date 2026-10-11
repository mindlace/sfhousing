import type { ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';

export function parcel(
  id: string,
  existingUnits: number,
  neighborhood = 'Mission',
  overrides: Partial<ParcelRecord> = {}
): ParcelRecord {
  return {
    id,
    polygon: [
      [
        [0, 0],
        [7.62, 0],
        [7.62, 30.48],
        [0, 30.48],
        [0, 0]
      ]
    ],
    labelPoint: [-122.42, 37.76],
    areaM2: 232,
    existingUnits,
    existingFloorAreaM2: existingUnits * 90,
    existingHeightM: existingUnits > 0 ? 9 : 0,
    landUse: existingUnits > 0 ? 'RESIDENT' : 'VACANT',
    eligible: true,
    neighborhood,
    ...overrides
  };
}

export function building(
  p: ParcelRecord,
  units: number,
  replacesExisting: boolean
): GeneratedBuilding {
  return {
    parcelId: p.id,
    source: 'user',
    typology: replacesExisting ? 'walkup' : 'adu',
    parts: [
      {
        footprint: [
          [-122.42, 37.76],
          [-122.4199, 37.76],
          [-122.4199, 37.7601],
          [-122.42, 37.76]
        ],
        baseM: 0,
        topM: 12
      }
    ],
    stories: 4,
    units,
    floorAreaM2: units * 80,
    replacesExisting
  };
}

// Spec §6 named fixtures
export const aduLot = parcel('1000001', 1, 'Sunset');
export const aduBuilding = building(aduLot, 1, false); // gross 1, demolished 0, net 1
export const replLot = parcel('1000002', 1, 'Mission');
export const replBuilding = building(replLot, 9, true); // net 8
export const vacantLot = parcel('1000003', 0, 'Mission');
export const vacantBuilding = building(vacantLot, 2, true); // net 2
export const nullLot = parcel('1000004', 3, 'Richmond'); // generates null
export const unassignedLot = parcel('1000005', 0, '');
export const unassignedBuilding = building(unassignedLot, 4, true); // "Unassigned": 4
