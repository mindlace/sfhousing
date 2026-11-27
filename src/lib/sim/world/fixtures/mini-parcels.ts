// The mini scenario city: 60 parcels in 4 cells (15 each), the T11 columns, the served parcel
// chunks and a manifest. Browser-safe (the cross-engine golden runs in Chromium): no `node:`
// imports; the deflated `parcels.bin` bytes come from the Node-only `mini-bin.ts`.
//
// Fixture values only (tier 4, made up for the timelapse-sim tests): not data. The `yield`,
// `baseYield`, `hostable` and `hostableBase` columns in DERIVED were produced by the pipeline
// rule (pipeline/steps/scenario.ts: `scenarioYield` on `scenarioRecordOf(p, i, rec)` per fill
// level, capped by `baseCap` except the FZP yield of a Local Program parcel; hostable flags on
// the uncapped full-fill gross) and are re-checked against the generator in input.spec.ts.
import type { Manifest } from '$lib/data/manifest';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import { decodeParcelChunk, encodeParcelChunk } from '$lib/data/parcel-chunk';
import { FILL_LEVELS, type ScenarioParcels } from '$lib/data/scenario-codec';
import { lRing, rectRing, ringArea, type Ring } from '$lib/generator/fixtures/geom';
import type { Provenance } from '$lib/timelapse/types';

/**
 * The mini dataset version. A `fixture-<n>` name because `checkManifestShape` and the manifest
 * schema only accept `DATASET_VERSION_RE` (dated builds or `fixture-<n>`); 'mini-1' would be
 * rejected as `manifest-invalid`.
 */
export const MINI_VERSION = 'fixture-60';
/** Cell ids in manifest and T11 order. */
export const MINI_CELLS = ['50_25', '50_26', '51_25', '51_26'] as const;
export const MINI_CHUNK_URL = (cellId: string) => `/data/${MINI_VERSION}/parcels/${cellId}.json`;
export const MINI_SCENARIO_URLS = {
  parcels: `/data/${MINI_VERSION}/scenarios/fzp/parcels.bin`,
  projects: `/data/${MINI_VERSION}/scenarios/fzp/projects.json`,
  calibration: `/data/${MINI_VERSION}/scenarios/fzp/calibration.json`
} as const;

/** Local Program parcel, 40-X, the scenario-tiny codec row's id. */
export const MINI_LP_ID = '0026T001A';
/** Hostable but density-capped below its existing units: every yield is 0 (no size level). */
export const MINI_NO_GAIN_ID = '0026T005';
/** Non-LP parcel whose base cap (3) binds below the generator's gross. */
export const MINI_CAPPED_ID = '0026T006';
/** Outside every height district: envelope 0, not hostable. */
export const MINI_NO_ENVELOPE_ID = '0026T008';
/** LP parcel (8 existing units) that is hostable under FZP but not `hostableBase`. */
export const MINI_HOSTABLE_NOT_BASE_ID = '2999A012';
/** Chunk land use 'NONE' (chunk `eligible` false) but assessor units > 0: scenario-eligible. */
export const MINI_NONE_WITH_UNITS_ID = '0026T015';
/** Neighbours across two cells (2999A019 in 50_26, 2999A020 in 51_26). */
export const MINI_CROSS_CELL_PAIR = ['2999A019', '2999A020'] as const;
/** Neighbours in one cell (50_25). */
export const MINI_SAME_CELL_PAIR = ['0026T003', '0026T004'] as const;
/** Open space: not eligible, not hostable (the scenario-tiny codec row's id). */
export const MINI_INELIGIBLE_ID = '3512008';

