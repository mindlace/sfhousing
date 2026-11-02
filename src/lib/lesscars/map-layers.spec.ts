import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FeatureCollection, Point, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { parsePlanFile, parseSitesFile } from '$lib/data/lesscars/codec';
import { LESSCARS_HORIZON, LESSCARS_START } from '$lib/data/lesscars/schedule';
import { BUILDINGS_LAYER, OVERLAY_ANCHOR } from '$lib/map/style';
import { TOKENS } from '$lib/map/palette';
import { OPEN_DAY, type Day } from '$lib/timelapse/time';
import {
  STREET_STATES,
  garageFeatures,
  lineFeatures,
  siteFeatures,
  stopFeatures,
  streetFeatures,
  type GarageProps,
  type SiteProps
} from './features';
import { LESSCARS_LEGEND } from './legend';
import {
  LC_LAYER,
  LC_LAYER_IDS,
  LC_STREET_LAYER,
  LINE_STYLE,
  STOP_RADIUS,
  installLessCarsLayers,
  type LayerMap,
  type LessCarsLayerData
} from './map-layers';

const DIR = join(process.cwd(), 'e2e/fixtures/data/fixture-0/scenarios/lesscars');
const read = (name: string): unknown => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
const planFile = parsePlanFile(read('plan.json'));
const sitesFile = parseSitesFile(read('sites.json'));
const T = (id: string) => planFile.times.find((t) => t.id === id)!;

const data = (): LessCarsLayerData => ({
  streets: streetFeatures(planFile),
  lines: lineFeatures(planFile),
  stops: stopFeatures(planFile),
  sites: siteFeatures(planFile, sitesFile),
  garages: garageFeatures(planFile, sitesFile, {}, [])
});

interface FakeLayer {
  id: string;
  type: string;
  source?: string;
  beforeId: string | undefined;
  filter: unknown;
  paint: Record<string, unknown>;
  layout: Record<string, unknown>;
  minzoom?: number;
}

/** A recording stand-in for the MapLibre map: the style has the anchors the layers target. */
function fakeMap() {
  const style = {
    version: 8,
    sources: {},
    layers: [
      { id: 'background', type: 'background' },
      { id: BUILDINGS_LAYER, type: 'fill-extrusion' },
      { id: 'roads-label', type: 'symbol' },
      { id: OVERLAY_ANCHOR, type: 'background' }
    ]
  };
  const sources: string[] = [];
  const sourceData = new Map<string, unknown>();
  const layers: FakeLayer[] = [];
  const filters = new Map<string, unknown[]>();
  const m = {
    sources,
    layers,
    filterCalls: 0,
    layer: (id: string) => layers.find((l) => l.id === id)!,
    sourceData: (id: string) => sourceData.get(id),
    paint: (id: string, prop: string) => m.layer(id).paint[prop],
    initialFilter: (id: string) => filters.get(id)![0],
    lastFilter: (id: string) => filters.get(id)!.at(-1),
    addSource(id: string, spec: { data: unknown }) {
      sources.push(id);
      sourceData.set(id, spec.data);
    },
    getSource(id: string) {
      if (!sources.includes(id)) return undefined;
      return { setData: (d: unknown) => sourceData.set(id, d) };
    },
    addLayer(spec: Partial<FakeLayer> & { id: string; type: string }, beforeId?: string) {
      layers.push({
        filter: null,
        ...spec,
        paint: spec.paint ?? {},
        layout: spec.layout ?? {},
        beforeId
      });
      filters.set(spec.id, [spec.filter]);
    },
    getLayer: (id: string) => layers.find((l) => l.id === id),
    setFilter(id: string, f: unknown) {
      m.filterCalls++;
      filters.get(id)!.push(f);
    },
    setPaintProperty(id: string, prop: string, v: unknown) {
      m.layer(id).paint[prop] = v;
    },
    getStyle: () => style
  };
  return m;
}
const asMap = (m: ReturnType<typeof fakeMap>) => m as unknown as LayerMap;

