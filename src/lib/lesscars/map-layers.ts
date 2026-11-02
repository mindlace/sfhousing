// The /lesscars map: the plan's streets, transit lines and stops, freed land and edge garages as
// ordinary MapLibre layers over GeoJSON sources, gated by day. Every layer's filter keeps the
// features live on the current epoch's start day, so scrubbing within one epoch sets no filter.
//
// Builder's calls:
// - One line layer per street state, because `line-dasharray` is not data-driven. The states
//   differ by width and pattern as well as colour (WCAG 1.4.1): works dashed, transit wide solid,
//   bike narrow solid, pedestrian dotted, removed thin solid, underpass filled a double line
//   (`line-gap-width`).
// - The plan lines share one layer (13 layer ids in all), so a line being built cannot be dashed:
//   it is narrower and translucent instead, and the car shuttle is narrower than the transit lines.
// - Stops are hollow discs (ring in the `label` token), all modes alike; garages are discs with a
//   "P", hollow while being built.
// - Runtime layers bypass the style's font rewrite, so text uses the shipped glyph names.
import type {
  ExpressionSpecification,
  FilterSpecification,
  GeoJSONSource,
  LayerSpecification,
  Map as MapLibreMap
} from 'maplibre-gl';
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { TOKENS, type TokenName } from '$lib/map/palette';
import { BUILDINGS_LAYER, OVERLAY_ANCHOR, firstSymbolLayerId } from '$lib/map/style';
import type { Theme } from '$lib/map/types';
import type { Day } from '$lib/timelapse/time';
import {
  STREET_STATES,
  epochOf,
  eventDays,
  type GarageProps,
  type LineProps,
  type SiteProps,
  type StopProps,
  type StreetProps,
  type StreetState
} from './features';

export interface LessCarsLayerData {
  streets: FeatureCollection<LineString, StreetProps>;
  lines: FeatureCollection<LineString, LineProps>;
  stops: FeatureCollection<Point, StopProps>;
  sites: FeatureCollection<Polygon, SiteProps>;
  garages: FeatureCollection<Point, GarageProps>;
}
export type LayerMap = Pick<
  MapLibreMap,
  | 'addSource'
  | 'addLayer'
  | 'getLayer'
  | 'getSource'
  | 'setFilter'
  | 'setPaintProperty'
  | 'getStyle'
>;
export interface LessCarsLayers {
  /** O(log n); calls setFilter only when epochOf(day) changes. */
  setDay(day: Day): void;
  setTheme(theme: Theme): void;
  /** Replaces one source's data (garages arrive once the worker has loaded) and refreshes the event days. */
  setData<K extends keyof LessCarsLayerData>(key: K, fc: LessCarsLayerData[K]): void;
}

const SOURCE: Record<keyof LessCarsLayerData, string> = {
  streets: 'lc-streets',
  lines: 'lc-lines',
  stops: 'lc-stops',
  sites: 'lc-sites',
  garages: 'lc-garages'
};

export const LC_STREET_LAYER = Object.fromEntries(
  STREET_STATES.map((s) => [s, `lc-street-${s}`])
) as Record<StreetState, string>;
/** The non-street layers by role; e2e queries these ids. */
export const LC_LAYER = {
  sitesFill: 'lc-sites-fill',
  sitesOutline: 'lc-sites-outline',
  lines: 'lc-lines',
  stopsCircle: 'lc-stops-circle',
  stopsLabel: 'lc-stops-label',
  garagesCircle: 'lc-garages-circle',
  garagesLabel: 'lc-garages-label'
} as const;
/** Every layer, in stack order: sites fill, sites outline, the six street layers in STREET_STATES
 *  order, lines, stops circle, stops label, garages circle, garages label (13 ids). */
