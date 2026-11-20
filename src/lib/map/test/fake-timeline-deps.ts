// Recording fake for TimelineController deps, like fake-deps.ts. Uses the real deck classes:
// layers are prop holders until a Deck renders them.
import type { Layer } from '@deck.gl/core';
import { SolidPolygonLayer } from '@deck.gl/layers';
import type { ParcelId } from '$lib/data/parcel';
import type { TimelineDeps } from '../timeline-controller';
import { HaloLayer, StageBarLayer, TimelapseExtension } from '../timelapse/deck';

export type FakeTimelineEvent =
  | ['setLayers', string[]]
  | ['setReplaced', ParcelId]
  | ['clearReplaced', ParcelId]
  | ['clearAllReplaced'];

export interface FakeTimelineDeps extends TimelineDeps {
  /** Every setLayers call, in order. */
  layerHistory: Layer[][];
  /** The most recent setLayers argument ([] before the first call). */
  readonly lastLayers: Layer[];
  /** Ids currently carrying feature-state `replaced`. */
  replaced: Set<ParcelId>;
  events: FakeTimelineEvent[];
  resyncCount: number;
  repaintCount: number;
  /** Every HaloLayer constructed (a clone included), in order. */
  haloLayers: Layer[];
  /** Callbacks waiting for the next frame. */
  pendingFrames(): number;
  /** Runs the callbacks queued before this call. */
  flushFrame(): void;
}

export function makeFakeTimelineDeps(): FakeTimelineDeps {
  let handle = 0;
  /** The real HaloLayer, recording each construction (deck's `clone` constructs one too). */
  class RecordingHaloLayer extends HaloLayer {
    static layerName = 'RecordingHaloLayer';
    constructor(...props: ConstructorParameters<typeof HaloLayer>) {
      super(...props);
      f.haloLayers.push(this as unknown as Layer);
    }
  }
  let frames = new Map<number, (t: number) => void>();
  let time = 0;
  const f: FakeTimelineDeps = {
    layerHistory: [],
    get lastLayers() {
      return f.layerHistory.at(-1) ?? [];
    },
    replaced: new Set(),
    events: [],
    resyncCount: 0,
    repaintCount: 0,
    haloLayers: [],
    SolidPolygonLayer,
    TimelapseExtension,
    StageBarLayer,
    HaloLayer: RecordingHaloLayer,
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
      f.events.push(['clearAllReplaced']);
    },
    raf(cb) {
      frames.set(++handle, cb);
      return handle;
    },
    cancelRaf(h) {
      frames.delete(h);
    },
    repaint() {
      f.repaintCount++;
    },
    onResyncNeeded() {
      f.resyncCount++;
    },
    pendingFrames: () => frames.size,
    flushFrame() {
      time += 16;
      const run = frames;
      frames = new Map();
      for (const cb of run.values()) cb(time);
    }
  };
  return f;
}
