import type { GeneratedBuilding, TypologyId } from '$lib/generator';
import { TYPOLOGY_ORDER, type Theme } from './types';

export type RGBA = [number, number, number, number];

export type TokenName =
  | 'land'
  | 'water'
  | 'park'
  | 'road'
  | 'roadMinor'
  | 'label'
  | 'existing'
  | 'replaced'
  | 'highlight'
  | 'chunkLoading'
  | 'chunkError'
  | `gen-${TypologyId}`
  | `transit-access-${1 | 2 | 3 | 4 | 5}`
  | 'transit-bus'
  | 'transit-rail'
  | 'transit-regional'
  | 'transit-stroke';

/** Spec §4.3 verbatim; `transit-*` from transit spec §6.1. Hex, or rgba() for highlight. */
export const TOKENS: Record<Theme, Record<TokenName, string>> = {
  light: {
    land: '#F3EFE6',
    water: '#C7D3D6',
    park: '#E2E4D3',
    road: '#FFFFFF',
    roadMinor: '#EAE5DA',
    label: '#5E5A52',
    existing: '#D6D0C4',
    replaced: '#E3DACA',
    highlight: 'rgba(255,255,255,0.45)',
    chunkLoading: '#8A8478',
    chunkError: '#B3261E',
    'gen-adu': '#E9A487',
    'gen-plex': '#E08A68',
    'gen-walkup': '#D2704E',
    'gen-podium': '#BF5A3A',
    'gen-midrise': '#A3472C',
    'gen-tower': '#84371F',
    'transit-access-1': '#E4EEF3',
    'transit-access-2': '#BED7E3',
    'transit-access-3': '#8DB9CF',
    'transit-access-4': '#5596B5',
    'transit-access-5': '#2C6E8F',
    'transit-bus': '#5F6B66',
    'transit-rail': '#7B3FA0',
    'transit-regional': '#1F5FBF',
    'transit-stroke': '#FFFFFF'
  },
  dark: {
    land: '#1C1D1F',
    water: '#10181C',
    park: '#1F2420',
    road: '#2C2E31',
    roadMinor: '#252729',
    label: '#A9A59C',
    existing: '#3B3D41',
    replaced: '#2A2B2E',
    highlight: 'rgba(255,255,255,0.30)',
    chunkLoading: '#8F8A80',
    chunkError: '#F2B8B5',
    'gen-adu': '#6E3B22',
    'gen-plex': '#8A4A28',
    'gen-walkup': '#A65C2E',
    'gen-podium': '#C27236',
    'gen-midrise': '#DB8B42',
    'gen-tower': '#F0A752',
    'transit-access-1': '#1E2A31',
    'transit-access-2': '#24414F',
    'transit-access-3': '#2D5D72',
    'transit-access-4': '#3A7F9C',
    'transit-access-5': '#5BA6C6',
    'transit-bus': '#A3ADA6',
    'transit-rail': '#C59BE0',
    'transit-regional': '#7FB2FF',
    'transit-stroke': '#111214'
  }
};

/** '#RRGGBB' or 'rgba(r,g,b,a)' to deck.gl RGBA (0-255 channels). `alpha` (0-255) overrides. */
export function hexToRgba(hex: string, alpha = 255): RGBA {
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(hex);
  if (m) return [+m[1], +m[2], +m[3], Math.round(+m[4] * 255)];
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    alpha
  ];
}

export const GEN_RGBA: Record<Theme, RGBA[]> = {
  light: TYPOLOGY_ORDER.map((t) => hexToRgba(TOKENS.light[`gen-${t}`])),
  dark: TYPOLOGY_ORDER.map((t) => hexToRgba(TOKENS.dark[`gen-${t}`]))
};

export function colorFor(
  source: GeneratedBuilding['source'],
  typology: TypologyId,
  theme: Theme
): RGBA {
  if (source !== 'user' && source !== 'pipeline' && source !== 'scenario')
    throw new Error(`colorFor: unsupported source ${String(source)}`);
  return GEN_RGBA[theme][TYPOLOGY_ORDER.indexOf(typology)];
}
