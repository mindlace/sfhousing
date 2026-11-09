// The gross table: per scenario row, gross units at N stories, precomputed by the pipeline so the
// sim worker looks yields up instead of generating buildings. Worker-safe (no `node:` imports).
//
// Wire format (`scenarios/fzp/gross.bin`, deflate-raw): ASCII `SFHG`, u8 version, u8 length + ASCII
// datasetVersion, u32le row count, then per row u8 `first`, u8 `plateau` and, when `plateau > 0`,
// one zigzag LEB128 varint of g(s) - g(s - 1) for s = first..plateau (g(0) = 0).
import type { ParcelRecord } from './parcel';
import type { ScenarioParcels } from './scenario-codec';
import { scenarioYield } from './scenario-yield';
import { fnv1a32 } from '$lib/generator';
import { DISTRICT_MIN_M2 } from '$lib/generator/constants';
import { districtArea, mayBeDistrict } from '$lib/generator/district-layout';
import { physicalMaxStories } from '$lib/generator/physical';
import { normaliseSite } from '$lib/generator/site';
import { drawVariety } from '$lib/generator/variety';

export const GROSS_MAX = 0xffff;
export const GROSS_STORIES_MAX = 80;
const VERSION = 1;
const MAGIC = [0x53, 0x46, 0x48, 0x47]; // SFHG

export interface GrossRow {
  first: number;
  plateau: number;
  values: number[];
  clamped: number;
}

export interface GrossTable {
  format: 'sfh-gross/1';
  datasetVersion: string;
  count: number;
  first: Uint8Array; // per row
  plateau: Uint8Array; // per row; 0 = empty row
  offset: Uint32Array; // count + 1: row i's values are values[offset[i]..offset[i+1])
  values: Uint16Array; // g(first..plateau) per row
}

export function clampGross(g: number): number {
  return g > GROSS_MAX ? GROSS_MAX : g;
}

/** Story count beyond which gross cannot change: the generator's physical clamp (80 for district-size lots). */
export function grossStoryBound(rec: ParcelRecord): number {
  if (!rec.eligible) return 0;
  if (mayBeDistrict(rec.polygon) && districtArea(rec.polygon) >= DISTRICT_MIN_M2) {
    return GROSS_STORIES_MAX;
  }
  const site = normaliseSite(rec.polygon, drawVariety(fnv1a32(rec.id)).edgeInsetM);
  return site ? Math.min(GROSS_STORIES_MAX, physicalMaxStories(site)) : 0;
}

export function grossRowOf(
  rec: ParcelRecord | undefined,
  yieldOf: (rec: ParcelRecord, stories: number) => number = (r, s) => scenarioYield(r, s, null)
): GrossRow {
  const empty: GrossRow = { first: 0, plateau: 0, values: [], clamped: 0 };
  if (!rec) return empty;
  const bound = grossStoryBound(rec);
  const g: number[] = [];
  let first = 0;
  let plateau = 0;
  let prev = 0;
  for (let s = 1; s <= bound; s++) {
    const v = clampGross(yieldOf(rec, s));
    g.push(v);
    if (v > 0 && first === 0) first = s;
    if (v !== prev) plateau = s;
    prev = v;
  }
  if (first === 0) return empty;
  const values = g.slice(first - 1, plateau);
  return { first, plateau, values, clamped: values.filter((v) => v === GROSS_MAX).length };
}

export function grossTableOf(datasetVersion: string, rows: readonly GrossRow[]): GrossTable {
  const count = rows.length;
  const first = new Uint8Array(count);
  const plateau = new Uint8Array(count);
  const offset = new Uint32Array(count + 1);
  let total = 0;
  for (const r of rows) total += r.values.length;
  const values = new Uint16Array(total);
  let at = 0;
  rows.forEach((r, i) => {
    // A Uint16Array would silently wrap an oversize value
    for (const v of r.values) {
      if (v > GROSS_MAX) throw new RangeError(`gross: row ${i} value ${v} exceeds ${GROSS_MAX}`);
    }
    first[i] = r.first;
    plateau[i] = r.plateau;
    offset[i] = at;
    values.set(r.values, at);
    at += r.values.length;
  });
  offset[count] = at;
  return { format: 'sfh-gross/1', datasetVersion, count, first, plateau, offset, values };
}

/** Gross units of `row` at `stories`: 0 at or below 0 and below `first`, g(plateau) at and above it. */
export function grossAt(t: GrossTable, row: number, stories: number): number {
  const p = t.plateau[row];
  if (p === 0 || stories < t.first[row]) return 0;
  return t.values[t.offset[row] + Math.min(stories, p) - t.first[row]];
}

