import { readFileSync } from 'node:fs';
import { expression } from '@maplibre/maplibre-gl-style-spec';
import type { FeatureCollection } from 'geojson';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '$lib/data/manifest';
import { CARS_BINS, CARS_LEGEND, carsBin, zonesCollection } from './cars-layer';
import { TOKENS } from './palette';
import { CARS_LAYER, CARS_SOURCE, buildStyle, carsLayer } from './style';

const square = (x: number) => [
  [
    [x, 0],
    [x + 1, 0],
    [x + 1, 1],
    [x, 1],
    [x, 0]
  ]
];

const geo: FeatureCollection = {
  type: 'FeatureCollection',
  features: [0, 1, 2].map((z) => ({
    type: 'Feature',
    properties: { z, geoid: `g${z}` },
    geometry: { type: 'Polygon', coordinates: square(z) }
  }))
};

describe('zonesCollection', () => {
  it("sets each zone's cars per household as v, in feature order", () => {
    const out = zonesCollection(geo, new Float32Array([0.5, 1.25, 2]));
    expect(out.features.map((f) => f.properties)).toEqual([
      { z: 0, v: 0.5 },
      { z: 1, v: 1.25 },
      { z: 2, v: 2 }
    ]);
    expect(out.features[1].geometry).toBe(geo.features[1].geometry);
  });

  it('a zone with no households (NaN) is v: null, never 0 (Review Focus 2)', () => {
    const out = zonesCollection(geo, new Float32Array([Number.NaN, 0, 1]));
    expect(out.features.map((f) => f.properties!.v)).toEqual([null, 0, 1]);
  });

  it('a zone past the values is v: null', () => {
    const out = zonesCollection(geo, new Float32Array([1]));
    expect(out.features.map((f) => f.properties!.v)).toEqual([1, null, null]);
  });
});

describe('the legend', () => {
  it('one label per bin, the bins ascending', () => {
    expect(CARS_LEGEND).toHaveLength(CARS_BINS.length + 1);
    expect([...CARS_BINS]).toEqual([...CARS_BINS].sort((a, b) => a - b));
    expect([0.2, 0.5, 0.8, 1.2, 3].map(carsBin)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('carsLayer', () => {
  for (const theme of ['light', 'dark'] as const) {
    const layer = carsLayer(theme) as {
      id: string;
      source: string;
      layout: { visibility: string };
      paint: Record<string, unknown>;
    };
    const color = expression.createExpression(layer.paint['fill-color'], {
      type: 'color'
    } as never);
    const at = (v: unknown) => {
      if (color.result !== 'success') throw new Error('bad expression');
      return color.value.evaluate({ zoom: 12 }, {
        type: 'Polygon',
        properties: v === undefined ? {} : { v }
      } as never);
    };

    it(`${theme}: a hidden fill on the zones source`, () => {
      expect(layer.id).toBe(CARS_LAYER);
      expect(layer.source).toBe(CARS_SOURCE);
      expect(layer.layout.visibility).toBe('none');
    });

    it(`${theme}: paints null (no households) as no data: transparent`, () => {
      expect(String(at(null))).toBe('rgba(0,0,0,0)');
      expect(String(at(undefined))).toBe('rgba(0,0,0,0)');
      expect(String(at(0))).toBe(TOKENS[theme]['cars-1']);
    });

    it(`${theme}: each bin takes its ramp colour`, () => {
      const t = TOKENS[theme];
      expect([0.2, 0.5, 0.8, 1.2, 3].map((v) => String(at(v)))).toEqual(
        ([1, 2, 3, 4, 5] as const).map((k) => t[`cars-${k}`])
      );
    });
  }
});

describe('buildStyle and the car zones', () => {
  const raw = JSON.parse(readFileSync('e2e/fixtures/data/fixture-0/manifest.json', 'utf8'));
  const withCars = parseManifest(raw);
  const noCars = parseManifest({
    ...raw,
    scenarios: { fzp: { ...raw.scenarios.fzp, cars: undefined, carZones: undefined } }
  });

  it('adds the zones source and the cars layer only when the manifest names car zones', () => {
    const s = buildStyle(withCars, 'light');
    expect(s.sources[CARS_SOURCE]).toEqual({
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    expect(s.layers.some((l) => l.id === CARS_LAYER)).toBe(true);
    const n = buildStyle(noCars, 'light');
    expect(n.sources[CARS_SOURCE]).toBeUndefined();
    expect(n.layers.some((l) => l.id === CARS_LAYER)).toBe(false);
  });

  it('the cars layer sits under the roads and the transit stops', () => {
    const ids = buildStyle(withCars, 'light').layers.map((l) => l.id);
    const cars = ids.indexOf(CARS_LAYER);
    expect(cars).toBeLessThan(ids.indexOf('transit-stops-bus'));
    expect(cars).toBeGreaterThan(ids.indexOf('water'));
    const roads = ids.findIndex((id, i) => i > ids.indexOf('water') && id.startsWith('roads_'));
    expect(cars).toBeLessThan(roads);
  });
});
