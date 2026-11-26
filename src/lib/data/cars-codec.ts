// Wire format "sfh-cars/1": the car-ownership model's zones and start households
// (scenarios/fzp/cars.bin, raw-deflated on disk like policy.bin). Zones are Census block groups of
// the latest ACS vintage; `lotZone` is one entry per parcels.bin row. Pure TS and worker-safe; it
// sits on the shared column-file layout (column-file.ts). The pipeline writes it; the sim reads it.
import { CAR_LEVELS, type ZoneTerms } from '../sim/cars';
import { encodeColumnFile, openColumnFile, type ColType } from './column-file';

export const CARS_CODEC = 'sfh-cars/1';

export interface CarData extends ZoneTerms {
  zones: string[]; // block-group GEOIDs, latest vintage, sorted
  pumas: string[]; // PUMA codes of the same vintage, sorted
  zonePuma: Int32Array; // zones: index into pumas
  lotZone: Int32Array; // per parcels.bin row; -1 none
  areaM2: Float64Array; // zones: land area (TIGER ALAND)
  occupied: Float64Array; // zones: occupied share of homes (ACS B25002), held constant
  types: number;
  households: Int32Array; // zones x types x CAR_LEVELS, the start counts
}

export class CarFormatError extends Error {
  name = 'CarFormatError';
}
const fail = (msg: string): never => {
  throw new CarFormatError(msg);
};

const MAGIC = 'SFHC';
const MAJOR = 1;
/** Columns in file order; `per` is the length in zones, lots or households cells. */
const COLUMNS: { name: keyof CarData; type: ColType; per: 'zone' | 'zone3' | 'lot' | 'cell' }[] = [
  { name: 'zonePuma', type: 'i32', per: 'zone' },
  { name: 'areaM2', type: 'f64', per: 'zone' },
  { name: 'occupied', type: 'f64', per: 'zone' },
  { name: 'access', type: 'f64', per: 'zone' },
  { name: 'constant', type: 'f64', per: 'zone3' },
  { name: 'lotZone', type: 'i32', per: 'lot' },
  { name: 'households', type: 'i32', per: 'cell' }
];

const sortedUnique = (a: readonly string[]) => a.every((x, i) => i === 0 || a[i - 1] < x);

/** Lengths, indices and value ranges; shared by encode and decode. */
function check(d: CarData): void {
  const Z = d.zones.length;
  if (!sortedUnique(d.zones)) fail('zones is not sorted and unique');
  if (!sortedUnique(d.pumas)) fail('pumas is not sorted and unique');
  if (!Number.isInteger(d.types) || d.types < 1) fail(`types ${d.types} is not a positive integer`);
  const lens = { zone: Z, zone3: Z * 3, lot: d.lotZone.length, cell: Z * d.types * CAR_LEVELS };
  for (const c of COLUMNS) {
    const a = d[c.name] as ArrayLike<number>;
    if (a.length !== lens[c.per]) fail(`${c.name} has ${a.length} values, want ${lens[c.per]}`);
  }
  for (let z = 0; z < Z; z++) {
    if (!(d.zonePuma[z] >= 0 && d.zonePuma[z] < d.pumas.length))
      fail(`zonePuma[${z}] = ${d.zonePuma[z]} is outside 0..${d.pumas.length - 1}`);
    if (!(d.occupied[z] >= 0 && d.occupied[z] <= 1))
      fail(`occupied[${z}] = ${d.occupied[z]} is outside 0..1`);
    if (!(d.areaM2[z] >= 0)) fail(`areaM2[${z}] = ${d.areaM2[z]} is negative`);
  }
  for (let i = 0; i < d.lotZone.length; i++)
    if (!(d.lotZone[i] >= -1 && d.lotZone[i] < Z))
      fail(`lotZone[${i}] = ${d.lotZone[i]} is outside -1..${Z - 1}`);
  for (let i = 0; i < d.households.length; i++)
    if (!(d.households[i] >= 0)) fail(`households[${i}] = ${d.households[i]} is negative`);
}

export function encodeCarData(d: CarData): Uint8Array {
  check(d);
  const header = {
    format: CARS_CODEC,
    count: d.lotZone.length,
    zones: d.zones,
    pumas: d.pumas,
    types: d.types,
    carLevels: CAR_LEVELS
  };
  return encodeColumnFile(
    MAGIC,
    MAJOR,
    header,
    COLUMNS.map((c) => ({ name: c.name, type: c.type, values: d[c.name] as ArrayLike<number> })),
    fail
  );
}

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Decode a cars.bin payload (inflated) built for a parcels.bin of `parcelCount` rows. */
export function decodeCarData(bytes: Uint8Array, parcelCount: number): CarData {
  const file = openColumnFile(
    bytes,
    MAGIC,
    MAJOR,
    COLUMNS.map((c) => c.name),
    fail
  );
  const h = file.header;
  if (h.format !== CARS_CODEC) fail(`format ${String(h.format)} is not ${CARS_CODEC}`);
  if (h.carLevels !== CAR_LEVELS) fail(`carLevels ${String(h.carLevels)} is not ${CAR_LEVELS}`);
  if (!isStrings(h.zones) || !isStrings(h.pumas)) fail('zones or pumas is not a string list');
  const zones = h.zones as string[];
  const pumas = h.pumas as string[];
  const types = h.types;
  if (typeof types !== 'number' || !Number.isInteger(types) || types < 1)
    fail(`types ${String(types)} is not a positive integer`);
  if (h.count !== parcelCount) fail(`cars.bin has ${String(h.count)} lots, want ${parcelCount}`);
  const Z = zones.length;
  const T = types as number;
  const lens = { zone: Z, zone3: Z * 3, lot: parcelCount, cell: Z * T * CAR_LEVELS };
  const col = (name: keyof CarData) => {
    const c = COLUMNS.find((x) => x.name === name)!;
    return file.read(name, c.type, lens[c.per]);
  };
  const d: CarData = {
    zones,
    pumas,
    zonePuma: col('zonePuma') as Int32Array,
    lotZone: col('lotZone') as Int32Array,
    areaM2: col('areaM2') as Float64Array,
    occupied: col('occupied') as Float64Array,
    access: col('access') as Float64Array,
    constant: col('constant') as Float64Array,
    types: T,
    households: col('households') as Int32Array
  };
  check(d);
  return d;
}
