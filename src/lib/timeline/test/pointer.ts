/// <reference types="@vitest/browser-playwright" />
// Test support: moves the real (provider) pointer to a point in client coordinates. Browser-only.
import { expect } from 'vitest';
import { userEvent, type Locator } from 'vitest/browser';

/** Hovers `el` at `position` (the provider's frame) and returns where the move landed. */
async function moveTo(el: Locator, x: number, y: number): Promise<{ x: number; y: number }> {
  let at: { x: number; y: number } | null = null;
  const on = (e: PointerEvent) => (at = { x: e.clientX, y: e.clientY });
  document.addEventListener('pointermove', on, { capture: true });
  try {
    await userEvent.hover(el, { position: { x, y }, force: true });
  } finally {
    document.removeEventListener('pointermove', on, { capture: true });
  }
  expect(at).not.toBeNull();
  return at!;
}

/**
 * Stops the pointer in the gap above the tooltip `tip`, between the bottom of its target
 * (`above`, a client y) and the tooltip's top, 4 px in from the tooltip's left. The provider's
 * positions and the page's client coordinates can differ by a fixed offset (the test frame's),
 * so it is measured first with a move inside the tooltip.
 */
export async function pointerBetween(tip: Locator, above: number): Promise<void> {
  const r = tip.element().getBoundingClientRect();
  const probe = await moveTo(tip, 4, r.height / 2);
  const dx = probe.x - (r.left + 4);
  const dy = probe.y - (r.top + r.height / 2);
  const y = (above + r.top) / 2;
  const landed = await moveTo(tip, 4 - dx, y - r.top - dy);
  expect(landed.y).toBeGreaterThan(above);
  expect(landed.y).toBeLessThan(r.top);
}
