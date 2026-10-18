import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps';
import type {
  ExpressionSpecification,
  GeoJSONSourceSpecification,
  LayerSpecification,
  StyleSpecification,
  VectorSourceSpecification
} from 'maplibre-gl';
import type { Manifest } from '$lib/data/manifest';
import type { StopClass } from '$lib/transit';
import { TOKENS } from './palette';
import type { Theme } from './types';

export const BUILDINGS_SOURCE = 'buildings';
export const BUILDINGS_LAYER = 'existing-buildings';
export const CHUNK_SOURCE = 'chunk-status';
export const CHUNK_LAYERS = ['chunk-fill', 'chunk-loading-line', 'chunk-error-line'] as const;
export const OVERLAY_ANCHOR = 'overlay-anchor';
export const TRANSIT_ACCESS_SOURCE = 'transit-access';
export const TRANSIT_STOPS_SOURCE = 'transit-stops';
export const TRANSIT_ACCESS_LAYER = 'transit-access';
export const TRANSIT_STOP_LAYERS = [
  'transit-stops-bus',
  'transit-stops-rail',
  'transit-stops-regional'
] as const;

/** Protomaps font names to the space-free glyph directories the pipeline ships. */
export const FONT_RENAME: Record<string, string> = {
  'Noto Sans Regular': 'NotoSans-Regular',
  'Noto Sans Medium': 'NotoSans-Medium',
  'Noto Sans Italic': 'NotoSans-Italic'
};

export type PaintSet = [layerId: string, prop: string, value: unknown];

type Tokens = (typeof TOKENS)[Theme];

function flavorFor(theme: Theme): Flavor {
  const t: Tokens = TOKENS[theme];
  const f = { ...namedFlavor(theme === 'light' ? 'white' : 'black') };
  const set = (keys: (keyof Flavor)[], v: string) => {
    for (const k of keys) (f as Record<string, unknown>)[k] = v;
  };
  set(['background', 'earth'], t.land);
  set(['water'], t.water);
  set(['park_a', 'park_b', 'wood_a', 'wood_b', 'scrub_a', 'scrub_b'], t.park);
  // Neutral land uses that have no token: fold into land.
  set(
    [
      'hospital',
      'industrial',
      'school',
      'pedestrian',
      'glacier',
      'sand',
      'beach',
      'aerodrome',
      'zoo',
      'military',
      'pier',
      'buildings'
    ],
    t.land
  );
  set(
    [
      'major',
      'highway',
      'link',
      'bridges_major',
      'bridges_highway',
      'bridges_link',
      'tunnel_major',
      'tunnel_highway',
      'tunnel_link'
    ],
    t.road
  );
  set(
    [
      'other',
      'minor_a',
      'minor_b',
      'minor_service',
      'bridges_minor',
      'bridges_other',
      'tunnel_minor',
      'tunnel_other',
      'runway',
      'railway',
      'boundaries',
      'minor_service_casing',
      'minor_casing',
      'link_casing',
      'major_casing_late',
      'highway_casing_late',
      'major_casing_early',
      'highway_casing_early',
      'bridges_other_casing',
      'bridges_minor_casing',
      'bridges_link_casing',
      'bridges_major_casing',
      'bridges_highway_casing',
      'tunnel_other_casing',
      'tunnel_minor_casing',
      'tunnel_link_casing',
      'tunnel_major_casing',
      'tunnel_highway_casing'
    ],
    t.roadMinor
  );
  set(
    [
      'roads_label_minor',
      'roads_label_major',
      'ocean_label',
      'subplace_label',
      'city_label',
      'state_label',
      'country_label',
      'address_label'
    ],
    t.label
  );
  set(
    [
      'roads_label_minor_halo',
      'roads_label_major_halo',
      'subplace_label_halo',
      'city_label_halo',
      'state_label_halo',
      'address_label_halo'
    ],
    t.land
  );
  if (f.landcover) {
    f.landcover = {
      barren: t.land,
      farmland: t.land,
      forest: t.park,
      glacier: t.land,
      grassland: t.park,
      scrub: t.park,
      urban_area: t.land
    };
  }
  return f;
}

const EXPR_OPS = new Set(['literal', 'case', 'match', 'step', 'interpolate', 'coalesce', 'get']);

function renameFont(name: unknown): string {
  const to = typeof name === 'string' ? FONT_RENAME[name] : undefined;
  if (to === undefined) throw new Error(`style: unknown text-font ${JSON.stringify(name)}`);
  return to;
}

