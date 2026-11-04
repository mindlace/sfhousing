// splitRoadsTile on synthetic tiles encoded with @maplibre/vt-pbf: every geometry is in tile units
// (extent 4096) of tile 12/655/1583, and the corridor is a tile-unit rectangle given as [lng, lat].
import { readFileSync } from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import { fromVectorTileJs, type VectorTileFeatureLike } from '@maplibre/vt-pbf';
import Pbf from 'pbf';
import { describe, expect, it } from 'vitest';
import { LESSCARS_FREEWAY_LAND_JSON } from '../lesscars-config';
import {
  keptOnlyRefs,
  LC_ROADS_LAYER,
  splitRoadsTile,
  type SplitPhase
} from '../lib/lesscars/basemap-split';
import { parseFreewayLand } from '../lib/lesscars/freeway-land';

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

/** The removed line the corridor is built around: v 2000, u 1000..3000. */
const centreLine: [number, number][][] = [
  (
    [
      [1000, 2000],
      [3000, 2000]
    ] as Uv[]
  ).map(lngLat)
];

function phase(p: {
  ids?: number[];
  corridor: [number, number][][];
  lines?: [number, number][][];
}) {
  return {
    projectId: 'p1',
    ids: new Set(p.ids ?? []),
    lines: p.lines ?? centreLine,
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
    const out = decode(splitRoadsTile(tile([longHighway]), z, x, y, [phase({ corridor })], true)!);
    expect(lengthOf(out.roads_lc)).toBeCloseTo(1000, -1);
    expect(lengthOf(out.roads)).toBeCloseTo(800, -1);
    expect(out.roads[0].id).toBe(longHighway.id);
    expect(out.roads_lc[0]).toMatchObject({
      id: longHighway.id,
      properties: { kind: 'highway', ref: 'US 101', lc_project: 'p1' }
    });
  });

  it('a crossing freeway with another ref is not clipped', () => {
    expect(splitRoadsTile(tile([i280Across]), z, x, y, [phase({ corridor })], true)).toBeNull();
  });

  it('on a zoom that is not a clip zoom nothing unlisted moves', () => {
    expect(splitRoadsTile(tile([longHighway]), z, x, y, [phase({ corridor })], false)).toBeNull();
  });

  it('an unlisted street with the ref (not a highway, not a link) is not clipped', () => {
    const major = { ...longHighway, properties: { kind: 'major_road', ref: 'US 101' } };
    expect(splitRoadsTile(tile([major]), z, x, y, [phase({ corridor })], true)).toBeNull();
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

// The live check of v1.1 (docs/dev/lesscars.md "v1.1 live check") found removed freeway roads left
// on the map: an `I 80` mainline piece along US-101 (35184403218590) and ref-less ramps (the
// Harrison St off-ramp loop). Every freeway road along a removed line moves, whatever its ref;
// kept freeways keep every piece that is nearer their own line.
describe('splitRoadsTile: every freeway road along a removed line', () => {
  const along = (v: number): Uv[][] => [
    [
      [1200, v],
      [2800, v]
    ]
  ];
  const run = (roads: Feat[], keep: [number, number][][] = [], ids: number[] = []) =>
    splitRoadsTile(tile(roads), z, x, y, [phase({ ids, corridor })], true, { keep });

  it('an unlisted highway with another ref along the line moves (the I 80 sliver)', () => {
    const sliver = road(35184403218590, 'highway', along(2004), {
      kind_detail: 'motorway',
      ref: 'I 80'
    });
    const out = decode(run([sliver])!);
    expect(out.roads).toEqual([]);
    expect(out.roads_lc.map((f) => [f.id, f.properties.ref, f.properties.lc_project])).toEqual([
      [sliver.id, 'I 80', 'p1']
    ]);
    expect(lengthOf(out.roads_lc)).toBeCloseTo(1600, -1);
  });

  it('a ref-less ramp along the line moves (the Harrison St loop), at every kind of link', () => {
    const ramp = road(35184399860900, 'highway', along(1996), {
      kind_detail: 'motorway_link',
      is_link: true
    });
    // At z13 protomaps can draw a merged ramp as a primary_link major_road (35184381003850).
    const lowZoomRamp = road(35184381003850, 'major_road', along(2006), {
      kind_detail: 'primary_link',
      is_link: true
    });
    const out = decode(run([ramp, lowZoomRamp])!);
    expect(out.roads).toEqual([]);
    expect(out.roads_lc.map((f) => f.id)).toEqual([ramp.id, lowZoomRamp.id]);
  });

  it('a ref-less ramp crossing the line stays: it is not the removed road', () => {
    const across = road(
      1,
      'highway',
      [
        [
          [2000, 1910],
          [2000, 2090]
        ]
      ],
      { kind_detail: 'motorway_link', is_link: true }
    );
    expect(run([across])).toBeNull();
  });

  it('a piece nearer a kept freeway line than the removed one stays', () => {
    const keptLine: [number, number][][] = [
      (
        [
          [1000, 2012],
          [3000, 2012]
        ] as Uv[]
      ).map(lngLat)
    ];
    const removedSide = road(1, 'highway', along(2002), { ref: 'US 101' });
    const keptSide = road(2, 'highway', along(2010), { ref: 'US 101' });
    const out = decode(run([removedSide, keptSide], keptLine)!);
    expect(out.roads.map((f) => f.id)).toEqual([2]);
    expect(out.roads_lc.map((f) => f.id)).toEqual([1]);
    expect(out.roads[0].geometry).toEqual(keptSide.geometry);
  });

  it('a kept road with a shared ref keeps a short stretch where it strays nearer a removed line', () => {
    // A kept US 101 carriageway beside a removed one (kept CNN line at v 2012, removed at 2000; a
    // unit is about 1.9 m here): drawn nearer its own line (v 2009) except for about 10 units
    // (20 m) where it bends to v 2004, nearer the removed line. The stretch has the kept side on
    // both ends, so it stays.
    const keptLine: [number, number][][] = [
      (
        [
          [1000, 2012],
          [3000, 2012]
        ] as Uv[]
      ).map(lngLat)
    ];
    const bend = (v0: number, v1: number, to: number): Uv[][] => [
      [
        [1200, v0],
        [1500, v0],
        [1503, v1],
        [to, v1],
        [to + 3, v0],
        [2800, v0]
      ]
    ];
    expect(
      run([road(1, 'highway', bend(2009, 2004, 1510), { ref: 'US 101' })], keptLine)
    ).toBeNull();
    // A longer stray (300 units, about 570 m) is the removed road, not a stray: it moves.
    const long = decode(
      run([road(2, 'highway', bend(2009, 2004, 1800), { ref: 'US 101' })], keptLine)!
    );
    expect(lengthOf(long.roads_lc)).toBeCloseTo(297, -1);
    // A removed carriageway that bends nearer the kept line still moves on its own side.
    const removed = decode(
      run([road(3, 'highway', bend(2003, 2008, 1520), { ref: 'US 101' })], keptLine)!
    );
    expect(lengthOf(removed.roads_lc)).toBeGreaterThan(1500);
  });

  it('a road whose ref names only kept freeways stays, even nearer a removed line', () => {
    // I-280 where the removed US-101 connectors merge into it at Alemany (35184399703420): the
    // connector's CNN line can lie nearer the drawn I-280 than I-280's own line.
    const i280 = road(35184399703420, 'highway', along(2002), { ref: 'I 280' });
    const both = road(2, 'highway', along(2004), { ref: 'I 280;US 101' });
    const out = decode(
      splitRoadsTile(tile([i280, both]), z, x, y, [phase({ corridor })], true, {
        keepRefs: ['I 280', 'CA 1']
      })!
    );
    expect(out.roads.map((f) => f.id)).toEqual([i280.id]);
    expect(out.roads_lc.map((f) => f.id)).toEqual([2]);
    expect(
      splitRoadsTile(tile([i280]), z, x, y, [phase({ ids: [i280.id], corridor })], true, {
        keepRefs: ['I 280']
      })
    ).not.toBeNull();
  });

  it('a listed id keeps its pieces nearer a kept line too', () => {
    const keptLine: [number, number][][] = [
      (
        [
          [1000, 2012],
          [3000, 2012]
        ] as Uv[]
      ).map(lngLat)
    ];
    expect(run([road(7, 'highway', along(2010))], keptLine, [7])).toBeNull();
  });

  it('where a kept freeway continues the removed line, the cut is at their shared end', () => {
    // The corridor reaches 200 units past the removed line's end, as a buffer's join can.
    const longCorridor = [
      (
        [
          [1000, 1900],
          [3200, 1900],
          [3200, 2100],
          [1000, 2100],
          [1000, 1900]
        ] as Uv[]
      ).map(lngLat)
    ];
    const keptLine: [number, number][][] = [
      (
        [
          [3000, 2000],
          [4000, 2000]
        ] as Uv[]
      ).map(lngLat)
    ];
    const out = decode(
      splitRoadsTile(tile([listedMerge]), z, x, y, [phase({ corridor: longCorridor })], true, {
        keep: keptLine
      })!
    );
    expect(lengthOf(out.roads_lc)).toBeCloseTo(1000, -1);
    expect(lengthOf(out.roads)).toBeCloseTo(800, -1);
  });
});

describe('keptOnlyRefs', () => {
  it('names the refs only kept segments carry; the live catalog gives CA 1 and I 280', () => {
    const seg = (ref: string | null, removedBy: string | null) => ({ ref, removedBy });
    expect(
      keptOnlyRefs([seg('US 101', 'p'), seg('US 101', null), seg('I 280', null), seg(null, null)])
    ).toEqual(['I 280']);
    const live = parseFreewayLand(
      JSON.parse(readFileSync(LESSCARS_FREEWAY_LAND_JSON.live, 'utf8'))
    );
    expect(keptOnlyRefs(live.segments)).toEqual(['CA 1', 'I 280']);
  });
});
