// The collision box estimate (labelWidthPx) against the label font as the browser draws it.
import { describe, expect, it } from 'vitest';
import { LABEL_FONT_FAMILY, LABEL_FONT_WEIGHT, labelWidthPx } from './labels';
import { LABEL_SIZE_PX } from './limits-layer';

describe('label font', () => {
  it('is a system sans, not deck’s default monospace', () => {
    expect(LABEL_FONT_FAMILY).toMatch(/system-ui/);
    expect(LABEL_FONT_FAMILY).toMatch(/sans-serif$/);
    expect(LABEL_FONT_FAMILY).not.toMatch(/monospace|Monaco/);
  });

  it('labelWidthPx covers the measured width of every kind of label, by at most 35%', () => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${LABEL_FONT_WEIGHT} ${LABEL_SIZE_PX}px ${LABEL_FONT_FAMILY}`;
    for (const t of [
      '4 stories',
      '6 stories · +16 floors',
      '40 stories · +1,200 floors',
      '1 story · +0 floors',
      '40+',
      '8'
    ]) {
      const w = ctx.measureText(t).width;
      expect(labelWidthPx(t), t).toBeGreaterThanOrEqual(w);
      expect(labelWidthPx(t), t).toBeLessThanOrEqual(1.35 * w);
    }
  });
});
