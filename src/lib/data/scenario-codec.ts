// Wire format "sfh-scenario/1" (scenario-data spec §4.8): `scenarios/fzp/parcels.bin`. Pure TS,
// worker-safe: its one value import is the generator's constants-only module. The pipeline writes
// it and the timelapse worker reads it. The declarations below the imports are step 0 and fixed,
// except what spec §2 authorises (RA1, IA-8): `existingFloorAreaM2`, `scenarioRecordFrom`,
// `scenarioRecordOf` and the mask comment; and, by the T11 option 1 ruling (scenario eligibility,
// T14 sd.landuse.none-with-units), the `eligible` flag (flags bit 5), which `scenarioRecordFrom`
// and `scenarioRecordOf` now also replace, and the flags comment.
import type { FeatureId, Provenance } from '../timelapse/types';
import type { ParcelId, ParcelRecord } from './parcel';
import type { Envelope } from '../plan/types';
// 3.1 m, the generator's floor-to-floor height (tier 3); constants only, so no generator code.
import { FTF_M } from '../generator/constants';

export const SCENARIO_FORMAT = 'sfh-scenario/1';
/** T4b fill levels; F = FILL_LEVELS.length = 5. stage-calibration imports this constant. */
export const FILL_LEVELS = [0.25, 0.5, 0.75, 0.9, 1] as const;
/** The T4b proposal rule, shared so the pipeline and the worker round identically. */
export const fillStories = (fill: number, maxStories: number) =>
  Math.max(1, Math.round(fill * maxStories));
export const LAND_USE_CLASSES = [
  'residential',
  'mixed',
  'commercial',
  'pdr',
  'vacant',
  'other'
] as const;
export type LandUseClass = (typeof LAND_USE_CLASSES)[number];

/** Decoded T11 (T5's `ScenarioParcels`). Struct of arrays; row i is one parcel; rows sorted by (cellId, id). */
export interface ScenarioParcels {
  format: 'sfh-scenario/1';
  datasetVersion: string;
  scenario: 'fzp';
  rollYear: number; // latest closed_roll_year the features come from
  count: number;
  fillLevels: number[];
  cells: { cellId: string; start: number; count: number }[];
  districts: string[]; // normalised height strings; '' = no district
  provenance: Record<
    'envelope' | 'localProgram' | 'features' | 'existingUnits' | 'yield',
    Provenance
  >;
  id: string[];
  index: Map<ParcelId, number>;
  labelPoint: Float64Array; // 2 per row, lng/lat, exact to 1e-7
  cell: Uint16Array; // index into cells
  district: Uint16Array; // index into districts
  envelopeStories: Uint8Array; // T11 envelope.maxStories (0 = no envelope)
  baseStories: Uint8Array;
  localProgram: Uint8Array; // 0/1
  hostable: Uint8Array; // 0/1: may receive a simulated project
  eligible: Uint8Array; // 0/1: scenario eligibility (flags bit 5); can differ from the chunk's eligible (sd.landuse.none-with-units)
  split: Uint8Array; // 0/1: largest district overlap < 90% of parcel area
  // T11/T13 mask (RA1 mask convention): a bit is set exactly when that field's value is not the
  // source's own value (imputed, replaced by a T14 rule, or carried). bit 0 yearBuilt,
  // 1 existingStories, 2 improvementShare, 3 existingUnits, 4 no roll row (implies bits 0-3 and 6),
  // 5 row carried from the previous roll year (interior gap), 6 existingFloorAreaM2 (chunk-record
  // fallback), 7 reserved (always 0).
  imputed: Uint8Array;
  baseCap: Uint16Array; // T11 base-zoning density cap in units; 0xFFFF = null (no cap)
  existingUnits: Uint16Array; // latest roll, post-T14
  existingFloorAreaM2: Uint32Array; // whole m²: the value the yields used (RA1, IA-8)
  existingStories: Uint8Array;
  lotAreaM2: Uint32Array;
  yearBuilt: Uint16Array;
  improvementShare: Float32Array;
  rentControlLikely: Uint8Array;
  landUseClass: Uint8Array; // index into LAND_USE_CLASSES
  hostableBase: Uint8Array; // 0/1: T11 hostable_base (eligible, baseStories ≥ 1, uncapped base yield at full fill > 0)
  baseYield: Uint16Array; // count × F: gross units at each fill level of the base envelope, density-capped
  yield: Uint16Array; // count × F, row-major: yield[i * F + k]
  potentialRatio: { fzp: Float32Array; base: Float32Array }; // derived at decode
  storiesGap: { fzp: Int16Array; base: Int16Array }; // derived at decode
}
// Payload layout (little-endian): "SFHS" | u16 major | u16 reserved | u32 headerLen H | header
// JSON (H bytes, zero-padded so the columns start on a multiple of 8) | columns. Column offsets
// in the header are absolute from the payload start, each a multiple of 8.
const MAGIC = [0x53, 0x46, 0x48, 0x53]; // "SFHS"
const MAJOR = 1;
const PRELUDE = 12;
const SHARE_SCALE = 200; // improvementShare u8 = round(share × 200): the tier-4 quantisation grid, spec §4.8 (AC 11)
const DEG_SCALE = 1e7; // label points as i32 degrees × 1e7, spec §4.8
const MAX_AFFIX = 255; // idPrefix and idSuffixLen are u8

