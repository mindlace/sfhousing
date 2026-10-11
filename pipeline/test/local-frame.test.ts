// Chunk polygons inverted with typology-generator §4.10 match source lng/lat.
import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { toLocalRings } from '../lib/rings';
import { miniDuck } from './helpers';
import { runSql } from '../lib/sql';

// typology-generator spec §4.10, transcribed (the generator module lives on another branch).
function localToLngLat([x, y]: [number, number], [l0, p0]: [number, number]): [number, number] {
  const rad = Math.PI / 180;
  const g = (l0 + 122.45) * Math.sin(p0 * rad) * rad;
  const e = x * Math.cos(g) + y * Math.sin(g);
  const n = -x * Math.sin(g) + y * Math.cos(g);
  const a = 6378137,
    e2 = 0.0066943800229;
  const W = 1 - e2 * Math.sin(p0 * rad) ** 2;
  const M = (a * (1 - e2)) / W ** 1.5,
    N = a / Math.sqrt(W);
  return [l0 + e / (N * Math.cos(p0 * rad) * rad), p0 + n / (M * rad)];
}

describe('local frame', () => {
  it('inverts to the source lng/lat within 0.05 m', async () => {
    const db = await miniDuck();
    await runSql(db);
    const rows = await db.all<{
      id: string;
      label_lng: number;
      label_lat: number;
      x0: number;
      y0: number;
      g7: string;
    }>('SELECT id, label_lng, label_lat, x0, y0, geojson7131 g7 FROM parcel_out');
    proj4.defs(
      'EPSG:7131',
      '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
    );
    let worst = 0;
    let n = 0;
    for (const r of rows) {
      for (const ring of toLocalRings(JSON.parse(r.g7), r.x0, r.y0)) {
        for (const v of ring) {
          const got = localToLngLat(v, [r.label_lng, r.label_lat]);
          const want = proj4('EPSG:7131', 'EPSG:4326', [v[0] + r.x0, v[1] + r.y0]);
          const dx = (got[0] - want[0]) * 111320 * Math.cos((want[1] * Math.PI) / 180);
          const dy = (got[1] - want[1]) * 110540;
          worst = Math.max(worst, Math.hypot(dx, dy));
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(0.05);
  });
});