/** Rewrite a text-font value: a plain stack, or an expression whose literals are stacks. */
export function rewriteFont(v: unknown, isStack: boolean): unknown {
  if (!Array.isArray(v)) return v;
  if (isStack) return v.map(renameFont);
  const op = v[0];
  if (typeof op === 'string' && EXPR_OPS.has(op)) {
    if (op === 'literal') return ['literal', rewriteFont(v[1], true)];
    return v.map((x, i) => (i === 0 ? x : rewriteFont(x, false)));
  }
  return v.map((x) => (Array.isArray(x) ? rewriteFont(x, false) : x));
}

function protomapsLayers(theme: Theme): {
  base: LayerSpecification[];
  labels: LayerSpecification[];
} {
  const all = layers('protomaps', flavorFor(theme), { lang: 'en' }) as LayerSpecification[];
  const kept = all.filter((l) => {
    if (l.id === 'pois' || l.id === 'buildings') return false;
    const layout = (l as { layout?: Record<string, unknown> }).layout;
    return layout?.['icon-image'] === undefined;
  });
  for (const l of kept) {
    const layout = (l as { layout?: Record<string, unknown> }).layout;
    if (layout && layout['text-font'] !== undefined) {
      const tf = layout['text-font'];
      const stack = Array.isArray(tf) && !(typeof tf[0] === 'string' && EXPR_OPS.has(tf[0]));
      layout['text-font'] = rewriteFont(tf, stack);
    }
  }
  return {
    base: kept.filter((l) => l.type !== 'symbol'),
    labels: kept.filter((l) => l.type === 'symbol')
  };
}

export function buildingsSource(manifest: Manifest): VectorSourceSpecification {
  return {
    type: 'vector',
    url: 'pmtiles://' + manifest.buildingsTiles,
    promoteId: { buildings: 'parcelId' }
  };
}

const REPLACED = ['boolean', ['feature-state', 'replaced'], false];

export function existingBuildingsLayer(theme: Theme): LayerSpecification {
  const t = TOKENS[theme];
  return {
    id: BUILDINGS_LAYER,
    type: 'fill-extrusion',
    source: BUILDINGS_SOURCE,
    'source-layer': 'buildings',
    minzoom: 12,
    paint: {
      'fill-extrusion-height': ['case', REPLACED, 0, ['coalesce', ['get', 'heightM'], 6]],
      'fill-extrusion-base': ['case', REPLACED, 0, ['coalesce', ['get', 'baseM'], 0]],
      'fill-extrusion-color': ['case', REPLACED, t.replaced, t.existing],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0, 13, 0.92]
    }
  } as unknown as LayerSpecification;
}

function chunkLayers(theme: Theme): LayerSpecification[] {
  const t = TOKENS[theme];
  return [
    {
      id: 'chunk-fill',
      type: 'fill',
      source: CHUNK_SOURCE,
      filter: ['==', ['get', 'status'], 'loading'],
      paint: { 'fill-color': t.chunkLoading, 'fill-opacity': 0.06 }
    },
    {
      id: 'chunk-loading-line',
      type: 'line',
      source: CHUNK_SOURCE,
      filter: ['==', ['get', 'status'], 'loading'],
      paint: { 'line-color': t.chunkLoading, 'line-width': 1, 'line-dasharray': [2, 2] }
    },
    {
      id: 'chunk-error-line',
      type: 'line',
      source: CHUNK_SOURCE,
      filter: ['==', ['get', 'status'], 'error'],
      paint: { 'line-color': t.chunkError, 'line-width': 1 }
    }
  ] as LayerSpecification[];
}

/** Transit spec §6.1: binned fill under existing buildings; hidden until SimMap applies the view. */
export function transitAccessLayer(theme: Theme): LayerSpecification {
  const t = TOKENS[theme];
  return {
    id: TRANSIT_ACCESS_LAYER,
    type: 'fill',
    source: TRANSIT_ACCESS_SOURCE,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': [
        'match',
        ['get', 'b'],
        1,
        t['transit-access-1'],
        2,
        t['transit-access-2'],
        3,
        t['transit-access-3'],
        4,
        t['transit-access-4'],
        5,
        t['transit-access-5'],
        'rgba(0,0,0,0)'
      ],
      'fill-opacity': 0.45,
      'fill-antialias': false
    }
  } as LayerSpecification;
}

// Radius by log10(capacity): 100 riders/hr -> 2.5 px, ~30k -> 7 px at z11; x3 by z16.
const STOP_R: ExpressionSpecification = ['interpolate', ['linear'], ['get', 'lc'], 2, 2.5, 4.5, 7];
const STOP_LAYER: Record<
  (typeof TRANSIT_STOP_LAYERS)[number],
  { cls: StopClass; minzoom?: number; token: 'transit-bus' | 'transit-rail' | 'transit-regional' }
