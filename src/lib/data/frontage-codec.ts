// Wire format "sfh-frontage/1": which street segments each lot fronts, one row per parcel in
// parcels.bin order. Pure TS and worker-safe. The pipeline writes it; the street brush reads it
// through `frontingRows`. It sits on the shared column-file layout (column-file.ts) and mirrors
// policy-codec.ts. The decoder is bound to the parcels.bin it was built for by datasetVersion,
// count and idsHash.
import type { Provenance } from '../timelapse/types';
import type { ScenarioParcels } from './scenario-codec';
import {
  encodeColumnFile,
  idsHash,
  inflateRawBody,
  openColumnFile,
  type ColType
} from './column-file';

export const FRONTAGE_FORMAT = 'sfh-frontage/1';
/** Index = DataSF 3psu-pn9h classcode. */
export const STREET_CLASSES = [
  'other',
  'freeway',
  'major',
  'arterial',
  'collector',
  'residential',
  'ramp'
] as const;

export interface Frontage {
  format: 'sfh-frontage/1';
  datasetVersion: string;
  count: number;
  idsHash: number;
  provenance: Provenance;
  names: string[]; // streetname dictionary, sorted
  segCnn: Uint32Array; // per segment, strictly ascending
  segName: Uint16Array;
  segClass: Uint8Array; // index into STREET_CLASSES
  rowStart: Uint32Array; // count + 1 offsets (derived from frontCount)
  frontSeg: Uint16Array; // per entry
  frontDepth: Uint8Array; // per entry: 0 fronting, 1 one lot deep
}

export class FrontageFormatError extends Error {
  name = 'FrontageFormatError';
}
const fail = (msg: string): never => {
  throw new FrontageFormatError(msg);
};

const MAGIC = 'SFHF';
const MAJOR = 1;
const HEADER_KEYS = [
  'format',
  'datasetVersion',
  'count',
  'idsHash',
  'segCount',
  'names',
  'streetClasses',
  'provenance'
] as const;
const COLUMNS: { name: string; type: ColType }[] = [
  { name: 'segCnn', type: 'u32' },
  { name: 'segName', type: 'u16' },
  { name: 'segClass', type: 'u8' },
  { name: 'frontCount', type: 'u8' },
  { name: 'frontSeg', type: 'u16' },
  { name: 'frontDepth', type: 'u8' }
];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const sameList = (a: unknown, b: readonly unknown[]) =>
  Array.isArray(a) && a.length === b.length && b.every((x, k) => a[k] === x);

/** Shared by encode and decode: lengths, indices, order, and the per-row entry rules. */
function checkColumns(f: Frontage): void {
  const n = f.count;
  const S = f.segCnn.length;
  const len = (name: string, a: ArrayLike<number>, want: number) => {
    if (a.length !== want) fail(`${name} has ${a.length} values, want ${want}`);
  };
  len('segName', f.segName, S);
  len('segClass', f.segClass, S);
  len('rowStart', f.rowStart, n + 1);
  len('frontDepth', f.frontDepth, f.frontSeg.length);
  for (let i = 0; i < S; i++) {
    if (f.segName[i] >= f.names.length)
      fail(`segName[${i}] = ${f.segName[i]} is outside 0..${f.names.length - 1}`);
    if (f.segClass[i] >= STREET_CLASSES.length)
      fail(`segClass[${i}] = ${f.segClass[i]} is outside 0..${STREET_CLASSES.length - 1}`);
    if (i > 0 && !(f.segCnn[i - 1] < f.segCnn[i])) fail(`segCnn[${i}] is not ascending`);
  }
  for (let i = 1; i < f.names.length; i++)
    if (!(f.names[i - 1] < f.names[i])) fail('names is not sorted and unique');
  if (f.rowStart[0] !== 0) fail('rowStart[0] is not 0');
  if (f.rowStart[n] !== f.frontSeg.length)
    fail(`entry total ${f.frontSeg.length} is not the sum of frontCount ${f.rowStart[n]}`);
  for (let i = 0; i < n; i++) {
    const a = f.rowStart[i];
    const b = f.rowStart[i + 1];
    if (b < a) fail(`rowStart[${i + 1}] is below rowStart[${i}]`);
    if (b - a > 0xff) fail(`row ${i} has ${b - a} entries, more than 255`);
    for (let e = a; e < b; e++) {
      if (f.frontSeg[e] >= S) fail(`frontSeg[${e}] = ${f.frontSeg[e]} is outside 0..${S - 1}`);
      if (f.frontDepth[e] > 1) fail(`frontDepth[${e}] = ${f.frontDepth[e]} is not 0 or 1`);
      if (e > a) {
        const d = f.frontDepth[e] - f.frontDepth[e - 1] || f.frontSeg[e] - f.frontSeg[e - 1];
        if (d <= 0) fail(`row ${i} entries are not sorted by (depth, seg) and unique`);
      }
    }
    // Sorted by (depth, seg): a segment at both depths is a depth-1 entry repeating a depth-0 one.
    const seen = new Set<number>();
    for (let e = a; e < b && f.frontDepth[e] === 0; e++) seen.add(f.frontSeg[e]);
    for (let e = a; e < b; e++)
      if (f.frontDepth[e] === 1 && seen.has(f.frontSeg[e]))
        fail(`row ${i} has segment ${f.frontSeg[e]} at both depths`);
  }
}

