import { describe, expect, it } from 'vitest';
import type { CarData } from '../../../src/lib/data/cars-codec';
import {
  CAR_LEVELS,
  carShares,
  densityOf,
  typeCount,
  type CarModel,
  type TypeBands
} from '../../../src/lib/sim/cars';
import { exp } from '../../../src/lib/timelapse/math';
import {
  effectiveSizes,
  fitChoice,
  observedLevels,
  shrinkShares,
  threePlusMeanOf
} from '../../lib/cars/fit';
import type { PumsRow } from '../../lib/cars/population';
import { carsModelReportLines, carsReportLines, spacesPerNewHome } from '../../lib/cars/report';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BANDS: TypeBands = {
  size: [1, 2, 3, 4],
  workers: [0, 1, 2],
  income: [0, 50_000, 100_000, 200_000]
};
const T = typeCount(BANDS);
const PUMAS = ['07507', '07508', '07509', '07510'];

// True model. Household terms per level (1, 2, 3+ against 0): size 2, 3, 4+; workers 1, 2+;
// income bands 2, 3, 4; renter.
const TRUE_HH: Record<string, number[]> = {
  'size 2': [0.6, 1.4, 1.2],
  'size 3': [0.7, 1.9, 2.2],
  'size 4+': [0.6, 2.1, 3.0],
  'workers 1': [0.4, 0.5, 0.6],
  'workers 2+': [0.3, 0.9, 1.3],
  'income 2': [0.7, 1.0, 1.1],
  'income 3': [1.0, 1.7, 2.0],
  'income 4': [1.1, 2.1, 2.6],
  renter: [-0.8, -1.5, -1.9]
};
const TRUE_ASC = [0.4, -1.6, -3.4];
const TRUE_DENSITY = [-0.012, -0.025, -0.03];
const TRUE_ACCESS = [-0.04, -0.07, -0.09];

