import type { ParcelRecord } from '../../data/parcel';
import { M_PER_DEG_LAT, M_PER_DEG_LNG } from '../geometry';
import { createParcelIndex, type ParcelIndex } from '../parcel-index';

/** 20×20 label points on a 10 m grid from a fixed origin in the Mission (spec §6). */
export const GRID_ORIGIN: [lng: number, lat: number] = [-122.4194, 37.7599];
export const GRID_N = 20;
const STEP_M = 10;

export function gridLngLat(i: number, j: number): [number, number] {
  return [
    GRID_ORIGIN[0] + (i * STEP_M) / M_PER_DEG_LNG,
    GRID_ORIGIN[1] + (j * STEP_M) / M_PER_DEG_LAT
  ];
}

/** Row-major, so ascending id order is row-major order. */
export function gridId(i: number, j: number): string {
  return String(3600000 + j * GRID_N + i);
}

export function gridRecord(i: number, j: number): ParcelRecord {
  const n = j * GRID_N + i;
  return {
    id: gridId(i, j),
    polygon: [
      [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
        [-5, -5]
      ]
    ],
    labelPoint: gridLngLat(i, j),
    areaM2: 100,
    existingUnits: 1,
    existingFloorAreaM2: 100,
    existingHeightM: 6,
    landUse: 'RESIDENT',
    eligible: n % 7 !== 0, // every 7th parcel is ineligible
    neighborhood: 'Mission'
  };
}

function quadrant(qi: number, qj: number): ParcelRecord[] {
  const out: ParcelRecord[] = [];
  for (let j = qj * 10; j < qj * 10 + 10; j++) {
    for (let i = qi * 10; i < qi * 10 + 10; i++) out.push(gridRecord(i, j));
  }
  return out;
}

export const GRID_CHUNKS: { cellId: string; records: ParcelRecord[] }[] = [
  { cellId: 'q00', records: quadrant(0, 0) },
  { cellId: 'q10', records: quadrant(1, 0) },
  { cellId: 'q01', records: quadrant(0, 1) },
  { cellId: 'q11', records: quadrant(1, 1) }
];

export const GRID_RECORDS: ParcelRecord[] = GRID_CHUNKS.flatMap((c) => c.records);

export function gridIndex(order: number[] = [0, 1, 2, 3]): ParcelIndex {
  const index = createParcelIndex();
  for (const k of order) index.addChunk(GRID_CHUNKS[k].cellId, GRID_CHUNKS[k].records);
  return index;
}
