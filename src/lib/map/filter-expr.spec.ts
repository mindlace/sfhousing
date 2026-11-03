// featureFilter is imported from '@maplibre/maplibre-gl-style-spec' in this test only (a
// devDependency), to compare a converted filter with MapLibre's reading of the original.
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { layers, namedFlavor } from '@protomaps/basemaps';
import { describe, expect, it } from 'vitest';
import { toExpressionFilter } from './filter-expr';

type Layer = { id: string; 'source-layer'?: string; filter?: unknown };

function protomapsRoadLayers(): Layer[] {
  const all = layers('protomaps', namedFlavor('white'), { lang: 'en' }) as Layer[];
  return all.filter((l) => l['source-layer'] === 'roads');
}

type Feat = { type: 1 | 2 | 3; id: number; properties: Record<string, string | number | boolean> };

/** Every combination of the properties the protomaps road filters read, on a line. */
const SAMPLE_FEATURES: Feat[] = (() => {
  const out: Feat[] = [];
  const kinds = ['highway', 'major_road', 'minor_road', 'other', 'path', 'rail', undefined];
  const details = ['service', 'runway', 'taxiway', 'pier', 'residential', undefined];
  const flags = [0, 1, 2, 3, 4, 5, 6, 7];
  let id = 1;
  for (const kind of kinds)
    for (const detail of details)
      for (const f of flags) {
        const p: Feat['properties'] = {};
        if (kind !== undefined) p.kind = kind;
        if (detail !== undefined) p.kind_detail = detail;
        if (f & 1) p.is_tunnel = true;
        if (f & 2) p.is_bridge = true;
        if (f & 4) p.is_link = true;
        if (id % 3 === 0) p.oneway = 'yes';
        if (id % 5 === 0) p.shield_text = id % 2 ? '101' : 'I-280X';
        out.push({ type: 2, id: id++, properties: p });
      }
  return out;
})();

const evalLegacy = (filter: unknown, feat: Feat): boolean =>
  featureFilter(filter as never, 'layers[0].filter').filter({ zoom: 14 } as never, feat as never);
const evalExpr = evalLegacy;

describe('toExpressionFilter', () => {
  it('every protomaps roads filter converts to an expression that selects the same features', () => {
    for (const l of protomapsRoadLayers()) {
      for (const feat of SAMPLE_FEATURES)
        expect(evalExpr(toExpressionFilter(l.filter), feat), l.id).toBe(evalLegacy(l.filter, feat));
      // the samples exercise every layer: each selects some and rejects some
      const hits = SAMPLE_FEATURES.filter((f) => evalLegacy(l.filter, f)).length;
      expect(hits, l.id).toBeGreaterThan(0);
      expect(hits, l.id).toBeLessThan(SAMPLE_FEATURES.length);
    }
  });

  it('an unknown legacy operator throws', () => {
    expect(() => toExpressionFilter(['within', 'x'])).toThrow(/within/);
  });

  it('a legacy filter inside an expression all reads as the legacy filter did', () => {
    const legacy = ['==', 'kind', 'highway'];
    const e = toExpressionFilter(legacy);
    const wrapped = ['all', e, ['!', ['in', ['get', 'lc_project'], ['literal', ['hwy']]]]];
    const hwy: Feat = { type: 2, id: 1, properties: { kind: 'highway', lc_project: 'x' } };
    expect(evalExpr(wrapped, hwy)).toBe(true);
    expect(evalExpr(wrapped, { ...hwy, properties: { kind: 'highway', lc_project: 'hwy' } })).toBe(
      false
    );
    expect(evalExpr(wrapped, { ...hwy, properties: { kind: 'minor_road' } })).toBe(false);
  });

  it('converts the other legacy forms as MapLibre reads them', () => {
    const filters: unknown[] = [
      ['!in', 'kind', 'highway', 'rail'],
      ['in', 'kind'],
      ['!has', 'is_link'],
      ['none', ['has', 'is_tunnel'], ['==', 'kind', 'rail']],
      ['any', ['==', 'kind', 'rail'], ['!=', 'kind_detail', 'service']],
      ['==', '$type', 'LineString'],
      ['==', '$id', 3],
      ['in', '$id', 1, 2, 3],
      ['<', '$id', 10],
      ['>=', 'kind', 'n'],
      ['!=', 'kind', null],
      ['==', 'kind', null]
    ];
    for (const f of filters)
      for (const feat of SAMPLE_FEATURES)
        expect(evalExpr(toExpressionFilter(f), feat), JSON.stringify(f)).toBe(evalLegacy(f, feat));
  });

  it('returns an expression as is, and no filter as one that keeps every feature', () => {
    const e = ['==', ['get', 'kind'], 'highway'];
    expect(toExpressionFilter(e)).toBe(e);
    expect(evalExpr(toExpressionFilter(undefined), SAMPLE_FEATURES[0])).toBe(true);
  });
});