interface Row {
  id: ParcelId;
  cell: number; // index into MINI_CELLS
  slot: number; // position in the cell's 5 × 3 layout grid (0..14)
  shape: 'std' | 'wide' | 'mid' | 'big' | 'l' | 'tiny';
  district: number; // index into DISTRICTS
  lp?: 1;
  cap?: number; // base density cap in units (absent = none)
  units: number;
  stories: number;
  floor: number;
  built: number;
  share200: number; // improvementShare × 200 (the codec grid)
  luc: number; // LAND_USE_CLASSES index
  rc?: 1;
  split?: 1;
  imputed?: number;
  ineligible?: 1; // T11 eligible 0 (and chunk eligible false)
  landUse?: string; // chunk land use, default from `luc`
  chunkEligible?: false; // chunk eligible false while T11 eligible is 1
  chunkUnits?: number; // chunk record units when they differ from the roll
  east?: ParcelId; // placed immediately east of this parcel (a neighbour)
}

const DISTRICTS = ['', '40-X', '65-A', '85-X', '130-E'];
const BASE_STORIES = [0, 4, 6, 8, 13];
const LP_STORIES = [0, 6, 10, 14, 20];
const NO_CAP = 0xffff;
const LAND_USE = ['RESIDENTIAL', 'MIXED', 'COMMERCIAL', 'PDR', 'VACANT', 'OTHER'];
const NEIGHBORHOOD = ['Mission', 'Bernal Heights', 'Potrero Hill', 'Bayview'];

