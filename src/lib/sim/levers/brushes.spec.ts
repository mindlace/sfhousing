import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '$lib/data/parcel';
import type { TransitNetwork, ModeId } from '$lib/data/transit';
import { scenarioTiny } from '$lib/data/fixtures/scenario-tiny';
import { policyTiny } from '$lib/data/fixtures/policy-tiny';
import { CORNER_ROW, DEEP_ROW, frontageTiny } from '$lib/data/fixtures/frontage-tiny';
import { createParcelIndex } from '$lib/plan/parcel-index';
import { M_PER_DEG_LNG } from '$lib/plan/geometry';
import {
  BrushDataMissing,
  brushCatalog,
  createLotIndex,
  districtFamily,
  parseNeighborhoods,
  resolveBrushRows,
  stopPoints,
  type BrushData,
  type BrushQuery
} from './brushes';

function data(over: Partial<BrushData> = {}): BrushData {
  const parcels = scenarioTiny();
  return {
    parcels,
    policy: policyTiny(parcels),
    frontage: frontageTiny(parcels),
    transit: null,
    neighborhoods: null,
    ...over
  };
}

/** Minimal chunk records: the editor's parcel index reads only id and labelPoint. */
function chunkRecords(d: BrushData): ParcelRecord[] {
  const p = d.parcels;
  return p.id.map((id, i) => ({
    id,
    polygon: [],
    labelPoint: [p.labelPoint[2 * i], p.labelPoint[2 * i + 1]],
    areaM2: 0,
    existingUnits: 0,
    existingFloorAreaM2: 0,
    existingHeightM: 0,
    landUse: 'X',
    eligible: true,
    neighborhood: ''
  }));
}

// Fixture values only (tier 4, made up for these tests): not data.
type StopSpec = { name: string; mode: ModeId; routeId: string; tph: number; op?: string };
function network(specs: StopSpec[], at: (k: number) => [number, number]): TransitNetwork {
  return {
    peak: { start: '07:00', end: '09:00' },
    operators: [],
    vehicles: {},
    stops: specs.map((s, k) => ({
      id: `x:${s.name}`,
      name: s.name,
      lngLat: at(k),
      stationId: null,
      placeId: `x:${s.name}`
    })),
    patterns: specs.map((s, k) => ({
      id: `${s.name}:p`,
      operatorId: s.op ?? 'muni',
      routeId: s.routeId,
      routeName: s.routeId,
      mode: s.mode,
      direction: 0,
      vehicle: 'v',
      cars: 1,
      stops: [{ stop: k, tph: s.tph, tpd: s.tph * 10 }]
    }))
  };
}