describe('installLessCarsLayers', () => {
  it('installs every source and layer once, in stack order', () => {
    const m = fakeMap();
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    expect(m.sources).toEqual(['lc-streets', 'lc-lines', 'lc-stops', 'lc-sites', 'lc-garages']);
    expect(m.layers.map((l) => l.id)).toEqual([...LC_LAYER_IDS]);
    expect(LC_LAYER_IDS).toEqual([
      LC_LAYER.sitesFill,
      LC_LAYER.sitesOutline,
      ...STREET_STATES.map((s) => LC_STREET_LAYER[s]),
      LC_LAYER.lines,
      LC_LAYER.stopsCircle,
      LC_LAYER.stopsLabel,
      LC_LAYER.garagesCircle,
      LC_LAYER.garagesLabel
    ]);
    expect(LC_LAYER_IDS).toHaveLength(13);
    expect(m.layer(LC_LAYER.stopsLabel).layout['text-font']).toEqual(['NotoSans-Regular']);
    expect(m.layer(LC_LAYER.stopsLabel).minzoom).toBe(14);
  });

  it('anchors sites and streets under buildings, lines under labels, marks under the overlay', () => {
    const m = fakeMap();
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    const before = (id: string) => m.layer(id).beforeId;
    for (const id of [LC_LAYER.sitesFill, LC_LAYER.sitesOutline, ...Object.values(LC_STREET_LAYER)])
      expect(before(id), id).toBe(BUILDINGS_LAYER);
    expect(before(LC_LAYER.lines)).toBe('roads-label');
    for (const id of [
      LC_LAYER.stopsCircle,
      LC_LAYER.stopsLabel,
      LC_LAYER.garagesCircle,
      LC_LAYER.garagesLabel
    ])
      expect(before(id), id).toBe(OVERLAY_ANCHOR);
    for (const s of STREET_STATES)
      expect(JSON.stringify(m.layer(LC_STREET_LAYER[s]).filter)).toContain(
        JSON.stringify(['==', ['get', 'state'], s])
      );
  });

  it('every street-state layer has a dash or width no other has', () => {
    const m = fakeMap();
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    const sig = Object.values(LC_STREET_LAYER).map((id) =>
      JSON.stringify([m.layer(id).paint['line-dasharray'] ?? null, m.layer(id).paint['line-width']])
    );
    expect(sig).toHaveLength(6);
    expect(new Set(sig).size).toBe(sig.length);
  });

  it('gates every layer on the epoch start day', () => {
    const m = fakeMap();
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    for (const id of LC_LAYER_IDS) {
      const f = JSON.stringify(m.initialFilter(id));
      expect(f, id).toContain(JSON.stringify(['<=', ['get', 'from'], LESSCARS_START]));
      expect(f, id).toContain(JSON.stringify(['<', LESSCARS_START, ['get', 'to']]));
    }
  });

  it('setDay refilters only on an epoch change, forwards and backwards', () => {
    const m = fakeMap();
    const l = installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    m.filterCalls = 0;
    l.setDay(LESSCARS_START + 1); // same epoch
    expect(m.filterCalls).toBe(0);
    l.setDay(T('hwy').openDay);
    expect(m.filterCalls).toBe(LC_LAYER_IDS.length);
    expect(JSON.stringify(m.lastFilter('lc-street-removed'))).toContain(
      JSON.stringify(['<=', ['get', 'from'], T('hwy').openDay])
    );
    l.setDay(T('hwy').openDay + 1);
    expect(m.filterCalls).toBe(LC_LAYER_IDS.length);
    // back to the install day's epoch (LESSCARS_START is itself an event day in fixture-0)
    l.setDay(LESSCARS_START);
    expect(m.lastFilter('lc-street-removed')).toEqual(m.initialFilter('lc-street-removed'));
    l.setDay(LESSCARS_START - 1); // before every event: epoch 0
    expect(m.lastFilter('lc-street-removed')).not.toEqual(m.initialFilter('lc-street-removed'));
    expect(JSON.stringify(m.lastFilter('lc-street-removed'))).toContain(
      JSON.stringify(['<=', ['get', 'from'], -1])
    );
  });

  it('setTheme repaints with the other theme', () => {
    const m = fakeMap();
    const l = installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    expect(m.paint('lc-street-transit', 'line-color')).toBe(TOKENS.light['lc-transit']);
    l.setTheme('dark');
    expect(m.paint('lc-street-transit', 'line-color')).toBe(TOKENS.dark['lc-transit']);
    expect(m.paint(LC_LAYER.sitesFill, 'fill-color')).toBe(TOKENS.dark['lc-site']);
    expect(JSON.stringify(m.paint(LC_LAYER.lines, 'line-color'))).toContain(
      TOKENS.dark['lc-line-subway']
    );
  });

  it('setData on garages replaces the source data and its days count in the epochs', () => {
    const m = fakeMap();
    const l = installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    const garages: FeatureCollection<Point, GarageProps> = garageFeatures(
      planFile,
      sitesFile,
      { '3512015': [-122.418, 37.76] },
      [{ parcelId: '3512015', kept: true }]
    );
    // The garage opens on a day no other feature uses: without its data it is no event day.
    const open: Day = T('garage').openDay;
    l.setDay(open);
    const before = m.lastFilter(LC_LAYER.garagesCircle);
    expect(JSON.stringify(before)).not.toContain(JSON.stringify(['<=', ['get', 'from'], open]));
    l.setData('garages', garages);
    expect((m.sourceData('lc-garages') as typeof garages).features).toHaveLength(
      garages.features.length
    );
    expect(JSON.stringify(m.lastFilter(LC_LAYER.garagesCircle))).toContain(
      JSON.stringify(['<=', ['get', 'from'], open])
    );
  });
});

