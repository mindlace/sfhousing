export interface CardArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The room the card may take, in map-container px: right of the dock (`dockW`), above the time
 * bar (`scrubberH`), and below the notice-pill stack when it overlays the map's top (from md; a
 * pill may be showing). The stack's `height` is 0 when no pill shows, and below md it sits in
 * flow above the map, so its bottom is not past the map's top: both leave the top at 0.
 */
export function cardArea(
  map: { left: number; top: number; width: number; height: number },
  pills: { top: number; bottom: number; height: number } | null,
  dockW: number,
  scrubberH: number
): CardArea {
  const pillsBottom = pills && pills.height > 0 ? pills.bottom - map.top : 0;
  return {
    left: dockW,
    top: Math.max(0, pillsBottom),
    right: map.width,
    bottom: map.height - scrubberH
  };
}

/** How far the card keeps inside its area, px. */
const MARGIN = 8;

/**
 * The card's top-left in map-container px: right of the anchor by `gap`, or left of it when
 * that overflows `area.right`; vertically centred on it; clamped 8 px inside `area`. When the
 * card is larger than the area, the left and top edges win.
 */
export function cardPlacement(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  area: { left: number; top: number; right: number; bottom: number },
  gap = 16
): { left: number; top: number } {
  const right = anchor.x + gap;
  const flipped = right + size.w > area.right;
  const left = flipped ? anchor.x - gap - size.w : right;
  const top = anchor.y - size.h / 2;
  return {
    left: clamp(left, area.left + MARGIN, area.right - MARGIN - size.w),
    top: clamp(top, area.top + MARGIN, area.bottom - MARGIN - size.h)
  };
}

/** `v` within [min, max]; the minimum wins if the range is empty. */
const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, max));
