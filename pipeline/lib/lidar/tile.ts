// The sfhl/1 LiDAR raster tile: height above ground, ground elevation and a vegetation mask on a
// 500 m tile of EPSG:7131.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { BOXES } from '../../boxes-config.js';
import type { Bbox7131 } from '../../geom.js';

export const LIDAR_NODATA = -32768;

export interface LidarTile {
  tx: number;
  ty: number;
  sizeM: number;
  res: number;
  groundRes: number;
  /** (sizeM/res)^2 cells, row 0 = south edge, LIDAR_NODATA = no data. */
  hagCm: Int16Array;
  /** (sizeM/groundRes)^2 cells, NAVD88 cm. */
  groundCm: Int16Array;
  /** One byte per hag cell, 0 or 1 (packed to bits on disk). */
  veg: Uint8Array;
}

const MAGIC = [0x53, 0x46, 0x48, 0x4c]; // SFHL

export function tileIndexOf(
  x: number,
  y: number,
  sizeM: number = BOXES.tileSizeM
): [number, number] {
  return [Math.floor(x / sizeM) + 0, Math.floor(y / sizeM) + 0];
}

export function tilesForBbox(b: Bbox7131, sizeM: number = BOXES.tileSizeM): [number, number][] {
  const [tx0, ty0] = tileIndexOf(b.x0, b.y0, sizeM);
  const [tx1, ty1] = tileIndexOf(b.x1, b.y1, sizeM);
  const out: [number, number][] = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) out.push([tx, ty]);
  return out;
}

export function lidarTileName(tx: number, ty: number): string {
  return `usgs-lidar-sf/${tx}_${ty}.sfhl`;
}

export function parseLidarTileName(name: string): [number, number] | null {
  const m = /^usgs-lidar-sf\/(-?\d+)_(-?\d+)\.sfhl$/.exec(name);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function i16Bytes(a: Int16Array): Uint8Array {
  const out = new Uint8Array(a.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < a.length; i++) dv.setInt16(i * 2, a[i], true);
  return out;
}

function packBits(v: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(v.length / 8));
  for (let i = 0; i < v.length; i++) if (v[i]) out[i >> 3] |= 1 << (i & 7);
  return out;
}

function deflate(b: Uint8Array): Uint8Array {
  return deflateRawSync(b, { level: 9 });
}

export function encodeLidarTile(t: LidarTile): Uint8Array {
  const header = new TextEncoder().encode(
    JSON.stringify({
      tx: t.tx,
      ty: t.ty,
      sizeM: t.sizeM,
      res: t.res,
      groundRes: t.groundRes,
      crs: 'EPSG:7131'
    })
  );
  const sections = [i16Bytes(t.hagCm), i16Bytes(t.groundCm), packBits(t.veg)].map(deflate);
  const total = 9 + header.length + sections.reduce((n, s) => n + 4 + s.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = 1;
  dv.setUint32(5, header.length, true);
  out.set(header, 9);
  let p = 9 + header.length;
  for (const s of sections) {
    dv.setUint32(p, s.length, true);
    out.set(s, p + 4);
    p += 4 + s.length;
  }
  return out;
}

export function decodeLidarTile(b: Uint8Array): LidarTile {
  if (b.length < 9 || MAGIC.some((m, i) => b[i] !== m)) throw new Error('sfhl: bad magic');
  if (b[4] !== 1) throw new Error(`sfhl: unsupported version ${b[4]}`);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const hlen = dv.getUint32(5, true);
  if (9 + hlen > b.length) throw new Error('sfhl: truncated header');
  const h = JSON.parse(new TextDecoder().decode(b.subarray(9, 9 + hlen))) as {
    tx: number;
    ty: number;
    sizeM: number;
    res: number;
    groundRes: number;
  };
  let p = 9 + hlen;
  const section = (): Uint8Array => {
    if (p + 4 > b.length) throw new Error('sfhl: truncated section');
    const len = dv.getUint32(p, true);
    if (p + 4 + len > b.length) throw new Error('sfhl: truncated section');
    let raw: Buffer;
    try {
      raw = inflateRawSync(b.subarray(p + 4, p + 4 + len));
    } catch {
      throw new Error('sfhl: corrupt section');
    }
    p += 4 + len;
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  };
  const toI16 = (u: Uint8Array): Int16Array => {
    const d = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const out = new Int16Array(u.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = d.getInt16(i * 2, true);
    return out;
  };
  const hagCm = toI16(section());
  const groundCm = toI16(section());
  const bits = section();
  const veg = new Uint8Array(hagCm.length);
  for (let i = 0; i < veg.length; i++) veg[i] = (bits[i >> 3] >> (i & 7)) & 1;
  return {
    tx: h.tx,
    ty: h.ty,
    sizeM: h.sizeM,
    res: h.res,
    groundRes: h.groundRes,
    hagCm,
    groundCm,
    veg
  };
}
