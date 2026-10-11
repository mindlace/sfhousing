// e2e debug hook (spec §6). Compiled in only when VITE_E2E === '1'; otherwise the body is a
// constant-false branch that Vite dead-code-eliminates.
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { ControllerSnapshot, GeneratedController } from './generated-controller';

export interface SfhMapDebug {
  readonly map: MapLibreMap | null;
  snapshot(): ControllerSnapshot | null;
  readonly hiddenSize: number;
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
    }
  };
  window.__sfhMap = hook;
  return () => {
    if (window.__sfhMap === hook) delete window.__sfhMap;
  };
}
