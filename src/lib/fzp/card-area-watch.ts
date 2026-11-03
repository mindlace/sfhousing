/**
 * What changes the room the project card may take (`cardArea`), and nothing else: the map's box,
 * the notice-pill stack's height (a pill appearing takes it from 0), the bottom-left controls'
 * box, the dock swapping its panel for its rail (a child list change of the dock element only),
 * and the bottom-right controls' footprint on `:root` (`--map-controls-br-block-size`, its inline
 * value). Text changes inside the map (the scrubber readout, a tooltip) change none of these, so
 * playback costs nothing here. Reports are coalesced to one per frame.
 */
/** The bottom-right controls' footprint SimMap publishes on `:root`, px from the map's bottom. */
export const BR_BLOCK = '--map-controls-br-block-size';
const FOOTPRINT = ['--map-controls-br-inline-size', BR_BLOCK];

export interface CardAreaTargets {
  map: HTMLElement;
  pills?: HTMLElement | null;
  /** The dock's own element: its panel or rail is its child. */
  dock?: HTMLElement | null;
  /** MapLibre's bottom-left controls container. */
  controls?: HTMLElement | null;
}

/** Calls `onchange` (once per frame) when the card's room may have changed; returns a stop. */
export function watchCardArea(t: CardAreaTargets, onchange: () => void): () => void {
  let frame = 0;
  const soon = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(onchange);
  };

  const ro = new ResizeObserver(soon);
  for (const e of [t.map, t.pills, t.controls]) if (e) ro.observe(e);

  const mo = new MutationObserver(soon);
  if (t.dock) mo.observe(t.dock, { childList: true });

  // Only the footprint's inline values count: any other root style write is none of our business.
  const root = document.documentElement;
  const footprint = () => FOOTPRINT.map((k) => root.style.getPropertyValue(k)).join('|');
  let last = footprint();
  const rootMo = new MutationObserver(() => {
    const now = footprint();
    if (now === last) return;
    last = now;
    soon();
  });
  rootMo.observe(root, { attributes: true, attributeFilter: ['style'] });

  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    mo.disconnect();
    rootMo.disconnect();
  };
}
