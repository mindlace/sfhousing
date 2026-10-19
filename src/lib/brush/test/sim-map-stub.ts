// Recording SimMapHandle for SimMapStub.svelte. Tests read `chunkStatus` and reset it per test.
import type { ChunkStatus, SimMapHandle, SimMapProps } from '$lib/map/types';

export const chunkStatus = new Map<string, ChunkStatus>();

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
  setTimelineLookups: () => {}
};
