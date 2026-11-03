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
  | 'transit-stroke'
  | 'limit-ink'
  | 'limit-edge'
  | 'limit-glaze'
  | 'limit-wall'
  | 'limit-halo'
  | 'brush-paint'
  | 'brush-erase'
  | 'painted-outline'
  | 'tl-ghost-planning'
  | 'tl-ghost-permit'
  | 'tl-ghost-ready'
  | 'tl-ghost-dying'
  | 'tl-bar-track'
  | 'tl-bar-edge'
  | 'tl-bar-likely'
  | 'tl-bar-uncertain'
  | 'tl-bar-unlikely'
  | 'tl-bar-dead'
  | 'lc-works'
  | 'lc-transit'
  | 'lc-bike'
  | 'lc-pedestrian'
  | 'lc-removed'
  | 'lc-grade'
  | 'lc-line-subway'
  | 'lc-line-tram'
  | 'lc-line-brt'
  | 'lc-shuttle'
  | 'lc-garage'
  | 'lc-site';

/** Spec §4.3 verbatim, with the one-hue-per-meaning transit, pipeline and brush tokens from spec 2026-10-31 §8; `transit-*` from transit spec §6.1; `tl-*` from timelapse-render spec §4.6; `lc-*` are the /lesscars map marks (plan 2 Task 3b). Hex, or rgba() for highlight. */
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
    'transit-access-1': '#E0F2EF',
    'transit-access-2': '#B3E0D8',
    'transit-access-3': '#7CC7BA',
    'transit-access-4': '#3FA596',
    'transit-access-5': '#167A6E',
    'transit-bus': '#5E7A76',
    'transit-rail': '#0F5A52',
    'transit-regional': '#0B3B36',
    'transit-stroke': '#FFFFFF',
    'limit-ink': '#2B2A28',
    'limit-edge': 'rgba(43,42,40,0.45)',
    'limit-glaze': 'rgba(72,74,78,0.4)',
    'limit-wall': 'rgba(72,74,78,0.25)',
    'limit-halo': '#F3EFE6',
    'brush-paint': '#B4532F',
    'brush-erase': '#2B2A28',
    'painted-outline': '#B4532F',
    'tl-ghost-planning': '#DDBBD2',
    'tl-ghost-permit': '#C58FB1',
    'tl-ghost-ready': '#93527F',
    'tl-ghost-dying': '#C62828',
    'tl-bar-track': '#FFFFFF',
    'tl-bar-edge': '#5E5A52',
    'tl-bar-likely': '#2E7D32',
    'tl-bar-uncertain': '#B26A00',
    'tl-bar-unlikely': '#C62828',
    'tl-bar-dead': '#8A8478',
    'lc-works': '#B35C00',
    'lc-transit': '#C1272D',
    'lc-bike': '#2E7D32',
    'lc-pedestrian': '#7B3FA0',
    'lc-removed': '#6E6658',
    'lc-grade': '#1E63B0',
    'lc-line-subway': '#0B4F8A',
    'lc-line-tram': '#8A5A00',
    'lc-line-brt': '#A3195B',
    'lc-shuttle': '#4A4A4A',
    'lc-garage': '#3B4A9C',
    'lc-site': '#8C6D3F'
  },
  dark: {
    land: '#1C1D1F',
    water: '#10181C',
    park: '#1F2420',
    road: '#34373B',
    roadMinor: '#252729',
    label: '#A9A59C',
    existing: '#3B3D41',
    replaced: '#232427',
    highlight: 'rgba(255,255,255,0.30)',
    chunkLoading: '#8F8A80',
    chunkError: '#F2B8B5',
    'gen-adu': '#6E3B22',
    'gen-plex': '#8A4A28',
    'gen-walkup': '#A65C2E',
    'gen-podium': '#C27236',
    'gen-midrise': '#DB8B42',
    'gen-tower': '#F0A752',
    'transit-access-1': '#16282A',
    'transit-access-2': '#1B3E3E',
    'transit-access-3': '#22595A',
    'transit-access-4': '#2E7B78',
    'transit-access-5': '#4BA59E',
    'transit-bus': '#9BB5B0',
    'transit-rail': '#7FD6C9',
    'transit-regional': '#C2F0E8',
    'transit-stroke': '#111214',
    'limit-ink': '#E8E4DC',
    'limit-edge': 'rgba(232,228,220,0.4)',
    'limit-glaze': 'rgba(214,216,220,0.3)',
    'limit-wall': 'rgba(214,216,220,0.18)',
    'limit-halo': '#1C1D1F',
    'brush-paint': '#DB8B42',
    'brush-erase': '#E8E4DC',
    'painted-outline': '#DB8B42',
    'tl-ghost-planning': '#623257',
    'tl-ghost-permit': '#8A5679',
    'tl-ghost-ready': '#C08AAE',
    'tl-ghost-dying': '#FF8A80',
    'tl-bar-track': '#2C2E31',
    'tl-bar-edge': '#A9A59C',
    'tl-bar-likely': '#81C784',
    'tl-bar-uncertain': '#FFB74D',
    'tl-bar-unlikely': '#FF8A80',
    'tl-bar-dead': '#8F8A80',
    'lc-works': '#F0A040',
    'lc-transit': '#FF8A8A',
    'lc-bike': '#7FCF83',
    'lc-pedestrian': '#C9A0F0',
    'lc-removed': '#B8B0A0',
    'lc-grade': '#7FB8F0',
    'lc-line-subway': '#6FC3F0',
    'lc-line-tram': '#E0C060',
    'lc-line-brt': '#F07AB0',
    'lc-shuttle': '#C8C8C8',
    'lc-garage': '#A8B4F8',
    'lc-site': '#C9A86A'
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

/** Fill opacity of the transit-access layer; the legend swatches composite at the same alpha. */
export const TRANSIT_ACCESS_OPACITY = 0.45;

/** sRGB channel blend of fg over bg at `alpha`, '#RRGGBB' uppercase. A legend helper only. */
export function compositeHex(fg: string, bg: string, alpha: number): string {
  const [fr, fgc, fb] = hexToRgba(fg);
  const [br, bgc, bb] = hexToRgba(bg);
  const mix = (f: number, b: number) =>
    Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(fr, br)}${mix(fgc, bgc)}${mix(fb, bb)}`.toUpperCase();
}

/** The colour a capacity bin k actually shows on the map over land. */
export function accessSwatch(theme: Theme, k: 1 | 2 | 3 | 4 | 5): string {
  const t = TOKENS[theme];
  return compositeHex(t[`transit-access-${k}` as const], t.land, TRANSIT_ACCESS_OPACITY);
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

export interface TimelineLegendEntry {
  id: string;
  kind: 'ghost' | 'solid' | 'bar';
  tokens: TokenName[];
  label: string;
}

/** Spec §4.6 legend, in render order; fzp-mode draws it with the `--map-tl-*` / `--map-gen-*` vars. */
export const TIMELINE_LEGEND: readonly TimelineLegendEntry[] = [
  {
    id: 'planning',
    kind: 'ghost',
    tokens: ['tl-ghost-planning'],
    label: 'Proposed: in Planning review'
  },
  { id: 'permit', kind: 'ghost', tokens: ['tl-ghost-permit'], label: 'Approved: in permit review' },
  { id: 'ready', kind: 'ghost', tokens: ['tl-ghost-ready'], label: 'Permit issued' },
  {
    id: 'building',
    kind: 'solid',
    tokens: ['tl-ghost-ready', 'gen-walkup'],
    label: 'Under construction (solid floors are built)'
  },
  {
    id: 'complete',
    kind: 'solid',
    tokens: TYPOLOGY_ORDER.map((t) => `gen-${t}` as const),
    label: 'Completed (colour shows building type)'
  },
  {
    id: 'stopped',
    kind: 'ghost',
    tokens: ['tl-ghost-dying'],
    label: 'Stopped: withdrawn, disapproved, cancelled or expired'
  },
  {
    id: 'chance',
    kind: 'bar',
    tokens: ['tl-bar-unlikely', 'tl-bar-uncertain', 'tl-bar-likely'],
    label: 'Bar colour: chance of finishing, low to high'
  },
  { id: 'bar-stopped', kind: 'bar', tokens: ['tl-bar-dead'], label: 'Bar: project stopped' }
];

const customProp = (name: TokenName) =>
  `--map-${name.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}`;

/**
 * The `--map-*` custom-property CSS for `names`: the light values scoped to `selector`, then the
 * dark values under `prefers-color-scheme: dark` (spec §4.6.1). Declarations keep `TOKENS` key
 * order whatever the order of `names`. Pure and DOM-free (runs in SSR). Not part of the public
 * surface: exported only so SimMap can build its default stylesheet on it. The selector is spliced
 * into CSS unescaped, so callers pass a trusted selector; `timelineTokenCss` validates its own.
 */
export function tokenCss(selector: string, names: readonly TokenName[]): string {
  const wanted = new Set(names);
  const vars = (theme: Theme) =>
    (Object.keys(TOKENS[theme]) as TokenName[])
      .filter((n) => wanted.has(n))
      .map((n) => `${customProp(n)}: ${TOKENS[theme][n]}`)
      .join('; ');
  return (
    `${selector} { ${vars('light')} } ` +
    `@media (prefers-color-scheme: dark) { ${selector} { ${vars('dark')} } }`
  );
}

/**
 * T7 (spec §4.6.1): the `--map-*` properties a legend outside SimMap needs, scoped to `selector`:
 * every `tl-*` token plus every token `TIMELINE_LEGEND` names, light then dark under
 * `prefers-color-scheme`. CSS text without a `<style>` wrapper. Follows the system theme only;
 * a page that passes SimMap an explicit `theme` sets its legend variables itself.
 * Throws `TypeError` for a selector that is blank or contains `{`, `}`, `<` or `;`.
 */
export function timelineTokenCss(selector: string): string {
  if (typeof selector !== 'string' || selector.trim() === '' || /[{}<;]/.test(selector)) {
    throw new TypeError(
      `timelineTokenCss: selector must be non-blank and contain none of { } < ; (got ${JSON.stringify(selector)})`
    );
  }
  const names = new Set<TokenName>(TIMELINE_LEGEND.flatMap((e) => e.tokens));
  for (const n of Object.keys(TOKENS.light) as TokenName[]) if (n.startsWith('tl-')) names.add(n);
  return tokenCss(selector, [...names]);
}
