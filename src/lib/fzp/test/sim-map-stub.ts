// Recording SimMap double for FzpMode tests (FzpSimMapStub.svelte): every handle call, the latest
// props, and a fake MapLibre map whose events a test fires by hand. Reset it per test.
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { SimMapHandle, SimMapProps } from '$lib/map/types';

type Listener = (ev?: unknown) => void;

export class FakeMap {
  zoom = 12;
  bounds: [west: number, south: number, east: number, north: number] = [
    -122.45, 37.75, -122.4, 37.78
  ];
  #listeners = new Map<string, Set<Listener>>();

  on(type: string, cb: Listener): this {
    let set = this.#listeners.get(type);
    if (!set) this.#listeners.set(type, (set = new Set()));
    set.add(cb);
    return this;
  }

  off(type: string, cb: Listener): this {
    this.#listeners.get(type)?.delete(cb);
    return this;
  }

  listenerCount(type: string): number {
    return this.#listeners.get(type)?.size ?? 0;
  }

  getZoom(): number {
    return this.zoom;
  }

  getBounds() {
    const [w, s, e, n] = this.bounds;
    return { getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n };
  }

  // What /sim's BrushController needs: a canvas in a container, and screen ↔ map points.
  #canvas = document.createElement('canvas');
  #box = (() => {
    const box = document.createElement('div');
    box.appendChild(this.#canvas);
    return box;
  })();

  getCanvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  getCanvasContainer(): HTMLElement {
    return this.#box;
  }

  getCenter(): { lng: number; lat: number } {
    const [w, s, e, n] = this.bounds;
    return { lng: (w + e) / 2, lat: (s + n) / 2 };
  }

  unproject([x, y]: [number, number]): { lng: number; lat: number } {
    const [w, , , n] = this.bounds;
    return { lng: w + x * 1e-5, lat: n - y * 1e-5 };
  }

  // What /lesscars' installLessCarsLayers calls: recording no-ops over sources and layers.
  #sources = new Map<string, { data: unknown }>();
  #layers = new Map<string, unknown>();
  filters = new Map<string, unknown>();

  addSource(id: string, spec: { data?: unknown }): this {
    this.#sources.set(id, { data: spec.data });
    return this;
  }

  getSource(id: string) {
    const src = this.#sources.get(id);
    return src && { setData: (d: unknown) => void (src.data = d) };
  }

  /** The latest data of a GeoJSON source (its spec's, then each setData's). */
  sourceData(id: string): { features: unknown[] } {
    return this.#sources.get(id)?.data as { features: unknown[] };
  }

  addLayer(spec: { id: string; filter?: unknown }): this {
    this.#layers.set(spec.id, spec);
    this.filters.set(spec.id, spec.filter);
    return this;
  }

  getLayer(id: string): unknown {
    return this.#layers.get(id);
  }

  setFilter(id: string, filter: unknown): this {
    this.filters.set(id, filter);
    return this;
  }

  setPaintProperty(): this {
    return this;
  }

  getStyle(): { layers: { id: string }[] } {
    return { layers: [] };
  }

  /**
   * Calls every listener of this event type with `{ type: ev }`, merged with `payload` when given
   * (a `click`'s `{ lngLat }`).
   */
  fire(ev: string, payload?: object): void {
    for (const cb of [...(this.#listeners.get(ev) ?? [])]) cb({ type: ev, ...payload });
  }
}

export interface Stub {
  calls: { method: keyof SimMapHandle; args: unknown[] }[];
  /** The latest props, as passed (a key is present only when the prop was passed). */
  props: Partial<SimMapProps>;
  map: FakeMap;
  /** False: the stub waits for `fireReady()` before calling `onready`. */
  autoReady: boolean;
  fireReady(): void;
  resyncCb: (() => void) | null;
  handle: SimMapHandle;
  reset(): void;
}

function record(method: keyof SimMapHandle) {
  return (...args: unknown[]) => {
    stub.calls.push({ method, args });
    if (method === 'onResyncNeeded') stub.resyncCb = args[0] as () => void;
    if (method === 'getMap') return stub.map as unknown as MapLibreMap;
  };
}

export const stub: Stub = {
  calls: [],
  props: {},
  map: new FakeMap(),
  autoReady: true,
  resyncCb: null,
  fireReady() {
    stub.props.onready?.(stub.handle);
  },
  handle: {
    applyGenerated: record('applyGenerated'),
    setChunkStatus: record('setChunkStatus'),
    setPanEnabled: record('setPanEnabled'),
    setBottomInset: record('setBottomInset'),
    getMap: record('getMap') as SimMapHandle['getMap'],
    setOverlayLayers: record('setOverlayLayers'),
    onResyncNeeded: record('onResyncNeeded'),
    applyTimeline: record('applyTimeline'),
    setTime: record('setTime'),
    setTimelineLookups: record('setTimelineLookups')
  },
  reset() {
    stub.calls = [];
    stub.props = {};
    stub.map = new FakeMap();
    stub.autoReady = true;
    stub.resyncCb = null;
  }
};

/** The calls to one handle method, in order. */
export function callsOf(method: keyof SimMapHandle): unknown[][] {
  return stub.calls.filter((c) => c.method === method).map((c) => c.args);
}
