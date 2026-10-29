// Shared column-file layout, the one `sfh-scenario/1` uses: a 4-byte ASCII magic | u16 major |
// u16 reserved (0) | u32 header length H | header JSON | columns, little-endian. The header gains
// `columns: [{ name, type, offset, byteLength }]`; offsets are absolute from the payload start and
// 8-aligned. Pure TS and worker-safe: no zod, no node: imports.
import { fnv1a32 } from '../generator/seed';

export type ColType = 'u8' | 'u16' | 'u32' | 'i32';
export interface ColumnIn {
  name: string;
  type: ColType;
  values: ArrayLike<number>;
}
export interface ColumnFile {
  header: Record<string, unknown>;
  read(
    name: string,
    type: ColType,
    length: number
  ): Uint8Array | Uint16Array | Uint32Array | Int32Array;
}

const PRELUDE = 12;
const SIZE: Record<ColType, number> = { u8: 1, u16: 2, u32: 4, i32: 4 };
const RANGE: Record<ColType, [number, number]> = {
  u8: [0, 0xff],
  u16: [0, 0xffff],
  u32: [0, 0xffffffff],
  i32: [-0x80000000, 0x7fffffff]
};
const align8 = (n: number) => Math.ceil(n / 8) * 8;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function put(
  dv: DataView,
  name: string,
  type: ColType,
  offset: number,
  values: ArrayLike<number>,
  fail: (msg: string) => never
): void {
  const [lo, hi] = RANGE[type];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isInteger(v) || v < lo || v > hi) fail(`${name}[${i}] = ${v} does not fit ${type}`);
    const at = offset + i * SIZE[type];
    if (type === 'u8') dv.setUint8(at, v);
    else if (type === 'u16') dv.setUint16(at, v, true);
    else if (type === 'i32') dv.setInt32(at, v, true);
    else dv.setUint32(at, v, true);
  }
}

export function encodeColumnFile(
  magic: string,
  major: number,
  header: Record<string, unknown>,
  columns: readonly ColumnIn[],
  fail: (msg: string) => never
): Uint8Array {
  if (magic.length !== 4 || [...magic].some((c) => c.charCodeAt(0) > 0x7f))
    fail(`magic ${magic} is not 4 ASCII characters`);
  // Lay the columns out relative to the column section, then find the section start: the header
  // holds absolute offsets, so its length depends on them. The start only grows with the header,
  // so the loop reaches a fixed point within a few passes.
  const rel: number[] = [];
  let end = 0;
  for (const c of columns) {
    end = align8(end);
    rel.push(end);
    end += c.values.length * SIZE[c.type];
  }
  const headerFor = (start: number) =>
    new TextEncoder().encode(
      JSON.stringify({
        ...header,
        columns: columns.map((c, k) => ({
          name: c.name,
          type: c.type,
          offset: start + rel[k],
          byteLength: c.values.length * SIZE[c.type]
        }))
      })
    );
  let start = align8(PRELUDE);
  let head = headerFor(start);
  while (align8(PRELUDE + head.length) !== start) {
    start = align8(PRELUDE + head.length);
    head = headerFor(start);
  }
  const out = new Uint8Array(start + end);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = magic.charCodeAt(i);
  dv.setUint16(4, major, true);
  dv.setUint16(6, 0, true);
  dv.setUint32(8, head.length, true);
  out.set(head, PRELUDE);
  columns.forEach((c, k) => put(dv, c.name, c.type, start + rel[k], c.values, fail));
  return out;
} // deterministic

export function openColumnFile(
  bytes: Uint8Array,
  magic: string,
  major: number,
  names: readonly string[],
  fail: (msg: string) => never
): ColumnFile {
  if (bytes.length < PRELUDE) fail(`payload is ${bytes.length} bytes, shorter than the prelude`);
  if ([...magic].some((c, k) => bytes[k] !== c.charCodeAt(0))) fail(`bad magic: not ${magic}`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const got = dv.getUint16(4, true);
  if (got !== major) fail(`unsupported major version ${got}`);
  const H = dv.getUint32(8, true);
  if (PRELUDE + H > bytes.length) fail(`header length ${H} runs past the payload`);
  let h: unknown;
  try {
    h = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(PRELUDE, PRELUDE + H))
    );
  } catch (e) {
    fail(`header is not JSON: ${(e as Error).message}`);
  }
  if (!isObj(h)) fail('header is not a JSON object');
  const header = h as Record<string, unknown>;
  if (!Array.isArray(header.columns)) fail('columns is not an array');
  const byName = new Map<string, { type: unknown; offset: number; byteLength: number }>();
  for (const [k, c] of (header.columns as unknown[]).entries()) {
    if (!isObj(c) || typeof c.name !== 'string' || !isInt(c.offset) || !isInt(c.byteLength))
      fail(`columns.${k} is invalid`);
    const col = c as { name: string; type: unknown; offset: number; byteLength: number };
    if (byName.has(col.name)) fail(`column ${col.name} is listed twice`);
    byName.set(col.name, { type: col.type, offset: col.offset, byteLength: col.byteLength });
  }
  // Columns sit in the given order after the header, without overlap.
  let free = align8(PRELUDE + H);
  for (const name of names) {
    const spec = byName.get(name);
    if (!spec) fail(`column ${name} is missing`);
    const { offset, byteLength } = spec!;
    if (offset % 8 !== 0 || offset < free)
      fail(`column ${name} offset ${offset} is not 8-aligned past the previous column`);
    if (offset + byteLength > bytes.length) fail(`column ${name} runs past the payload`);
    free = offset + byteLength;
  }
  return {
    header,
    read(name, type, length) {
      const spec = byName.get(name);
      if (!spec || !names.includes(name)) fail(`column ${name} is missing`);
      const { offset, byteLength } = spec!;
      if (spec!.type !== type) fail(`column ${name} has type ${String(spec!.type)}, want ${type}`);
      if (length * SIZE[type] !== byteLength)
        fail(`column ${name} is ${byteLength} bytes, want ${length * SIZE[type]}`);
      const out =
        type === 'u8'
          ? new Uint8Array(length)
          : type === 'u16'
            ? new Uint16Array(length)
            : type === 'u32'
              ? new Uint32Array(length)
              : new Int32Array(length);
      for (let i = 0; i < length; i++) {
        const at = offset + i * SIZE[type];
        out[i] =
          type === 'u8'
            ? dv.getUint8(at)
            : type === 'u16'
              ? dv.getUint16(at, true)
              : type === 'u32'
                ? dv.getUint32(at, true)
                : dv.getInt32(at, true);
      }
      return out;
    }
  };
}

/** Inflate a raw-deflate body (a stream or bytes) to one buffer; throws on corrupt input. */
export async function inflateRawBody(
  body: ReadableStream<Uint8Array> | Uint8Array
): Promise<Uint8Array> {
  const source =
    body instanceof Uint8Array
      ? new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(body);
            c.close();
          }
        })
      : body;
  // The DOM lib types the writable side as BufferSource; the bytes are the same.
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
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Order-sensitive hash of an id list: fnv1a32 of the ids joined by newlines. */
export function idsHash(ids: readonly string[]): number {
  return fnv1a32(ids.join('\n'));
}