// prettier-ignore
const ROWS: Row[] = [
  // 50_25: block 0026T
  { id: '0026T001A', cell: 0, slot: 0, shape: 'std', district: 1, lp: 1, units: 2, stories: 2, floor: 186, built: 1925, share200: 70, luc: 0 },
  { id: '0026T002', cell: 0, slot: 1, shape: 'std', district: 1, lp: 1, units: 1, stories: 2, floor: 150, built: 1908, share200: 40, luc: 0 },
  { id: '0026T003', cell: 0, slot: 2, shape: 'std', district: 2, units: 0, stories: 1, floor: 220, built: 1950, share200: 20, luc: 2 },
  { id: '0026T004', cell: 0, slot: 2, shape: 'std', district: 2, units: 2, stories: 2, floor: 200, built: 1912, share200: 30, luc: 1, east: '0026T003' },
  { id: '0026T005', cell: 0, slot: 3, shape: 'std', district: 1, cap: 2, units: 3, stories: 3, floor: 280, built: 1905, share200: 60, luc: 0, rc: 1 },
  { id: '0026T006', cell: 0, slot: 4, shape: 'std', district: 1, cap: 3, units: 1, stories: 2, floor: 140, built: 1940, share200: 50, luc: 0 },
  { id: '0026T007', cell: 0, slot: 5, shape: 'wide', district: 2, lp: 1, units: 0, stories: 1, floor: 400, built: 1960, share200: 10, luc: 3 },
  { id: '0026T008', cell: 0, slot: 6, shape: 'std', district: 0, units: 1, stories: 2, floor: 150, built: 1930, share200: 50, luc: 0 },
  { id: '0026T009', cell: 0, slot: 7, shape: 'std', district: 1, units: 4, stories: 3, floor: 330, built: 1922, share200: 90, luc: 0, rc: 1 },
  { id: '0026T010', cell: 0, slot: 8, shape: 'std', district: 1, lp: 1, units: 0, stories: 0, floor: 0, built: 0, share200: 1, luc: 4, imputed: 0b00100 },
  { id: '0026T011', cell: 0, slot: 9, shape: 'l', district: 2, lp: 1, units: 2, stories: 2, floor: 210, built: 1931, share200: 45, luc: 1 },
  { id: '0026T012', cell: 0, slot: 10, shape: 'std', district: 1, units: 1, stories: 2, floor: 160, built: 1948, share200: 55, luc: 0, split: 1, imputed: 0b1011111 },
  { id: '0026T013', cell: 0, slot: 11, shape: 'tiny', district: 1, units: 0, stories: 0, floor: 0, built: 0, share200: 0, luc: 4 },
  { id: '0026T014', cell: 0, slot: 12, shape: 'std', district: 1, lp: 1, units: 6, stories: 3, floor: 520, built: 1915, share200: 80, luc: 0 },
  { id: '0026T015', cell: 0, slot: 13, shape: 'mid', district: 3, lp: 1, units: 1, stories: 1, floor: 900, built: 1955, share200: 12, luc: 2, landUse: 'NONE', chunkEligible: false, chunkUnits: 0 },
  // 50_26: block 2999A
  { id: '2999A001', cell: 1, slot: 0, shape: 'std', district: 1, units: 1, stories: 2, floor: 170, built: 1923, share200: 50, luc: 0 },
  { id: '2999A002', cell: 1, slot: 1, shape: 'std', district: 1, lp: 1, units: 2, stories: 2, floor: 190, built: 1910, share200: 35, luc: 0 },
  { id: '2999A003', cell: 1, slot: 2, shape: 'big', district: 2, units: 0, stories: 0, floor: 0, built: 0, share200: 0, luc: 5, ineligible: 1, landUse: 'OPENSPACE' },
  { id: '2999A004', cell: 1, slot: 3, shape: 'std', district: 1, cap: 2, units: 1, stories: 1, floor: 100, built: 1951, share200: 70, luc: 0 },
  { id: '2999A005', cell: 1, slot: 4, shape: 'mid', district: 3, units: 3, stories: 2, floor: 600, built: 1960, share200: 15, luc: 2 },
  { id: '2999A006', cell: 1, slot: 5, shape: 'std', district: 1, lp: 1, units: 3, stories: 3, floor: 290, built: 1926, share200: 60, luc: 0 },
  { id: '2999A007', cell: 1, slot: 6, shape: 'std', district: 1, units: 0, stories: 0, floor: 0, built: 0, share200: 1, luc: 4 },
  { id: '2999A008', cell: 1, slot: 7, shape: 'wide', district: 2, lp: 1, units: 0, stories: 1, floor: 300, built: 1958, share200: 8, luc: 3 },
  { id: '2999A009', cell: 1, slot: 8, shape: 'std', district: 1, units: 2, stories: 2, floor: 200, built: 1900, share200: 40, luc: 0, rc: 1 },
  { id: '2999A010', cell: 1, slot: 9, shape: 'std', district: 2, lp: 1, units: 1, stories: 2, floor: 180, built: 1939, share200: 25, luc: 1 },
  { id: '2999A011', cell: 1, slot: 10, shape: 'l', district: 1, units: 1, stories: 2, floor: 150, built: 1947, share200: 50, luc: 0, split: 1 },
  { id: '2999A012', cell: 1, slot: 11, shape: 'std', district: 1, lp: 1, units: 8, stories: 4, floor: 700, built: 1964, share200: 95, luc: 0 },
  { id: '2999A013', cell: 1, slot: 12, shape: 'std', district: 1, units: 1, stories: 2, floor: 160, built: 1925, share200: 45, luc: 0, imputed: 0b00001 },
  { id: '2999A014', cell: 1, slot: 13, shape: 'std', district: 4, lp: 1, units: 0, stories: 1, floor: 250, built: 1970, share200: 5, luc: 2 },
  { id: '2999A019', cell: 1, slot: 14, shape: 'std', district: 2, lp: 1, units: 2, stories: 2, floor: 210, built: 1915, share200: 30, luc: 1 },
  // 51_25: block 3512
  { id: '3512001', cell: 2, slot: 0, shape: 'std', district: 1, units: 0, stories: 0, floor: 0, built: 0, share200: 0, luc: 5, split: 1, imputed: 0b1011111 },
  { id: '3512002', cell: 2, slot: 1, shape: 'std', district: 1, units: 0, stories: 0, floor: 0, built: 0, share200: 1, luc: 4, imputed: 0b00100 },
  { id: '3512003', cell: 2, slot: 2, shape: 'std', district: 1, lp: 1, units: 1, stories: 2, floor: 170, built: 1912, share200: 50, luc: 0 },
  { id: '3512004', cell: 2, slot: 3, shape: 'wide', district: 2, units: 0, stories: 1, floor: 500, built: 1965, share200: 10, luc: 3 },
  { id: '3512005', cell: 2, slot: 4, shape: 'std', district: 1, units: 1, stories: 2, floor: 160, built: 1931, share200: 55, luc: 0 },
  { id: '3512006', cell: 2, slot: 5, shape: 'std', district: 1, lp: 1, units: 0, stories: 0, floor: 0, built: 0, share200: 1, luc: 4 },
  { id: '3512007', cell: 2, slot: 6, shape: 'std', district: 1, cap: 4, units: 2, stories: 2, floor: 190, built: 1920, share200: 45, luc: 0 },
  { id: '3512008', cell: 2, slot: 7, shape: 'std', district: 1, units: 6, stories: 3, floor: 560, built: 1962, share200: 120, luc: 0, rc: 1, ineligible: 1, landUse: 'OPENSPACE' },
  { id: '3512009', cell: 2, slot: 8, shape: 'l', district: 2, lp: 1, units: 0, stories: 1, floor: 180, built: 1950, share200: 15, luc: 2 },
  { id: '3512010', cell: 2, slot: 9, shape: 'mid', district: 3, lp: 1, units: 1, stories: 1, floor: 1250, built: 1950, share200: 15, luc: 2, imputed: 0b00010 },
  { id: '3512011', cell: 2, slot: 10, shape: 'std', district: 0, units: 1, stories: 2, floor: 150, built: 1941, share200: 50, luc: 0 },
  { id: '3512012', cell: 2, slot: 11, shape: 'std', district: 1, units: 2, stories: 2, floor: 200, built: 1918, share200: 40, luc: 0, chunkUnits: 1 },
  { id: '3512013', cell: 2, slot: 12, shape: 'std', district: 2, lp: 1, units: 4, stories: 3, floor: 350, built: 1924, share200: 70, luc: 1 },
  { id: '3512014', cell: 2, slot: 13, shape: 'std', district: 1, units: 1, stories: 1, floor: 90, built: 1946, share200: 65, luc: 0, imputed: 0b00010 },
  { id: '3512015', cell: 2, slot: 14, shape: 'std', district: 1, lp: 1, units: 3, stories: 3, floor: 300, built: 1909, share200: 75, luc: 0 },
  // 51_26: the east half of block 2999A, block 3600 (development-agreement lots) and 8711023C
  { id: '2999A020', cell: 3, slot: 0, shape: 'std', district: 2, lp: 1, units: 1, stories: 2, floor: 160, built: 1921, share200: 35, luc: 0, east: '2999A019' },
  { id: '3600001', cell: 3, slot: 1, shape: 'big', district: 3, units: 0, stories: 1, floor: 2000, built: 1968, share200: 10, luc: 3 },
  { id: '3600002', cell: 3, slot: 2, shape: 'big', district: 3, units: 0, stories: 1, floor: 1500, built: 1968, share200: 10, luc: 3 },
  { id: '3600003', cell: 3, slot: 3, shape: 'big', district: 4, units: 0, stories: 0, floor: 0, built: 0, share200: 1, luc: 4 },
  { id: '3600004', cell: 3, slot: 4, shape: 'big', district: 4, units: 0, stories: 1, floor: 800, built: 1972, share200: 10, luc: 3 },
  { id: '3600005', cell: 3, slot: 5, shape: 'big', district: 4, units: 5, stories: 2, floor: 900, built: 1958, share200: 20, luc: 1 },
  { id: '3600006', cell: 3, slot: 6, shape: 'big', district: 4, units: 0, stories: 0, floor: 0, built: 0, share200: 1, luc: 4 },
  { id: '3600007', cell: 3, slot: 7, shape: 'big', district: 3, units: 0, stories: 1, floor: 1200, built: 1966, share200: 10, luc: 3 },
  { id: '3600008', cell: 3, slot: 8, shape: 'big', district: 3, units: 0, stories: 0, floor: 0, built: 0, share200: 1, luc: 4 },
  { id: '3600009', cell: 3, slot: 9, shape: 'mid', district: 2, units: 0, stories: 0, floor: 0, built: 0, share200: 1, luc: 4 },
  { id: '3600010', cell: 3, slot: 10, shape: 'big', district: 4, lp: 1, units: 0, stories: 1, floor: 1000, built: 1961, share200: 10, luc: 2 },
  { id: '3600014', cell: 3, slot: 11, shape: 'std', district: 1, units: 1, stories: 2, floor: 160, built: 1933, share200: 50, luc: 0 },
  { id: '3600015', cell: 3, slot: 12, shape: 'std', district: 1, lp: 1, units: 2, stories: 2, floor: 190, built: 1927, share200: 40, luc: 0 },
  { id: '3600016', cell: 3, slot: 13, shape: 'std', district: 1, units: 1, stories: 2, floor: 150, built: 1936, share200: 55, luc: 0 },
  { id: '8711023C', cell: 3, slot: 14, shape: 'std', district: 0, units: 0, stories: 0, floor: 77, built: 1990, share200: 200, luc: 3 }
];

