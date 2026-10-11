// Recording fake for GeneratedController deps. Uses the real SolidPolygonLayer: layers are
// prop holders until a Deck renders them.
import type { Layer } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import type { ParcelId } from '$lib/data/parcel';
import type { ControllerDeps } from '../generated-controller';

export type FakeEvent =
  | ['setLayers', string[]]
  | ['setReplaced', ParcelId]
  | ['clearReplaced', ParcelId]
  | ['clearAllReplaced'];

export interface FakeDeps extends ControllerDeps {
  /** Every setLayers call, in order. */
  layerHistory: Layer[][];
  /** The most recent setLayers argument ([] before the first call). */
  readonly lastLayers: Layer[];
  /** Ids currently carrying feature-state `replaced`. */
  replaced: Set<ParcelId>;
  events: FakeEvent[];
  clearAllCount: number;
  resyncCount: number;
  reduced: boolean;
  time: number;
  /** Callbacks waiting for the next frame. */
  pendingFrames(): number;
  /** Sets `now` to `t`, then runs the callbacks queued before this call. */
  flushFrame(t: number): void;
}

export function makeFakeDeps(): FakeDeps {
  let handle = 0;
  let frames = new Map<number, (t: number) => void>();
  const f: FakeDeps = {
    layerHistory: [],
    get lastLayers() {
      return f.layerHistory.at(-1) ?? [];
    },
    replaced: new Set(),
    events: [],
    clearAllCount: 0,
    resyncCount: 0,
    reduced: false,
    time: 0,
    SolidPolygonLayer,
    setLayers(layers) {
      f.layerHistory.push(layers);
      f.events.push(['setLayers', layers.map((l) => l.id)]);
    },
    setReplaced(id) {
      f.replaced.add(id);
      f.events.push(['setReplaced', id]);
    },
    clearReplaced(id) {
      f.replaced.delete(id);
      f.events.push(['clearReplaced', id]);
    },
    clearAllReplaced() {
      f.replaced.clear();
      f.clearAllCount++;
      f.events.push(['clearAllReplaced']);
    },
    raf(cb) {
      frames.set(++handle, cb);
      return handle;
    },
    cancelRaf(h) {
      frames.delete(h);
    },
    now: () => f.time,
    reducedMotion: () => f.reduced,
    onResyncNeeded() {
      f.resyncCount++;
    },
    pendingFrames: () => frames.size,
    flushFrame(t) {
      f.time = t;
      const run = frames;
      frames = new Map();
      for (const cb of run.values()) cb(t);
    }
  };
  return f;
}
