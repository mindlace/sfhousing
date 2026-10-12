import type { LockSpatial } from '../lib/lock';

export interface RoofInputBuilding {
  buildingId: string;
  footprint: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown[] };
  footprintHash: string;
  sourceRelease?: string;
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
  /** Original complete lock references, including EPT metadata/hierarchy objects. */
  sourceArchives?: import('../lib/lock').LockFile[];
  /** Includes entries with no files, e.g. disabled aerials. */
  sourceStatus: { sourceId: string; spatial: LockSpatial }[];
  configPath: string;
  toolchainHash: string;
  workDir: string;
}

export interface RoofMesh {
  vertices: [number, number, number][];
  triangles: [number, number, number][];
  semantics: string[];
  roofPatchIds?: number[];
}
export interface CandidateMetrics {
  reason: string | null;
  roofCoverage?: number | null;
  maxHeightM?: number | null;
  triangleCount?: number;
  roofSections?: number;
  pitchedFraction?: number | null;
  spikes: number;
  maeM: number | null;
  validationSamples: number;
  validationCoverage: number | null;
  negativeCorrectionM?: number | null;
}
export interface RoofCandidate {
  name: 'simplified' | 'reference' | 'retry' | 'landmark';
  mesh: RoofMesh | null;
  metrics: CandidateMetrics;
  complexity?: number;
  planeSupport?: number;
  trainingCount?: number;
  error?: string | null;
  rooferAttributes?: Record<string, unknown>;
}
export type RoofArchive = import('../lib/lock').LockFile;
export interface ProcessedBuilding {
  buildingId: string;
  footprintHash: string;
  method: 'lidar_aerial' | 'lidar_only' | 'landmark' | 'footprint';
  mesh: RoofMesh | null;
  selectedCandidate: RoofCandidate['name'] | null;
  reason: string | null;
  flags: import('../../src/lib/data/roof-audit').RoofReason[];
  diagnostics?: { vegetation: string[] };
  candidates: RoofCandidate[];
  ground: { groundM: number | null; method: string; count: number } | null;
  archives: RoofArchive[];
  returnCounts?: {
    before: number;
    retained: number;
    rejected: number;
    roofTraining: number;
    validation: number;
  };
  override?: Record<string, unknown>;
  followUp?: { revisit: boolean; reasons: string[] };
}

export type RoofInputPiece = {
  pieceId: string;
  buildingId: string;
  parcelId: string | null;
  geometry: import('../lib/rings').PolygonGeom | import('../lib/rings').MultiPolygonGeom;
};
export type ClippedRoofPiece = RoofInputPiece & {
  mesh: ProcessedBuilding['mesh'];
  reason: import('../../src/lib/data/roof-audit').RoofReason | null;
};
