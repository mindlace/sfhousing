// Real deck harness for the GeneratedController browser specs: a MapLibre map with an interleaved
// MapLibreOverlay. Shared by generated-controller.svelte.spec.ts (C3) and
// generated-controller.perf.svelte.spec.ts (C5 frame budgets).
import type { Layer } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import { MapLibreOverlay } from '@deck.gl/maplibre';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { GeneratedController, type ControllerDeps } from '../generated-controller';

export interface HarnessOpts {
  reducedMotion?: () => boolean;
  /**
   * false: generated/rising layers reach deck with `visible: false`. deck still matches them,
   * tessellates and fills attributes (all main-thread work), but SwiftShader does not rasterise
   * them. Used only by the whole-city budget: headless software GL stalls the main thread for
   * seconds per frame on 150k extruded buildings, which spec §4.12 says CI cannot measure.
   */
  drawGenerated?: boolean;
}

export interface Harness {
  map: maplibregl.Map;
  overlay: MapLibreOverlay;
  deps: ControllerDeps;
  controller(theme?: 'light' | 'dark'): GeneratedController;
  done(): void;
}

export const BG_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#fff' } }]
};

/** Same background style plus a `buildings` vector source that never requests tiles at z12. */
export const BUILDINGS_STYLE: maplibregl.StyleSpecification = {
  ...BG_STYLE,
  sources: {
    buildings: {
      type: 'vector',
      tiles: ['http://127.0.0.1:9/{z}/{x}/{y}.pbf'],
      minzoom: 20,
      maxzoom: 20,
      promoteId: { buildings: 'parcelId' }
    }
  }
};

export async function harness(
  style: maplibregl.StyleSpecification,
  opts: HarnessOpts = {}
): Promise<Harness> {
  const {
    reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    drawGenerated = true
  } = opts;
  const container = document.createElement('div');
  container.style.cssText = 'width:400px;height:300px';
  document.body.appendChild(container);
  const map = new maplibregl.Map({
    container,
    style,
    center: [-122.44, 37.76],
    zoom: 12,
    attributionControl: false
  });
  await new Promise<void>((r) => map.once('load', () => r()));
  const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
  map.addControl(overlay);
  const fs = { source: 'buildings', sourceLayer: 'buildings' };
  const hiddenClones = new WeakMap<Layer, Layer>();
  const forDeck = (l: Layer) => {
    if (drawGenerated || !/^(generated|rising)-/.test(l.id)) return l;
    let x = hiddenClones.get(l);
    if (!x) hiddenClones.set(l, (x = l.clone({ visible: false })));
    return x;
  };
  const controllers: GeneratedController[] = [];
  const deps: ControllerDeps = {
    setLayers: (layers) => overlay.setProps({ layers: layers.map(forDeck) }),
    setReplaced: (id) => map.setFeatureState({ ...fs, id }, { replaced: true }),
    clearReplaced: (id) => map.removeFeatureState({ ...fs, id }, 'replaced'),
    clearAllReplaced: () => {
      if (map.getSource('buildings')) map.removeFeatureState(fs);
    },
    SolidPolygonLayer,
    raf: (cb) => requestAnimationFrame(cb),
    cancelRaf: (n) => cancelAnimationFrame(n),
    now: () => performance.now(),
    reducedMotion,
    onResyncNeeded: () => {}
  };
  return {
    map,
    overlay,
    deps,
    controller(theme = 'light') {
      const c = new GeneratedController(deps, theme);
      controllers.push(c);
      return c;
    },
    done() {
      for (const c of controllers) c.destroy();
      overlay.finalize();
      map.remove();
      container.remove();
    }
  };
}

export const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
export const idle = (map: maplibregl.Map) =>
  new Promise<void>((r) => {
    map.once('idle', () => r());
    map.triggerRepaint();
  });

// Same as SimMap's setupLibraries: Vite pre-bundles maplibre-gl away from its sibling worker,
// so MapLibre's default worker URL 404s ("Worker failed to load"). Point it at the asset URL.
maplibregl.setWorkerUrl(maplibreWorkerUrl);