export const LC_LAYER_IDS: readonly string[] = [
  LC_LAYER.sitesFill,
  LC_LAYER.sitesOutline,
  ...STREET_STATES.map((s) => LC_STREET_LAYER[s]),
  LC_LAYER.lines,
  LC_LAYER.stopsCircle,
  LC_LAYER.stopsLabel,
  LC_LAYER.garagesCircle,
  LC_LAYER.garagesLabel
];

/** Width, dash (in line widths, null solid) and gap (a double line) of each street state. */
export const STREET_STYLE: Record<
  StreetState,
  { width: number; dash: number[] | null; gap: number }
> = {
  works: { width: 4, dash: [2, 1.5], gap: 0 },
  transit: { width: 6, dash: null, gap: 0 },
  bike: { width: 3, dash: null, gap: 0 },
  pedestrian: { width: 5, dash: [0.1, 1.6], gap: 0 },
  removed: { width: 1.5, dash: null, gap: 0 },
  grade: { width: 2, dash: null, gap: 3 }
};
/** Opacity of the freed-land fill under its outline. */
const SITE_FILL_OPACITY = 0.3;
/** The text font, by its shipped glyph directory name (FONT_RENAME in src/lib/map/style.ts). */
const FONT_REGULAR = 'NotoSans-Regular';
const FONT_MEDIUM = 'NotoSans-Medium';

type Spec = Exclude<LayerSpecification, { type: 'background' | 'raster' | 'hillshade' }> & {
  filter?: FilterSpecification;
};
interface LayerDef {
  id: string;
  /** Where it stacks: before this anchor. */
  anchor: 'buildings' | 'labels' | 'overlay';
  own: FilterSpecification | null;
  spec: (t: Record<TokenName, string>) => Omit<Spec, 'id' | 'filter'>;
}

const building = (yes: string, no: string): ExpressionSpecification => [
  'case',
  ['==', ['get', 'building'], 1],
  yes,
  no
];

const DEFS: LayerDef[] = [
  {
    id: LC_LAYER.sitesFill,
    anchor: 'buildings',
    own: null,
    spec: (t) => ({
      type: 'fill',
      source: SOURCE.sites,
      paint: { 'fill-color': t['lc-site'], 'fill-opacity': SITE_FILL_OPACITY }
    })
  },
  {
    id: LC_LAYER.sitesOutline,
    anchor: 'buildings',
    own: null,
    spec: (t) => ({
      type: 'line',
      source: SOURCE.sites,
      paint: { 'line-color': t['lc-site'], 'line-width': 1.5, 'line-dasharray': [3, 2] }
    })
  },
  ...STREET_STATES.map((s): LayerDef => ({
    id: LC_STREET_LAYER[s],
    anchor: 'buildings',
    own: ['==', ['get', 'state'], s],
    spec: (t) => {
      const st = STREET_STYLE[s];
      return {
        type: 'line',
        source: SOURCE.streets,
        layout: { 'line-cap': s === 'pedestrian' ? 'round' : 'butt', 'line-join': 'round' },
        paint: {
          'line-color': t[`lc-${s}`],
          'line-width': st.width,
          ...(st.dash ? { 'line-dasharray': st.dash } : {}),
          ...(st.gap ? { 'line-gap-width': st.gap } : {})
        }
      };
    }
  })),
  {
    id: LC_LAYER.lines,
    anchor: 'labels',
    own: null,
    spec: (t) => ({
      type: 'line',
      source: SOURCE.lines,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match',
          ['get', 'mode'],
          'subway',
          t['lc-line-subway'],
          'tram',
          t['lc-line-tram'],
          'brt',
          t['lc-line-brt'],
          t['lc-shuttle']
        ],
        'line-width': [
          'case',
          ['==', ['get', 'mode'], 'shuttle'],
          2.5,
          ['==', ['get', 'building'], 1],
          2.5,
          5
        ],
        'line-opacity': ['case', ['==', ['get', 'building'], 1], 0.55, 1]
      }
    })
  },
  {
    id: LC_LAYER.stopsCircle,
    anchor: 'overlay',
    own: null,
    spec: (t) => ({
      type: 'circle',
      source: SOURCE.stops,
      paint: {
        'circle-radius': 5,
        'circle-color': t['transit-stroke'],
        'circle-stroke-color': t.label,
        'circle-stroke-width': 2
      }
    })
  },
  {
    id: LC_LAYER.stopsLabel,
    anchor: 'overlay',
    own: null,
    spec: (t) => ({
      type: 'symbol',
      source: SOURCE.stops,
      minzoom: 14,
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [FONT_REGULAR],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.8]
      },
      paint: { 'text-color': t.label, 'text-halo-color': t.land, 'text-halo-width': 1.5 }
    })
  },
  {
    id: LC_LAYER.garagesCircle,
    anchor: 'overlay',
    own: null,
    spec: (t) => ({
      type: 'circle',
      source: SOURCE.garages,
      paint: {
        'circle-radius': 9,
        'circle-color': building(t.land, t['lc-garage']),
        'circle-stroke-color': t['lc-garage'],
        'circle-stroke-width': 2
      }
    })
  },
  {
    id: LC_LAYER.garagesLabel,
    anchor: 'overlay',
    own: null,
    spec: (t) => ({
      type: 'symbol',
      source: SOURCE.garages,
      layout: {
        'text-field': 'P',
        'text-font': [FONT_MEDIUM],
        'text-size': 12,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: { 'text-color': building(t['lc-garage'], t.land) }
    })
  }
];

