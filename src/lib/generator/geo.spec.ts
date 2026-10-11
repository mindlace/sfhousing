import { describe, expect, it } from 'vitest';
import proj4 from 'proj4';
import { toLngLat } from './geo';
import { mulberry32 } from './seed';

// https://epsg.io/7131.proj4
const EPSG7131 =
  '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const fwd = (p: [number, number]) => proj4('EPSG:4326', EPSG7131, p) as [number, number];

describe('toLngLat (§4.10)', () => {
  it('is within 0.05 m of proj4 EPSG:7131 for 500 seeded points with offsets ≤ 500 m', () => {
    const r = mulberry32(7131);
    let maxErr = 0;
    for (let i = 0; i < 500; i++) {
      const label: [number, number] = [-122.52 + 0.17 * r(), 37.7 + 0.13 * r()];
      const dx = (2 * r() - 1) * 500;
      const dy = (2 * r() - 1) * 500;
      const [o] = [fwd(label)];
      const [[lng, lat]] = toLngLat([[dx, dy]], label);
      const p = fwd([lng, lat]);
      const err = Math.hypot(p[0] - o[0] - dx, p[1] - o[1] - dy);
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThanOrEqual(0.05);
  });
  it('maps the origin to the label point', () => {
    expect(toLngLat([[0, 0]], [-122.4194, 37.7749])).toEqual([[-122.4194, 37.7749]]);
  });
  it('rounds to 1e-7 degrees', () => {
    for (const [lng, lat] of toLngLat([[123.456, -78.9]], [-122.4194, 37.7749])) {
      expect(Math.round(lng * 1e7) / 1e7).toBe(lng);
      expect(Math.round(lat * 1e7) / 1e7).toBe(lat);
    }
  });
  it('keeps a CCW ring CCW', () => {
    const out = toLngLat(
      [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5]
      ],
      [-122.4194, 37.7749]
    );
    let s = 0;
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    expect(s).toBeGreaterThan(0);
  });
});