describe('source data for MapLibre', () => {
  // MapLibre's GeoJSON worker re-encodes tiles with vt-pbf, which writes an integer property as a
  // varint: OPEN_DAY (3e38) does not fit in 10 bytes and the whole source fails to load.
  it('carries no property value too large for a vt-pbf varint, on install and on setData', () => {
    const m = fakeMap();
    const l = installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    l.setData(
      'garages',
      garageFeatures(planFile, sitesFile, { '3512015': [-122.418, 37.76] }, [
        { parcelId: '3512015', kept: true }
      ])
    );
    let checked = 0;
    for (const id of m.sources) {
      const fc = m.sourceData(id) as FeatureCollection;
      for (const f of fc.features)
        for (const v of Object.values(f.properties ?? {}))
          if (typeof v === 'number') {
            expect(Math.abs(v)).toBeLessThan(2 ** 53);
            checked++;
          }
    }
    expect(checked).toBeGreaterThan(0);
    expect(OPEN_DAY).toBeGreaterThan(2 ** 53);
  });

  it('a feature that never ends stays live on the horizon and long after', () => {
    const m = fakeMap();
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_HORIZON);
    const fc = m.sourceData('lc-sites') as FeatureCollection<Polygon, SiteProps>;
    expect(fc.features.length).toBeGreaterThan(0);
    for (const f of fc.features) expect(f.properties.to).toBeGreaterThan(LESSCARS_HORIZON * 100);
  });
});

