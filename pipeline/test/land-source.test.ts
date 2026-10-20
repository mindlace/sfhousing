import type { VectorTile } from '@mapbox/vector-tile';
import { describe, expect, it } from 'vitest';
import { landFeaturesFromTile, tileBounds } from '../sources/land';
import { miniDuck } from './helpers';

const square = (x0: number, y0: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x0 + 0.001, y0],
      [x0 + 0.001, y0 + 0.001],
      [x0, y0]
    ]
  ]
});
const line = {
  type: 'LineString',
  coordinates: [
    [-122.4, 37.8],
    [-122.41, 37.81]
  ]
};

const feat = (type: number, properties: Record<string, string>, geometry: object) => ({
  type,
  properties,
  toGeoJSON: () => ({ type: 'Feature', properties, geometry })
});
const layer = (features: ReturnType<typeof feat>[]) => ({
  length: features.length,
  feature: (i: number) => features[i]
});

const fake = {
  layers: {
    earth: layer([
      feat(3, { kind: 'earth' }, square(-122.42, 37.77)),
      feat(3, { kind: 'water' }, square(-122.41, 37.77))
    ]),
    landuse: layer([
      feat(3, { kind: 'pier' }, square(-122.415, 37.775)),
      feat(2, { kind: 'pier' }, line),
      feat(3, { kind: 'park' }, square(-122.412, 37.772))
    ]),
    roads: layer([feat(2, { kind_detail: 'pier' }, line)])
  }
} as unknown as Pick<VectorTile, 'layers'>;

describe('land source', () => {
  it('keeps earth and pier polygons and nothing else', () => {
    const f = landFeaturesFromTile(fake, 15, 5241, 12663);
    expect(f.map((x) => `${x.layer}:${x.fid}`)).toEqual(['earth:0', 'pier:0']);
    expect(JSON.parse(f[0].geojson).type).toMatch(/Polygon/);
  });

  it('gives tile bounds in lon/lat', () => {
    const [w, , e] = tileBounds(15, 5241, 12663);
    expect(w).toBeCloseTo(-122.420654296875, 12);
    expect(e).toBeCloseTo(-122.40966796875, 12);
  });

  it('loads the mini basemap as z15 earth over two tile columns', async () => {
    const db = await miniDuck();
    const rows = await db.all<{ x: number; n: number }>(
      "SELECT x, count(*) n FROM src_land WHERE layer = 'earth' GROUP BY x ORDER BY x"
    );
    expect(rows.map((r) => r.x)).toEqual([5240, 5241]);
    expect((await db.all('SELECT * FROM src_land WHERE z <> 15')).length).toBe(0);
    const tiles = await db.all<{ x: number }>(
      'SELECT DISTINCT x FROM src_land_tiles WHERE z = 15 ORDER BY x'
    );
    expect(tiles.map((r) => r.x)).toEqual([5240, 5241]);
  });
});
