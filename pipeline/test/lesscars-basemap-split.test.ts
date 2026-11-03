// splitRoadsTile on synthetic tiles encoded with @maplibre/vt-pbf: every geometry is in tile units
// (extent 4096) of tile 12/655/1583, and the corridor is a tile-unit rectangle given as [lng, lat].
import { VectorTile } from '@mapbox/vector-tile';
import { fromVectorTileJs, type VectorTileFeatureLike } from '@maplibre/vt-pbf';
import Pbf from 'pbf';
import { describe, expect, it } from 'vitest';
import { LC_ROADS_LAYER, splitRoadsTile, type SplitPhase } from '../lib/lesscars/basemap-split';

const EXTENT = 4096;
const [z, x, y] = [12, 655, 1583];

type Uv = [number, number];
interface Feat {
  id: number;
  type: 1 | 2 | 3;
  properties: Record<string, string | number | boolean>;
  geometry: Uv[][];
}

/** Tile units of 12/655/1583 to [lng, lat]. */
function lngLat([u, v]: Uv): [number, number] {
  const n = 2 ** z;
  const lng = ((x + u / EXTENT) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v / EXTENT)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

/** The corridor: u 1000..3000, v 1900..2100. */
const corridor: [number, number][][] = [
  (
    [
      [1000, 1900],
      [3000, 1900],
      [3000, 2100],
      [1000, 2100],
      [1000, 1900]
    ] as Uv[]
  ).map(lngLat)
];

function layerOf(name: string, features: Feat[]) {
  return {
    version: 2,
    name,
    extent: EXTENT,
    length: features.length,
    feature: (i: number) => {
      const f = features[i];
      return {
        id: f.id,
        type: f.type,
        properties: f.properties,
        extent: EXTENT,
        // vt-pbf reads only x and y of each point
        loadGeometry: () =>
          f.geometry.map((ring) => ring.map(([a, b]) => ({ x: a, y: b }))) as unknown as ReturnType<
            VectorTileFeatureLike['loadGeometry']
          >
      };
    }
  };
}

function tile(roads: Feat[], others: Record<string, Feat[]> = {}): Uint8Array {
  const layers: Record<string, ReturnType<typeof layerOf>> = { roads: layerOf('roads', roads) };
  for (const [name, fs] of Object.entries(others)) layers[name] = layerOf(name, fs);
  return fromVectorTileJs({ layers });
}

function road(
  id: number,
  kind: string,
  geometry: Uv[][],
  props: Record<string, string | number | boolean> = {}
): Feat {
  return { id, type: 2, properties: { kind, ...props }, geometry };
}

function decode(mvt: Uint8Array): Record<string, Feat[]> {
  const t = new VectorTile(new Pbf(mvt));
  const out: Record<string, Feat[]> = { roads: [], [LC_ROADS_LAYER]: [] };
  for (const [name, l] of Object.entries(t.layers)) {
    out[name] = [];
    for (let i = 0; i < l.length; i++) {
      const f = l.feature(i);
      out[name].push({
        id: f.id!,
        type: f.type as 1 | 2 | 3,
        properties: f.properties as Feat['properties'],
        geometry: f.loadGeometry().map((r) => r.map((p) => [p.x, p.y] as Uv))
      });
    }
  }
  return out;
}

const lengthOf = (fs: Feat[]): number =>
  fs
    .flatMap((f) => f.geometry)
    .reduce((t, l) => {
      for (let i = 1; i < l.length; i++)
        t += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
      return t;
    }, 0);

function phase(p: { ids?: number[]; ref?: string | null; corridor: [number, number][][] }) {
  return {
    projectId: 'p1',
    ids: new Set(p.ids ?? []),
    ref: p.ref ?? null,
    corridor: p.corridor
  } satisfies SplitPhase;
}

const inside: Uv[][] = [
  [
    [1200, 2000],
    [2800, 2000]
  ]
];
// A listed merge (as 35184377160410 on the live basemap): half inside the corridor, half along
// the kept stretch beyond its flat end.
const listedMerge = road(35184377160410, 'highway', [
  [
    [2000, 2000],
    [3800, 2000]
  ]
]);
// A highway with ref 'US 101' crossing the corridor's flat end at mid-tile.
const longHighway = road(
  35184377160999,
  'highway',
  [
    [
      [200, 2000],
      [2000, 2000]
    ]
  ],
  { ref: 'US 101' }
);
const i280Across = road(
  35184377161000,
  'highway',
  [
    [
      [2000, 500],
      [2000, 3500]
    ]
  ],
  { ref: 'I 280' }
);

describe('splitRoadsTile', () => {
  it('a listed id inside the corridor moves to roads_lc with lc_project; other features stay', () => {
    const out = decode(
      splitRoadsTile(
        tile([road(7, 'highway', inside), road(8, 'minor_road', inside)]),
        z,
        x,
        y,
        [phase({ ids: [7], corridor })],
        false
      )!
    );
    expect(out.roads.map((f) => f.id)).toEqual([8]);
    expect(out.roads_lc.map((f) => [f.id, f.properties.lc_project])).toEqual([[7, 'p1']]);
    expect(out.roads_lc[0].properties.kind).toBe('highway');
  });

  it('a listed id on a clip zoom is clipped, not moved whole', () => {
    const out = decode(
      splitRoadsTile(
        tile([listedMerge]),
        z,
        x,
        y,
        [phase({ ids: [listedMerge.id], corridor })],
        true
      )!
    );
    expect(lengthOf(out.roads_lc)).toBeCloseTo(1000, -1);
    expect(out.roads.map((f) => f.id)).toEqual([listedMerge.id]);
    expect(lengthOf(out.roads)).toBeCloseTo(800, -1);
    expect(out.roads[0].properties).toEqual(listedMerge.properties);
  });

  it('a merged line is clipped at the corridor: the kept part stays in roads', () => {
    const out = decode(
      splitRoadsTile(tile([longHighway]), z, x, y, [phase({ ref: 'US 101', corridor })], true)!
    );
    expect(lengthOf(out.roads_lc)).toBeCloseTo(1000, -1);
    expect(lengthOf(out.roads)).toBeCloseTo(800, -1);
    expect(out.roads[0].id).toBe(longHighway.id);
    expect(out.roads_lc[0]).toMatchObject({
      id: longHighway.id,
      properties: { kind: 'highway', ref: 'US 101', lc_project: 'p1' }
    });
  });

  it('a ref matches by any of its ;-separated tokens', () => {
    const multi = { ...longHighway, properties: { kind: 'highway', ref: 'I 80;US 101' } };
    const out = decode(
      splitRoadsTile(tile([multi]), z, x, y, [phase({ ref: 'US 101', corridor })], true)!
    );
    expect(lengthOf(out.roads_lc)).toBeCloseTo(1000, -1);
    const partial = { ...longHighway, properties: { kind: 'highway', ref: 'US 1010' } };
    expect(
      splitRoadsTile(tile([partial]), z, x, y, [phase({ ref: 'US 101', corridor })], true)
    ).toBeNull();
  });

  it('a crossing freeway with another ref is not clipped', () => {
    expect(
      splitRoadsTile(tile([i280Across]), z, x, y, [phase({ ref: 'US 101', corridor })], true)
    ).toBeNull();
  });

  it('on a zoom that is not a clip zoom nothing unlisted moves', () => {
    expect(
      splitRoadsTile(tile([longHighway]), z, x, y, [phase({ ref: 'US 101', corridor })], false)
    ).toBeNull();
  });

  it('an unlisted feature of another kind with the ref is not clipped', () => {
    const major = { ...longHighway, properties: { kind: 'major_road', ref: 'US 101' } };
    expect(
      splitRoadsTile(tile([major]), z, x, y, [phase({ ref: 'US 101', corridor })], true)
    ).toBeNull();
  });

  it('a tile away from every corridor is unchanged (null)', () => {
    const far = [[lngLat([1000, 1900]), lngLat([1001, 1900]), lngLat([1001, 1901])]].map((r) =>
      r.map(([lng, lat]) => [lng + 1, lat] as [number, number])
    );
    expect(
      splitRoadsTile(
        tile([road(7, 'highway', inside)]),
        z,
        x,
        y,
        [phase({ ids: [7], corridor: far })],
        true
      )
    ).toBeNull();
  });

  it('other layers and the order of the kept features are re-encoded unchanged', () => {
    const water: Feat = {
      id: 3,
      type: 3,
      properties: { kind: 'water' },
      geometry: [
        [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
          [0, 0]
        ]
      ]
    };
    const out = decode(
      splitRoadsTile(
        tile([road(8, 'minor_road', inside), road(7, 'highway', inside), road(9, 'path', inside)], {
          water: [water]
        }),
        z,
        x,
        y,
        [phase({ ids: [7], corridor })],
        true
      )!
    );
    expect(out.water).toEqual([water]);
    expect(out.roads.map((f) => f.id)).toEqual([8, 9]);
    expect(out.roads[0].geometry).toEqual(inside);
  });

  it('the first phase whose corridor holds a part takes it', () => {
    const p2 = { ...phase({ ids: [7], corridor }), projectId: 'p2' };
    const out = decode(
      splitRoadsTile(
        tile([road(7, 'highway', inside)]),
        z,
        x,
        y,
        [phase({ ids: [7], corridor }), p2],
        true
      )!
    );
    expect(out.roads_lc.map((f) => f.properties.lc_project)).toEqual(['p1']);
  });
});
