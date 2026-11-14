// Synthetic LiDAR scenes for tests and the fixture: boxes on a ground surface, drawn into a tile.
import { BOXES } from '../boxes-config.js';
import type { Ring } from '../geom.js';
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
