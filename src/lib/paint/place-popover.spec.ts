import { describe, expect, it } from 'vitest';
import { placePopover } from './place-popover';

const vp = { width: 1280, height: 800 };

describe('placePopover', () => {
  it('right-aligns under the anchor with a 4 px gap', () => {
    expect(placePopover({ bottom: 40, right: 900 }, { width: 280 }, vp)).toEqual({
      left: 620,
      top: 44,
      maxHeight: 748
    });
  });

  it('keeps 8 px from the left edge', () => {
    expect(placePopover({ bottom: 40, right: 200 }, { width: 280 }, vp).left).toBe(8);
  });

  it('keeps 8 px from the right edge', () => {
    expect(placePopover({ bottom: 40, right: 1279 }, { width: 280 }, vp).left).toBe(992);
  });

  it('pins to the left margin when wider than the viewport allows', () => {
    const p = placePopover({ bottom: 40, right: 290 }, { width: 290 }, { width: 300, height: 800 });
    expect(p.left).toBe(8);
  });

  it('never returns a negative maxHeight', () => {
    expect(placePopover({ bottom: 795, right: 900 }, { width: 280 }, vp).maxHeight).toBe(0);
  });
});
