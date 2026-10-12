import type { LockSpatial } from '../lib/lock';

export interface RoofInputBuilding {
  buildingId: string;
  footprint: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] };
  footprintHash: string;
  horizontalCrs: 'EPSG:7131';
  heightM: number;
  baseM: number;
  hs: number;
  bbox: [number, number, number, number];
  neighborhood: string | null;
  sourceDates: { acquisitionStart: string | null; acquisitionEnd: string | null };
}
export interface RoofInputSource extends LockSpatial {
  kind: 'lidar' | 'aerial';
  sourceId: string;
  name: string;
  path: string;
  sha256: string;
  url: string;
}
export interface RoofJob {
  schemaVersion: 1;
  datasetVersion: string;
  buildings: RoofInputBuilding[];
  sources: RoofInputSource[];
  /** Includes entries with no files, e.g. disabled aerials. */
  sourceStatus: { sourceId: string; spatial: LockSpatial }[];
  configPath: string;
  toolchainHash: string;
  workDir: string;
}
