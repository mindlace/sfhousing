import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  area,
  cellsToPoly,
  difference,
  fromGeoJson,
  grow,
  inset,
  intersect,
  toGeoJson,
  translate,
  union,
  type MultiPoly,
  type Ring
} from '../geom.js';
import { LidarMosaic, openLidarMosaic } from '../lib/lidar/mosaic.js';
import { bilinear, cellMask, gaussian, gradient, label4 } from '../lib/lidar/raster.js';
import { encodeLidarTile, type LidarTile } from '../lib/lidar/tile.js';
import { synthTile, synthWindow, type SynthScene } from './lidar-synth.js';

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
];

const ground = (x: number, y: number): number => 5 + 0.02 * x + 0.3 * Math.sin(y / 7);

function blankTile(tx: number, ty: number): LidarTile {
  return {
    tx,
    ty,
    sizeM: 500,
    res: 0.25,
    groundRes: 1,
    hagCm: new Int16Array(2000 * 2000),
    groundCm: new Int16Array(500 * 500),
    veg: new Uint8Array(2000 * 2000)
  };
}

describe('LidarMosaic', () => {
  it('a window across a tile seam equals the single-raster scene', () => {
    const scene: SynthScene = {
      ground,
      boxes: [
        { ring: rect(495, 10, 505, 20), top: (x, y) => 8 + 0.1 * (x - 495) + 0.05 * (y - 10) }
      ],
      veg: [{ ring: rect(497, 22, 503, 24), top: 4 }]
    };
    const tiles = new Map([
      ['0_0', synthTile(0, 0, scene)],
      ['1_0', synthTile(1, 0, scene)]
    ]);
    const mosaic = new LidarMosaic((tx, ty) => tiles.get(`${tx}_${ty}`) ?? null);
    const b = { x0: 494, y0: 5, x1: 506, y1: 26 };
    const got = mosaic.window(b);
    const want = synthWindow(scene, b);
    expect(got).not.toBeNull();
    expect(got!.nx).toBe(want.nx);
    expect(got!.ny).toBe(want.ny);
    expect(got!.x0).toBe(want.x0);
    expect(got!.y0).toBe(want.y0);
    expect(got!.hag.some(Number.isNaN)).toBe(false);
    expect(got!.ground.some(Number.isNaN)).toBe(false);
    expect(Array.from(got!.hag)).toEqual(Array.from(want.hag));
    expect(Array.from(got!.ground)).toEqual(Array.from(want.ground));
    expect(Array.from(got!.veg)).toEqual(Array.from(want.veg));
  });

  it('a missing tile reads NaN, and a window touching no tile is null', () => {
    const scene: SynthScene = { ground, boxes: [{ ring: rect(495, 10, 505, 20), top: 8 }] };
    const left = synthTile(0, 0, scene);
    const mosaic = new LidarMosaic((tx, ty) => (tx === 0 && ty === 0 ? left : null));
    const w = mosaic.window({ x0: 495, y0: 10, x1: 505, y1: 20 })!;
    const at = (x: number, y: number): number =>
      w.hag[Math.floor((y - w.y0) / w.res) * w.nx + Math.floor((x - w.x0) / w.res)];
    expect(at(498, 15)).toBe(8);
    expect(at(502, 15)).toBeNaN();
    expect(mosaic.window({ x0: 2000, y0: 2000, x1: 2010, y1: 2010 })).toBeNull();
  });

  it('the LRU evicts', () => {
    let loads = 0;
    const mosaic = new LidarMosaic((tx, ty) => {
      loads++;
      return blankTile(tx, ty);
    }, 2);
    mosaic.window({ x0: 499, y0: 10, x1: 1001, y1: 20 });
    expect(loads).toBe(3);
    mosaic.window({ x0: 1010, y0: 10, x1: 1020, y1: 20 });
    expect(loads).toBe(3);
    mosaic.window({ x0: 10, y0: 10, x1: 20, y1: 20 });
    expect(loads).toBe(4);
  });

  it('openLidarMosaic rejects a tile at res 0.5', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfhl-'));
    const path = join(dir, '0_0.sfhl');
    writeFileSync(
      path,
      encodeLidarTile({
        tx: 0,
        ty: 0,
        sizeM: 500,
        res: 0.5,
        groundRes: 1,
        hagCm: new Int16Array(4),
        groundCm: new Int16Array(4),
        veg: new Uint8Array(4)
      })
    );
    const mosaic = openLidarMosaic(new Map([['0_0', path]]))!;
    expect(() => mosaic.window({ x0: 10, y0: 10, x1: 20, y1: 20 })).toThrow(/res/);
    expect(openLidarMosaic(new Map())).toBeNull();
  });
});