export function encodeFrontagePayload(f: Frontage): Uint8Array {
  checkColumns(f);
  const n = f.count;
  const frontCount = new Uint8Array(n);
  for (let i = 0; i < n; i++) frontCount[i] = f.rowStart[i + 1] - f.rowStart[i];
  const header = {
    format: FRONTAGE_FORMAT,
    datasetVersion: f.datasetVersion,
    count: n,
    idsHash: f.idsHash,
    segCount: f.segCnn.length,
    names: f.names,
    streetClasses: STREET_CLASSES,
    provenance: f.provenance
  };
  const values = { ...f, frontCount } as unknown as Record<string, ArrayLike<number>>;
  return encodeColumnFile(
    MAGIC,
    MAJOR,
    header,
    COLUMNS.map((c) => ({ name: c.name, type: c.type, values: values[c.name] })),
    fail
  );
} // deterministic

type Bound = Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion'>;

export function decodeFrontagePayload(bytes: Uint8Array, parcels: Bound): Frontage {
  const file = openColumnFile(
    bytes,
    MAGIC,
    MAJOR,
    COLUMNS.map((c) => c.name),
    fail
  );
  const hd = file.header;
  for (const k of HEADER_KEYS) if (!Object.hasOwn(hd, k)) fail(`header missing key ${k}`);
  if (hd.format !== FRONTAGE_FORMAT) fail(`unknown format ${String(hd.format)}`);
  if (hd.datasetVersion !== parcels.datasetVersion)
    fail(
      `datasetVersion ${String(hd.datasetVersion)} is not parcels.bin's ${parcels.datasetVersion}`
    );
  if (!isInt(hd.count)) fail('count is not a non-negative integer');
  const n = hd.count as number;
  if (n !== parcels.count || parcels.id.length !== parcels.count)
    fail(`count ${n} is not parcels.bin's ${parcels.count}`);
  if (!isInt(hd.idsHash)) fail('idsHash is not an integer');
  if (hd.idsHash !== idsHash(parcels.id)) fail('idsHash differs: built for another parcels.bin');
  if (!isInt(hd.segCount)) fail('segCount is not a non-negative integer');
  const S = hd.segCount as number;
  const names = hd.names;
  if (!Array.isArray(names) || !names.every((d) => typeof d === 'string'))
    fail('names is not a string array');
  if (!sameList(hd.streetClasses, STREET_CLASSES))
    fail('streetClasses differs from STREET_CLASSES');
  const prov = hd.provenance;
  if (!isObj(prov) || !isInt(prov.tier) || prov.tier > 4 || typeof prov.label !== 'string')
    fail('provenance is invalid');

  const frontCount = file.read('frontCount', 'u8', n) as Uint8Array;
  const rowStart = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) rowStart[i + 1] = rowStart[i] + frontCount[i];
  const E = rowStart[n];
  const out: Frontage = {
    format: FRONTAGE_FORMAT,
    datasetVersion: hd.datasetVersion as string,
    count: n,
    idsHash: hd.idsHash as number,
    provenance: prov as unknown as Provenance,
    names: names as string[],
    segCnn: file.read('segCnn', 'u32', S) as Uint32Array,
    segName: file.read('segName', 'u16', S) as Uint16Array,
    segClass: file.read('segClass', 'u8', S) as Uint8Array,
    rowStart,
    frontSeg: file.read('frontSeg', 'u16', E) as Uint16Array,
    frontDepth: file.read('frontDepth', 'u8', E) as Uint8Array
  };
  checkColumns(out);
  return out;
}

/** Read a frontage file body (raw-deflate bytes or a stream of them) for the given parcels.bin. */
export async function readFrontage(
  body: ReadableStream<Uint8Array> | Uint8Array,
  parcels: Bound
): Promise<Frontage> {
  let bytes: Uint8Array;
  try {
    bytes = await inflateRawBody(body);
  } catch (e) {
    return fail(`frontage body is not valid deflate-raw: ${(e as Error).message}`);
  }
  return decodeFrontagePayload(bytes, parcels);
}

/** Rows (ascending, unique) with an entry on a segment where `seg(s)` holds, at depth ≤ maxDepth. */
export function frontingRows(f: Frontage, seg: (s: number) => boolean, maxDepth: 0 | 1): number[] {
  const rows: number[] = [];
  for (let i = 0; i < f.count; i++)
    for (let e = f.rowStart[i]; e < f.rowStart[i + 1]; e++)
      if (f.frontDepth[e] <= maxDepth && seg(f.frontSeg[e])) {
        rows.push(i);
        break;
      }
  return rows;
}
