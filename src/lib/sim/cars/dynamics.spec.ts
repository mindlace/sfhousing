import { describe, expect, it } from 'vitest';
import type { CarData } from '../../data/cars-codec';
import { carShares, densityOf, meanCars } from './choice';
import { splitSystematic } from './split';
import {
  predictedSpaces,
  refreshTable,
  stepZone,
  totals,
  zoneCarsPerHousehold,
  type CarDraw,
  type CarState
} from './dynamics';
import { CAR_LEVELS, CAR_P, IN_MIX_DRAW, MIXES, typeCount, type CarModel } from './types';

const L = CAR_LEVELS;
const prov = { tier: 4 as const, label: 'x', sources: [], method: 'invented' };
const bands = { size: [1, 2], workers: [0, 1], income: [0] };
const T = typeCount(bands);
const uniform = new Array(T).fill(1 / T);

function modelOf(perMonth = 0.05): CarModel {
  return {
    schema: 1,
    bands,
    choice: {
      asc: [0.4, -0.6, -1.8],
      household: Array.from({ length: T * 3 }, (_, i) => 0.03 * (i % 7) - 0.1),
      location: { density: [-0.01, -0.02, -0.03], access: [-0.1, -0.2, -0.3] },
      terms: [],
      provenance: prov
    },
    threePlusMean: 3.25,
    moves: {
      perMonth: new Array(T).fill(perMonth),
      provenance: prov
    },
    newHomes: {
      mix: { market: uniform, veryLow: uniform, low: uniform, moderate: uniform },
      affordableTiers: { veryLow: 0.3, low: 0.3, moderate: 0.4 },
      provenance: prov
    },
    parking: { supplyOverUse: 1.4, costPerSpace: null, dollarsYear: null, provenance: [] },
    refreshMonths: 12
  };
}

const Z = 3;
function dataOf(): CarData {
  const households = new Int32Array(Z * T * L);
  for (let i = 0; i < households.length; i++) households[i] = (i * 7) % 5;
  // Zone 2 starts empty.
  households.fill(0, 2 * T * L);
  return {
    zones: ['060750001001', '060750001002', '060750001003'],
    pumas: ['07507'],
    zonePuma: new Int32Array(Z),
    lotZone: new Int32Array(0),
    areaM2: new Float64Array([20_000, 50_000, 0]),
    occupied: new Float64Array([0.95, 0.9, 1]),
    access: new Float64Array([1, 2, 3]),
    constant: new Float64Array(Z * 3),
    types: T,
    households
  };
}

function stateOf(d: CarData, m: CarModel): CarState {
  const s: CarState = {
    zones: Z,
    types: T,
    hh: Int32Array.from(d.households),
    table: new Float64Array(Z * T * L)
  };
  refreshTable(s, m, d);
  return s;
}

/** A counter-free stand-in for the zone draws: a hash of the arguments and a month. */
function drawOf(month: number, log?: [number, number, number][]): CarDraw {
  return (zone, purpose, index) => {
    log?.push([zone, purpose, index]);
    let h = Math.imul(zone + 1, 0x9e3779b1) ^ Math.imul(purpose + 7, 0x85ebca6b);
    h = Math.imul(h ^ (index + 13) ^ Math.imul(month, 0xc2b2ae35), 0x27d4eb2f);
    h ^= h >>> 15;
    return ((h >>> 0) + 0.5) / 4294967296;
  };
}

const zoneTotal = (s: CarState, z: number) => {
  let n = 0;
  for (let i = z * T * L; i < (z + 1) * T * L; i++) n += s.hh[i];
  return n;
};