type ColType = 'u8' | 'u16' | 'i32' | 'u32';
const SIZE: Record<ColType, number> = { u8: 1, u16: 2, i32: 4, u32: 4 };
const RANGE: Record<ColType, [number, number]> = {
  u8: [0, 0xff],
  u16: [0, 0xffff],
  i32: [-0x80000000, 0x7fffffff],
  u32: [0, 0xffffffff]
};
/** Columns in file order. `per`: values per row ('id' = the concatenated suffix bytes). */
const COLUMNS: { name: string; type: ColType; per: 1 | 'F' | 'id' }[] = [
  { name: 'idPrefix', type: 'u8', per: 1 },
  { name: 'idSuffixLen', type: 'u8', per: 1 },
  { name: 'idSuffix', type: 'u8', per: 'id' },
  { name: 'labelLng', type: 'i32', per: 1 },
  { name: 'labelLat', type: 'i32', per: 1 },
  { name: 'cell', type: 'u16', per: 1 },
  { name: 'district', type: 'u16', per: 1 },
  { name: 'envelopeStories', type: 'u8', per: 1 },
  { name: 'baseStories', type: 'u8', per: 1 },
  { name: 'flags', type: 'u8', per: 1 },
  { name: 'imputed', type: 'u8', per: 1 },
  { name: 'existingUnits', type: 'u16', per: 1 },
  { name: 'existingFloorAreaM2', type: 'u32', per: 1 },
  { name: 'existingStories', type: 'u8', per: 1 },
  { name: 'lotAreaM2', type: 'u32', per: 1 },
  { name: 'yearBuilt', type: 'u16', per: 1 },
  { name: 'improvementShare', type: 'u8', per: 1 },
  { name: 'landUseClass', type: 'u8', per: 1 },
  { name: 'baseCap', type: 'u16', per: 1 },
  { name: 'baseYield', type: 'u16', per: 'F' },
  { name: 'yield', type: 'u16', per: 'F' }
];
// flags bits, spec §4.8: bit 0 localProgram, 1 rentControlLikely, 2 hostable, 3 split,
// 4 hostableBase, 5 eligible. Bit 5 is the scenario eligibility, the value the yields and the
// hostable flags used: the chunk record's `eligible`, or, for a parcel with no land-use record
// (`landUse` 'NONE'), assessor units > 0 on the latest roll (T14 sd.landuse.none-with-units).
// Bits 6-7 are reserved (always 0).
const FLAG_BITS = [
  'localProgram',
  'rentControlLikely',
  'hostable',
  'split',
  'hostableBase',
  'eligible'
] as const;
/** Reserved bits, spec §4.8: `flags` bits 6-7 and `imputed` bit 7 must be 0. */
const FLAGS_RESERVED = 0xff & ~((1 << FLAG_BITS.length) - 1);
const IMPUTED_RESERVED = 0x80;
const PROVENANCE_KEYS = ['envelope', 'localProgram', 'features', 'existingUnits', 'yield'] as const;
const HEADER_KEYS = [
  'format',
  'datasetVersion',
  'scenario',
  'rollYear',
  'count',
  'fillLevels',
  'cells',
  'districts',
  'landUseClasses',
  'provenance',
  'columns'
] as const;

