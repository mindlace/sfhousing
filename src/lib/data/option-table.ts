// The option table: per scenario row, the lot's pruned building options and its location value,
// baked by the pipeline so the sim worker chooses among them without generating buildings.
// Worker-safe (no `node:` imports).
//
// Wire format (`scenarios/fzp/options.bin`, deflate-raw): ASCII `SFHO`, u8 version, u8 length +
// ASCII datasetVersion, u32le row count, then per row u16le n, f32le locationValue and n options
// of (u8 type, u8 form, u8 stories, u8 plates, LEB128 homes). Type and form are codes into
// BUILDING_TYPES and BUILDING_FORMS; a row's options rise in stories.
import type { ScenarioParcels } from './scenario-codec';
import { BUILDING_FORMS, BUILDING_TYPES, type Option } from '../sim/choice/types';

/** The most options a row holds: n is a u16, and 1,023 keeps an option index in 10 bits. */
export const OPTIONS_MAX_PER_LOT = 1023;
const HOMES_MAX = 0xffff;
const BYTE_MAX = 0xff;
const VERSION = 1;
const MAGIC = [0x53, 0x46, 0x48, 0x4f]; // SFHO

export interface OptionTable {
  format: 'sfh-options/1';
  datasetVersion: string;
  count: number;
  /** count + 1: row i's options are [offset[i], offset[i + 1]). */
  offset: Uint32Array;
  /** Per option: a code into BUILDING_TYPES. */
  type: Uint8Array;
  /** Per option: a code into BUILDING_FORMS. */
  form: Uint8Array;
  stories: Uint8Array;
  plates: Uint8Array;
  homes: Uint16Array;
  /** Per row. */
  locationValue: Float32Array;
}

function byte(v: number, what: string): number {
  if (!Number.isInteger(v) || v < 0 || v > BYTE_MAX) {
    throw new RangeError(`options: ${what} ${v} is not a byte`);
  }
  return v;
}

export function optionTableOf(
  datasetVersion: string,
  rows: readonly { options: readonly Option[]; locationValue: number }[]
): OptionTable {
  const count = rows.length;
  let total = 0;
  rows.forEach((r, i) => {
    if (r.options.length > OPTIONS_MAX_PER_LOT) {
      throw new RangeError(
        `options: row ${i} has ${r.options.length} options, above ${OPTIONS_MAX_PER_LOT}`
      );
    }
    total += r.options.length;
  });
  const t: OptionTable = {
    format: 'sfh-options/1',
    datasetVersion,
    count,
    offset: new Uint32Array(count + 1),
    type: new Uint8Array(total),
    form: new Uint8Array(total),
    stories: new Uint8Array(total),
    plates: new Uint8Array(total),
    homes: new Uint16Array(total),
    locationValue: new Float32Array(count)
  };
  let at = 0;
  rows.forEach((r, i) => {
    t.offset[i] = at;
    t.locationValue[i] = r.locationValue;
    let prev = 0;
    for (const o of r.options) {
      const type = BUILDING_TYPES.indexOf(o.type);
      const form = BUILDING_FORMS.indexOf(o.form);
      if (type < 0 || form < 0) throw new RangeError(`options: row ${i} type or form unknown`);
      // a Uint16Array would silently wrap an oversize value
      if (!Number.isInteger(o.homes) || o.homes < 0 || o.homes > HOMES_MAX) {
        throw new RangeError(`options: row ${i} homes ${o.homes} outside 0 to ${HOMES_MAX}`);
      }
      if (o.stories < prev) throw new RangeError(`options: row ${i} stories out of order`);
      prev = o.stories;
      t.type[at] = type;
      t.form[at] = form;
      t.stories[at] = byte(o.stories, `row ${i} stories`);
      t.plates[at] = byte(o.plates, `row ${i} plates`);
      t.homes[at] = o.homes;
      at++;
    }
  });
  t.offset[count] = at;
  return t;
}

const varintLength = (v: number) => (v < 0x80 ? 1 : v < 0x4000 ? 2 : 3);

