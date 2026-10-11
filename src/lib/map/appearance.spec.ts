import { expect, it } from 'vitest';
import { differenceCiede2000, parse } from 'culori';
import { appearanceColor, encodeAppearance } from './appearance';
import { TOKENS } from './palette';
import { TYPOLOGY_ORDER } from './types';
const codes = [0, 1, 2, 4, 5, 6];
const hex = (rgb: number[]) =>
  '#' +
  rgb
    .slice(0, 3)
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('');
const lum = (rgb: number[]) =>
  rgb
    .slice(0, 3)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((n, v, i) => n + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (rgb: number[], ground: string) => {
  const g = lum([1, 3, 5].map((i) => parseInt(ground.slice(i, i + 2), 16)));
  const l = lum(rgb);
  return (Math.max(g, l) + 0.05) / (Math.min(g, l) + 0.05);
};
it('encodes the finite appearance choices and rejects invalid choices', () => {
  expect(encodeAppearance('occupied', 0)).toBe(0);
  expect(encodeAppearance('occupied', 2)).toBe(2);
  expect(encodeAppearance('roof', 0)).toBe(4);
  expect(encodeAppearance('roof', 2)).toBe(6);
  expect(() => appearanceColor('light', 'tower', 3)).toThrow();
});
for (const theme of ['light', 'dark'] as const)
  it(`${theme} tones preserve separation and ordered ground contrast`, () => {
    const de = differenceCiede2000();
    let previous = 0;
    for (const t of TYPOLOGY_ORDER) {
      const colors = codes.map((code) => appearanceColor(theme, t, code));
      for (const color of colors)
        expect(de(parse(hex(color))!, parse(TOKENS[theme].existing)!)).toBeGreaterThanOrEqual(20);
      const contrasts = colors.map((c) => contrast(c, TOKENS[theme].land));
      expect(Math.min(...contrasts)).toBeGreaterThan(previous);
      previous = Math.max(...contrasts);
    }
  });