const align8 = (n: number) => Math.ceil(n / 8) * 8;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min;
function fail(message: string): never {
  throw new ScenarioFormatError(message);
}
function inRange(a: ArrayLike<number>, name: string, size: number): void {
  for (let i = 0; i < a.length; i++)
    if (a[i] >= size) fail(`${name}[${i}] = ${a[i]} is past its dictionary (${size})`);
}
function noReserved(a: ArrayLike<number>, name: string, reserved: number): void {
  for (let i = 0; i < a.length; i++)
    if (a[i] & reserved) fail(`${name}[${i}] = ${a[i]} sets reserved bits`);
}

function checkFillLevels(f: unknown): number[] {
  if (!Array.isArray(f) || f.length === 0 || !f.every((v) => typeof v === 'number'))
    fail('fillLevels is not a non-empty number array');
  const levels = f as number[];
  for (let k = 1; k < levels.length; k++)
    if (!(levels[k] > levels[k - 1])) fail(`fillLevels not ascending at ${k}`);
  if (levels[levels.length - 1] !== 1) fail('fillLevels does not end at 1');
  return levels;
}

function put(
  dv: DataView,
  name: string,
  type: ColType,
  offset: number,
  values: ArrayLike<number>
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

function get(dv: DataView, type: ColType, offset: number, i: number): number {
  const at = offset + i * SIZE[type];
  if (type === 'u8') return dv.getUint8(at);
  if (type === 'u16') return dv.getUint16(at, true);
  if (type === 'i32') return dv.getInt32(at, true);
  return dv.getUint32(at, true);
}

export function encodeScenarioPayload(p: ScenarioParcels): Uint8Array {
  const n = p.count;
  if (!isInt(n)) fail(`count ${n} is not a non-negative integer`);
  const fillLevels = checkFillLevels(p.fillLevels);
  const F = fillLevels.length;
  if (p.id.length !== n) fail(`id has ${p.id.length} entries, want ${n}`);
  inRange(p.cell, 'cell', p.cells.length);
  inRange(p.district, 'district', p.districts.length);
  inRange(p.landUseClass, 'landUseClass', LAND_USE_CLASSES.length);
  // The decoder rejects a set reserved bit, so the encoder never writes one.
  noReserved(p.imputed, 'imputed', IMPUTED_RESERVED);
  // Columns derived below (flags, improvementShare) must match N too.
  for (const k of ['improvementShare', ...FLAG_BITS] as const)
    if (p[k].length !== n) fail(`${k} has ${p[k].length} values, want ${n}`);
  if (p.labelPoint.length !== 2 * n)
    fail(`labelPoint has ${p.labelPoint.length} values, want ${2 * n}`);

  // Front-code ids against the previous row in file order.
  const idPrefix = new Uint8Array(n);
  const idSuffixLen = new Uint8Array(n);
  const suffix: number[] = [];
  let prev = '';
  for (let i = 0; i < n; i++) {
    const id = p.id[i];
    for (let c = 0; c < id.length; c++)
      if (id.charCodeAt(c) > 0x7f) fail(`id ${i} (${id}) is not ASCII`);
    let shared = 0;
    const most = Math.min(prev.length, id.length, MAX_AFFIX);
    while (shared < most && prev.charCodeAt(shared) === id.charCodeAt(shared)) shared++;
    if (id.length - shared > MAX_AFFIX)
      fail(`id ${i} suffix is ${id.length - shared} bytes, over ${MAX_AFFIX}`);
    idPrefix[i] = shared;
    idSuffixLen[i] = id.length - shared;
    for (let c = shared; c < id.length; c++) suffix.push(id.charCodeAt(c));
    prev = id;
  }

  const lng = new Array<number>(n);
  const lat = new Array<number>(n);
  const flags = new Array<number>(n);
  const share = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    lng[i] = Math.round(p.labelPoint[2 * i] * DEG_SCALE);
    lat[i] = Math.round(p.labelPoint[2 * i + 1] * DEG_SCALE);
    share[i] = Math.round(p.improvementShare[i] * SHARE_SCALE);
    let bits = 0;
    FLAG_BITS.forEach((key, b) => {
      const v = p[key][i];
      if (v !== 0 && v !== 1) fail(`${key}[${i}] = ${v} is not 0/1`);
      bits |= v << b;
    });
    flags[i] = bits;
  }
  const values: Record<string, ArrayLike<number>> = {
    idPrefix,
    idSuffixLen,
    idSuffix: suffix,
    labelLng: lng,
    labelLat: lat,
    cell: p.cell,
    district: p.district,
    envelopeStories: p.envelopeStories,
    baseStories: p.baseStories,
    flags,
    imputed: p.imputed,
    existingUnits: p.existingUnits,
    existingFloorAreaM2: p.existingFloorAreaM2,
    existingStories: p.existingStories,
    lotAreaM2: p.lotAreaM2,
    yearBuilt: p.yearBuilt,
    improvementShare: share,
    landUseClass: p.landUseClass,
    baseCap: p.baseCap,
    baseYield: p.baseYield,
    yield: p.yield
  };

  // Lay the columns out relative to the column section, then find the section start: the
  // header holds absolute offsets, so its length depends on them. The start only grows with
  // the header, so the loop reaches a fixed point within a few passes.
  const rel: number[] = [];
  let end = 0;
  for (const c of COLUMNS) {
    const want = c.per === 'id' ? suffix.length : c.per === 'F' ? n * F : n;
    if (values[c.name].length !== want)
      fail(`${c.name} has ${values[c.name].length} values, want ${want}`);
    end = align8(end);
    rel.push(end);
    end += want * SIZE[c.type];
  }
  const headerFor = (start: number) =>
    new TextEncoder().encode(
      JSON.stringify({
        format: SCENARIO_FORMAT,
        datasetVersion: p.datasetVersion,
        scenario: p.scenario,
        rollYear: p.rollYear,
        count: n,
        fillLevels,
        cells: p.cells.map((c) => ({ cellId: c.cellId, start: c.start, count: c.count })),
        districts: p.districts,
        landUseClasses: LAND_USE_CLASSES,
        provenance: Object.fromEntries(PROVENANCE_KEYS.map((k) => [k, p.provenance[k]])),
        columns: COLUMNS.map((c, k) => ({
          name: c.name,
          type: c.type,
          offset: start + rel[k],
          byteLength: values[c.name].length * SIZE[c.type]
        }))
      })
    );
  let start = align8(PRELUDE);
  let header = headerFor(start);
  while (align8(PRELUDE + header.length) !== start) {
    start = align8(PRELUDE + header.length);
    header = headerFor(start);
  }

  const out = new Uint8Array(start + end);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint16(4, MAJOR, true);
  dv.setUint16(6, 0, true);
  dv.setUint32(8, header.length, true);
  out.set(header, PRELUDE);
  COLUMNS.forEach((c, k) => put(dv, c.name, c.type, start + rel[k], values[c.name]));
  return out;
} // deterministic

