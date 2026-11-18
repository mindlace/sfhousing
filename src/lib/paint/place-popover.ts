export interface Placement {
  left: number;
  top: number;
  maxHeight: number;
}

/** Right-aligned under the anchor, kept `margin` px inside the viewport. */
export function placePopover(
  anchor: { bottom: number; right: number },
  size: { width: number },
  viewport: { width: number; height: number },
  gap = 4,
  margin = 8
): Placement {
  const max = viewport.width - size.width - margin;
  const left = max < margin ? margin : Math.min(Math.max(anchor.right - size.width, margin), max);
  const top = anchor.bottom + gap;
  return { left, top, maxHeight: Math.max(0, viewport.height - top - margin) };
}