describe('stepZone', () => {
  it('keeps households = before + fills - lost, every cell non-negative', () => {
    const m = modelOf();
    const d = dataOf();
    const s = stateOf(d, m);
    for (let month = 1; month <= 40; month++) {
      const before = zoneTotal(s, 0);
      const fills = new Int32Array([month % 3, 1, 0, month % 2]);
      const lost = month % 4;
      const short = stepZone(s, m, d, 0, fills, lost, drawOf(month));
      expect(short).toBe(0);
      expect(zoneTotal(s, 0)).toBe(before + fills.reduce((a, b) => a + b, 0) - lost);
    }
    expect(s.hh.every((v) => v >= 0)).toBe(true);
  });

  it('returns the households lost beyond the zone, leaving it empty', () => {
    const m = modelOf();
    const d = dataOf();
    const s = stateOf(d, m);
    s.hh.fill(0, 0, T * L);
    s.hh[3] = 1;
    s.hh[L * 2 + 1] = 3;
    const short = stepZone(s, m, d, 0, new Int32Array(MIXES.length), 10, drawOf(1));
    expect(short).toBe(6);
    expect(zoneTotal(s, 0)).toBe(0);
  });

  it('changes nothing with move rate 0, no fills and nothing lost', () => {
    const m = modelOf(0);
    const d = dataOf();
    const s = stateOf(d, m);
    const before = Int32Array.from(s.hh);
    for (let z = 0; z < Z; z++) stepZone(s, m, d, z, new Int32Array(MIXES.length), 0, drawOf(5));
    expect(Array.from(s.hh)).toEqual(Array.from(before));
  });

  it('moves households: the zone keeps its total, the car levels change', () => {
    const m = modelOf(0.2);
    const d = dataOf();
    const s = stateOf(d, m);
    const before = Int32Array.from(s.hh);
    const total = zoneTotal(s, 1);
    for (let month = 1; month <= 12; month++) {
      stepZone(s, m, d, 1, new Int32Array(MIXES.length), 0, drawOf(month));
      expect(zoneTotal(s, 1)).toBe(total);
    }
    expect(Array.from(s.hh)).not.toEqual(Array.from(before));
  });

  it('refills the movers’ homes from the in-mover mix on draw index IN_MIX_DRAW', () => {
    const m = modelOf(0.3);
    const d = dataOf();
    const s = stateOf(d, m);
    const log: [number, number, number][] = [];
    stepZone(s, m, d, 1, new Int32Array([0, 2, 0, 0]), 0, drawOf(3, log));
    const inTypes = log.filter(([, p]) => p === CAR_P.IN_TYPES).map(([, , i]) => i);
    expect(IN_MIX_DRAW).toBe(MIXES.length);
    expect(inTypes).toEqual([1, IN_MIX_DRAW]);
    expect(log.every(([z]) => z === 1)).toBe(true);
  });

  /** A zone's households by type, as shares. */
  const typeMix = (s: CarState, z: number): number[] => {
    const n = new Array(T).fill(0);
    for (let t = 0; t < T; t++) for (let k = 0; k < L; k++) n[t] += s.hh[(z * T + t) * L + k];
    const total = n.reduce((a, b) => a + b, 0);
    return n.map((x) => x / total);
  };
  /**
   * Zones 0 and 1 with uneven type mixes (1,000 to 2,400 households a type), each type's
   * households over the car levels at the zone's table shares, so only the refill can move them.
   */
  const seeded = (m: CarModel): { s: CarState; d: CarData } => {
    const d = dataOf();
    d.households.fill(0);
    for (let z = 0; z < 2; z++)
      for (let t = 0; t < T; t++) d.households[(z * T + t) * L] = 1000 + 200 * ((t + 3 * z) % 8);
    const s = stateOf(d, m);
    const out = new Int32Array(L);
    for (let z = 0; z < 2; z++)
      for (let t = 0; t < T; t++) {
        const at = (z * T + t) * L;
        const n = s.hh[at];
        splitSystematic(n, s.table.subarray(at, at + L), 0.5, out);
        s.hh.set(out, at);
      }
    return { s, d };
  };

  // Stationarity: with no homes built or lost, arrivals by type replace departures by type, so a
  // zone's type mix and the zero-car share hold. Tolerance 0.005 (half a point): each month every
  // type's departures and arrivals are each within one household of rate x households, so a
  // type's count takes an unbiased walk of at most two households a month; over 480 months that
  // is a few dozen households against 1,000 to 2,400 a type and 12,000+ a zone, well under 0.005
  // of a share, while one type drifting by its rate gap (0.02 vs 0.08 a month) would move its
  // share by tenths within a few years.
  it('holds a zone’s type mix and the zero-car share over 480 months with unequal move rates', () => {
    const m = modelOf(0.02);
    m.moves.perMonth = m.moves.perMonth.map((r, t) => (t % 3 === 0 ? 0.08 : r));
    const { s, d } = seeded(m);
    const start = [typeMix(s, 0), typeMix(s, 1)];
    const zeroCar = () => {
      const x = totals(s, m);
      return x.carless / x.households;
    };
    const z0 = zeroCar();
    for (let month = 1; month <= 480; month++) {
      if ((month - 1) % 12 === 0) refreshTable(s, m, d);
      for (let z = 0; z < 2; z++)
        stepZone(s, m, d, z, new Int32Array(MIXES.length), 0, drawOf(month));
      if (month % 120 === 0) {
        for (let z = 0; z < 2; z++)
          typeMix(s, z).forEach((x, t) => expect(Math.abs(x - start[z][t])).toBeLessThan(0.005));
        expect(Math.abs(zeroCar() - z0)).toBeLessThan(0.005);
      }
    }
  });

  it('fills an empty zone: arrivals choose cars by the zone’s table', () => {
    const m = modelOf(0);
    const d = dataOf();
    const s = stateOf(d, m);
    stepZone(s, m, d, 2, new Int32Array([40, 0, 0, 0]), 0, drawOf(2));
    expect(zoneTotal(s, 2)).toBe(40);
  });
});

