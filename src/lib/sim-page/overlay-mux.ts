/**
 * SimMap's `setOverlayLayers` has one owner (docs/dev/map-interfaces.md). On /sim several writers
 * share it: the feedback buildings, the height fog, the painted outlines and the brush ring. Each
 * writes its own slot; the map gets the slots concatenated in a fixed order.
 */
import type { Layer } from '@deck.gl/core';

/**
 * Draw order, bottom to top: feedback buildings under the fog; outlines and the brush ring over it
 * (the fog writes no depth, so a ground line drawn after it stays visible).
 */
export const OVERLAY_ORDER = ['feedback', 'fog', 'outline', 'ring'] as const;
export type OverlaySlot = (typeof OVERLAY_ORDER)[number];

export function createOverlayMux(set: (layers: Layer[]) => void): {
  slot(name: OverlaySlot): (layers: Layer[]) => void;
} {
  const slots: Record<OverlaySlot, Layer[]> = { feedback: [], fog: [], outline: [], ring: [] };
  return {
    slot(name) {
      return (layers) => {
        slots[name] = layers;
        set(OVERLAY_ORDER.flatMap((s) => slots[s]));
      };
    }
  };
}
