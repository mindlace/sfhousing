import { describe, expect, it } from 'vitest';
import { openDuck } from '../lib/duck';

describe('openDuck', () => {
  it('loads spatial, sets SQL variables, transforms to EPSG:7131 and returns plain numbers', async () => {
    const db = await openDuck();
    const [r] = await db.all<{ x: number; y: number; n: number; v: number }>(
      `SELECT ST_X(p) x, ST_Y(p) y, 3::BIGINT n, getvariable('min_piece_m2') v FROM (SELECT ST_Transform(ST_Point(-122.4194, 37.7599), 'EPSG:4326', 'EPSG:7131', always_xy := true) p)`
    );
    db.close();
    expect(r.x).toBeCloseTo(50696.431, 2);
    expect(r.y).toBeCloseTo(25099.268, 2);
    expect(r.n).toBe(3);
    expect(r.v).toBe(2);
  });
});
