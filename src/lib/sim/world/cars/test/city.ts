// Test support: hand-built car data and models on any city's lots (the mini, bench and live
// cities). Invented numbers, shaped like the pipeline's. Browser-safe.
import type { CarData } from '$lib/data/cars-codec';
import {
  CAR_LEVELS,
  splitSystematic,
  typeCount,
  type CarModel,
  type TypeBands
} from '$lib/sim/cars';
import type { SimInput } from '$lib/sim/scenario/types';

const prov = { tier: 4 as const, label: 'Test car model', sources: [], method: 'invented' };

export const SMALL_BANDS: TypeBands = { size: [1, 2], workers: [0, 1], income: [0] };
/** The live build's starting bands: 4 sizes x 3 worker counts x 4 incomes x 2 tenures = 96. */
export const LIVE_BANDS: TypeBands = {
  size: [1, 2, 3, 4],
  workers: [0, 1, 2],
  income: [0, 30_000, 75_000, 150_000]
};

export interface CarCityOpts {
  zones?: number;
  bands?: TypeBands;
  /** Every zone's occupied share; default 0.92 to 0.96 by zone. */
  occupied?: number;
  /** Every `noZoneEvery`th lot is in no zone (lotZone -1); default none. */
  noZoneEvery?: number;
  /** Monthly move rate of owners; renters move three times as often. Default 0.006. */
  perMonth?: number;
  refreshMonths?: number;
}

const norm = (w: number[]) => {
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
};

/** A test model over `bands`: varied household utilities, density and access terms. */
export function carModelOf(o: CarCityOpts = {}): CarModel {
  const bands = o.bands ?? SMALL_BANDS;
  const T = typeCount(bands);
  const owner = o.perMonth ?? 0.006;
  const mix = (a: number) => norm(Array.from({ length: T }, (_, t) => 1 + ((t * a) % 5)));
  return {
    schema: 1,
    bands,
    choice: {
      asc: [0.6, -0.4, -1.9],
      household: Array.from({ length: T * 3 }, (_, i) => 0.05 * ((i * 5) % 9) - 0.2),
      location: { density: [-0.004, -0.008, -0.012], access: [-0.05, -0.1, -0.15] },
      terms: [],
      provenance: prov
    },
    threePlusMean: 3.2,
    moves: {
      perMonth: Array.from({ length: T }, (_, t) => (t % 2 === 0 ? owner : 3 * owner)),
      inRatio: [mix(3).map((x) => x * T), mix(7).map((x) => x * T)],
      provenance: prov
    },
    newHomes: {
      mix: { market: mix(2), veryLow: mix(3), low: mix(4), moderate: mix(6) },
      affordableTiers: { veryLow: 0.35, low: 0.4, moderate: 0.25 },
      provenance: prov
    },
    parking: { supplyOverUse: 1.4, costPerSpace: null, dollarsYear: null, provenance: [] },
    refreshMonths: o.refreshMonths ?? 12
  };
}

/** Car data on `input`'s lots: `zones` contiguous runs of lots, households = occupied x homes. */
export function carDataOf(input: SimInput, o: CarCityOpts = {}): CarData {
  const bands = o.bands ?? SMALL_BANDS;
  const T = typeCount(bands);
  const L = CAR_LEVELS;
  const Z = o.zones ?? 4;
  const N = input.parcels.id.length;
  const every = o.noZoneEvery ?? 0;
  const lotZone = new Int32Array(N);
  const homes = new Float64Array(Z);
  for (let lot = 0; lot < N; lot++) {
    const z = every > 0 && lot % every === every - 1 ? -1 : Math.floor((lot * Z) / N);
    lotZone[lot] = z;
    if (z >= 0) homes[z] += input.parcels.existingUnits[lot];
  }
  const occupied = new Float64Array(Z);
  const households = new Int32Array(Z * T * L);
  const weights = new Float64Array(T * L);
  const out = new Int32Array(T * L);
  for (let z = 0; z < Z; z++) {
    occupied[z] = o.occupied ?? 0.92 + 0.02 * (z % 3);
    for (let i = 0; i < T * L; i++) weights[i] = 1 + ((i * 7 + z * 3) % 5) + (i % L === 0 ? 2 : 0);
    splitSystematic(Math.round(occupied[z] * homes[z]), weights, 0.5, out);
    households.set(out, z * T * L);
  }
  const zones = Array.from({ length: Z }, (_, z) => `0607599${String(z).padStart(5, '0')}`);
  return {
    zones,
    pumas: ['07507', '07508'],
    zonePuma: Int32Array.from({ length: Z }, (_, z) => z % 2),
    lotZone,
    areaM2: Float64Array.from({ length: Z }, (_, z) => 40_000 + 10_000 * (z % 5)),
    occupied,
    access: Float64Array.from({ length: Z }, (_, z) => 1 + (z % 4)),
    constant: new Float64Array(Z * 3),
    types: T,
    households
  };
}

/** Data and model together. */
export function carCity(input: SimInput, o: CarCityOpts = {}): { data: CarData; model: CarModel } {
  return { data: carDataOf(input, o), model: carModelOf(o) };
}
