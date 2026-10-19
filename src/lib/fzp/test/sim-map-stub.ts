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

  /** Calls every listener of this event type. */
  fire(ev: string): void {
    for (const cb of [...(this.#listeners.get(ev) ?? [])]) cb({ type: ev });
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