describe('raster primitives', () => {
  const courtyard: MultiPoly = [[rect(51, 5, 59, 25), rect(54, 12, 56, 18)]];
  const flat: SynthScene = { ground: () => 0, boxes: [{ ring: rect(51, 5, 59, 25), top: 10 }] };

  it('cellMask honours holes and multipolygons', () => {
    const w = synthWindow(flat, { x0: 50, y0: 4, x1: 90, y1: 26 });
    const cells = (m: Uint8Array): number => m.reduce((a, b) => a + b, 0);
    expect(Math.abs(cells(cellMask(w, courtyard)) * 0.0625 - 148)).toBeLessThanOrEqual(2);
    const two: MultiPoly = [courtyard[0], [rect(70, 5, 80, 15)]];
    expect(Math.abs(cells(cellMask(w, two)) * 0.0625 - 248)).toBeLessThanOrEqual(2);
  });

  it('cellMask with a shift samples the shifted place', () => {
    const scene: SynthScene = { ...flat, shift: [1.0, -0.3] };
    const w = synthWindow(scene, { x0: 48, y0: 2, x1: 62, y1: 28 });
    const shape: MultiPoly = [[rect(51, 5, 59, 25)]];
    const mean = (m: Uint8Array): number => {
      let s = 0;
      let n = 0;
      m.forEach((v, i) => {
        if (v) {
          s += w.hag[i];
          n++;
        }
      });
      return s / n;
    };
    expect(Math.abs(mean(cellMask(w, shape, 1.0, -0.3)) - 10)).toBeLessThan(0.05);
    expect(mean(cellMask(w, shape))).toBeLessThan(9);
  });

  it('label4 counts components', () => {
    // two blobs touching only diagonally
    const m = Uint8Array.from([1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1]);
    const { labels, n } = label4(m, 4, 4);
    expect(n).toBe(2);
    expect(labels[0]).toBe(labels[4]);
    expect(labels[0]).not.toBe(labels[10]);
    expect(labels[3]).toBe(0);
  });

  it('cellsToPoly then intersect stays inside', () => {
    const w = synthWindow(flat, { x0: 48, y0: 2, x1: 62, y1: 28 });
    const poly = cellsToPoly(w, cellMask(w, courtyard));
    expect(area(poly)).toBeGreaterThan(140);
    expect(area(difference(poly, courtyard))).toBeLessThan(0.01);
    expect(area(intersect(poly, [[rect(40, 0, 55, 30)]]))).toBeGreaterThan(0);
    // a shifted mask comes back in footprint space
    const shifted = cellsToPoly(w, cellMask(w, courtyard, 0.5, 0.25), 0.5, 0.25);
    expect(area(difference(shifted, courtyard))).toBeLessThan(0.01);
  });

  it('bilinear, gaussian and gradient', () => {
    const w = synthWindow(
      { ground: () => 0, boxes: [{ ring: rect(0, 0, 20, 20), top: (x) => x / 10 }] },
      { x0: 0, y0: 0, x1: 20, y1: 20 }
    );
    expect(bilinear(w.hag, w, 10, 10)).toBeCloseTo(1, 1);
    expect(bilinear(w.hag, w, -1, 10)).toBeNaN();
    const { gx, gy } = gradient(w.hag, w.nx, w.ny, w.res);
    expect(gx[40 * w.nx + 40]).toBeCloseTo(0.1, 1);
    expect(gy[40 * w.nx + 40]).toBeCloseTo(0, 5);
    const g = gaussian(w.hag, w.nx, w.ny, 2);
    expect(g[40 * w.nx + 40]).toBeCloseTo(w.hag[40 * w.nx + 40], 1);
    const spike = new Float32Array(169);
    spike[84] = 1;
    const gs = gaussian(spike, 13, 13, 1);
    expect(gs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  });
});

describe('polygons', () => {
  it('inset, grow, union, translate and geojson round-trip', () => {
    const sq: MultiPoly = [[rect(0, 0, 10, 10)]];
    expect(area(inset(sq, 1))).toBeCloseTo(64, 3);
    expect(area(grow(sq, 1))).toBeCloseTo(144, 3);
    expect(area(union([sq, [[rect(5, 0, 15, 10)]]]))).toBeCloseTo(150, 3);
    expect(area(translate(sq, 3, 4))).toBeCloseTo(100, 6);
    const ring: MultiPoly = [[rect(0, 0, 10, 10), rect(4, 4, 6, 6)]];
    expect(area(ring)).toBeCloseTo(96, 6);
    expect(area(inset(ring, 0.5))).toBeCloseTo(81 - 9, 3);
    const back = fromGeoJson(toGeoJson(ring));
    expect(back).toHaveLength(1);
    expect(back[0]).toHaveLength(2);
    expect(area(back)).toBeCloseTo(96, 6);
    const multi = fromGeoJson(toGeoJson([...sq, [rect(20, 0, 30, 10)]]));
    expect(multi).toHaveLength(2);
  });
});
