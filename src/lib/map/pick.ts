// Pure picking helpers for SimMap (spec §4.7): existing-building hit resolution, cell lookup,
// chunk-status GeoJSON and tooltip placement. No DOM, no map library.
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { ParcelId } from '$lib/data/parcel';
import type { Manifest } from '$lib/data/manifest';
import type { TooltipHit } from './tooltip';
import type { ChunkStatus } from './types';

export type ExistingHit = Extract<TooltipHit, { kind: 'existing' }>;
export type ChunkLike = Pick<Manifest['chunks'][number], 'cellId' | 'bbox'>;

/** `properties.parcelId` as a string, or null when absent (unmatched building). */
export function featureParcelId(f: {
  properties?: Record<string, unknown> | null;
}): ParcelId | null {
  const v = f.properties?.parcelId;
  if (typeof v === 'string') return v === '' ? null : v;
  if (typeof v === 'number') return String(v);
  return null;
}

/**
 * First rendered existing-building feature that is not hidden. Features without a parcelId are
 * never hidden and resolve to `parcelId: null`. Other properties (`hs`, heights) are ignored.
 */
export function resolveExistingHit(
  features: readonly { properties?: Record<string, unknown> | null }[],
  hidden: ReadonlySet<ParcelId>,
  chunkStatusFor: (parcelId: ParcelId) => ChunkStatus | 'unknown'
): ExistingHit | null {
  for (const f of features) {
    const parcelId = featureParcelId(f);
    if (parcelId === null)
      return { kind: 'existing', parcelId: null, chunk: 'unknown', summary: null };
    if (hidden.has(parcelId)) continue;
    return { kind: 'existing', parcelId, chunk: chunkStatusFor(parcelId), summary: null };
  }
  return null;
}

/** The chunk whose bbox contains [lng, lat], or null. */
export function cellAt(chunks: readonly ChunkLike[], [lng, lat]: [number, number]): string | null {
  for (const c of chunks) {
    const [w, s, e, n] = c.bbox;
    if (lng >= w && lng <= e && lat >= s && lat <= n) return c.cellId;
  }
  return null;
}

/** One bbox polygon per cell whose status is not `ready`. Cells absent from `chunks` are skipped. */
export function chunkStatusCollection(
  chunks: readonly ChunkLike[],
  statuses: ReadonlyMap<string, ChunkStatus>
): FeatureCollection<Polygon, { cellId: string; status: ChunkStatus }> {
  const features: Feature<Polygon, { cellId: string; status: ChunkStatus }>[] = [];
  for (const c of chunks) {
    const status = statuses.get(c.cellId);
    if (status === undefined || status === 'ready') continue;
    const [w, s, e, n] = c.bbox;
    features.push({
      type: 'Feature',
      properties: { cellId: c.cellId, status },
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
    });
  }
  return { type: 'FeatureCollection', features };
}

export const TOOLTIP_OFFSET = 12;

/** Top-left of a w×h tooltip 12 px from the pointer, flipped to stay inside a vw×vh viewport. */
export function tooltipPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number
): { left: number; top: number } {
  let left = x + TOOLTIP_OFFSET;
  let top = y + TOOLTIP_OFFSET;
  if (left + w > vw) left = x - TOOLTIP_OFFSET - w;
  if (top + h > vh) top = y - TOOLTIP_OFFSET - h;
  return { left: Math.max(0, left), top: Math.max(0, top) };
}