/** The filter that keeps `own`'s features live on day `d`. */
function dayFilter(own: FilterSpecification | null, d: Day): FilterSpecification {
  const live: ExpressionSpecification[] = [
    ['<=', ['get', 'from'], d],
    ['<', d, ['get', 'to']]
  ];
  return (own ? ['all', own, ...live] : ['all', ...live]) as FilterSpecification;
}

export function installLessCarsLayers(
  map: LayerMap,
  data: LessCarsLayerData,
  theme: Theme,
  day: Day
): LessCarsLayers {
  const current = { ...data };
  let days = eventDays(...Object.values(current));
  let today = day;
  /** The current epoch's start day, which every filter is built on (-1 before every event). */
  const startOf = (d: Day) => {
    const e = epochOf(days, d);
    return e === 0 ? -1 : days[e - 1];
  };
  let applied = startOf(day);

  for (const key of Object.keys(SOURCE) as (keyof LessCarsLayerData)[])
    if (!map.getSource(SOURCE[key]))
      map.addSource(SOURCE[key], { type: 'geojson', data: current[key] });

  const style = map.getStyle();
  const anchors = {
    buildings: style.layers.some((l) => l.id === BUILDINGS_LAYER) ? BUILDINGS_LAYER : undefined,
    labels: firstSymbolLayerId(style),
    overlay: style.layers.some((l) => l.id === OVERLAY_ANCHOR) ? OVERLAY_ANCHOR : undefined
  };
  for (const def of DEFS) {
    if (map.getLayer(def.id)) continue;
    map.addLayer(
      { id: def.id, ...def.spec(TOKENS[theme]), filter: dayFilter(def.own, applied) } as Spec,
      anchors[def.anchor]
    );
  }

  const refilter = () => {
    const d = startOf(today);
    if (d === applied) return;
    applied = d;
    for (const def of DEFS) map.setFilter(def.id, dayFilter(def.own, d));
  };

  return {
    setDay(d) {
      today = d;
      refilter();
    },
    setTheme(t) {
      for (const def of DEFS) {
        const paint = def.spec(TOKENS[t]).paint ?? {};
        for (const [prop, v] of Object.entries(paint))
          map.setPaintProperty(def.id, prop as Parameters<LayerMap['setPaintProperty']>[1], v);
      }
    },
    setData(key, fc) {
      current[key] = fc;
      (map.getSource(SOURCE[key]) as GeoJSONSource | undefined)?.setData(fc);
      days = eventDays(...Object.values(current));
      refilter();
    }
  };
}
