// Recording SimMapHandle for SimMapStub.svelte. Tests read `chunkStatus` and `halos`; a test
// that reads them calls `resetStubHandle()` after each test.
import type { ChunkStatus, SimMapHandle, SimMapProps } from '$lib/map/types';

export const chunkStatus = new Map<string, ChunkStatus>();

/** Every `setHalos` argument, in order. */
export const halos: ({ from: number } | null)[] = [];

/** Empties `chunkStatus` and `halos`. */
export function resetStubHandle(): void {
  chunkStatus.clear();
  halos.length = 0;
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
  setHalos: (o) => void halos.push(o)
};
