/**
 * SimMap's `setOverlayLayers` has one owner (docs/dev/map-interfaces.md). Several writers share it:
 * on /sim the feedback buildings, the height limits, the painted outlines and the brush ring; on /
 * the selected row's outline and the brush ring. Each writes its own slot; the map gets the slots
 * concatenated in a fixed order.
 */
import type { Layer } from '@deck.gl/core';

/**
 * Draw order, bottom to top: feedback buildings under the height limits; outlines and the brush
 * ring over them (the limits write no depth, so a ground line drawn after them stays visible).
 */
export const OVERLAY_ORDER = ['feedback', 'limits', 'outline', 'ring'] as const;
export type OverlaySlot = (typeof OVERLAY_ORDER)[number];

export function createOverlayMux(set: (layers: Layer[]) => void): {
  slot(name: OverlaySlot): (layers: Layer[]) => void;
} {
  const slots: Record<OverlaySlot, Layer[]> = { feedback: [], limits: [], outline: [], ring: [] };
  return {
    slot(name) {
      return (layers) => {
        slots[name] = layers;
        set(OVERLAY_ORDER.flatMap((s) => slots[s]));
      };
    }
  };
}
