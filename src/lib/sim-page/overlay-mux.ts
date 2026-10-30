/**
 * SimMap's `setOverlayLayers` has one owner (docs/dev/map-interfaces.md). On /sim two writers
 * share it: the lot dots and the brush ring. Each writes its own slot; the map gets the slots
 * concatenated in a fixed order (lots under the ring).
 */
import type { Layer } from '@deck.gl/core';

const ORDER = ['lots', 'ring'] as const;
type Slot = (typeof ORDER)[number];

export function createOverlayMux(set: (layers: Layer[]) => void): {
  slot(name: Slot): (layers: Layer[]) => void;
} {
  const slots: Record<Slot, Layer[]> = { lots: [], ring: [] };
  return {
    slot(name) {
      return (layers) => {
        slots[name] = layers;
        set(ORDER.flatMap((s) => slots[s]));
      };
    }
  };
}