> = {
  'transit-stops-bus': { cls: 'bus', minzoom: 15, token: 'transit-bus' },
  'transit-stops-rail': { cls: 'rail', minzoom: 13, token: 'transit-rail' },
  'transit-stops-regional': { cls: 'regional-rail', token: 'transit-regional' }
};

/**
 * Bus at z15+, rail at z13+, regional rail always (transit spec §6.1). Discs lie flat on the map
 * plane (they tilt with the pitch rather than facing the viewer); buildStyle puts them under the
 * roads.
 */
export function transitStopLayers(theme: Theme): LayerSpecification[] {
  const t = TOKENS[theme];
  return TRANSIT_STOP_LAYERS.map((id) => {
    const { cls, minzoom, token } = STOP_LAYER[id];
    return {
      id,
      type: 'circle',
      source: TRANSIT_STOPS_SOURCE,
      ...(minzoom !== undefined ? { minzoom } : {}),
      filter: ['==', ['get', 'cls'], cls],
      layout: { visibility: 'none' },
      paint: {
        'circle-color': t[token],
        'circle-stroke-color': t['transit-stroke'],
        'circle-stroke-width': 1,
        'circle-pitch-alignment': 'map',
        'circle-pitch-scale': 'map',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, STOP_R, 16, ['*', 3, STOP_R]]
      }
    } as LayerSpecification;
  });
}

const emptyCollection = (): GeoJSONSourceSpecification => ({
  type: 'geojson',
  data: { type: 'FeatureCollection', features: [] }
});

/**
 * Stack: terrain and water, transit-access, transit stops, roads, existing-buildings, chunk
 * layers, labels, overlay-anchor. The transit sources and layers exist only when the manifest names a transit
 * network. The deck layers go beneath the labels at runtime: SimMap gives them `beforeId` =
 * `firstSymbolLayerId(style)` (§4.4). No sprite is ever set: pois and icon layers are dropped.
 */
export function buildStyle(manifest: Manifest, theme: Theme): StyleSpecification {
  const { base, labels } = protomapsLayers(theme);
  const transit = manifest.transit !== undefined;
  // Stops sit above terrain, landuse and water but beneath the roads. Airport runways draw before
  // water, so look for the first road after it (the tunnels).
  const water = base.findIndex((l) => l.id === 'water');
  const roads = base.findIndex((l, i) => i > water && l.id.startsWith('roads_'));
  const split = transit && roads >= 0 ? roads : base.length;
  return {
    version: 8,
    glyphs: manifest.glyphs,
    sources: {
      protomaps: { type: 'vector', url: 'pmtiles://' + manifest.basemapTiles },
      [BUILDINGS_SOURCE]: buildingsSource(manifest),
      [CHUNK_SOURCE]: emptyCollection(),
      ...(transit
        ? { [TRANSIT_ACCESS_SOURCE]: emptyCollection(), [TRANSIT_STOPS_SOURCE]: emptyCollection() }
        : {})
    },
    layers: [
      ...base.slice(0, split),
      ...(transit ? [transitAccessLayer(theme), ...transitStopLayers(theme)] : []),
      ...base.slice(split),
      existingBuildingsLayer(theme),
      ...chunkLayers(theme),
      ...labels,
      { id: OVERLAY_ANCHOR, type: 'background', layout: { visibility: 'none' } }
    ]
  } as StyleSpecification;
}

/**
 * Id of the style's first `symbol` (label) layer: the `beforeId` that puts deck layers beneath
 * every label (§4.4). Undefined when there is none, and deck layers then draw on top.
 */
export function firstSymbolLayerId(
  style: Pick<StyleSpecification, 'layers'> | undefined
): string | undefined {
  return style?.layers.find((l) => l.type === 'symbol')?.id;
}

/** apply list[t] via setPaintProperty to move to theme t. Absent target keys emit null. */
export function themePaintDiff(manifest: Manifest): Record<Theme, PaintSet[]> {
  const styles = { light: buildStyle(manifest, 'light'), dark: buildStyle(manifest, 'dark') };
  const out: Record<Theme, PaintSet[]> = { light: [], dark: [] };
  for (const to of ['light', 'dark'] as const) {
    const from = to === 'light' ? 'dark' : 'light';
    const fromById = new Map(styles[from].layers.map((l) => [l.id, l]));
    for (const l of styles[to].layers) {
      const a = (fromById.get(l.id) as { paint?: Record<string, unknown> })?.paint ?? {};
      const b = (l as { paint?: Record<string, unknown> }).paint ?? {};
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[to].push([l.id, k, b[k] ?? null]);
      }
    }
  }
  return out;
}