export function decodeScenarioPayload(bytes: Uint8Array): ScenarioParcels {
  if (bytes.length < PRELUDE) fail(`payload is ${bytes.length} bytes, shorter than the prelude`);
  if (MAGIC.some((m, k) => bytes[k] !== m)) fail('bad magic: not an sfh-scenario payload');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = dv.getUint16(4, true);
  if (major !== MAJOR) fail(`unsupported major version ${major}`);
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
  const hd = h as Record<string, unknown>;
  for (const k of HEADER_KEYS) if (!Object.hasOwn(hd, k)) fail(`header missing key ${k}`);
  if (hd.format !== SCENARIO_FORMAT) fail(`unknown format ${String(hd.format)}`);
  if (typeof hd.datasetVersion !== 'string') fail('datasetVersion is not a string');
  if (hd.scenario !== 'fzp') fail(`unknown scenario ${String(hd.scenario)}`);
  if (!isInt(hd.rollYear)) fail('rollYear is not an integer');
  if (!isInt(hd.count)) fail('count is not a non-negative integer');
  const n = hd.count as number;
  const fillLevels = checkFillLevels(hd.fillLevels);
  const F = fillLevels.length;

  if (!Array.isArray(hd.cells)) fail('cells is not an array');
  let next = 0;
  const cells = (hd.cells as unknown[]).map((c, k) => {
    if (!isObj(c) || typeof c.cellId !== 'string' || !isInt(c.start) || !isInt(c.count))
      fail(`cells.${k} is invalid`);
    const cell = c as { cellId: string; start: number; count: number };
    if (cell.start !== next) fail(`cells.${k} starts at ${cell.start}, want ${next}`);
    next += cell.count;
    return { cellId: cell.cellId, start: cell.start, count: cell.count };
  });
  if (next !== n) fail(`cells cover ${next} rows, want ${n}`);
  const districts = hd.districts;
  if (!Array.isArray(districts) || !districts.every((d) => typeof d === 'string'))
    fail('districts is not a string array');
  const luc = hd.landUseClasses;
  if (
    !Array.isArray(luc) ||
    luc.length !== LAND_USE_CLASSES.length ||
    LAND_USE_CLASSES.some((c, k) => luc[k] !== c)
  )
    fail('landUseClasses differs from LAND_USE_CLASSES');
  const prov = hd.provenance;
  if (!isObj(prov)) fail('provenance is not an object');
  const provenance = {} as ScenarioParcels['provenance'];
  for (const k of PROVENANCE_KEYS) {
    const v = (prov as Record<string, unknown>)[k];
    if (!isObj(v) || !isInt(v.tier) || v.tier > 4 || typeof v.label !== 'string')
      fail(`provenance.${k} is invalid`);
    provenance[k] = v as unknown as Provenance;
  }

  // Columns: each named once, with the stated type, 8-aligned, inside the payload, full length.
  if (!Array.isArray(hd.columns)) fail('columns is not an array');
  const byName = new Map<string, { type: unknown; offset: number; byteLength: number }>();
  for (const [k, c] of (hd.columns as unknown[]).entries()) {
    if (!isObj(c) || typeof c.name !== 'string' || !isInt(c.offset) || !isInt(c.byteLength))
      fail(`columns.${k} is invalid`);
    if (byName.has(c.name)) fail(`column ${c.name} is listed twice`);
    byName.set(c.name, { type: c.type, offset: c.offset, byteLength: c.byteLength });
  }
  // Columns sit in file order after the header, without overlap.
  let free = align8(PRELUDE + H);
  const col: Record<string, number> = {};
  for (const c of COLUMNS) {
    const spec = byName.get(c.name);
    if (!spec) fail(`column ${c.name} is missing`);
    const { type, offset, byteLength } = spec;
    if (type !== c.type) fail(`column ${c.name} has type ${String(type)}, want ${c.type}`);
    if (offset % 8 !== 0 || offset < free)
      fail(`column ${c.name} offset ${offset} is not 8-aligned past the previous column`);
    if (offset + byteLength > bytes.length) fail(`column ${c.name} runs past the payload`);
    let want: number;
    if (c.per === 'id') {
      want = 0;
      for (let i = 0; i < n; i++) want += get(dv, 'u8', col.idSuffixLen, i);
    } else want = (c.per === 'F' ? n * F : n) * SIZE[c.type];
    if (byteLength !== want) fail(`column ${c.name} is ${byteLength} bytes, want ${want}`);
    col[c.name] = offset;
    free = offset + byteLength;
  }
  const read = <T extends { [k: number]: number }>(
    make: new (len: number) => T,
    name: string,
    len = n
  ): T => {
    const type = COLUMNS.find((c) => c.name === name)!.type;
    const a = new make(len);
    for (let i = 0; i < len; i++) a[i] = get(dv, type, col[name], i);
    return a;
  };

  const id = new Array<string>(n);
  let prev = '';
  let at = col.idSuffix;
  for (let i = 0; i < n; i++) {
    const pre = get(dv, 'u8', col.idPrefix, i);
    const len = get(dv, 'u8', col.idSuffixLen, i);
    if (pre > prev.length) fail(`idPrefix[${i}] = ${pre} is longer than the previous id`);
    let s = prev.slice(0, pre);
    for (let c = 0; c < len; c++) {
      const b = bytes[at++];
      if (b > 0x7f) fail(`idSuffix byte for row ${i} is not ASCII`);
      s += String.fromCharCode(b);
    }
    id[i] = s;
    prev = s;
  }
  const index = new Map(id.map((v, i) => [v, i]));
  if (index.size !== n) fail('duplicate parcel id');

  const labelPoint = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    labelPoint[2 * i] = get(dv, 'i32', col.labelLng, i) / DEG_SCALE;
    labelPoint[2 * i + 1] = get(dv, 'i32', col.labelLat, i) / DEG_SCALE;
  }
  const cell = read(Uint16Array, 'cell');
  inRange(cell, 'cell', cells.length);
  for (let i = 0; i < n; i++) {
    const c = cells[cell[i]];
    if (i < c.start || i >= c.start + c.count) fail(`row ${i} lies outside cell ${c.cellId}`);
  }
  const district = read(Uint16Array, 'district');
  inRange(district, 'district', (districts as string[]).length);
  const landUseClass = read(Uint8Array, 'landUseClass');
  inRange(landUseClass, 'landUseClass', LAND_USE_CLASSES.length);

  const flags = read(Uint8Array, 'flags');
  noReserved(flags, 'flags', FLAGS_RESERVED);
  const imputed = read(Uint8Array, 'imputed');
  noReserved(imputed, 'imputed', IMPUTED_RESERVED);
  const flag = (b: number) => flags.map((v) => (v >> b) & 1);
  const shareRaw = read(Uint8Array, 'improvementShare');
  const improvementShare = new Float32Array(n);
  for (let i = 0; i < n; i++) improvementShare[i] = shareRaw[i] / SHARE_SCALE;

  const envelopeStories = read(Uint8Array, 'envelopeStories');
  const baseStories = read(Uint8Array, 'baseStories');
  const existingUnits = read(Uint16Array, 'existingUnits');
  const existingStories = read(Uint8Array, 'existingStories');
  const baseYield = read(Uint16Array, 'baseYield', n * F);
  const yieldCol = read(Uint16Array, 'yield', n * F);
  const ratio = (y: Uint16Array) => {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = y[i * F + F - 1] / Math.max(existingUnits[i], 1);
    return a;
  };
  const gap = (s: Uint8Array) => {
    const a = new Int16Array(n);
    for (let i = 0; i < n; i++) a[i] = s[i] - existingStories[i];
    return a;
  };

  return {
    format: SCENARIO_FORMAT,
    datasetVersion: hd.datasetVersion as string,
    scenario: 'fzp',
    rollYear: hd.rollYear as number,
    count: n,
    fillLevels,
    cells,
    districts: districts as string[],
    provenance,
    id,
    index,
    labelPoint,
    cell,
    district,
    envelopeStories,
    baseStories,
    localProgram: flag(0),
    hostable: flag(2),
    eligible: flag(5),
    split: flag(3),
    imputed,
    baseCap: read(Uint16Array, 'baseCap'),
    existingUnits,
    existingFloorAreaM2: read(Uint32Array, 'existingFloorAreaM2'),
    existingStories,
    lotAreaM2: read(Uint32Array, 'lotAreaM2'),
    yearBuilt: read(Uint16Array, 'yearBuilt'),
    improvementShare,
    rentControlLikely: flag(1),
    landUseClass,
    hostableBase: flag(4),
    baseYield,
    yield: yieldCol,
    potentialRatio: { fzp: ratio(yieldCol), base: ratio(baseYield) },
    storiesGap: { fzp: gap(envelopeStories), base: gap(baseStories) }
  };
} // sync; throws ScenarioFormatError

