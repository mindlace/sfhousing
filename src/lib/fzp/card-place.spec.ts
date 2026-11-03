import { describe, expect, it } from 'vitest';
import { cardArea, cardPlacement } from './card-place';

const area = { left: 0, top: 0, right: 1280, bottom: 700 };
const size = { w: 320, h: 200 };

describe('cardPlacement', () => {
  it('sits right of the anchor by the gap, centred on it, when it fits', () => {
    expect(cardPlacement({ x: 400, y: 300 }, size, area)).toEqual({ left: 416, top: 200 });
  });

  it('takes a custom gap', () => {
    expect(cardPlacement({ x: 400, y: 300 }, size, area, 40)).toEqual({ left: 440, top: 200 });
  });

  it('flips left of the anchor when the right side overflows the area', () => {
    expect(cardPlacement({ x: 1100, y: 300 }, size, area)).toEqual({ left: 764, top: 200 });
  });

  it('keeps the right side while it fits, pulled 8 px inside the edge at the limit', () => {
    expect(cardPlacement({ x: 930, y: 300 }, size, area)).toEqual({ left: 946, top: 200 });
    // Ends exactly at the edge: it does not overflow, so no flip, only the margin.
    expect(cardPlacement({ x: 944, y: 300 }, size, area)).toEqual({ left: 952, top: 200 });
  });

  it('clamps 8 px inside the top and the bottom', () => {
    expect(cardPlacement({ x: 400, y: 20 }, size, area).top).toBe(8);
    expect(cardPlacement({ x: 400, y: 690 }, size, area).top).toBe(700 - 8 - 200);
  });

  it('clamps below an area top that clears the notice pills', () => {
    const below = { ...area, top: 56 };
    expect(cardPlacement({ x: 400, y: 20 }, size, below).top).toBe(64);
  });

  it('clamps right of the dock', () => {
    const docked = { ...area, left: 320 };
    // The anchor is under the dock: the right side starts inside it, the clamp moves it out.
    expect(cardPlacement({ x: 100, y: 300 }, size, docked).left).toBe(328);
    // A flip that would land under the dock is clamped too.
    const narrow = { left: 320, top: 0, right: 700, bottom: 700 };
    expect(cardPlacement({ x: 650, y: 300 }, size, narrow).left).toBe(328);
  });

  it('prefers the top edge when the card is taller than the area', () => {
    expect(cardPlacement({ x: 400, y: 300 }, { w: 320, h: 900 }, area).top).toBe(8);
  });
});

describe('cardArea', () => {
  const map = { left: 0, top: 56, width: 1280, height: 700 };

  it('is the map right of the dock and above the time bar', () => {
    expect(cardArea(map, null, 320, 80)).toEqual({ left: 320, top: 0, right: 1280, bottom: 620 });
  });

  it('starts below a showing notice pill, so the card never overlaps it', () => {
    // A pill 8 px below the map's top, 36 px high: its bottom is 44 px into the map.
    const pills = { top: 64, bottom: 100, height: 36 };
    const area = cardArea(map, pills, 320, 80);
    expect(area.top).toBe(44);
    // The placement then keeps the card 8 px under the pill, even for a click at the very top.
    expect(cardPlacement({ x: 800, y: 4 }, { w: 320, h: 200 }, area).top).toBe(44 + 8);
  });

  it('ignores an empty stack, and one that is not over the map (a phone: in flow above it)', () => {
    expect(cardArea(map, { top: 64, bottom: 64, height: 0 }, 0, 0).top).toBe(0);
    expect(cardArea(map, { top: 16, bottom: 52, height: 36 }, 0, 0).top).toBe(0);
  });
});
