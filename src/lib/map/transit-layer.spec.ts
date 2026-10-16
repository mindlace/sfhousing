import { describe, expect, it, vi } from 'vitest';
import { encodeTransit } from '$lib/data/transit-codec';
import { M_PER_DEG_LAT, M_PER_DEG_LNG, project } from '$lib/plan/geometry';
import type { TransitNetwork } from '$lib/data/transit';
import { buildAccessGrid, type AccessGrid } from '$lib/transit';
import { net } from '$lib/transit/test/test-network';
import {
  accessCollection,
  loadTransitNetwork,
  stopTooltipLines,
  stopsCollection,
  transitView
} from './transit-layer';

/**
 * Embarcadero-style station: two BART platforms, one per direction, each its own GTFS stop, plus a
 * Muni bus stop with no station.
 */
function embarcadero(): TransitNetwork {
  const n = net();
  n.stops = [
    {
      id: 'bart:M16-1',
      name: 'Embarcadero',
      lngLat: [-122.397, 37.793],
      stationId: 'bart:EMBR',
      placeId: 'bart:EMBR'
    },
    {
      id: 'muni:1',
      name: 'Market St & Main St',
      lngLat: [-122.396, 37.792],
      stationId: null,
      placeId: 'muni:1'
    },
    {
      id: 'bart:M16-2',
      name: 'Embarcadero',
      lngLat: [-122.395, 37.795],
      stationId: 'bart:EMBR',
      placeId: 'bart:EMBR'
    }
  ];
  const bart = (id: string, routeName: string, direction: 0 | 1, stop: number) => ({
    id,
    operatorId: 'bart',
    routeId: id,
    routeName,
    mode: 'heavy-rail' as const,
    direction,
    vehicle: 'bart-car',
    cars: 10,
    stops: [{ stop, tph: 4, tpd: 80 }]
  });
  n.patterns = [
    bart('R0', 'Red', 0, 0),
    bart('Y0', 'Yellow', 0, 0),
    bart('R1', 'Red', 1, 2),
    { ...n.patterns[0], stops: [{ stop: 1, tph: 6, tpd: 60 }] }
  ];
  return n;
}

describe('stopsCollection', () => {
  it('builds one point per station or stationless stop with class, capacity, log capacity and name', () => {
    const fc = stopsCollection(transitView(net()));
    // ct-nb and ct-sb are the two platforms of station ct: one marker.
    expect(fc.features).toHaveLength(4);
    expect(fc.features.map((f) => [f.properties.i, f.properties.cls])).toEqual([
      [0, 'bus'],
      [1, 'rail'],
      [2, 'regional-rail'],
      [3, 'regional-rail']
    ]);
    // No shared leading words in the platform names: the first platform's name.
    expect(fc.features[2].properties).toMatchObject({ cap: 4050, name: 'ct-nb' });
    expect(fc.features[3].properties).toMatchObject({
      cls: 'regional-rail',
      cap: 4280,
      name: 's4'
    });
    expect(fc.features[3].properties.lc).toBeCloseTo(Math.log10(4280), 5);
    expect(fc.features[3].geometry.coordinates).toEqual([-122.42, 37.76]);
  });

  it('merges platforms of one station at their mean position, summing capacity', () => {
    const fc = stopsCollection(transitView(embarcadero()));
    expect(fc.features).toHaveLength(2);
    const [station, bus] = fc.features;
    expect(station.properties).toMatchObject({
      cls: 'regional-rail',
      cap: 3 * 4 * 1070,
      name: 'Embarcadero'
    });
    expect(station.properties.lc).toBeCloseTo(Math.log10(12840), 5);
    expect(station.geometry.coordinates[0]).toBeCloseTo(-122.396, 9);
    expect(station.geometry.coordinates[1]).toBeCloseTo(37.794, 9);
    expect(bus.properties).toMatchObject({ cls: 'bus', cap: 264, name: 'Market St & Main St' });
    expect(bus.geometry.coordinates).toEqual([-122.396, 37.792]);
  });

  it('names a station by the leading words its platforms share', () => {
    const n = embarcadero();
    n.stops[0].name = '22nd Street NB';
    n.stops[2].name = '22nd Street SB';
    expect(stopsCollection(transitView(n)).features[0].properties.name).toBe('22nd Street');
  });
});