describe('resolveBrushRows', () => {
  it('freehand matches the editor', () => {
    const d = data();
    const index = createLotIndex(d.parcels);
    const editor = createParcelIndex();
    editor.addChunk('all', chunkRecords(d));
    const strokes: { path: [number, number][]; radiusM: number }[] = [
      {
        path: [
          [-122.4103, 37.7621],
          [-122.4097, 37.7617]
        ],
        radiusM: 30
      },
      { path: [[-122.4194155, 37.7749295]], radiusM: 50 },
      {
        path: [
          [-122.3905, 37.7305],
          [-122.3895, 37.7295]
        ],
        radiusM: 5
      }
    ];
    const eligibleIds = (ids: string[]) =>
      ids.filter((id) => d.parcels.eligible[d.parcels.index.get(id)!] === 1);
    const all = new Set<string>();
    for (const s of strokes) {
      const covered = editor.covered({ kind: 'erase', id: 'e', ...s });
      expect(index.nearPath(s.path, s.radiusM).map((r) => d.parcels.id[r])).toEqual(covered);
      const one = resolveBrushRows(d, index, { kind: 'freehand', strokes: [s] });
      expect(one.map((r) => d.parcels.id[r])).toEqual(eligibleIds(covered));
      covered.forEach((id) => all.add(id));
    }
    // The first stroke covers the ineligible 3512008; the union drops it.
    expect(all.has('3512008')).toBe(true);
    const rows = resolveBrushRows(d, index, { kind: 'freehand', strokes });
    expect(rows.map((r) => d.parcels.id[r])).toEqual(eligibleIds([...all].sort()));
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it('commercial corridor', () => {
    const q: BrushQuery = {
      kind: 'street',
      classes: ['arterial'],
      names: [],
      depth: 1,
      ncOnly: true
    };
    // In policy-tiny no MISSION ST lot is NC-2 (CORNER_ROW is RH-2, DEEP_ROW RM-1): nothing.
    const d = data();
    expect(resolveBrushRows(d, createLotIndex(d.parcels), q)).toEqual([]);
    // Make the corner lot NC-2 (useDistricts[1]) and DEEP_ROW eligible: only the NC lot stays.
    const d2 = data();
    d2.policy.useDistrict[CORNER_ROW] = 1;
    d2.parcels.eligible[DEEP_ROW] = 1;
    expect(d2.policy.useDistricts[1]).toBe('NC-2');
    expect(resolveBrushRows(d2, createLotIndex(d2.parcels), q)).toEqual([CORNER_ROW]);
    // Without ncOnly the arterial reaches both.
    expect(resolveBrushRows(d2, createLotIndex(d2.parcels), { ...q, ncOnly: false })).toEqual([
      CORNER_ROW,
      DEEP_ROW
    ]);
  });

  it('named street, one lot deep', () => {
    const q = (depth: 0 | 1): BrushQuery => ({
      kind: 'street',
      classes: [],
      names: ['MISSION ST'],
      depth,
      ncOnly: false
    });
    const d = data();
    d.parcels.eligible[DEEP_ROW] = 1; // scenario-tiny's DEEP_ROW (3512008) is ineligible
    const index = createLotIndex(d.parcels);
    expect(resolveBrushRows(d, index, q(0))).toEqual([CORNER_ROW]);
    expect(resolveBrushRows(d, index, q(1))).toEqual([CORNER_ROW, DEEP_ROW]);
    // With the fixture's own eligibility the deep lot is dropped.
    const f = data();
    expect(resolveBrushRows(f, createLotIndex(f.parcels), q(1))).toEqual([CORNER_ROW]);
    // A class match reaches FIXTURE AVE's corner lot too.
    expect(
      resolveBrushRows(f, createLotIndex(f.parcels), {
        kind: 'street',
        classes: ['residential'],
        names: [],
        depth: 0,
        ncOnly: false
      })
    ).toEqual([CORNER_ROW]);
  });

  it('district family', () => {
    expect(districtFamily('RH-1(D)')).toBe('RH-1');
    expect(districtFamily('RH-1')).toBe('RH-1');
    expect(districtFamily('NCT-3')).toBe('NCT-3');
    const d = data();
    d.policy.useDistricts = ['', 'NC-2', 'RH-1|RM-1', 'RM-1'];
    const index = createLotIndex(d.parcels);
    const area = (districts: string[]): BrushQuery => ({
      kind: 'area',
      districts,
      neighborhoods: []
    });
    // Rows 1 and 2 are 'RH-1|RM-1'; row 4 is RM-1 (row 3 is RM-1 but ineligible).
    expect(resolveBrushRows(d, index, area(['RH-1', 'RH-1(D)']))).toEqual([1, 2]);
    expect(resolveBrushRows(d, index, area(['RM-1']))).toEqual([1, 2, 4]);
    expect(resolveBrushRows(d, index, area(['RH-1(D)']))).toEqual([]);
  });

  it('area unions districts with neighborhoods', () => {
    const geo = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Box' },
          geometry: {
            type: 'MultiPolygon',
            coordinates: [
              [
                [
                  [-122.42, 37.77],
                  [-122.41, 37.77],
                  [-122.41, 37.78],
                  [-122.42, 37.78],
                  [-122.42, 37.77]
                ],
                // a hole around row 0's label point
                [
                  [-122.4195, 37.7748],
                  [-122.4193, 37.7748],
                  [-122.4193, 37.775],
                  [-122.4195, 37.775],
                  [-122.4195, 37.7748]
                ]
              ]
            ]
          }
        },
        {
          type: 'Feature',
          properties: { name: 'South' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.4, 37.72],
                [-122.38, 37.72],
                [-122.38, 37.74],
                [-122.4, 37.74],
                [-122.4, 37.72]
              ]
            ]
          }
        }
      ]
    };
    const shapes = parseNeighborhoods(geo);
    expect(shapes.map((s) => s.name)).toEqual(['Box', 'South']);
    const d = data({ neighborhoods: shapes });
    const index = createLotIndex(d.parcels);
    const q = (districts: string[], neighborhoods: string[]): BrushQuery => ({
      kind: 'area',
      districts,
      neighborhoods
    });
    expect(resolveBrushRows(d, index, q([], ['South']))).toEqual([5]);
    expect(resolveBrushRows(d, index, q([], ['Box']))).toEqual([]); // row 0 sits in the hole
    expect(resolveBrushRows(d, index, q(['NC-2'], ['South']))).toEqual([0, 5]);
    expect(() => parseNeighborhoods({ type: 'Feature' })).toThrow();
  });

  it('neighborhood membership is exact for overlapping shapes and stable across queries', () => {
    const box = (name: string, x0: number, y0: number, x1: number, y1: number) => ({
      name,
      rings: [
        [
          [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
            [x0, y0]
          ] as [number, number][]
        ]
      ]
    });
    // East holds rows 1-4; Overlap (inside East) holds rows 2 and 3. Row 3 is ineligible.
    const d = data({
      neighborhoods: [
        box('East', -122.4104, 37.7616, -122.4096, 37.7622),
        box('Overlap', -122.41025, 37.76175, -122.40985, 37.76205)
      ]
    });
    const index = createLotIndex(d.parcels);
    const q = (neighborhoods: string[]): BrushQuery => ({
      kind: 'area',
      districts: [],
      neighborhoods
    });
    expect(resolveBrushRows(d, index, q(['East']))).toEqual([1, 2, 4]);
    expect(resolveBrushRows(d, index, q(['Overlap']))).toEqual([2]);
    expect(resolveBrushRows(d, index, q(['East', 'Overlap']))).toEqual([1, 2, 4]);
    expect(resolveBrushRows(d, index, q(['Overlap']))).toEqual([2]);
    expect(resolveBrushRows(d, index, q(['East']))).toEqual([1, 2, 4]);
  });

  it('transit distance', () => {
    const d = data();
    const i = 5; // 8711023C, kilometres from every other fixture lot
    const lng = d.parcels.labelPoint[2 * i];
    const lat = d.parcels.labelPoint[2 * i + 1];
    const stop: [number, number] = [lng + 400 / M_PER_DEG_LNG, lat];
    d.transit = network(
      [{ name: 'b', mode: 'heavy-rail', routeId: 'R', tph: 4, op: 'bart' }],
      () => stop
    );
    const index = createLotIndex(d.parcels);
    expect(index.nearPoints([stop], 402)).toEqual([i]);
    expect(index.nearPoints([stop], 300)).toEqual([]);
    const q = (maxM: number): BrushQuery => ({
      kind: 'transit',
      stopTypes: ['regionalRail'],
      maxM
    });
    expect(resolveBrushRows(d, index, q(402))).toEqual([i]);
    expect(resolveBrushRows(d, index, q(300))).toEqual([]);
    expect(
      resolveBrushRows(d, index, { kind: 'transit', stopTypes: ['metro'], maxM: 402 })
    ).toEqual([]);
  });

  it('missing data', () => {
    const d = data({ frontage: null });
    const index = createLotIndex(d.parcels);
    const street: BrushQuery = {
      kind: 'street',
      classes: ['arterial'],
      names: [],
      depth: 0,
      ncOnly: false
    };
    let err: unknown;
    try {
      resolveBrushRows(d, index, street);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BrushDataMissing);
    expect((err as BrushDataMissing).file).toBe('frontage');
    expect(() =>
      resolveBrushRows(d, index, { kind: 'transit', stopTypes: ['metro'], maxM: 400 })
    ).toThrow(expect.objectContaining({ file: 'transit' }));
    expect(() =>
      resolveBrushRows(d, index, { kind: 'area', districts: [], neighborhoods: ['Mission'] })
    ).toThrow(expect.objectContaining({ file: 'neighborhoods' }));
    // A districts-only area needs no neighborhoods file.
    expect(
      resolveBrushRows(d, index, { kind: 'area', districts: ['NC-2'], neighborhoods: [] })
    ).toEqual([0]);
  });
});