export function encodeOptionPayload(t: OptionTable): Uint8Array {
  const name = new TextEncoder().encode(t.datasetVersion);
  if (name.length > BYTE_MAX) throw new RangeError('options: datasetVersion longer than 255 bytes');
  let size = MAGIC.length + 2 + name.length + 4 + t.count * 6;
  for (let j = 0; j < t.offset[t.count]; j++) size += 4 + varintLength(t.homes[j]);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0);
  bytes[4] = VERSION;
  bytes[5] = name.length;
  bytes.set(name, 6);
  let at = 6 + name.length;
  view.setUint32(at, t.count, true);
  at += 4;
  for (let i = 0; i < t.count; i++) {
    const from = t.offset[i];
    const to = t.offset[i + 1];
    if (to - from > OPTIONS_MAX_PER_LOT) {
      throw new RangeError(
        `options: row ${i} has ${to - from} options, above ${OPTIONS_MAX_PER_LOT}`
      );
    }
    view.setUint16(at, to - from, true);
    view.setFloat32(at + 2, t.locationValue[i], true);
    at += 6;
    for (let j = from; j < to; j++) {
      bytes[at++] = t.type[j];
      bytes[at++] = t.form[j];
      bytes[at++] = t.stories[j];
      bytes[at++] = t.plates[j];
      let v = t.homes[j];
      while (v >= 0x80) {
        bytes[at++] = (v & 0x7f) | 0x80;
        v >>>= 7;
      }
      bytes[at++] = v;
    }
  }
  return bytes;
}

export function decodeOptionPayload(bytes: Uint8Array): OptionTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number, what: string) => {
    if (at + n > bytes.length) throw new Error(`options: truncated ${what}`);
  };
  need(MAGIC.length, 'magic');
  for (const m of MAGIC) {
    if (bytes[at++] !== m) throw new Error('options: bad magic');
  }
  need(2, 'header');
  const version = bytes[at++];
  if (version !== VERSION) throw new Error(`options: unsupported version ${version}`);
  const nameLen = bytes[at++];
  need(nameLen + 4, 'header');
  const datasetVersion = new TextDecoder().decode(bytes.subarray(at, at + nameLen));
  at += nameLen;
  const count = view.getUint32(at, true);
  at += 4;
  if (count * 6 > bytes.length - at) throw new Error('options: truncated rows');
  const offset = new Uint32Array(count + 1);
  const locationValue = new Float32Array(count);
  const type: number[] = [];
  const form: number[] = [];
  const stories: number[] = [];
  const plates: number[] = [];
  const homes: number[] = [];
  for (let i = 0; i < count; i++) {
    need(6, 'row');
    const n = view.getUint16(at, true);
    if (n > OPTIONS_MAX_PER_LOT) {
      throw new Error(`options: row ${i} has ${n} options, above ${OPTIONS_MAX_PER_LOT}`);
    }
    locationValue[i] = view.getFloat32(at + 2, true);
    at += 6;
    offset[i] = type.length;
    let prev = 0;
    for (let k = 0; k < n; k++) {
      need(5, 'option');
      const ty = bytes[at++];
      const fo = bytes[at++];
      const st = bytes[at++];
      if (ty >= BUILDING_TYPES.length || fo >= BUILDING_FORMS.length) {
        throw new Error(`options: row ${i} type or form code out of range`);
      }
      if (st < prev) throw new Error(`options: row ${i} stories out of order`);
      prev = st;
      type.push(ty);
      form.push(fo);
      stories.push(st);
      plates.push(bytes[at++]);
      let v = 0;
      let mul = 1;
      for (;;) {
        need(1, 'homes');
        const b = bytes[at++];
        v += (b & 0x7f) * mul;
        if (b < 0x80) break;
        mul *= 0x80;
        if (mul > 0x80 ** 2) throw new Error(`options: row ${i} homes varint too long`);
      }
      if (v > HOMES_MAX) throw new Error(`options: row ${i} homes ${v} above ${HOMES_MAX}`);
      homes.push(v);
    }
  }
  offset[count] = type.length;
  if (at !== bytes.length) throw new Error(`options: ${bytes.length - at} trailing bytes`);
  return {
    format: 'sfh-options/1',
    datasetVersion,
    count,
    offset,
    type: Uint8Array.from(type),
    form: Uint8Array.from(form),
    stories: Uint8Array.from(stories),
    plates: Uint8Array.from(plates),
    homes: Uint16Array.from(homes),
    locationValue
  };
}

/** Inflate a deflate-raw body (as `readGrossTable` does) and decode it. */
export async function readOptionTable(body: Uint8Array): Promise<OptionTable> {
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
  return decodeOptionPayload(bytes);
}

/** Why `t` does not belong to `p` (a different row count or build), or null. */
export function optionTableProblem(t: OptionTable, p: ScenarioParcels): string | null {
  if (t.count !== p.count) return `option table has ${t.count} rows, parcels.bin ${p.count}`;
  if (t.datasetVersion !== p.datasetVersion) {
    return `option table is for dataset ${t.datasetVersion}, parcels.bin for ${p.datasetVersion}`;
  }
  return null;
}
