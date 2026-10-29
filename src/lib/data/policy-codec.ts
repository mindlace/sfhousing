// Wire format "sfh-policy/1": per-lot policy inputs for the /sim data layers, one row per parcel in
// parcels.bin order. Pure TS and worker-safe. The pipeline writes it; the worker reads it. It sits
// on the shared column-file layout (column-file.ts) and mirrors scenario-codec.ts, which it does
// not touch. The decoder is bound to the parcels.bin it was built for by count, datasetVersion,
// fillLevels and idsHash.
import type { Provenance } from '../timelapse/types';
import type { ScenarioParcels } from './scenario-codec';
import {
  encodeColumnFile,
  idsHash,
  inflateRawBody,
  openColumnFile,
  type ColType
} from './column-file';

export const POLICY_FORMAT = 'sfh-policy/1';
export const NULL_CAP = 0xffff;
export const HISTORIC_CODES = ['', 'A', 'A*', 'B', 'C'] as const; // '' = no status row
/** Ruling 4 (spec round 2): historic protection covers A and A*. */
export const HISTORIC_PROTECTED = ['A', 'A*'] as const;
export const TOD_BANDS = ['none', 'adjacent', 'quarter', 'half'] as const;
export const SB79_STATUSES = [
  'outside',
  'applies',
  'not-eligible',
  'zone',
  'rent-control',
  'min-units'
] as const;
export const S207_STATUSES = [
  'outside',
  'applies',
  'exempt',
  'not-residential',
  'no-limit',
  'r4',
  'historic',
  'meets-minimum',
  'not-eligible'
] as const;
export type Sb79Status = (typeof SB79_STATUSES)[number];
export type S207Status = (typeof S207_STATUSES)[number];

export interface PolicyParcels {
  format: 'sfh-policy/1';
  datasetVersion: string;
  count: number;
  idsHash: number;
  fillLevels: number[];
  currentLawRule: 'fzp+s207.11';
  tierSource: 'mtc' | 'gtfs';
  useDistricts: string[]; // sc_zoning codes ('' = none), sorted
  provenance: Record<'useDistrict' | 'historic' | 'exemptions' | 'sb79' | 'currentLaw', Provenance>;
  useDistrict: Uint16Array; // index into useDistricts
  historic: Uint8Array; // index into HISTORIC_CODES
  fzpYieldCap: Uint16Array; // the cap parcels.bin `yield` used; NULL_CAP = none
  todTier: Uint8Array; // 0 none, 1, 2: the tier of the standard used
  todBand: Uint8Array; // index into TOD_BANDS
  sb79Status: Uint8Array; // index into SB79_STATUSES
  sb79Stories: Uint8Array; // 0 unless 'applies'
  sb79Cap: Uint16Array; // statute du/ac × acres; NULL_CAP unless 'applies'
  sb79Yield: Uint16Array; // count × F, capped by sb79Cap; each 0 or ≥ MIN_UNITS
  s207Status: Uint8Array; // index into S207_STATUSES
  currentStories: Uint8Array;
  currentCap: Uint16Array; // NULL_CAP = no cap
  currentYield: Uint16Array; // count × F
  hostableSb79: Uint8Array; // flags bit 0
  hostableCurrent: Uint8Array; // flags bit 1
  currentFromS207: Uint8Array; // flags bit 2
  exemptPermanent: Uint8Array; // flags bit 3: Ord. 082-26 §3 table
  exemptTemporary: Uint8Array; // flags bit 4: Ord. 082-26 §4 table
  historicProtected: Uint8Array; // flags bit 5: historic ∈ HISTORIC_PROTECTED
}

export class PolicyFormatError extends Error {
  name = 'PolicyFormatError';
}
const fail = (msg: string): never => {
  throw new PolicyFormatError(msg);
};

const MAGIC = 'SFHP';
const MAJOR = 1;
const PROVENANCE_KEYS = ['useDistrict', 'historic', 'exemptions', 'sb79', 'currentLaw'] as const;
// flags bits 0-5 in order; bits 6-7 are reserved and must be 0.
const FLAG_ARRAYS = [
  'hostableSb79',
  'hostableCurrent',
  'currentFromS207',
  'exemptPermanent',
  'exemptTemporary',
  'historicProtected'
] as const;
const FLAGS_RESERVED = 0xff & ~((1 << FLAG_ARRAYS.length) - 1);
const HEADER_KEYS = [
  'format',
  'datasetVersion',
  'count',
  'idsHash',
  'fillLevels',
  'currentLawRule',
  'tierSource',
  'useDistricts',
  'historicCodes',
  'todBands',
  'sb79Statuses',
  's207Statuses',
  'provenance'
] as const;
/** Columns in file order. `perFill`: F values per row instead of one. */
const COLUMNS: { name: string; type: ColType; perFill?: true }[] = [
  { name: 'useDistrict', type: 'u16' },
  { name: 'historic', type: 'u8' },
  { name: 'fzpYieldCap', type: 'u16' },
  { name: 'todTier', type: 'u8' },
  { name: 'todBand', type: 'u8' },
  { name: 'sb79Status', type: 'u8' },
  { name: 'sb79Stories', type: 'u8' },
  { name: 'sb79Cap', type: 'u16' },
  { name: 's207Status', type: 'u8' },
  { name: 'flags', type: 'u8' },
  { name: 'currentStories', type: 'u8' },
  { name: 'currentCap', type: 'u16' },
  { name: 'sb79Yield', type: 'u16', perFill: true },
  { name: 'currentYield', type: 'u16', perFill: true }
];

