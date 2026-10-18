import type { Layer } from '@deck.gl/core';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ParcelId } from '$lib/data/parcel';
import type { Manifest } from '$lib/data/manifest';
import type { BBox } from '$lib/plan';
import type { TypologyId } from '$lib/generator';
import type { TransitNetwork } from '$lib/data/transit';
import type { ViewPrefs } from '$lib/view/prefs';
import type { chanceTable, typicalMonths } from '$lib/timelapse/model';
import type { Day } from '$lib/timelapse/time';

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
  positions: Float64Array; // [lng, lat]*, rings closed (last vertex repeats the first), CW
  partTopM: Float32Array; // per part: topM (ground-up rendering, §4.4)
  partSlot: Uint32Array; // per part → parcel slot
  partAppearance: Uint8Array; // tone + 4 for a roof accent
  partTypology: Uint8Array; // per part → index into TYPOLOGY_ORDER (I10 order)
}

/**
 * T7: a packed cell whose parts and slots carry the timelapse's time data.
 * `parcelMeta` rows describe the slot's final revision.
 */
export interface TimedPackedCell extends PackedCell {
  slotProjectIds: string[]; // render slots are keyed by project; parcelIds may repeat across slots
  partWindow: Float32Array; // per part: [fromDay, toDay) the part's revision is current; toDay = OPEN_DAY if open
  slotStages: Float32Array; // per slot: STAGE_ORDER.length entry days, NaN = never
  slotEnd: Float32Array; // per slot: [endDay, endKind] (0 open, 1 complete, 2 exit)
  slotPathway: Uint8Array; // index into ['discretionary','streamlined','permitOnly']
}

/** T7: one timeline message (timelapse worker → SimMap). */
export interface TimelineUpdate {
  revision: number; // 0 = snapshot
  cells: TimedPackedCell[];
  removedCells: string[];
  demolish: { parcelId: ParcelId; day: Day }[]; // complete list in revision 0 (needs no geometry); empty afterwards
}

/**
 * One message per worker revision (worker host → SimMap).
 *
 * Any size is safe to send as one update: a whole-city repaint, undo or erase included. map-view
 * applies an update in slices, one per animation frame. A slice closes at 2,000 hide ids or 4
 * cells (repacked + removed), whichever comes first, and a cell is never split (`planSlices`,
 * spec §4.5, §4.12). Each `hide.add` id is applied with the cell whose packs hold it, and each
 * `hide.remove` id with the cell that held the parcel in the previous revision. So an existing
 * building is never hidden before its replacement layer exists, and it is restored in the same
 * frame its generated replacement disappears. Updates small enough for one slice (≤ 2,000 ids and
 * ≤ 4 cells) apply synchronously in `applyGenerated`. Later updates queue behind earlier slices.
 */
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
  applyTimeline(u: TimelineUpdate): void; // T7: timelapse-render step 1 implements it
  setTime(day: Day): void; // T7
  setTimelineLookups(l: {
    chance: ReturnType<typeof chanceTable>;
    typicalMonths: ReturnType<typeof typicalMonths>;
  }): void; // T7
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
  /** Transit layer visibility (transit spec §6.3); default both on. */
  view?: ViewPrefs;
  /** Loads `manifest.transit`; tests inject. Default: fetch + decode. */
  fetchTransit?: (url: string) => Promise<TransitNetwork>;
  /**
   * T7: timeline part pick callback. When set, SimMap's built-in tooltip is suppressed over
   * timeline parts (implemented by timelapse-render step 1).
   */
  timelinePick?: (
    p: {
      projectId: string;
      parcelId: ParcelId;
      x: number;
      y: number;
      kind: 'hover' | 'tap';
    } | null
  ) => void;
}