/** Generator-derived columns per id: FZP yield, base yield (both length F), hostable, hostableBase. */
// prettier-ignore
const DERIVED: Record<ParcelId, [number[], number[], 0 | 1, 0 | 1]> = {
  '0026T001A': [[0, 3, 9, 9, 9], [0, 0, 3, 7, 7], 1, 1],
  '0026T002': [[0, 3, 9, 9, 9], [0, 0, 3, 7, 7], 1, 1],
  '0026T003': [[2, 3, 9, 9, 9], [2, 3, 9, 9, 9], 1, 1],
  '0026T004': [[0, 3, 9, 9, 9], [0, 3, 9, 9, 9], 1, 1],
  '0026T005': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 1, 1],
  '0026T006': [[0, 0, 3, 3, 3], [0, 0, 3, 3, 3], 1, 1],
  '0026T007': [[4, 48, 69, 76, 83], [4, 4, 48, 48, 58], 1, 1],
  '0026T008': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 0, 0],
  '0026T009': [[0, 0, 0, 7, 7], [0, 0, 0, 7, 7], 1, 1],
  '0026T010': [[2, 3, 9, 9, 9], [1, 2, 3, 7, 7], 1, 1],
  '0026T011': [[4, 11, 11, 11, 11], [0, 4, 11, 11, 11], 1, 1],
  '0026T012': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '0026T013': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 0, 0],
  '0026T014': [[0, 0, 9, 9, 9], [0, 0, 0, 7, 7], 1, 1],
  '0026T015': [[38, 82, 106, 114, 114], [0, 38, 70, 82, 82], 1, 1],
  '2999A001': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '2999A002': [[0, 3, 9, 9, 9], [0, 0, 3, 7, 7], 1, 1],
  '2999A003': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 0, 0],
  '2999A004': [[0, 0, 2, 2, 2], [0, 0, 2, 2, 2], 1, 1],
  '2999A005': [[0, 38, 70, 82, 80], [0, 38, 70, 82, 80], 1, 1],
  '2999A006': [[0, 0, 9, 9, 9], [0, 0, 0, 7, 7], 1, 1],
  '2999A007': [[1, 2, 3, 7, 7], [1, 2, 3, 7, 7], 1, 1],
  '2999A008': [[4, 49, 66, 72, 78], [4, 4, 49, 49, 59], 1, 1],
  '2999A009': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '2999A010': [[3, 9, 9, 9, 9], [0, 3, 9, 9, 9], 1, 1],
  '2999A011': [[0, 0, 4, 9, 9], [0, 0, 4, 9, 9], 1, 1],
  '2999A012': [[0, 0, 9, 9, 9], [0, 0, 0, 0, 0], 1, 0],
  '2999A013': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '2999A014': [[9, 9, 9, 9, 9], [3, 9, 9, 9, 9], 1, 1],
  '2999A019': [[3, 9, 9, 9, 9], [0, 3, 9, 9, 9], 1, 1],
  '3512001': [[1, 2, 3, 7, 7], [1, 2, 3, 7, 7], 1, 1],
  '3512002': [[1, 2, 3, 7, 7], [1, 2, 3, 7, 7], 1, 1],
  '3512003': [[0, 3, 9, 9, 9], [0, 0, 3, 7, 7], 1, 1],
  '3512004': [[4, 4, 48, 48, 58], [4, 4, 48, 48, 58], 1, 1],
  '3512005': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '3512006': [[2, 3, 9, 9, 9], [1, 2, 3, 7, 7], 1, 1],
  '3512007': [[0, 0, 3, 4, 4], [0, 0, 3, 4, 4], 1, 1],
  '3512008': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 0, 0],
  '3512009': [[4, 12, 12, 12, 12], [3, 4, 12, 12, 12], 1, 1],
  '3512010': [[38, 82, 102, 109, 109], [0, 38, 70, 82, 80], 1, 1],
  '3512011': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 0, 0],
  '3512012': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '3512013': [[0, 9, 9, 9, 9], [0, 0, 9, 9, 9], 1, 1],
  '3512014': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '3512015': [[0, 0, 9, 9, 9], [0, 0, 0, 7, 7], 1, 1],
  '2999A020': [[3, 9, 9, 9, 9], [0, 3, 9, 9, 9], 1, 1],
  '3600001': [[4, 96, 175, 204, 212], [4, 96, 175, 204, 212], 1, 1],
  '3600002': [[4, 95, 175, 204, 208], [4, 95, 175, 204, 208], 1, 1],
  '3600003': [[4, 205, 252, 295, 219], [4, 205, 252, 295, 219], 1, 1],
  '3600004': [[4, 206, 250, 293, 219], [4, 206, 250, 293, 219], 1, 1],
  '3600005': [[0, 204, 256, 302, 219], [0, 204, 256, 302, 219], 1, 1],
  '3600006': [[4, 206, 250, 292, 219], [4, 206, 250, 292, 219], 1, 1],
  '3600007': [[4, 95, 176, 205, 208], [4, 95, 176, 205, 208], 1, 1],
  '3600008': [[4, 96, 175, 205, 207], [4, 96, 175, 205, 207], 1, 1],
  '3600009': [[4, 4, 59, 59, 70], [4, 4, 59, 59, 70], 1, 1],
  '3600010': [[146, 253, 239, 270, 291], [4, 205, 253, 297, 219], 1, 1],
  '3600014': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '3600015': [[0, 3, 9, 9, 9], [0, 0, 3, 7, 7], 1, 1],
  '3600016': [[0, 0, 3, 7, 7], [0, 0, 3, 7, 7], 1, 1],
  '8711023C': [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], 0, 0]
};

