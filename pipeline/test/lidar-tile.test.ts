import { describe, expect, it } from 'vitest';
import {
  LIDAR_NODATA,
  decodeLidarTile,
  encodeLidarTile,
  lidarTileName,
  parseLidarTileName,
  tileIndexOf,
  tilesForBbox
} from '../lib/lidar/tile.js';
import type { Ring } from '../geom.js';
import { synthTile } from './lidar-synth.js';

const sq = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
];

describe('sfhl tile codec', () => {
  const t = synthTile(0, 0, {
    ground: () => 20,
    boxes: [{ ring: sq(100, 100, 110, 110), top: 10 }],
    veg: [{ ring: sq(200, 200, 205, 205), top: 6 }]
  });

  it('round-trips a tile byte for byte', () => {
    const a = encodeLidarTile(t);
    const d = decodeLidarTile(a);
    expect(encodeLidarTile(d)).toEqual(a);
    expect(d.hagCm).toEqual(t.hagCm);
    expect(d.groundCm).toEqual(t.groundCm);
    expect(d.veg).toEqual(t.veg);
    expect([d.tx, d.ty, d.sizeM, d.res, d.groundRes]).toEqual([0, 0, 500, 0.25, 1]);
  });

  it('rejects a bad magic, version 2 and a truncated section', () => {
    const a = encodeLidarTile(t);
    const bad = a.slice();
    bad[0] = 0x58;
    expect(() => decodeLidarTile(bad)).toThrow(/sfhl/);
    const v2 = a.slice();
    v2[4] = 2;
    expect(() => decodeLidarTile(v2)).toThrow(/sfhl/);
    expect(() => decodeLidarTile(a.slice(0, a.length - 10))).toThrow(/sfhl/);
  });

  it('tileIndexOf floors negatives', () => {
    expect(tileIndexOf(-0.01, 499.99)).toEqual([-1, 0]);
    expect(tilesForBbox({ x0: 499, y0: 0, x1: 1001, y1: 10 })).toEqual([
      [0, 0],
      [1, 0],
      [2, 0]
    ]);
  });

  it('names round-trip', () => {
    expect(parseLidarTileName(lidarTileName(-3, 12))).toEqual([-3, 12]);
    expect(parseLidarTileName('x.sfhl')).toBeNull();
  });

  it('synthTile draws a 10 m box on 20 m ground', () => {
    const at = (x: number, y: number, n: number, res: number) =>
      Math.floor(y / res) * n + Math.floor(x / res);
    const s = synthTile(0, 0, {
      ground: () => 20,
      boxes: [{ ring: sq(100, 100, 110, 110), top: 10 }],
      veg: [{ ring: sq(200, 200, 205, 205), top: 6 }],
      nodata: [sq(300, 300, 301, 301)]
    });
    expect(s.hagCm[at(105, 105, 2000, 0.25)]).toBe(1000);
    expect(s.groundCm[at(105, 105, 500, 1)]).toBe(2000);
    expect(s.hagCm[at(50, 50, 2000, 0.25)]).toBe(0);
    expect(s.veg[at(202, 202, 2000, 0.25)]).toBe(1);
    expect(s.veg[at(105, 105, 2000, 0.25)]).toBe(0);
    expect(s.hagCm[at(300.5, 300.5, 2000, 0.25)]).toBe(LIDAR_NODATA);
  });
});