describe('the table, totals and spaces', () => {
  it('holds each zone and type’s shares at the zone’s density', () => {
    const m = modelOf();
    const d = dataOf();
    const s = stateOf(d, m);
    const want = new Float64Array(L);
    for (let z = 0; z < Z; z++) {
      const dens = densityOf(zoneTotal(s, z), d.areaM2[z]);
      for (let t = 0; t < T; t++) {
        carShares(m, d, z, t, dens, want);
        const at = (z * T + t) * L;
        for (let k = 0; k < L; k++) expect(s.table[at + k]).toBe(want[k]);
      }
    }
  });

  it('counts 3+ households at threePlusMean', () => {
    const m = modelOf();
    const d = dataOf();
    const s = stateOf(d, m);
    let hh = 0;
    let cars = 0;
    let carless = 0;
    for (let i = 0; i < s.hh.length; i++) {
      const k = i % L;
      hh += s.hh[i];
      cars += s.hh[i] * (k === 3 ? m.threePlusMean : k);
      if (k === 0) carless += s.hh[i];
    }
    const t = totals(s, m);
    expect(t.households).toBe(hh);
    expect(t.cars).toBeCloseTo(cars, 9);
    expect(t.carless).toBe(carless);
  });

  it('gives NaN cars per household for a zone with no households (Review Focus 2)', () => {
    const m = modelOf();
    const d = dataOf();
    const s = stateOf(d, m);
    const out = new Float32Array(Z);
    zoneCarsPerHousehold(s, m, out);
    expect(Number.isNaN(out[2])).toBe(true);
    expect(Number.isFinite(out[0]) && out[0] > 0).toBe(true);
  });

  it('predicts spaces per new market home as supply over use times the mix’s mean cars', () => {
    const m = modelOf();
    const d = dataOf();
    const s = stateOf(d, m);
    let want = 0;
    for (let t = 0; t < T; t++) {
      want += m.newHomes.mix.market[t] * meanCars(s.table.subarray((t + T) * L), m.threePlusMean);
    }
    expect(predictedSpaces(s, m, d, 1)).toBeCloseTo(1.4 * want, 12);
  });
});