/** Type index parts: size, workers, income band, renter. */
function parts(t: number) {
  const nI = BANDS.income.length;
  const nW = BANDS.workers.length;
  const renter = t % 2;
  const i = (t >> 1) % nI;
  const w = Math.floor(t / (2 * nI)) % nW;
  const s = Math.floor(t / (2 * nI * nW));
  return { s, w, i, renter };
}
function trueHousehold(t: number, k: number): number {
  const { s, w, i, renter } = parts(t);
  let u = 0;
  if (s > 0) u += TRUE_HH[['', 'size 2', 'size 3', 'size 4+'][s]][k];
  if (w > 0) u += TRUE_HH[['', 'workers 1', 'workers 2+'][w]][k];
  if (i > 0) u += TRUE_HH[['', 'income 2', 'income 3', 'income 4'][i]][k];
  if (renter) u += TRUE_HH.renter[k];
  return u;
}
function trueShares(t: number, density: number, access: number, c: number[] = [0, 0, 0]) {
  const e = [1];
  for (let k = 0; k < 3; k++)
    e.push(
      exp(
        TRUE_ASC[k] +
          trueHousehold(t, k) +
          TRUE_DENSITY[k] * density +
          TRUE_ACCESS[k] * access +
          c[k]
      )
    );
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** A synthetic city: 32 zones in 4 PUMAs, a PUMS sample, and B25044-like zone counts. */
function city() {
  const r = rng(2026);
  const Z = 32;
  const zones = Array.from({ length: Z }, (_, z) => `0607501${String(z).padStart(5, '0')}`);
  const zonePuma = Int32Array.from({ length: Z }, (_, z) => z % 4);
  const areaM2 = new Float64Array(Z);
  const access = new Float64Array(Z);
  const households = new Int32Array(Z * T * CAR_LEVELS);
  const observed = new Float64Array(Z * CAR_LEVELS);
  const zoneC: number[][] = [];
  for (let z = 0; z < Z; z++) {
    const n = 20_000;
    const density = 3 + 80 * r();
    areaM2[z] = (n * 10_000) / density;
    access[z] = 25 * r();
    const mix = Array.from({ length: T }, () => r() * r());
    const ms = mix.reduce((a, b) => a + b, 0);
    // The zone's own constants: the gap the across-zone terms leave.
    const c = [r() - 0.5, r() - 0.5, r() - 0.5];
    zoneC.push(c);
    for (let t = 0; t < T; t++) {
      const nt = (n * mix[t]) / ms;
      const p = trueShares(t, density, access[z]);
      const po = trueShares(t, density, access[z], c);
      for (let k = 0; k < CAR_LEVELS; k++) {
        households[(z * T + t) * CAR_LEVELS + k] = Math.round(nt * p[k]);
        observed[z * CAR_LEVELS + k] += nt * po[k];
      }
    }
  }
  // Zone 5 reports no 3+ household; zone 9 has no B25044 row.
  observed[5 * CAR_LEVELS + 3] = 0;
  for (let k = 0; k < CAR_LEVELS; k++) observed[9 * CAR_LEVELS + k] = 0;
  const data: CarData = {
    zones,
    pumas: PUMAS,
    zonePuma,
    lotZone: new Int32Array(0),
    areaM2,
    occupied: new Float64Array(Z).fill(0.95),
    access,
    constant: new Float64Array(Z * 3),
    types: T,
    households
  };
  // PUMA-mean location covariates, as fitChoice computes them.
  const pumaHh = new Float64Array(4);
  const pumaHa = new Float64Array(4);
  const pumaAcc = new Float64Array(4);
  for (let z = 0; z < Z; z++) {
    let h = 0;
    for (let i = 0; i < T * CAR_LEVELS; i++) h += households[z * T * CAR_LEVELS + i];
    pumaHh[zonePuma[z]] += h;
    pumaHa[zonePuma[z]] += areaM2[z] / 10_000;
    pumaAcc[zonePuma[z]] += h * access[z];
  }
  const rows: PumsRow[] = [];
  const incomes = [20_000, 70_000, 150_000, 300_000];
  for (let i = 0; i < 20_000; i++) {
    const p = Math.floor(r() * 4);
    const np = 1 + Math.floor(r() * 5);
    const workers = Math.min(np, Math.floor(r() * 4));
    const hincp_adj = incomes[Math.floor(r() * 4)] + Math.floor(r() * 1000);
    const ten = r() < 0.4 ? 1 : 3;
    const tt = typeOf(np, workers, hincp_adj, ten);
    const sh = trueShares(tt, pumaHh[p] / pumaHa[p], pumaAcc[p] / pumaHh[p]);
    let u = r();
    let k = 0;
    while (k < 3 && u >= sh[k]) u -= sh[k++];
    rows.push({
      puma: PUMAS[p],
      wgtp: 1 + Math.floor(r() * 20),
      veh: k === 3 && r() < 0.3 ? 4 : k,
      np,
      workers,
      hincp_adj,
      ten
    });
  }
  return { data, observed, rows, zoneC };
}

function typeOf(np: number, workers: number, income: number, ten: number): number {
  const s = Math.min(np, 4) - 1;
  const w = Math.min(workers, 2);
  let i = 0;
  for (let j = 0; j < BANDS.income.length; j++) if (BANDS.income[j] <= income) i = j;
  const owner = ten === 1 || ten === 2;
  return ((s * 3 + w) * 4 + i) * 2 + (owner ? 0 : 1);
}

describe('fitChoice on a synthetic city', () => {
  const c = city();
  const r = fitChoice(
    { rows: c.rows, bands: BANDS, window: ['2020-01-01', '2024-12-31'] },
    c.observed,
    c.data
  );

  it('recovers the household terms from PUMS and collapses them per type', () => {
    const hh = r.stats.stage1.terms.filter((t) => t.name in TRUE_HH);
    expect(hh.map((t) => t.name).sort()).toEqual(Object.keys(TRUE_HH).sort());
    for (const t of hh)
      for (let k = 0; k < 3; k++)
        expect(Math.abs(t.coef[k] - TRUE_HH[t.name][k]), `${t.name} ${k}`).toBeLessThan(
          4 * t.se[k]
        );
    // choice.household is the sum of each type's terms.
    const term = Object.fromEntries(hh.map((t) => [t.name, t.coef]));
    for (let t = 0; t < T; t++) {
      const { s, w, i, renter } = parts(t);
      for (let k = 0; k < 3; k++) {
        let u = 0;
        if (s > 0) u += term[['', 'size 2', 'size 3', 'size 4+'][s]][k];
        if (w > 0) u += term[['', 'workers 1', 'workers 2+'][w]][k];
        if (i > 0) u += term[['', 'income 2', 'income 3', 'income 4'][i]][k];
        if (renter) u += term.renter[k];
        expect(r.choice.household[t * 3 + k]).toBeCloseTo(u, 12);
      }
    }
    expect(r.choice.household).toHaveLength(T * 3);
  });

  it('takes density and access from the across-zone fit', () => {
    for (let k = 0; k < 3; k++) {
      expect(r.choice.location.density[k]).toBeCloseTo(TRUE_DENSITY[k], 2);
      expect(r.choice.location.access[k]).toBeCloseTo(TRUE_ACCESS[k], 2);
    }
    expect(r.stats.stage2.logLik).toBeGreaterThan(r.stats.stage2.logLikNoAccess);
  });

  it("matches every zone's shrunk 0/1/2/3+ shares within 1e-6 after the zone constants", () => {
    const { data, observed } = c;
    const model = { choice: r.choice } as Parameters<typeof carShares>[0];
    const zt = { access: data.access, constant: r.constant };
    const out = new Float64Array(CAR_LEVELS);
    for (let z = 0; z < data.zones.length; z++) {
      let obsTotal = 0;
      for (let k = 0; k < CAR_LEVELS; k++) obsTotal += observed[z * CAR_LEVELS + k];
      if (obsTotal === 0) {
        // No observation: no constants.
        for (let k = 0; k < 3; k++) expect(r.constant[z * 3 + k]).toBe(0);
        continue;
      }
      const pred = new Float64Array(CAR_LEVELS);
      let n = 0;
      for (let i = 0; i < T * CAR_LEVELS; i++) n += data.households[z * T * CAR_LEVELS + i];
      const density = densityOf(n, data.areaM2[z]);
      for (let t = 0; t < T; t++) {
        let nt = 0;
        for (let k = 0; k < CAR_LEVELS; k++) nt += data.households[(z * T + t) * CAR_LEVELS + k];
        carShares(model, zt, z, t, density, out);
        for (let k = 0; k < CAR_LEVELS; k++) pred[k] += (nt / n) * out[k];
      }
      for (let k = 0; k < CAR_LEVELS; k++)
        expect(Math.abs(pred[k] - r.fit[z].target[k]), `z${z} k${k}`).toBeLessThan(1e-6);
    }
    expect(Array.from(r.constant).every(Number.isFinite)).toBe(true);
  });

  it('reports each zone before and after the constants', () => {
    expect(r.fit).toHaveLength(c.data.zones.length);
    const f = r.fit[0];
    expect(f.geoid).toBe(c.data.zones[0]);
    expect(f.households).toBeGreaterThan(0);
    expect(f.before).toHaveLength(4);
    expect(f.after).toHaveLength(4);
    // The across-zone fit leaves a gap the constants close.
    const gap = (a: number[], b: number[]) => Math.max(...a.map((x, k) => Math.abs(x - b[k])));
    const obs = (g: (typeof r.fit)[number]) => g.observed.map((x) => x / g.observedTotal);
    expect(gap(f.before, obs(f))).toBeGreaterThan(1e-3);
    expect(gap(f.after, f.target)).toBeLessThan(1e-6);
    // The shrunk target lies between the observed and the predicted shares.
    f.target.forEach((x, k) =>
      expect(
        Math.min(f.before[k], obs(f)[k]) - 1e-12 <= x &&
          x <= Math.max(f.before[k], obs(f)[k]) + 1e-12
      ).toBe(true)
    );
    expect(r.stats.constants.n0).toBeGreaterThan(0);
    expect(r.fit[9].observedTotal).toBe(0);
  });
});

describe('empirical Bayes shrinkage of the observed shares', () => {
  /** Gamma(shape >= 1) by Marsaglia-Tsang, normals by Box-Muller. */
  function gamma(r: () => number, shape: number): number {
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
      const v = (1 + c * x) ** 3;
      if (v <= 0) continue;
      if (Math.log(1 - r()) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v;
    }
  }

  /** Zones whose true shares are Dirichlet(n0 x predicted), observed by multinomial counts. */
  function draws(n0: number, seed: number) {
    const r = rng(seed);
    const Z = 800;
    const predicted = new Float64Array(Z * 4);
    const observed = new Float64Array(Z * 4);
    for (let z = 0; z < Z; z++) {
      const p = [0.05 + 0.5 * r(), 0.05 + 0.5 * r(), 0.05 + 0.3 * r(), 0.05 + 0.1 * r()];
      const ps = p.reduce((a, b) => a + b, 0);
      const q = p.map((x) => gamma(r, (n0 * x) / ps));
      const qs = q.reduce((a, b) => a + b, 0);
      const n = 200 + Math.floor(r() * 800);
      for (let i = 0; i < n; i++) {
        let u = r() * qs;
        let k = 0;
        while (k < 3 && u >= q[k]) u -= q[k++];
        observed[z * 4 + k]++;
      }
      for (let k = 0; k < 4; k++) predicted[z * 4 + k] = p[k] / ps;
    }
    return { predicted, observed };
  }

  it('recovers n0 from data generated with known overdispersion', () => {
    for (const n0 of [30, 150]) {
      const d = draws(n0, n0);
      const s = shrinkShares(d.observed, d.predicted);
      expect(s.n0, `n0 ${n0}`).toBeGreaterThan(n0 * 0.75);
      expect(s.n0, `n0 ${n0}`).toBeLessThan(n0 * 1.33);
    }
  });

  it('gives share* = (n obs + n0 pred) / (n + n0), the predicted shares with no observation', () => {
    const d = draws(50, 3);
    d.observed.fill(0, 0, 4);
    const s = shrinkShares(d.observed, d.predicted);
    for (let k = 0; k < 4; k++) expect(s.shares[k]).toBe(d.predicted[k]);
    const n0 = s.n0 ?? NaN;
    expect(n0).toBeGreaterThan(0);
    const z = 7;
    const n = d.observed.subarray(z * 4, z * 4 + 4).reduce((a, b) => a + b, 0);
    for (let k = 0; k < 4; k++)
      expect(s.shares[z * 4 + k]).toBeCloseTo(
        (d.observed[z * 4 + k] + n0 * d.predicted[z * 4 + k]) / (n + n0),
        12
      );
  });

  it('a zone with an observed zero level gets a finite constant and a nonzero share', () => {
    const c = city();
    // Zone 5 reports no 3+ household, from a block-group-sized count (400 households).
    const observed = Float64Array.from(c.observed);
    const n5 = observed.subarray(20, 24).reduce((a, b) => a + b, 0);
    for (let k = 0; k < 4; k++) observed[20 + k] = Math.round((observed[20 + k] * 400) / n5);
    const r = fitChoice(
      { rows: c.rows, bands: BANDS, window: ['2020-01-01', '2024-12-31'] },
      observed,
      c.data
    );
    expect(observed[5 * 4 + 3]).toBe(0);
    expect(r.fit[5].target[3]).toBeGreaterThan(1e-3);
    expect(r.fit[5].after[3]).toBeGreaterThan(1e-3);
    expect(Math.abs(r.constant[5 * 3 + 2])).toBeLessThan(5);
    expect(r.stats.constants.observedZero).toBe(1);
  });
});

describe('effective sample sizes from the B25044 margins of error', () => {
  it('pools the level shares: n_eff = sum p(1-p) / sum SE(p)^2, SE = MOE / 1.645', () => {
    const est = (geoid: string, cells: Record<string, number>) =>
      Object.entries(cells).map(([variable, estimate]) => ({ geoid, variable, estimate }));
    const moe = (geoid: string, cells: Record<string, number>) =>
      Object.entries(cells).map(([variable, m]) => ({ geoid, variable, moe: m }));
    // Zone a: 100 households, owners 0/1/2 cars 10/20/10, renters 0/1 30/30; zone b: no margins.
    const acs = [
      ...est('a', { B25044_001: 100, B25044_003: 10, B25044_004: 20, B25044_005: 10 }),
      ...est('a', { B25044_010: 30, B25044_011: 30 }),
      ...est('b', { B25044_001: 50, B25044_003: 50 })
    ];
    const m = moe('a', {
      B25044_001: 16.45,
      B25044_003: 8.225,
      B25044_004: 16.45,
      B25044_005: 8.225,
      B25044_006: 16.45,
      B25044_010: 16.45,
      B25044_011: 16.45
    });
    const r = effectiveSizes(acs, m, ['a', 'b']);
    // SE: total 10; level counts 40, 50, 10, 0 with SE sqrt(5^2+10^2), sqrt(10^2+10^2), 5, 10.
    const N = 100;
    const x = [40, 50, 10, 0];
    const sx2 = [125, 200, 25, 100];
    let num = 0;
    let den = 0;
    for (let k = 0; k < 4; k++) {
      const p = x[k] / N;
      const rad = sx2[k] - p * p * 100;
      num += p * (1 - p);
      den += (rad > 0 ? rad : sx2[k] + p * p * 100) / (N * N);
    }
    expect(r.nEff[0]).toBeCloseTo(num / den, 9);
    // No margins: the estimated households stand in, and the zone is counted.
    expect(r.nEff[1]).toBe(50);
    expect(r.missing).toBe(1);
  });

  it('keeps only the largest margin among zero-estimate cells of a level (Census rule)', () => {
    const est = (cells: Record<string, number>) =>
      Object.entries(cells).map(([variable, estimate]) => ({ geoid: 'a', variable, estimate }));
    const moe = (cells: Record<string, number>) =>
      Object.entries(cells).map(([variable, m]) => ({ geoid: 'a', variable, moe: m }));
    // 100 households: 0 cars 50, 1 car 45, 3+ cars 5 (one owner cell); five 3+ cells are zero.
    const acs = est({
      B25044_001: 100,
      B25044_003: 30,
      B25044_010: 20,
      B25044_004: 45,
      B25044_006: 5,
      B25044_007: 0,
      B25044_008: 0
    });
    const m = moe({
      B25044_001: 16.45,
      B25044_003: 16.45,
      B25044_010: 16.45,
      B25044_004: 16.45,
      B25044_005: 16.45,
      B25044_012: 32.9,
      B25044_006: 8.225,
      B25044_007: 16.45,
      B25044_008: 24.675,
      B25044_013: 16.45,
      B25044_014: 16.45,
      B25044_015: 16.45
    });
    const r = effectiveSizes(acs, m, ['a']);
    // SE^2 per level: 0 cars 100 + 100; 1 car 100 (the renter cell is absent: no margin);
    // 2 cars: both cells zero, the larger (20^2) only; 3+: 5^2 nonzero + the largest zero 15^2.
    const N = 100;
    const x = [50, 45, 0, 5];
    const sx2 = [200, 100, 400, 25 + 225];
    let num = 0;
    let den = 0;
    for (let k = 0; k < 4; k++) {
      const p = x[k] / N;
      const rad = sx2[k] - p * p * 100;
      num += p * (1 - p);
      den += (rad > 0 ? rad : sx2[k] + p * p * 100) / (N * N);
    }
    expect(r.nEff[0]).toBeCloseTo(num / den, 9);
  });

  it('shrinkShares takes the effective sizes as n', () => {
    const observed = Float64Array.from([50, 30, 20, 0, 10, 60, 25, 5, 40, 40, 10, 10]);
    const predicted = Float64Array.from([
      0.3, 0.4, 0.2, 0.1, 0.2, 0.5, 0.2, 0.1, 0.4, 0.3, 0.2, 0.1
    ]);
    const n = Float64Array.from([200, 300, 400]);
    const s = shrinkShares(observed, predicted, n);
    const n0 = s.n0 ?? NaN;
    expect(n0).toBeGreaterThan(0);
    expect(s.shares[3]).toBeCloseTo((0 * 200 + n0 * 0.1) / (200 + n0), 12);
    expect(s.shares[4]).toBeCloseTo((0.1 * 300 + n0 * 0.2) / (300 + n0), 12);
  });
});

describe('dispersion at or beyond the multinomial limit', () => {
  it('gives n0 = 0 and still finite constants when every zone is all of one level', () => {
    const c = city();
    const Z = c.data.zones.length;
    const observed = new Float64Array(Z * 4);
    for (let z = 0; z < Z; z++) if (z !== 9) observed[z * 4 + 3] = 500;
    const s = shrinkShares(
      observed,
      Float64Array.from({ length: Z * 4 }, () => 0.25)
    );
    expect(s.n0).toBe(0);
    const r = fitChoice(
      { rows: c.rows, bands: BANDS, window: ['2020-01-01', '2024-12-31'] },
      observed,
      c.data
    );
    expect(r.stats.constants.n0).toBe(0);
    expect(Array.from(r.constant).every(Number.isFinite)).toBe(true);
    expect(r.fit.every((f) => f.after.every(Number.isFinite))).toBe(true);
  });
});

describe('fitChoice on thin data', () => {
  it('drops the location terms with one PUMA and one peopled zone, and a dummy with no variation', () => {
    const c = city();
    const one = PUMAS[0];
    const rows = c.rows.map((r) => ({ ...r, puma: one, ten: 3 }));
    const Z = c.data.zones.length;
    const households = Int32Array.from(c.data.households, (h, i) => (i < T * CAR_LEVELS ? h : 0));
    const data = { ...c.data, pumas: [one], zonePuma: new Int32Array(Z), households };
    const r = fitChoice(
      { rows, bands: BANDS, window: ['2020-01-01', '2024-12-31'] },
      c.observed,
      data
    );
    const dropped = (ts: { name: string; dropped?: boolean }[]) =>
      ts.filter((t) => t.dropped).map((t) => t.name);
    expect(dropped(r.stats.stage1.terms)).toEqual(['renter', 'PUMA density', 'PUMA access']);
    expect(dropped(r.stats.stage2.terms)).toEqual(['density', 'access']);
    expect(r.choice.location).toEqual({ density: [0, 0, 0], access: [0, 0, 0] });
    expect(r.choice.household.every(Number.isFinite)).toBe(true);
    // Zone 0 still matches its target shares.
    r.fit[0].after.forEach((p, k) => expect(Math.abs(p - r.fit[0].target[k])).toBeLessThan(1e-6));
  });

  it('throws when no PUMS household has some number of cars', () => {
    const c = city();
    const rows = c.rows.filter((r) => r.veh < 3);
    expect(() =>
      fitChoice({ rows, bands: BANDS, window: ['2020-01-01', '2024-12-31'] }, c.observed, c.data)
    ).toThrow(/no PUMS household with 3\+ cars/);
  });
});

describe('helpers', () => {
  it('threePlusMeanOf is the weighted mean of vehicles over 3+ households', () => {
    const row = (veh: number, wgtp: number) =>
      ({ puma: '07507', wgtp, veh, np: 2, workers: 1, hincp_adj: 1, ten: 1 }) as PumsRow;
    expect(threePlusMeanOf([row(0, 5), row(3, 1), row(4, 1), row(6, 2)])).toBeCloseTo(19 / 4, 12);
  });

  it('observedLevels adds owner and renter B25044 cells per level', () => {
    const rows = [
      ['B25044_003', 5],
      ['B25044_004', 7],
      ['B25044_006', 1],
      ['B25044_007', 2],
      ['B25044_010', 11],
      ['B25044_012', 3]
    ].map(([variable, estimate]) => ({
      geoid: 'a',
      variable: variable as string,
      estimate: estimate as number
    }));
    expect(Array.from(observedLevels(rows, ['a', 'b']))).toEqual([16, 7, 3, 3, 0, 0, 0, 0]);
  });
});

describe('carsReportLines', () => {
  const c = city();
  const r = fitChoice(
    { rows: c.rows, bands: BANDS, window: ['2020-01-01', '2024-12-31'] },
    c.observed,
    c.data
  );
  const model = {
    schema: 1 as const,
    bands: BANDS,
    choice: r.choice,
    threePlusMean: 3.3
  };
  const lines = carsReportLines(model, { ...c.data, constant: r.constant }, r, {
    year: 2026,
    lightDuty: 410_813
  });
  const md = lines.join('\n');

  it('lists the coefficients with standard errors and the priors beside them', () => {
    expect(md).toMatch(/size 2 \| -?[0-9.]+ \(±[0-9.]+\)/);
    expect(md).toContain('density');
    expect(md).toContain('access');
    expect(md).toContain('MTC Travel Model Two');
    expect(md).toContain('ActivitySim');
    expect(md).toContain('estimated model (MTC TM2 / ActivitySim)');
    expect(md).toContain('tier 3');
  });

  it('gives the fit by block group, citywide and the DMV check', () => {
    expect(md).toMatch(/median [0-9.]+ points/);
    expect(md).toMatch(/90th percentile [0-9.]+ points/);
    expect(md).toMatch(/n0 = [0-9.]+, by the method of moments/);
    expect(md).toContain("n is each block group's estimated households");
    expect(md).toMatch(/would range -?[0-9.]+ to -?[0-9.]+/);
    expect(md).toContain('Largest zero-car errors after the constants');
    expect(md).toContain('Citywide');
    expect(md).toContain('DMV');
    expect(md).toContain('410813');
    expect(md).not.toMatch(/NaN|Infinity|undefined|\bnull\b/);
    expect(lines.some((l) => /^#{1,2} /.test(l))).toBe(false);
  });

  it('states the effective sample sizes when the margins of error are given', () => {
    const nEff = Float64Array.from(
      c.observed.filter((_, i) => i % 4 === 0),
      () => 300
    );
    const f = fitChoice(
      { rows: c.rows, bands: BANDS, window: ['2020-01-01', '2024-12-31'] },
      c.observed,
      c.data,
      { nEff, moeMissing: 2 }
    );
    const l = carsReportLines(model, { ...c.data, constant: f.constant }, f, null).join('\n');
    expect(l).toMatch(
      /effective sample size from its B25044 margins of error[^\n]*median 300 against/
    );
    expect(l).toContain('2 block groups had no margins');
  });

  it('says so when there is no DMV table', () => {
    const l = carsReportLines(model, { ...c.data, constant: r.constant }, r, null).join('\n');
    expect(l).toContain('DMV: no registrations in the lock');
  });
});

describe('carsModelReportLines', () => {
  const c = city();
  const r = fitChoice(
    { rows: c.rows, bands: BANDS, window: ['2020-01-01', '2024-12-31'] },
    c.observed,
    c.data
  );
  const data = { ...c.data, constant: r.constant };
  const prov = {
    tier: 1 as const,
    label: 'test',
    sources: [{ label: 'PUMS', url: 'https://example.invalid/pums' }],
    method: 'test',
    n: 10,
    window: ['2020-01-01', '2024-12-31'] as [string, string]
  };
  const uniform = Array.from({ length: T }, () => 1 / T);
  // Only one-person owner households: fewer cars than the uniform mix.
  const small = Array.from({ length: T }, (_, t) => (t < 12 && t % 2 === 0 ? 1 / 6 : 0));
  const cost = { surface: null, podium: 48_756, belowGrade: 120_083 };
  const model: CarModel = {
    schema: 1,
    bands: BANDS,
    choice: r.choice,
    threePlusMean: 3.3,
    moves: { perMonth: uniform.map(() => 0.01), inMix: PUMAS.map(() => uniform), provenance: prov },
    newHomes: {
      mix: { market: uniform, veryLow: small, low: small, moderate: uniform },
      affordableTiers: { veryLow: 0.5, low: 0.3, moderate: 0.2 },
      provenance: prov
    },
    parking: { supplyOverUse: 1.4, costPerSpace: cost, dollarsYear: 2026, provenance: [prov] },
    refreshMonths: 12
  };
  const tenure = { records: 100, households: 2000, annual: 0.12, perMonth: 0.0106 };
  const stats = {
    pumas: PUMAS,
    moves: {
      records: 200,
      noMv: 0,
      tenure: { owner: tenure, renter: { ...tenure, annual: 0.25, perMonth: 0.0237 } },
      fallback: 40,
      perMonthRange: [0.005, 0.03] as [number, number],
      moversByPuma: [10, 20, 30, 40],
      pumaFallback: []
    },
    newHomes: {
      release: 2024,
      builtFrom: 2010,
      amiYear: 2024,
      records: { market: 300, veryLow: 40, low: 60, moderate: 90 },
      households: { market: 9000, veryLow: 1000, low: 1500, moderate: 2500 },
      allHomes: [],
      tiersFrom: 'projects' as const,
      byTier: { veryLow: 2203, low: 1352, moderate: 559 }
    },
    parking: {
      supply: { value: 1.4, tier: 3, sources: ['King County Right Size Parking'] },
      costs: [
        {
          type: 'podium' as const,
          value: 28_700,
          dollarsYear: 2012,
          factor: 112.3 / 98.2,
          cpiFactor: 356.005 / 239.65,
          escalated: 48_756,
          sources: ['Seifel 2012']
        },
        {
          type: 'belowGrade' as const,
          value: 80_000,
          dollarsYear: 2016,
          factor: 1.123,
          cpiFactor: 356.005 / 266.344,
          escalated: 120_083,
          sources: ['Hub memo']
        }
      ],
      unpriced: ['surface' as const],
      commonYear: 2026,
      indexLast: 2023,
      cpiYear: 2025,
      cpiSeries: 'CUURS49BSA0',
      searched: ['Controller 2026']
    }
  };

  it('uses the new-home mix for spaces per new home', () => {
    const a = spacesPerNewHome(model, data, uniform);
    const b = spacesPerNewHome(model, data, small);
    expect(a.zones).toHaveLength(data.zones.length);
    expect(b.city).toBeLessThan(a.city);
    expect(a.city).toBeGreaterThan(0);
  });

  it('gives move rates, mixes, spaces, costs, the baseline and the cross-check', () => {
    const md = carsModelReportLines(model, data, stats).join('\n');
    expect(md).toContain('owners 12.0% a year (1.060% a month');
    expect(md).toContain('40 take their tenure');
    expect(md).toContain('07507 10');
    expect(md).toMatch(/\| Market \| 300 \| 9000 \| [0-9.]+% \| [0-9.]+ \|/);
    expect(md).toContain('very low 50.0%, low 30.0%, moderate 20.0%');
    expect(md).toContain('2203, 1352, 559');
    expect(md).toContain('built to demand');
    expect(md).toContain('| podium | $28,700 | 2012 | 1.1436 | 1.4855 | $48,756 | Seifel 2012 |');
    expect(md).toContain("The 2026 annual average is not yet published, so 2025's stands in");
    expect(md).toContain('CUURS49BSA0');
    expect(md).toContain('projects built with that parking get no parking cost');
    expect(md).toContain(
      '$98,000 to $144,000 per below-grade space in 2026 dollars ' +
        "(docs/dev/cars-data.md), beside the cited figure's $120,083."
    );
    expect(md).not.toMatch(/NaN|Infinity|undefined|\bnull\b/);
  });

  it('says the parking link is off and lists the search when there is no cost', () => {
    const off = { ...model, parking: { ...model.parking, costPerSpace: null, dollarsYear: null } };
    const md = carsModelReportLines(off, data, {
      ...stats,
      parking: {
        ...stats.parking,
        costs: null,
        unpriced: [],
        commonYear: null,
        indexLast: null,
        cpiYear: null
      }
    }).join('\n');
    expect(md).toContain('The parking link is off');
    expect(md).toContain('- Controller 2026');
    expect(md).not.toContain('Cross-check, not used');
  });
});
