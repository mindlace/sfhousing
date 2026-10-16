import { describe, expect, it } from 'vitest';
import { differenceCiede2000, parse } from 'culori';
import { TOKENS, colorFor, GEN_RGBA } from './palette';
import { TYPOLOGY_ORDER } from './types';

const de = differenceCiede2000();
function luminance(hex: string) {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('palette (U4)', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: every typology has a colour`, () => {
      for (const t of TYPOLOGY_ORDER) expect(colorFor('user', t, theme)).toHaveLength(4);
      expect(GEN_RGBA[theme]).toHaveLength(6);
    });
    it(`${theme}: ΔE2000(gen, existing) ≥ 20`, () => {
      for (const t of TYPOLOGY_ORDER) {
        const d = de(parse(TOKENS[theme][`gen-${t}`])!, parse(TOKENS[theme].existing)!);
        expect(d, t).toBeGreaterThanOrEqual(20);
      }
    });
    it(`${theme}: ground contrast strictly increases with typology order`, () => {
      const cs = TYPOLOGY_ORDER.map((t) => contrast(TOKENS[theme][`gen-${t}`], TOKENS[theme].land));
      for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeGreaterThan(cs[i - 1]);
    });
    it(`${theme}: the access ramp's contrast with land strictly increases`, () => {
      const cs = ([1, 2, 3, 4, 5] as const).map((k) =>
        contrast(TOKENS[theme][`transit-access-${k}`], TOKENS[theme].land)
      );
      for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeGreaterThan(cs[i - 1]);
    });
    it(`${theme}: stop classes are distinct (ΔE2000 ≥ 20)`, () => {
      const ids = ['transit-bus', 'transit-rail', 'transit-regional'] as const;
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const d = de(parse(TOKENS[theme][ids[i]])!, parse(TOKENS[theme][ids[j]])!);
          expect(d, `${ids[i]} vs ${ids[j]}`).toBeGreaterThanOrEqual(20);
        }
    });
    it(`${theme}: stop markers keep 3:1 contrast with land`, () => {
      for (const id of ['transit-bus', 'transit-rail', 'transit-regional'] as const)
        expect(contrast(TOKENS[theme][id], TOKENS[theme].land), id).toBeGreaterThanOrEqual(3);
    });
  }
  it('non-user source throws (M1 seam)', () => {
    expect(() => colorFor('pipeline' as never, 'plex', 'light')).toThrow(/unsupported source/);
  });
  it('spec hex values are verbatim', () => {
    expect(TOKENS.light.existing).toBe('#D6D0C4');
    expect(TOKENS.dark['gen-tower']).toBe('#F0A752');
  });
});
