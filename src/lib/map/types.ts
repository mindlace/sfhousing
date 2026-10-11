import type { Layer } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ParcelId } from '$lib/data/parcel';
import type { Manifest } from '$lib/data/manifest';
import type { BBox } from '$lib/plan';
import type { TypologyId } from '$lib/generator';

export type Theme = 'light' | 'dark';
export interface CameraFrame {
  center: [lng: number, lat: number];
  zoom: number;
  pitch: number;
  bearing: number;
}

/** I10 order. */
export const TYPOLOGY_ORDER = [
  'adu',
  'plex',
  'walkup',
  'podium',
  'midrise',
  'tower'
] as const satisfies readonly TypologyId[];

// Packed per-cell geometry. Built in the worker by packCell() (src/lib/map/pack.ts,
// pure, no DOM), posted to the main thread with every typed array transferred.
export interface PackedCell {
  cellId: string; // I12 chunks[].cellId
  parcelIds: ParcelId[]; // dense table; index = parcel slot
  parcelMeta: Uint32Array; // per parcel slot: [units, existingUnits, stories, typologyIdx]
  partCount: number;
  startIndices: Uint32Array; // length partCount + 1 (vertex index where each part starts; last = vertex count)
  positions: Float64Array; // [lng, lat]*, rings open (no repeated closing vertex), CW
  partTopM: Float32Array; // per part: topM (ground-up rendering, §4.4)
  partSlot: Uint32Array; // per part → parcel slot
  partTypology: Uint8Array; // per part → index into TYPOLOGY_ORDER (I10 order)
}

// One message per worker revision (worker host → SimMap).
export interface GeneratedUpdate {
  revision: number; // strictly +1 per message; 0 = full snapshot
  cells: { settled: PackedCell; rising: PackedCell | null }[]; // full repack of each touched cell
  removedCells: string[]; // cells that now hold no generated building
  hide: { add: ParcelId[]; remove: ParcelId[] }; // replacesExisting diff vs previous revision
}
export type ChunkStatus = 'loading' | 'ready' | 'error';

export interface SimMapHandle {
  applyGenerated(u: GeneratedUpdate): void;
  setChunkStatus(cellId: string, s: ChunkStatus): void;
  setPanEnabled(enabled: boolean): void; // brush-tool: false in paint mode
  setBottomInset(px: number): void; // mobile sheets → map.setPadding
  getMap(): MapLibreMap | null; // brush-tool projects its ring
  setOverlayLayers(layers: Layer[]): void; // I17: brush ring and swath; [] clears
  onResyncNeeded(cb: () => void): void; // revision gap → worker host sends revision 0
}

export interface ParcelSummaryLike {
  parcelId: ParcelId;
  eligible: boolean;
  existingUnits: number;
  generated: { typology: TypologyId; stories: number; units: number } | null;
}

export interface SimMapProps {
  manifest: Manifest;
  theme?: Theme;
  initialFrame?: CameraFrame | 'plan-bbox';
  planBBox?: BBox;
  requestParcelSummary?: (parcelId: ParcelId) => Promise<ParcelSummaryLike | null>;
  onRetryChunks?: () => void;
  onready?: (h: SimMapHandle) => void;
}