export async function readScenarioParcels(
  body: ReadableStream<Uint8Array> | Uint8Array
): Promise<ScenarioParcels> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    const source =
      body instanceof Uint8Array
        ? new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(body);
              c.close();
            }
          })
        : body;
    // The DOM lib types the writable side as BufferSource (ArrayBuffer-backed views only),
    // which a Uint8Array over ArrayBufferLike does not satisfy. The bytes are the same.
    const inflate = new DecompressionStream('deflate-raw') as unknown as TransformStream<
      Uint8Array,
      Uint8Array
    >;
    const reader = source.pipeThrough(inflate).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
  } catch (e) {
    throw new ScenarioFormatError(`inflate failed: ${(e as Error).message}`);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return decodeScenarioPayload(bytes);
} // inflate + decode

export function featureValue(
  p: ScenarioParcels,
  i: number,
  f: FeatureId,
  env: 'fzp' | 'base'
): number {
  switch (f) {
    case 'potentialRatio':
      return p.potentialRatio[env][i];
    case 'storiesGap':
      return p.storiesGap[env][i];
    case 'existingUnits':
    case 'lotAreaM2':
    case 'yearBuilt':
    case 'improvementShare':
    case 'rentControlLikely':
    case 'landUseClass':
      return p[f][i];
    default:
      return fail(`unknown feature ${String(f satisfies never)}`);
  }
}

