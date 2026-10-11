// Recording SimMapHandle for SimMapStub.svelte. Tests read `chunkStatus` and reset it per test.
import type { ChunkStatus, SimMapHandle } from '$lib/map/types';

export const chunkStatus = new Map<string, ChunkStatus>();

export const stubHandle: SimMapHandle = {
  applyGenerated: () => {},
  setChunkStatus: (cellId, s) => void chunkStatus.set(cellId, s),
  setPanEnabled: () => {},
  setBottomInset: () => {},
  getMap: () => null,
  setOverlayLayers: () => {},
  onResyncNeeded: () => {}
};