const RINGS: Record<Row['shape'], Ring> = {
  std: rectRing(7.62, 30.48), // 25 × 100 ft
  wide: rectRing(25, 40),
  mid: rectRing(40, 30),
  big: rectRing(60, 50),
  l: lRing(20, 20, 10, 10),
  tiny: rectRing(6, 6)
};
const WIDTH: Record<Row['shape'], number> = {
  std: 7.62,
  wide: 25,
  mid: 40,
  big: 60,
  l: 20,
  tiny: 6
};

// Layout: cell (cx, cy) starts at LNG0 + (cx − 50) × CELL_LNG, LAT0 + (cy − 25) × CELL_LAT
// (about 1 km); slots sit on a 5 × 3 grid about 90 m apart. A neighbour (`east`) sits flush
// against the east edge of its partner. Metres per degree of longitude at 37.76° N (GRS80, to
// within 0.1%): the generator's sub-centimetre closing heals the residual seam.
const LNG0 = -122.42;
const LAT0 = 37.76;
const CELL_LNG = 0.0114;
const CELL_LAT = 0.009;
const M_PER_DEG_LNG = 88_083;
const r7 = (v: number) => Math.round(v * 1e7) / 1e7;

function lngLatOf(r: Row, placed: Map<ParcelId, [number, number]>): [number, number] {
  if (r.east) {
    const west = ROWS.find((w) => w.id === r.east)!;
    const [lng, lat] = placed.get(r.east)!;
    return [r7(lng + (WIDTH[west.shape] / 2 + WIDTH[r.shape] / 2) / M_PER_DEG_LNG), lat];
  }
  const [cx, cy] = MINI_CELLS[r.cell].split('_').map(Number);
  const x0 = LNG0 + (cx - 50) * CELL_LNG;
  const y0 = LAT0 + (cy - 25) * CELL_LAT;
  // 2999A019 hugs its cell's east edge, so 2999A020, flush east of it, starts the next cell.
  const lng =
    r.id === MINI_CROSS_CELL_PAIR[0] ? x0 + CELL_LNG - 0.00005 : x0 + ((r.slot % 5) + 1) * 0.0011;
  const lat = y0 + (Math.floor(r.slot / 5) + 1) * 0.0008;
  return [r7(lng), r7(lat)];
}