export function envelopeOf(p: ScenarioParcels, i: number): Envelope {
  return { maxStories: p.envelopeStories[i] };
} // { maxStories: envelopeStories[i] }

/** The scenario view of a chunk record (§4.5): units, floor area, height and eligible replaced. Pure. */
export function scenarioRecordFrom(
  rec: ParcelRecord,
  v: {
    existingUnits: number;
    existingFloorAreaM2: number;
    existingStories: number;
    eligible: boolean;
  }
): ParcelRecord {
  return {
    ...rec,
    existingUnits: v.existingUnits,
    existingFloorAreaM2: v.existingFloorAreaM2,
    existingHeightM: v.existingStories * FTF_M,
    eligible: v.eligible
  };
} // { ...rec, existingUnits, existingFloorAreaM2, existingHeightM: existingStories × FTF_M, eligible }

/** T11: scenarioRecordFrom(rec, row i of p). Worker-safe. Throws RangeError if p.id[i] !== rec.id. */
export function scenarioRecordOf(p: ScenarioParcels, i: number, rec: ParcelRecord): ParcelRecord {
  if (p.id[i] !== rec.id) {
    throw new RangeError(`scenarioRecordOf: row ${i} is ${String(p.id[i])}, not ${rec.id}`);
  }
  return scenarioRecordFrom(rec, {
    existingUnits: p.existingUnits[i],
    existingFloorAreaM2: p.existingFloorAreaM2[i],
    existingStories: p.existingStories[i],
    eligible: p.eligible[i] === 1
  });
}

export class ScenarioFormatError extends Error {
  name = 'ScenarioFormatError';
}