describe('stopPoints', () => {
  const specs: StopSpec[] = [
    { name: 'bart', mode: 'heavy-rail', routeId: 'Red', tph: 4, op: 'bart' },
    { name: 'caltrain', mode: 'commuter-rail', routeId: 'L1', tph: 2, op: 'caltrain' },
    { name: 'metro', mode: 'light-rail', routeId: 'N', tph: 8 },
    { name: 'rapid', mode: 'bus', routeId: '5R', tph: 3 },
    { name: 'six', mode: 'bus', routeId: '22', tph: 6 },
    { name: 'almost', mode: 'bus', routeId: '24', tph: 5.9 },
    { name: 'cable', mode: 'cable-car', routeId: 'PM', tph: 12 },
    { name: 'streetcar', mode: 'streetcar', routeId: 'F', tph: 8 }
  ];
  const at = (k: number): [number, number] => [-122.4 + k / 1000, 37.76];
  const net = network(specs, at);

  it('stop types', () => {
    expect(stopPoints(net, ['regionalRail'])).toEqual([at(0), at(1)]);
    expect(stopPoints(net, ['metro'])).toEqual([at(2)]);
    expect(stopPoints(net, ['rapidBus'])).toEqual([at(3)]);
    expect(stopPoints(net, ['frequentBus'])).toEqual([at(4)]);
    expect(
      stopPoints(net, ['regionalRail', 'metro', 'rapidBus', 'frequentBus'])
    ).not.toContainEqual(at(6));
    // A 'R'-suffixed route outside Muni is not Rapid.
    const other = network([{ name: 'x', mode: 'bus', routeId: '5R', tph: 1, op: 'ac' }], at);
    expect(stopPoints(other, ['rapidBus'])).toEqual([]);
  });

  it('sums peak tph over bus patterns and de-duplicates stops', () => {
    const n = network(
      [
        { name: 'a', mode: 'bus', routeId: '5R', tph: 3 },
        { name: 'b', mode: 'bus', routeId: '5', tph: 3 }
      ],
      () => [-122.41, 37.77]
    );
    // Both patterns serve stop 0: 3 + 3 = 6 tph.
    n.patterns[1].stops = [{ stop: 0, tph: 3, tpd: 30 }];
    expect(stopPoints(n, ['frequentBus'])).toEqual([[-122.41, 37.77]]);
    expect(stopPoints(n, ['frequentBus', 'rapidBus'])).toEqual([[-122.41, 37.77]]);
    expect(stopPoints(n, [])).toEqual([]);
  });
});

