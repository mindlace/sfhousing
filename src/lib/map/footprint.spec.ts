import { describe, expect, it } from 'vitest';
import { controlsFootprint } from './footprint';

const root = { left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 };
const rect = (left: number, top: number, right: number, bottom: number) => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top
});

describe('controlsFootprint', () => {
  it('measures from the root right/bottom edges to the container left/top edges', () => {
    expect(controlsFootprint(root, rect(380, 372, 600, 400))).toEqual({ inline: 220, block: 28 });
  });

  it('a narrower (collapsed) container yields a smaller inline size', () => {
    const collapsed = controlsFootprint(root, rect(570, 372, 600, 400));
    const expanded = controlsFootprint(root, rect(380, 372, 600, 400));
    expect(collapsed.inline).toBe(30);
    expect(expanded.inline).toBeGreaterThan(collapsed.inline);
  });

  it('includes the bottom inset lift and ceils fractional pixels', () => {
    expect(controlsFootprint(root, rect(379.2, 271.5, 600, 300))).toEqual({
      inline: 221,
      block: 129
    });
  });

  it('is zero for a missing, empty or hidden container', () => {
    expect(controlsFootprint(root, null)).toEqual({ inline: 0, block: 0 });
    expect(controlsFootprint(root, rect(600, 400, 600, 400))).toEqual({ inline: 0, block: 0 });
  });

  it('never goes negative', () => {
    expect(controlsFootprint(root, rect(650, 450, 700, 480))).toEqual({ inline: 0, block: 0 });
  });
});