describe('accessCollection', () => {
  const sw: [number, number] = [-122.42, 37.76];
  // Row 0 (south): 5000, 5000, 0 -> one bin-3 run of two cells. Row 1: 0, 500, 2000 -> bins 1, 2.
  const grid: AccessGrid = {
    origin: project(sw[0], sw[1]),
    sizeM: 100,
    cols: 3,
    rows: 2,
    values: new Float32Array([5000, 5000, 0, 0, 500, 2000])
  };

  it('merges same-bin runs per row into rectangles, skipping bin 0', () => {
    const fc = accessCollection(grid);
    expect(fc.features.map((f) => f.properties.b)).toEqual([3, 1, 2]);
    for (const f of fc.features) {
      const ring = f.geometry.coordinates[0];
      expect(ring).toHaveLength(5);
      expect(ring[4]).toEqual(ring[0]);
    }
  });

  it('places cell corners grid-relative to the origin (origin counted once)', () => {
    const fc = accessCollection(grid);
    const dLng = 100 / M_PER_DEG_LNG;
    const dLat = 100 / M_PER_DEG_LAT;
    const [run, cell] = [
      fc.features[0].geometry.coordinates[0],
      fc.features[1].geometry.coordinates[0]
    ];
    // Row-0 run: SW corner is the grid origin, NE corner two cells east and one north.
    expect(run[0][0]).toBeCloseTo(sw[0], 9);
    expect(run[0][1]).toBeCloseTo(sw[1], 9);
    expect(run[2][0]).toBeCloseTo(sw[0] + 2 * dLng, 9);
    expect(run[2][1]).toBeCloseTo(sw[1] + dLat, 9);
    // Cell (c=1, r=1): SW corner one cell east and one north of the origin.
    expect(cell[0][0]).toBeCloseTo(sw[0] + dLng, 9);
    expect(cell[0][1]).toBeCloseTo(sw[1] + dLat, 9);
  });

  it('yields non-empty bins for the test network', () => {
    const fc = accessCollection(buildAccessGrid(net()));
    expect(fc.features.length).toBeGreaterThan(0);
    for (const f of fc.features) expect(f.properties.b).toBeGreaterThanOrEqual(1);
  });
});

describe('stopTooltipLines', () => {
  const t = transitView(net());
  it('describes a stop: name, routes by mode, capacity and estimated tier', () => {
    expect(stopTooltipLines(t, 3)).toEqual([
      's4',
      'BART Red · ~4,280 riders/hr at peak · SB 79 tier 1 (est.)'
    ]);
    // Station ct: both platforms' lines and capacity.
    expect(stopTooltipLines(t, 2)).toEqual([
      'ct-nb',
      'Caltrain CTN, CTS · ~4,050 riders/hr at peak · SB 79 tier 1 (est.)'
    ]);
  });
  it('describes a station over all its platforms, each line once', () => {
    const e = transitView(embarcadero());
    expect(stopTooltipLines(e, 0)).toEqual([
      'Embarcadero',
      'BART Red, Yellow · ~12,840 riders/hr at peak · SB 79 tier 1 (est.)'
    ]);
    expect(stopTooltipLines(e, 1)).toEqual([
      'Market St & Main St',
      'Bus 22 · ~260 riders/hr at peak'
    ]);
  });
  it('lists rail before bus and omits a null tier', () => {
    expect(stopTooltipLines(t, 1)[1]).toBe(
      'Muni Metro N · Bus 22 · ~1,480 riders/hr at peak · SB 79 tier 2 (est.)'
    );
    expect(stopTooltipLines(t, 0)[1]).toBe('Bus 22 · ~350 riders/hr at peak');
  });
  it('never shows a raw mode or operator id', () => {
    for (let i = 0; i < 4; i++)
      expect(stopTooltipLines(t, i)[1]).not.toMatch(/bart|caltrain|muni |-rail/);
  });
});

describe('loadTransitNetwork', () => {
  it('fetches and decodes, and rejects on HTTP errors', async () => {
    // The codec requires every pattern's operator to be listed; the shared network lists only Muni.
    const n = net();
    n.operators.push(
      { id: 'caltrain', label: 'Caltrain', serviceDate: '2026-10-13' },
      { id: 'bart', label: 'BART', serviceDate: '2026-10-13' }
    );
    const ok = vi.fn(async () => new Response(encodeTransit(n)));
    await expect(loadTransitNetwork('/data/v/transit.json', ok)).resolves.toMatchObject({
      stops: expect.any(Array)
    });
    expect(ok).toHaveBeenCalledWith('/data/v/transit.json');
    const bad = vi.fn(async () => new Response('', { status: 404 }));
    await expect(loadTransitNetwork('/x', bad)).rejects.toThrow(/HTTP 404/);
  });
});