describe('brushCatalog', () => {
  it('catalog', () => {
    const d = data({
      transit: network(
        [
          { name: 'bart', mode: 'heavy-rail', routeId: 'Red', tph: 4, op: 'bart' },
          { name: 'rapid', mode: 'bus', routeId: '9R', tph: 7 }
        ],
        (k) => [-122.4 + k / 1000, 37.76]
      ),
      neighborhoods: [
        { name: 'Mission', rings: [] },
        { name: 'Bayview', rings: [] }
      ]
    });
    d.policy.useDistricts = ['', 'NC-2', 'RH-1(D)|RH-2', 'RH-1|RM-1'];
    const c = brushCatalog(d);
    expect(c.streetNames).toEqual(['FIXTURE AVE', 'MISSION ST']);
    // Eligible rows 0..5 minus 3: row 0 NC-2, rows 1-2 'RH-1(D)|RH-2', row 4 'RH-1|RM-1', row 5 ''.
    expect(c.districts).toEqual([
      { family: 'NC-2', codes: [{ code: 'NC-2', lots: 1 }] },
      {
        family: 'RH-1',
        codes: [
          { code: 'RH-1', lots: 1 },
          { code: 'RH-1(D)', lots: 2 }
        ]
      },
      { family: 'RH-2', codes: [{ code: 'RH-2', lots: 2 }] },
      { family: 'RM-1', codes: [{ code: 'RM-1', lots: 1 }] }
    ]);
    expect(c.neighborhoods).toEqual(['Bayview', 'Mission']);
    expect(c.stops).toEqual({ regionalRail: 1, metro: 0, rapidBus: 1, frequentBus: 1 });
    expect(c.has).toEqual({ frontage: true, transit: true, neighborhoods: true });

    // A name an eligible lot reaches only one lot deep is not listed.
    const deep = data();
    deep.parcels.eligible[CORNER_ROW] = 0;
    deep.parcels.eligible[DEEP_ROW] = 1;
    expect(brushCatalog(deep).streetNames).toEqual([]);

    const empty = brushCatalog(data({ frontage: null }));
    expect(empty.streetNames).toEqual([]);
    expect(empty.stops).toEqual({ regionalRail: 0, metro: 0, rapidBus: 0, frequentBus: 0 });
    expect(empty.has).toEqual({ frontage: false, transit: false, neighborhoods: false });
  });
});
