// Recording SimMapHandle for SimMapStub.svelte. Tests read `chunkStatus`, `halos` and
// `barModes`; a test that reads them calls `resetStubHandle()` after each test.
import type { BarMode, ChunkStatus, SimMapHandle, SimMapProps } from '$lib/map/types';

export const chunkStatus = new Map<string, ChunkStatus>();

/** Every `setHalos` argument, in order. */
export const halos: ({ from: number } | null)[] = [];

/** Every `setBarMode` argument, in order. */
export const barModes: BarMode[] = [];

/** Empties `chunkStatus`, `halos` and `barModes`. */
export function resetStubHandle(): void {
  chunkStatus.clear();
  halos.length = 0;
  barModes.length = 0;
}

/** The stub's latest `view` prop (kept current by SimMapStub.svelte). */
export const stubProps: { view: SimMapProps['view'] } = { view: undefined };

export const stubHandle: SimMapHandle = {
  applyGenerated: () => {},
  setChunkStatus: (cellId, s) => void chunkStatus.set(cellId, s),
  setPanEnabled: () => {},
  setBottomInset: () => {},
  getMap: () => null,
  setOverlayLayers: () => {},
  onResyncNeeded: () => {},
  applyTimeline: () => {},
  setTime: () => {},
  setTimelineLookups: () => {},
  setHalos: (o) => void halos.push(o),
  setBarMode: (mode) => void barModes.push(mode),
  collapseCredit: () => {}
};
