// Synthetic LiDAR scenes for tests and the fixture: boxes on a ground surface, drawn into a tile.
import { BOXES } from '../boxes-config.js';
import type { Bbox7131, Ring } from '../geom.js';
import { groundBilinear, type RasterWindow } from '../lib/lidar/mosaic.js';
import { LIDAR_NODATA, type LidarTile } from '../lib/lidar/tile.js';

export interface SynthScene {
  /** Ground elevation, NAVD88 m. */
  ground: (x: number, y: number) => number;
  /** Heights are above local ground. */
  boxes: { ring: Ring; top: number | ((x: number, y: number) => number) }[];
  veg?: { ring: Ring; top: number }[];
  nodata?: Ring[];
  /** The LiDAR sits at footprint + shift. */
  shift?: [number, number];
}

function inRing(x: number, y: number, r: Ring): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function synthTile(tx: number, ty: number, scene: SynthScene): LidarTile {
  const sizeM = BOXES.tileSizeM;
  const res = BOXES.rasterResM;
  const groundRes = BOXES.groundResM;
  const [dx, dy] = scene.shift ?? [0, 0];
  const shifted = (r: Ring): Ring => r.map(([x, y]) => [x + dx, y + dy]);
  const n = sizeM / res;
  const g = sizeM / groundRes;
  const x0 = tx * sizeM;
  const y0 = ty * sizeM;
  const hagCm = new Int16Array(n * n);
  const veg = new Uint8Array(n * n);
  const groundCm = new Int16Array(g * g);
  for (let r = 0; r < g; r++)
    for (let c = 0; c < g; c++)
      groundCm[r * g + c] = Math.round(
        scene.ground(x0 + (c + 0.5) * groundRes, y0 + (r + 0.5) * groundRes) * 100
      );

  // Visits every cell whose centre lies in the ring, scanning only the ring's bounding box.
  const paint = (ring: Ring, fn: (i: number, x: number, y: number) => void): void => {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const c0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / res));
    const c1 = Math.min(n - 1, Math.ceil((Math.max(...xs) - x0) / res));
    const r0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / res));
    const r1 = Math.min(n - 1, Math.ceil((Math.max(...ys) - y0) / res));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const x = x0 + (c + 0.5) * res;
        const y = y0 + (r + 0.5) * res;
        if (inRing(x, y, ring)) fn(r * n + c, x, y);
      }
  };

  for (const b of scene.boxes)
    paint(shifted(b.ring), (i, x, y) => {
      const top = typeof b.top === 'function' ? b.top(x - dx, y - dy) : b.top;
      hagCm[i] = Math.max(hagCm[i], Math.round(top * 100));
    });
  for (const v of scene.veg ?? [])
    paint(shifted(v.ring), (i) => {
      hagCm[i] = Math.max(hagCm[i], Math.round(v.top * 100));
      veg[i] = 1;
    });
  for (const ring of scene.nodata ?? [])
    paint(shifted(ring), (i) => {
      hagCm[i] = LIDAR_NODATA;
      veg[i] = 0;
    });
  return { tx, ty, sizeM, res, groundRes, hagCm, groundCm, veg };
}

/** The in-memory window of a scene over b, cell for cell what a mosaic of synthTile tiles reads. */
export function synthWindow(scene: SynthScene, b: Bbox7131): RasterWindow {
  const res = BOXES.rasterResM;
  const gres = BOXES.groundResM;
  const [dx, dy] = scene.shift ?? [0, 0];
  const shifted = (r: Ring): Ring => r.map(([x, y]) => [x + dx, y + dy]);
  const i0 = Math.floor(b.x0 / res);
  const j0 = Math.floor(b.y0 / res);
  const nx = Math.max(1, Math.ceil(b.x1 / res) - i0);
  const ny = Math.max(1, Math.ceil(b.y1 / res) - j0);
  const x0 = i0 * res;
  const y0 = j0 * res;
  const hag = new Float32Array(nx * ny);
  const veg = new Uint8Array(nx * ny);
  const ground = new Float32Array(nx * ny);
  const boxes = scene.boxes.map((b2) => ({ ...b2, ring: shifted(b2.ring) }));
  const vegs = (scene.veg ?? []).map((v) => ({ ...v, ring: shifted(v.ring) }));
  const holes = (scene.nodata ?? []).map(shifted);
  const groundAt = (gi: number, gj: number): number =>
    Math.round(scene.ground((gi + 0.5) * gres, (gj + 0.5) * gres) * 100) / 100;
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + (i + 0.5) * res;
      const y = y0 + (j + 0.5) * res;
      let cm = 0;
      let v = 0;
      for (const bx of boxes)
        if (inRing(x, y, bx.ring)) {
          const top = typeof bx.top === 'function' ? bx.top(x - dx, y - dy) : bx.top;
          cm = Math.max(cm, Math.round(top * 100));
        }
      for (const vg of vegs)
        if (inRing(x, y, vg.ring)) {
          cm = Math.max(cm, Math.round(vg.top * 100));
          v = 1;
        }
      let nodata = false;
      for (const h of holes) if (inRing(x, y, h)) nodata = true;
      const k = j * nx + i;
      hag[k] = nodata ? NaN : cm / 100;
      veg[k] = nodata ? 0 : v;
      ground[k] = groundBilinear(groundAt, x, y, gres);
    }
  return { x0, y0, res, nx, ny, hag, ground, veg };
}
