// A lazy mosaic of sfhl tiles: windows are cut on the global 0.25 m grid and read across tile seams
// as one raster.
import { readFileSync } from 'node:fs';
import { BOXES } from '../../boxes-config.js';
import type { Bbox7131 } from '../../geom.js';
import { decodeLidarTile, LIDAR_NODATA, tilesForBbox, type LidarTile } from './tile.js';

export interface RasterWindow {
  /** Cell (i,j) centre = x0+(i+.5)res, y0+(j+.5)res; row 0 is the south edge. */
  x0: number;
  y0: number;
  res: number;
  nx: number;
  ny: number;
  /** Metres, NaN = no data or no tile. */
  hag: Float32Array;
  /** NAVD88 metres, bilinear from the 1 m grid, NaN = none. */
  ground: Float32Array;
  veg: Uint8Array;
}

/**
 * Bilinear ground at (x, y) from a 1 m grid whose cell (gi, gj) has its centre at
 * ((gi+.5)gres, (gj+.5)gres). `at` returns metres or NaN; NaN corners drop out and the rest are
 * renormalised, NaN only when all four are missing.
 */
export function groundBilinear(
  at: (gi: number, gj: number) => number,
  x: number,
  y: number,
  gres: number
): number {
  const u = x / gres - 0.5;
  const v = y / gres - 0.5;
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  let s = 0;
  let ws = 0;
  for (let b = 0; b < 2; b++)
    for (let a = 0; a < 2; a++) {
      const g = at(i + a, j + b);
      if (Number.isNaN(g)) continue;
      const wgt = (a ? fu : 1 - fu) * (b ? fv : 1 - fv);
      s += g * wgt;
      ws += wgt;
    }
  return ws > 0 ? s / ws : NaN;
}

export class LidarMosaic {
  private cache = new Map<string, LidarTile | null>();

  constructor(
    private load: (tx: number, ty: number) => LidarTile | null,
    private maxTiles = 16
  ) {}

  private get(tx: number, ty: number): LidarTile | null {
    const key = `${tx}_${ty}`;
    if (this.cache.has(key)) {
      const t = this.cache.get(key) ?? null;
      this.cache.delete(key);
      this.cache.set(key, t);
      return t;
    }
    const t = this.load(tx, ty);
    this.cache.set(key, t);
    while (this.cache.size > this.maxTiles) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    return t;
  }

  /** Cells snapped to the global 0.25 m grid; null when no tile intersects b. */
  window(b: Bbox7131): RasterWindow | null {
    const res: number = BOXES.rasterResM;
    const gres: number = BOXES.groundResM;
    const size: number = BOXES.tileSizeM;
    const i0 = Math.floor(b.x0 / res);
    const j0 = Math.floor(b.y0 / res);
    const nx = Math.max(1, Math.ceil(b.x1 / res) - i0);
    const ny = Math.max(1, Math.ceil(b.y1 / res) - j0);
    const x0 = i0 * res;
    const y0 = j0 * res;

    // The tiles the cells sit in, plus those the 1 m ground neighbours of an edge cell sit in.
    const held = new Map<string, LidarTile | null>();
    const hold = (tx: number, ty: number): LidarTile | null => {
      const key = `${tx}_${ty}`;
      if (!held.has(key)) held.set(key, this.get(tx, ty));
      return held.get(key) ?? null;
    };
    let any = false;
    for (const [tx, ty] of tilesForBbox({ x0, y0, x1: x0 + nx * res, y1: y0 + ny * res }, size))
      if (hold(tx, ty)) any = true;
    if (!any) return null;
    for (const [tx, ty] of tilesForBbox(
      { x0: x0 - gres, y0: y0 - gres, x1: x0 + nx * res + gres, y1: y0 + ny * res + gres },
      size
    ))
      hold(tx, ty);

    const n = size / res;
    const g = size / gres;
    const hag = new Float32Array(nx * ny).fill(NaN);
    const veg = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      const gj = j0 + j;
      const ty = Math.floor(gj / n);
      const r = gj - ty * n;
      for (let i = 0; i < nx; i++) {
        const gi = i0 + i;
        const tx = Math.floor(gi / n);
        const t = held.get(`${tx}_${ty}`);
        if (!t) continue;
        const k = r * n + (gi - tx * n);
        const cm = t.hagCm[k];
        if (cm === LIDAR_NODATA) continue;
        hag[j * nx + i] = cm / 100;
        veg[j * nx + i] = t.veg[k];
      }
    }

    const groundAt = (gi: number, gj: number): number => {
      const tx = Math.floor(gi / g);
      const ty = Math.floor(gj / g);
      const t = held.get(`${tx}_${ty}`);
      if (!t) return NaN;
      const cm = t.groundCm[(gj - ty * g) * g + (gi - tx * g)];
      return cm === LIDAR_NODATA ? NaN : cm / 100;
    };
    const ground = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        ground[j * nx + i] = groundBilinear(
          groundAt,
          x0 + (i + 0.5) * res,
          y0 + (j + 0.5) * res,
          gres
        );
    return { x0, y0, res, nx, ny, hag, ground, veg };
  }
}

function checkTile(t: LidarTile, path: string): void {
  if (t.sizeM !== BOXES.tileSizeM || t.res !== BOXES.rasterResM || t.groundRes !== BOXES.groundResM)
    throw new Error(
      `${path}: tile sizeM/res/groundRes ${t.sizeM}/${t.res}/${t.groundRes} differ from boxes-config ` +
        `${BOXES.tileSizeM}/${BOXES.rasterResM}/${BOXES.groundResM}`
    );
  const n = t.sizeM / t.res;
  const g = t.sizeM / t.groundRes;
  if (t.hagCm.length !== n * n || t.veg.length !== n * n || t.groundCm.length !== g * g)
    throw new Error(`${path}: tile array sizes do not match its header`);
}

/** Lazy file-backed mosaic over lidarTilesOf(...); null when tiles is empty. */
export function openLidarMosaic(tiles: Map<string, string>): LidarMosaic | null {
  if (tiles.size === 0) return null;
  return new LidarMosaic((tx, ty) => {
    const path = tiles.get(`${tx}_${ty}`);
    if (!path) return null;
    const t = decodeLidarTile(new Uint8Array(readFileSync(path)));
    checkTile(t, path);
    return t;
  });
}
