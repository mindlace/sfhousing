// e2e debug hook (spec §6). Compiled in only when VITE_E2E === '1'; otherwise the body is a
// constant-false branch that Vite dead-code-eliminates.
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ControllerSnapshot, GeneratedController } from './generated-controller';

export interface SfhMapDebug {
  readonly map: MapLibreMap | null;
  snapshot(): ControllerSnapshot | null;
  readonly hiddenSize: number;
  /** Parcel ids the controller currently hides (its `hidden` mirror), sorted. */
  hiddenIds(): string[];
  /** One entry per parcel with a generated building in a generated-/rising- layer, by id. */
  generatedParcels(): { parcelId: string; typology: string; units: number }[];
}

declare global {
  interface Window {
    __sfhMap?: SfhMapDebug;
  }
}

export function installDebug(
  get: () => { map: MapLibreMap | null; controller: GeneratedController | null }
): () => void {
  if (import.meta.env.VITE_E2E !== '1') return () => {};
  const hook: SfhMapDebug = {
    get map() {
      return get().map;
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
    }
  };
  window.__sfhMap = hook;
  return () => {
    if (window.__sfhMap === hook) delete window.__sfhMap;
  };
}
