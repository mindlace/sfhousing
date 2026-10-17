// e2e debug hook (spec §6). Compiled in only when VITE_E2E === '1'; otherwise the body is a
// constant-false branch that Vite dead-code-eliminates.
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ControllerSnapshot, GeneratedController } from './generated-controller';
import type { TimelineController } from './timeline-controller';
import type { TimelineLookups, TimelineSnapshot } from './timelapse/types';
import type { GeneratedUpdate, SimMapHandle, TimelineUpdate } from './types';
import type { Day } from '$lib/timelapse/time';
import { packCell } from './pack';

/** SimMap's timeline handle functions: the hook calls them, so the lazy path runs as in FZP. */
export type TimelineHandleFns = Pick<
  SimMapHandle,
  'applyTimeline' | 'setTime' | 'setTimelineLookups'
>;

export interface SfhMapDebug {
  readonly map: MapLibreMap | null;
  snapshot(): ControllerSnapshot | null;
  readonly hiddenSize: number;
  /** Parcel ids the controller currently hides (its `hidden` mirror), sorted. */
  hiddenIds(): string[];
  /** One entry per parcel with a generated building in a generated-/rising- layer, by id. */
  generatedParcels(): { parcelId: string; typology: string; units: number }[];
  /** Passthrough to the controller's `apply` (bypasses the worker host). No-op before ready. */
  applyGenerated(u: GeneratedUpdate): void;
  /**
   * bench:map only (docs/dev/map-perf.md): applies `makeSyntheticCity(seed, n, 1500, complexity)` as one settled
   * revision-0 snapshot covering the whole SF bbox. Resolves to the parcel and cell counts.
   */
  loadCompositionDistrict(
    seed: number,
    stories: number
  ): Promise<{ parcels: number; cells: number }>;
  loadSyntheticCity(
    seed?: number,
    n?: number,
    complexity?: 'representative' | 'worst'
  ): Promise<{ parcels: number; cells: number }>;
  /**
   * bench:map and timeline-perf only (docs/dev/map-perf.md): sets `SYNTHETIC_LOOKUPS`, then
   * applies `makeSyntheticTimeline(seed, n)` (revision 0) through SimMap's `applyTimeline`.
   * Resolves to the project and cell counts.
   */
  loadSyntheticTimeline(seed: number, n: number): Promise<{ projects: number; cells: number }>;
  /** SimMap's `applyTimeline` (enters timeline mode; queues until the map is ready). */
  applyTimeline(u: TimelineUpdate): void;
  /** SimMap's `setTime`. */
  setTime(day: Day): void;
  /** SimMap's `setTimelineLookups`. */
  setTimelineLookups(l: TimelineLookups): void;
  /** The TimelineController's snapshot; null outside timeline mode or while its module loads. */
  timelineSnapshot(): TimelineSnapshot | null;
  /** The demolish pump's largest feature-state call count in one frame; 0 without a timeline. */
  readonly demolishMaxFrameOps: number;
}

declare global {
  interface Window {
    __sfhMap?: SfhMapDebug;
  }
}

export function installDebug(
  get: () => {
    map: MapLibreMap | null;
    controller: GeneratedController | null;
    timeline: TimelineController | null;
  },
  timeline: TimelineHandleFns
): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  const hook: SfhMapDebug = {
    get map() {
      return get().map;
    },
    applyTimeline: (u) => timeline.applyTimeline(u),
    setTime: (day) => timeline.setTime(day),
    setTimelineLookups: (l) => timeline.setTimelineLookups(l),
    timelineSnapshot: () => get().timeline?.debugSnapshot() ?? null,
    get demolishMaxFrameOps() {
      return get().timeline?.demolishMaxFrameOps ?? 0;
    },
    snapshot: () => get().controller?.debugSnapshot() ?? null,
    get hiddenSize() {
      return get().controller?.hidden.size ?? 0;
    },
    hiddenIds: () => [...(get().controller?.hidden ?? [])].sort(),
    generatedParcels: () => {
      const c = get().controller;
      if (!c) return [];
      const out = new Map<string, { parcelId: string; typology: string; units: number }>();
      for (const id of c.debugSnapshot().layerIds) {
        if (!/^(generated|rising)-/.test(id)) continue;
        for (let i = 0, p = c.lookup(id, 0); p; p = c.lookup(id, ++i)) {
          out.set(p.parcelId, { parcelId: p.parcelId, typology: p.typology, units: p.units });
        }
      }
      return [...out.values()].sort((a, b) => (a.parcelId < b.parcelId ? -1 : 1));
    },
    applyGenerated: (u) => get().controller?.apply(u),
    loadCompositionDistrict: async (seed, stories) => {
      const { compositionDistrict } = await import('./fixtures/composition-district');
      const { toLngLat } = await import('../generator/geo');
      const district = compositionDistrict(seed, stories);
      const pack = packCell(
        'composition-district',
        district.buildings.map((building) => ({ building, existingUnits: 0 }))
      );
      get().controller?.apply({
        revision: 0,
        cells: [{ settled: pack, rising: null }],
        removedCells: [],
        hide: { add: [], remove: [] }
      });
      const map = get().map;
      if (map) {
        if (map.getLayer('composition-boundaries')) map.removeLayer('composition-boundaries');
        if (map.getSource('composition-boundaries')) map.removeSource('composition-boundaries');
        map.addSource('composition-boundaries', {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: district.parcels.map((p) => ({
              type: 'Feature',
              properties: { id: p.id },
              geometry: {
                type: 'Polygon',
                coordinates: p.polygon.map((r) => {
                  const ll = toLngLat(r, p.labelPoint);
                  return [...ll, ll[0]];
                })
              }
            }))
          }
        });
        map.addLayer({
          id: 'composition-boundaries',
          type: 'line',
          source: 'composition-boundaries',
          paint: { 'line-color': '#858099', 'line-width': 1 }
        });
      }
      return { parcels: district.buildings.length, cells: 1 };
    },
    loadSyntheticCity: async (seed = 1, n = 150_000, complexity = 'representative') => {
      const { makeSyntheticCity } = await import('./test/synthetic-city');
      const updates = makeSyntheticCity(seed, n, 1500, complexity);
      const cells = updates.flatMap((u) =>
        u.cells.map((c) => ({ settled: c.rising ?? c.settled, rising: null }))
      );
      const add = updates.flatMap((u) => u.hide.add);
      get().controller?.apply({ revision: 0, cells, removedCells: [], hide: { add, remove: [] } });
      return { parcels: add.length, cells: cells.length };
    },
    loadSyntheticTimeline: async (seed, n) => {
      const { makeSyntheticTimeline, SYNTHETIC_LOOKUPS } =
        await import('./test/synthetic-timeline');
      const u = makeSyntheticTimeline(seed, n);
      timeline.setTimelineLookups(SYNTHETIC_LOOKUPS);
      timeline.applyTimeline(u);
      return { projects: n, cells: u.cells.length };
    }
  };
  window.__sfhMap = hook;
  return () => {
    if (window.__sfhMap === hook) delete window.__sfhMap;
  };
}
