import { describe, expect, it } from 'vitest';
import { CHART_COLORS, PANEL_BG } from './chart-colors';

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('ExtraChart colours', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: text meets 4.5:1 and the lines 3:1 against the panel`, () => {
      const c = CHART_COLORS[theme];
      const bg = PANEL_BG[theme];
      expect(contrast(c.text, bg)).toBeGreaterThanOrEqual(4.5);
      for (const k of ['mean', 'zero', 'now'] as const)
        expect(contrast(c[k], bg)).toBeGreaterThanOrEqual(3);
    });
  }
});