// Confirmed against Task 1's zone list (pipeline/sb79-config.ts ZONE_CLASS_RULES): the live
// sc_zoning NC codes are NC-1, NC-2, NC-3, NC-S, NCT, NCT-1..3 and NCD. The two `.+ NCD/NCT`
// alternatives match named districts ("<name> NCD"); none appears in the live data, kept as
// harmless headroom.
const NC_PATTERN = /^(NC-[1-3S]|NCD|NCT(-[1-3])?|.+ NCD|.+ NCT)$/;
/** Ruling 5: NC/NCT and named neighborhood-commercial districts; a split code matches if any component does. */
export function isNeighborhoodCommercial(code: string): boolean {
  return code.split('|').some((c) => NC_PATTERN.test(c.trim()));
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const sameList = (a: unknown, b: readonly unknown[]) =>
  Array.isArray(a) && a.length === b.length && b.every((x, k) => a[k] === x);

/** Shared by encode and decode: lengths, 0/1 flags, dictionary indices, sorted districts, historicProtected. */
function checkColumns(p: PolicyParcels): void {
  const n = p.count;
  const F = p.fillLevels.length;
  const len = (name: string, a: ArrayLike<number>, want: number) => {
    if (a.length !== want) fail(`${name} has ${a.length} values, want ${want}`);
  };
  const index = (name: string, a: ArrayLike<number>, size: number) => {
    for (let i = 0; i < a.length; i++)
      if (a[i] >= size) fail(`${name}[${i}] = ${a[i]} is outside 0..${size - 1}`);
  };
  const single = [
    'useDistrict',
    'historic',
    'fzpYieldCap',
    'todTier',
    'todBand',
    'sb79Status',
    'sb79Stories',
    'sb79Cap',
    's207Status',
    'currentStories',
    'currentCap',
    ...FLAG_ARRAYS
  ] as const;
  for (const k of single) len(k, p[k], n);
  len('sb79Yield', p.sb79Yield, n * F);
  len('currentYield', p.currentYield, n * F);
  for (const k of FLAG_ARRAYS)
    for (let i = 0; i < n; i++) if (p[k][i] > 1) fail(`${k}[${i}] = ${p[k][i]} is not 0 or 1`);
  index('useDistrict', p.useDistrict, p.useDistricts.length);
  index('historic', p.historic, HISTORIC_CODES.length);
  index('todTier', p.todTier, 3);
  index('todBand', p.todBand, TOD_BANDS.length);
  index('sb79Status', p.sb79Status, SB79_STATUSES.length);
  index('s207Status', p.s207Status, S207_STATUSES.length);
  for (let i = 1; i < p.useDistricts.length; i++)
    if (!(p.useDistricts[i - 1] < p.useDistricts[i])) fail('useDistricts is not sorted and unique');
  const protectedCodes: readonly string[] = HISTORIC_PROTECTED;
  for (let i = 0; i < n; i++) {
    const want = protectedCodes.includes(HISTORIC_CODES[p.historic[i]]) ? 1 : 0;
    if (p.historicProtected[i] !== want)
      fail(`historicProtected[${i}] disagrees with historic ${HISTORIC_CODES[p.historic[i]]}`);
  }
}

export function encodePolicyPayload(p: PolicyParcels): Uint8Array {
  checkColumns(p);
  const n = p.count;
  const flags = new Uint8Array(n);
  for (let i = 0; i < n; i++) FLAG_ARRAYS.forEach((k, bit) => (flags[i] |= p[k][i] << bit));
  const header = {
    format: POLICY_FORMAT,
    datasetVersion: p.datasetVersion,
    count: n,
    idsHash: p.idsHash,
    fillLevels: p.fillLevels,
    currentLawRule: p.currentLawRule,
    tierSource: p.tierSource,
    useDistricts: p.useDistricts,
    historicCodes: HISTORIC_CODES,
    todBands: TOD_BANDS,
    sb79Statuses: SB79_STATUSES,
    s207Statuses: S207_STATUSES,
    provenance: Object.fromEntries(PROVENANCE_KEYS.map((k) => [k, p.provenance[k]]))
  };
  const values = { ...p, flags } as unknown as Record<string, ArrayLike<number>>;
  return encodeColumnFile(
    MAGIC,
    MAJOR,
    header,
    COLUMNS.map((c) => ({ name: c.name, type: c.type, values: values[c.name] })),
    fail
  );
} // deterministic

type Bound = Pick<ScenarioParcels, 'count' | 'id' | 'datasetVersion' | 'fillLevels'>;

export function decodePolicyPayload(bytes: Uint8Array, parcels: Bound): PolicyParcels {
  const file = openColumnFile(
    bytes,
    MAGIC,
    MAJOR,
    COLUMNS.map((c) => c.name),
    fail
  );
  const hd = file.header;
  for (const k of HEADER_KEYS) if (!Object.hasOwn(hd, k)) fail(`header missing key ${k}`);
  if (hd.format !== POLICY_FORMAT) fail(`unknown format ${String(hd.format)}`);
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
  if (!sameList(hd.fillLevels, parcels.fillLevels)) fail('fillLevels differ from parcels.bin');
  const F = parcels.fillLevels.length;
  if (hd.currentLawRule !== 'fzp+s207.11')
    fail(`unknown currentLawRule ${String(hd.currentLawRule)}`);
  if (hd.tierSource !== 'mtc' && hd.tierSource !== 'gtfs')
    fail(`unknown tierSource ${String(hd.tierSource)}`);
  const useDistricts = hd.useDistricts;
  if (!Array.isArray(useDistricts) || !useDistricts.every((d) => typeof d === 'string'))
    fail('useDistricts is not a string array');
  if (!sameList(hd.historicCodes, HISTORIC_CODES))
    fail('historicCodes differs from HISTORIC_CODES');
  if (!sameList(hd.todBands, TOD_BANDS)) fail('todBands differs from TOD_BANDS');
  if (!sameList(hd.sb79Statuses, SB79_STATUSES)) fail('sb79Statuses differs from SB79_STATUSES');
  if (!sameList(hd.s207Statuses, S207_STATUSES)) fail('s207Statuses differs from S207_STATUSES');
  const prov = hd.provenance;
  if (!isObj(prov)) fail('provenance is not an object');
  const provenance = {} as PolicyParcels['provenance'];
  for (const k of PROVENANCE_KEYS) {
    const v = (prov as Record<string, unknown>)[k];
    if (!isObj(v) || !isInt(v.tier) || v.tier > 4 || typeof v.label !== 'string')
      fail(`provenance.${k} is invalid`);
    provenance[k] = v as unknown as Provenance;
  }

  const u8 = (name: string) => file.read(name, 'u8', n) as Uint8Array;
  const u16 = (name: string, len = n) => file.read(name, 'u16', len) as Uint16Array;
  const flags = u8('flags');
  for (let i = 0; i < n; i++)
    if (flags[i] & FLAGS_RESERVED) fail(`flags[${i}] = ${flags[i]} sets a reserved bit`);
  const bit = (b: number) => Uint8Array.from(flags, (f) => (f >> b) & 1);
  const out: PolicyParcels = {
    format: POLICY_FORMAT,
    datasetVersion: hd.datasetVersion as string,
    count: n,
    idsHash: hd.idsHash as number,
    fillLevels: [...parcels.fillLevels],
    currentLawRule: 'fzp+s207.11',
    tierSource: hd.tierSource as 'mtc' | 'gtfs',
    useDistricts: useDistricts as string[],
    provenance,
    useDistrict: u16('useDistrict'),
    historic: u8('historic'),
    fzpYieldCap: u16('fzpYieldCap'),
    todTier: u8('todTier'),
    todBand: u8('todBand'),
    sb79Status: u8('sb79Status'),
    sb79Stories: u8('sb79Stories'),
    sb79Cap: u16('sb79Cap'),
    sb79Yield: u16('sb79Yield', n * F),
    s207Status: u8('s207Status'),
    currentStories: u8('currentStories'),
    currentCap: u16('currentCap'),
    currentYield: u16('currentYield', n * F),
    hostableSb79: bit(0),
    hostableCurrent: bit(1),
    currentFromS207: bit(2),
    exemptPermanent: bit(3),
    exemptTemporary: bit(4),
    historicProtected: bit(5)
  };
  checkColumns(out);
  return out;
}

/** Read a policy file body (raw-deflate bytes or a stream of them) for the given parcels.bin. */
export async function readPolicyParcels(
  body: ReadableStream<Uint8Array> | Uint8Array,
  parcels: Bound
): Promise<PolicyParcels> {
  let bytes: Uint8Array;
  try {
    bytes = await inflateRawBody(body);
  } catch (e) {
    return fail(`policy body is not valid deflate-raw: ${(e as Error).message}`);
  }
  return decodePolicyPayload(bytes, parcels);
}