export function encodeGrossPayload(t: GrossTable): Uint8Array {
  const name = new TextEncoder().encode(t.datasetVersion);
  if (name.length > 255) throw new RangeError('gross: datasetVersion longer than 255 bytes');
  const b: number[] = [...MAGIC, VERSION, name.length, ...name];
  b.push(t.count & 255, (t.count >>> 8) & 255, (t.count >>> 16) & 255, (t.count >>> 24) & 255);
  const varint = (v: number) => {
    while (v >= 128) {
      b.push((v & 127) | 128);
      v = Math.floor(v / 128);
    }
    b.push(v);
  };
  for (let i = 0; i < t.count; i++) {
    const first = t.first[i];
    const plateau = t.plateau[i];
    b.push(first, plateau);
    let prev = 0;
    for (let s = first; plateau > 0 && s <= plateau; s++) {
      const v = t.values[t.offset[i] + s - first];
      if (v > GROSS_MAX) throw new RangeError(`gross: row ${i} value ${v} exceeds ${GROSS_MAX}`);
      const d = v - prev;
      varint(d < 0 ? -2 * d - 1 : 2 * d);
      prev = v;
    }
  }
  return Uint8Array.from(b);
}

export function decodeGrossPayload(bytes: Uint8Array): GrossTable {
  let at = 0;
  const u8 = (what: string): number => {
    if (at >= bytes.length) throw new Error(`gross: truncated ${what}`);
    return bytes[at++];
  };
  if (bytes.length < 4) throw new Error('gross: truncated magic');
  for (const m of MAGIC) {
    if (bytes[at++] !== m) throw new Error('gross: bad magic');
  }
  const version = u8('version');
  if (version !== VERSION) throw new Error(`gross: unsupported version ${version}`);
  const nameLen = u8('datasetVersion length');
  if (at + nameLen + 4 > bytes.length) throw new Error('gross: truncated header');
  const datasetVersion = new TextDecoder().decode(bytes.subarray(at, at + nameLen));
  at += nameLen;
  const count =
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
  at += 4;
  if (count * 2 > bytes.length - at) throw new Error('gross: truncated rows');
  const first = new Uint8Array(count);
  const plateau = new Uint8Array(count);
  const offset = new Uint32Array(count + 1);
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    const f = u8('row');
    const p = u8('row');
    if (p > GROSS_STORIES_MAX) {
      throw new Error(`gross: row ${i} plateau ${p} above ${GROSS_STORIES_MAX}`);
    }
    if (p > 0 && f === 0) throw new Error(`gross: row ${i} first 0 with plateau ${p}`);
    if (p < f) throw new Error(`gross: row ${i} plateau ${p} below first ${f}`);
    first[i] = f;
    plateau[i] = p;
    offset[i] = values.length;
    let prev = 0;
    for (let s = f; p > 0 && s <= p; s++) {
      let z = 0;
      let mul = 1;
      for (;;) {
        const byte = u8('varint');
        z += (byte & 127) * mul;
        if (byte < 128) break;
        mul *= 128;
        if (mul > 2 ** 35) throw new Error(`gross: row ${i} varint too long`);
      }
      prev += z % 2 === 1 ? -(z + 1) / 2 : z / 2;
      if (prev < 0 || prev > GROSS_MAX) {
        throw new Error(`gross: row ${i} value ${prev} out of range`);
      }
      values.push(prev);
    }
  }
  offset[count] = values.length;
  if (at !== bytes.length) throw new Error(`gross: ${bytes.length - at} trailing bytes`);
  return {
    format: 'sfh-gross/1',
    datasetVersion,
    count,
    first,
    plateau,
    offset,
    values: Uint16Array.from(values)
  };
}

/** Inflate a deflate-raw body (as `readScenarioParcels` does) and decode it. */
export async function readGrossTable(body: Uint8Array): Promise<GrossTable> {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(body);
      c.close();
    }
  });
  const inflate = new DecompressionStream('deflate-raw') as unknown as TransformStream<
    Uint8Array,
    Uint8Array
  >;
  const reader = source.pipeThrough(inflate).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return decodeGrossPayload(bytes);
}

/** Why `t` does not belong to `p` (a different row count or build), or null. */
export function grossTableProblem(t: GrossTable, p: ScenarioParcels): string | null {
  if (t.count !== p.count) return `gross table has ${t.count} rows, parcels.bin ${p.count}`;
  if (t.datasetVersion !== p.datasetVersion) {
    return `gross table is for dataset ${t.datasetVersion}, parcels.bin for ${p.datasetVersion}`;
  }
  return null;
}