describe('LESSCARS_LEGEND', () => {
  it('has a row per street state and mark, each with a token', () => {
    expect(LESSCARS_LEGEND.map((r) => r.label)).toEqual([
      'Works under way',
      'Buses and trams only',
      'Bike lanes',
      'Pedestrian street',
      'Removed: now land',
      'Underpass filled',
      'New subway',
      'New tram',
      'New rapid bus',
      'Car shuttle',
      'Plan stop',
      'Edge garage',
      'Freed land'
    ]);
    expect(LESSCARS_LEGEND.every((r) => r.token in TOKENS.light)).toBe(true);
    expect(new Set(LESSCARS_LEGEND.map((r) => r.id)).size).toBe(LESSCARS_LEGEND.length);
  });

  it('street rows carry their layer pattern, so the key matches the map', () => {
    const m = fakeMap();
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    STREET_STATES.forEach((s, i) => {
      const row = LESSCARS_LEGEND[i];
      expect(row.kind).toBe('line');
      expect(row.token).toBe(`lc-${s}`);
      expect(row.dash).toEqual(m.layer(LC_STREET_LAYER[s]).paint['line-dasharray'] ?? null);
      expect(row.width).toBe(m.layer(LC_STREET_LAYER[s]).paint['line-width']);
      expect(row.gap).toBe(m.layer(LC_STREET_LAYER[s]).paint['line-gap-width'] ?? 0);
      expect(row.double).toBe(row.gap > 0);
    });
  });

  // WCAG 1.4.1: no two rows of one group may differ by colour alone.
  const signature = (r: (typeof LESSCARS_LEGEND)[number]) =>
    JSON.stringify([r.kind, r.dash, r.width, r.gap, r.double]);

  it('every street-state row differs from every other by a non-colour property', () => {
    const rows = LESSCARS_LEGEND.filter((r) => r.id.startsWith('street-'));
    expect(rows).toHaveLength(STREET_STATES.length);
    expect(new Set(rows.map(signature)).size).toBe(rows.length);
    expect(rows.filter((r) => r.double).map((r) => r.id)).toEqual(['street-grade']);
  });

  it('every line-mode row differs from every other by a non-colour property', () => {
    const ids = ['line-subway', 'line-tram', 'line-brt', 'shuttle'];
    const rows = ids.map((id) => LESSCARS_LEGEND.find((r) => r.id === id)!);
    expect(rows.map((r) => r.width)).toEqual([
      LINE_STYLE.subway.width,
      LINE_STYLE.tram.width,
      LINE_STYLE.brt.width,
      LINE_STYLE.shuttle.width
    ]);
    expect(new Set(rows.map(signature)).size).toBe(rows.length);
  });
});

describe('plan lines and stops without colour', () => {
  const lineWidth = (expr: unknown, mode: string, building: 0 | 1): number => {
    // Evaluate the layer's width expression: ['case', building, <match>, <match>].
    const [, , whenBuilding, whenBuilt] = expr as [string, unknown, unknown, unknown];
    const match = (building ? whenBuilding : whenBuilt) as unknown[];
    const i = match.indexOf(mode, 2);
    return (i > 0 ? match[i + 1] : match.at(-1)) as number;
  };

  it('built and building lines of every mode have widths no other has', () => {
    const m = fakeMap();
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    const expr = m.paint(LC_LAYER.lines, 'line-width');
    const modes = ['subway', 'tram', 'brt', 'shuttle'] as const;
    const widths = modes.flatMap((mode) => [lineWidth(expr, mode, 0), lineWidth(expr, mode, 1)]);
    expect(widths.slice(0, 2)).toEqual([LINE_STYLE.subway.width, LINE_STYLE.subway.building]);
    expect(new Set(widths).size).toBe(widths.length);
    const sorted = [...widths].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++)
      expect(sorted[i] - sorted[i - 1], `${sorted[i - 1]} vs ${sorted[i]}`).toBeGreaterThanOrEqual(
        0.5
      );
  });

  it('stop discs are sized by mode, like their lines', () => {
    const m = fakeMap();
    installLessCarsLayers(asMap(m), data(), 'light', LESSCARS_START);
    const r = JSON.stringify(m.paint(LC_LAYER.stopsCircle, 'circle-radius'));
    for (const mode of ['subway', 'tram', 'brt'] as const)
      expect(r).toContain(JSON.stringify([mode, STOP_RADIUS[mode]]).slice(1, -1));
    expect(STOP_RADIUS.subway).toBeGreaterThan(STOP_RADIUS.tram);
    expect(STOP_RADIUS.tram).toBeGreaterThan(STOP_RADIUS.brt);
  });
});
