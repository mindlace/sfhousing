// e2e debug hook (spec §6). Compiled in only when VITE_E2E === '1'; otherwise the body is a
// constant-false branch that Vite dead-code-eliminates.
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ControllerSnapshot, GeneratedController } from './generated-controller';
import type { ExistingBuildings } from './existing-buildings';
import type { RoofController, RoofControllerSnapshot } from './roof-controller';
import type { LayerComposer } from './layer-composer';
import type { GeneratedUpdate } from './types';
import { packCell } from './pack';

export interface SfhMapDebug {
  readonly map: MapLibreMap | null;
  snapshot(): ControllerSnapshot | null;
  compositionSnapshot(): ReturnType<LayerComposer['snapshot']>;
  roofSnapshot(): RoofControllerSnapshot | null;
  existingSnapshot(): { hiddenIds: string[]; roofReadyIds: string[] } | null;
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
    roofs?: RoofController | null;
    composer?: LayerComposer | null;
    existing?: ExistingBuildings | null;
  }
): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  const hook: SfhMapDebug = {
    get map() {
      return get().map;
    },
    snapshot: () => get().controller?.debugSnapshot() ?? null,
    compositionSnapshot: () => get().composer?.snapshot() ?? null,
    roofSnapshot: () => get().roofs?.snapshot() ?? null,
    existingSnapshot: () => {
      const e = get().existing;
      return e ? { hiddenIds: [...e.hidden].sort(), roofReadyIds: [...e.roofReady].sort() } : null;
    },
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
    }
  };
  window.__sfhMap = hook;
  return () => {
    if (window.__sfhMap === hook) delete window.__sfhMap;
  };
}
