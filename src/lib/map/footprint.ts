/** Geometry for the bottom-right map controls footprint (docs/dev/map-interfaces.md). */
export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Footprint {
  /** px from the root's right edge to the controls' left edge. */
  inline: number;
  /** px from the root's bottom edge to the controls' top edge. */
  block: number;
}

export const controlsFootprint = (root: RectLike, controls: RectLike | null): Footprint => {
  if (!controls || controls.width <= 0 || controls.height <= 0) return { inline: 0, block: 0 };
  return {
    inline: Math.max(0, Math.ceil(root.right - controls.left)),
    block: Math.max(0, Math.ceil(root.bottom - controls.top))
  };
};