const prov = (label: string): Provenance => ({
  tier: 4,
  label,
  sources: [{ label: 'timelapse-sim mini fixture', url: 'https://example.org/mini-fixture' }],
  method: 'Hand-written simulator fixture (tier 4, made up); not data.'
});

function recordOf(r: Row, lngLat: [number, number]): ParcelRecord {
  const ring = RINGS[r.shape];
  return {
    id: r.id,
    polygon: [ring],
    labelPoint: lngLat,
    areaM2: ringArea(ring),
    existingUnits: r.chunkUnits ?? r.units,
    existingFloorAreaM2: r.floor,
    existingHeightM: Math.round(r.stories * 3.1 * 10) / 10,
    landUse: r.landUse ?? LAND_USE[r.luc],
    eligible: r.ineligible ? false : (r.chunkEligible ?? true),
    neighborhood: NEIGHBORHOOD[r.cell]
  };
}

export interface MiniCity {
  parcels: ScenarioParcels;
  manifest: Manifest;
  /** chunk URL → the parcel chunk JSON as served (what the loader's `json()` returns) */
  chunks: Record<string, unknown>;
  /** id → the record the chunk loader decodes */
  records: Map<ParcelId, ParcelRecord>;
}

/** A fresh mini city on every call (callers may mutate their copy). */
export function miniCity(): MiniCity {
  const placed = new Map<ParcelId, [number, number]>();
  for (const r of ROWS) placed.set(r.id, lngLatOf(r, placed));
  const rows = [...ROWS].sort((a, b) =>
    a.cell !== b.cell ? a.cell - b.cell : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  const chunks: Record<string, unknown> = {};
  const records = new Map<ParcelId, ParcelRecord>();
  const manifestChunks: Manifest['chunks'] = [];
  MINI_CELLS.forEach((cellId, c) => {
    const inCell = rows.filter((r) => r.cell === c);
    const json = JSON.parse(
      encodeParcelChunk(
        MINI_VERSION,
        cellId,
        inCell.map((r) => recordOf(r, placed.get(r.id)!))
      )
    );
    const url = MINI_CHUNK_URL(cellId);
    chunks[url] = json;
    for (const rec of decodeParcelChunk(json)) records.set(rec.id, rec);
    const lngs = inCell.map((r) => placed.get(r.id)![0]);
    const lats = inCell.map((r) => placed.get(r.id)![1]);
    const pad = 0.0005;
    manifestChunks.push({
      cellId,
      bbox: [
        r7(Math.min(...lngs) - pad),
        r7(Math.min(...lats) - pad),
        r7(Math.max(...lngs) + pad),
        r7(Math.max(...lats) + pad)
      ],
      url,
      parcelCount: inCell.length
    });
  });

  const n = rows.length;
  const F = FILL_LEVELS.length;
  const col = <T extends { [k: number]: number }>(
    make: new (len: number) => T,
    pick: (r: Row) => number
  ): T => {
    const a = new make(n);
    rows.forEach((r, i) => (a[i] = pick(r)));
    return a;
  };
  const derived = (r: Row) => DERIVED[r.id];
  const perFill = (k: 0 | 1) => {
    const a = new Uint16Array(n * F);
    rows.forEach((r, i) => a.set(derived(r)[k], i * F));
    return a;
  };
  const envelope = (r: Row) => (r.lp ? LP_STORIES : BASE_STORIES)[r.district];
  const yieldCol = perFill(0);
  const baseYield = perFill(1);
  const ratio = (y: Uint16Array) =>
    col(Float32Array, (r) => y[rows.indexOf(r) * F + F - 1] / Math.max(r.units, 1));
  let cell = 0;
  const parcels: ScenarioParcels = {
    format: 'sfh-scenario/1',
    datasetVersion: MINI_VERSION,
    scenario: 'fzp',
    rollYear: 2025,
    count: n,
    fillLevels: [...FILL_LEVELS],
    cells: MINI_CELLS.map((cellId, c) => {
      const count = rows.filter((r) => r.cell === c).length;
      const start = cell;
      cell += count;
      return { cellId, start, count };
    }),
    districts: [...DISTRICTS],
    provenance: {
      envelope: prov('Envelope'),
      localProgram: prov('Local Program'),
      features: prov('Features'),
      existingUnits: { ...prov('Existing units'), n, window: ['2025-01-01', '2025-12-31'] },
      yield: prov('Yield')
    },
    id: rows.map((r) => r.id),
    index: new Map(rows.map((r, i) => [r.id, i])),
    labelPoint: Float64Array.from(rows.flatMap((r) => placed.get(r.id)!)),
    cell: col(Uint16Array, (r) => r.cell),
    district: col(Uint16Array, (r) => r.district),
    envelopeStories: col(Uint8Array, envelope),
    baseStories: col(Uint8Array, (r) => BASE_STORIES[r.district]),
    localProgram: col(Uint8Array, (r) => r.lp ?? 0),
    hostable: col(Uint8Array, (r) => derived(r)[2]),
    eligible: col(Uint8Array, (r) => (r.ineligible ? 0 : 1)),
    split: col(Uint8Array, (r) => r.split ?? 0),
    imputed: col(Uint8Array, (r) => r.imputed ?? 0),
    baseCap: col(Uint16Array, (r) => r.cap ?? NO_CAP),
    existingUnits: col(Uint16Array, (r) => r.units),
    existingFloorAreaM2: col(Uint32Array, (r) => r.floor),
    existingStories: col(Uint8Array, (r) => r.stories),
    lotAreaM2: col(Uint32Array, (r) => Math.round(ringArea(RINGS[r.shape]))),
    yearBuilt: col(Uint16Array, (r) => r.built),
    improvementShare: col(Float32Array, (r) => r.share200 / 200),
    rentControlLikely: col(Uint8Array, (r) => r.rc ?? 0),
    landUseClass: col(Uint8Array, (r) => r.luc),
    hostableBase: col(Uint8Array, (r) => derived(r)[3]),
    baseYield,
    yield: yieldCol,
    potentialRatio: { fzp: ratio(yieldCol), base: ratio(baseYield) },
    storiesGap: {
      fzp: col(Int16Array, (r) => envelope(r) - r.stories),
      base: col(Int16Array, (r) => BASE_STORIES[r.district] - r.stories)
    }
  };

  const manifest: Manifest = {
    datasetVersion: MINI_VERSION,
    builtAt: '2026-10-16T00:00:00.000Z',
    sources: [
      {
        id: 'mini-fixture',
        label: 'timelapse-sim mini fixture',
        url: 'https://example.org/mini-fixture',
        retrievedAt: '2026-10-16',
        license: 'MIT'
      }
    ],
    chunks: manifestChunks,
    buildingsTiles: `/data/${MINI_VERSION}/buildings.pmtiles`,
    basemapTiles: `/data/${MINI_VERSION}/basemap.pmtiles`,
    glyphs: `/data/${MINI_VERSION}/fonts/{fontstack}/{range}.pbf`,
    neighborhoods: `/data/${MINI_VERSION}/neighborhoods.geojson`,
    scenarios: { fzp: { ...MINI_SCENARIO_URLS } }
  };
  return { parcels, manifest, chunks, records };
}
