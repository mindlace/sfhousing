import type { TypologyId } from '$lib/generator';
import { GEN_RGBA, type RGBA } from './palette';
import { TYPOLOGY_ORDER, type Theme } from './types';
const CODES = new Set([0, 1, 2, 4, 5, 6]);
export function encodeAppearance(role: 'occupied' | 'roof', tone: 0 | 1 | 2): number {
  if ((role !== 'occupied' && role !== 'roof') || ![0, 1, 2].includes(tone))
    throw new Error('invalid appearance');
  return tone + (role === 'roof' ? 4 : 0);
}
const colors = Object.fromEntries(
  (['light', 'dark'] as const).map((theme) => [
    theme,
    GEN_RGBA[theme].map((base) =>
      [1, 0.98, 1.02].map(
        (scale) => base.map((v, i) => (i === 3 ? v : Math.min(255, Math.round(v * scale)))) as RGBA
      )
    )
  ])
) as Record<Theme, RGBA[][]>;
/** Fixed finite colors; the full perceptual and contrast constraints are checked in appearance.spec. */
export function appearanceColor(theme: Theme, typology: TypologyId, code: number): RGBA {
  if (!CODES.has(code)) throw new Error(`invalid appearance code ${code}`);
  return colors[theme][TYPOLOGY_ORDER.indexOf(typology)][code % 4];
}
