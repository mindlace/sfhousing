import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseNeighborhoods } from '$lib/sim/levers/brushes';
import { loadPlaces, placeOf } from './places';

const RAW = readFileSync('e2e/fixtures/data/fixture-0/neighborhoods.geojson', 'utf8');
const shapes = parseNeighborhoods(JSON.parse(RAW));

const ok = (body: string) => vi.fn(async () => new Response(body, { status: 200 }));

describe('places', () => {
  it('placeOf names the fixture-0 square holding the point, null outside every square', () => {
    // The squares' centres (fixture-0's three, side by side).
    expect(placeOf(shapes, [-122.4194, 37.76])).toBe('Mission');
    expect(placeOf(shapes, [-122.4178, 37.76])).toBe('Noe Valley');
    expect(placeOf(shapes, [-122.4097, 37.76])).toBe('Bayview Hunters Point');
    // Between the squares, and far away.
    expect(placeOf(shapes, [-122.414, 37.76])).toBeNull();
    expect(placeOf(shapes, [-122.5, 37.7])).toBeNull();
    expect(placeOf([], [-122.4194, 37.76])).toBeNull();
  });

  it('placeOf counts holes even-odd: a point in a hole is outside', () => {
    const ring = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0]
    ];
    const donut = [{ name: 'Donut', rings: [[ring(0, 0, 10, 10), ring(4, 4, 6, 6)]] }];
    expect(placeOf(donut, [2, 2])).toBe('Donut');
    expect(placeOf(donut, [5, 5])).toBeNull();
  });

  it('loadPlaces parses the published file', async () => {
    const f = ok(RAW);
    const got = await loadPlaces('/data/fixture-0/neighborhoods.geojson', f);
    expect(f).toHaveBeenCalledExactlyOnceWith('/data/fixture-0/neighborhoods.geojson');
    expect(got?.map((s) => s.name)).toEqual(['Bayview Hunters Point', 'Mission', 'Noe Valley']);
  });

  it('loadPlaces is null on a failed fetch or a bad file', async () => {
    const url = '/data/fixture-0/neighborhoods.geojson';
    expect(
      await loadPlaces(
        url,
        vi.fn(async () => new Response('', { status: 404 }))
      )
    ).toBeNull();
    expect(
      await loadPlaces(
        url,
        vi.fn(async () => {
          throw new TypeError('offline');
        })
      )
    ).toBeNull();
    expect(await loadPlaces(url, ok('not json'))).toBeNull();
    expect(await loadPlaces(url, ok('{"type":"Feature"}'))).toBeNull();
  });
});
