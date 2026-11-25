// The household car-ownership choice, fitted (spec "Choice model"): a multinomial logit over 0,
// 1, 2 and 3+ cars. Stage 1 fits the household terms on PUMS records (weights WGTP) with the
// PUMA's mean density and transit access as location covariates. Stage 2 holds the household
// terms fixed and fits the constants, density and access across block groups on the start
// population (whose zone shares are B25044's). Zone constants then make each block group's
// predicted shares equal its observed B25044 shares. Pure: the step reads the tables.
import type { CarData } from '../../../src/lib/data/cars-codec';
import {
  CAR_LEVELS,
  carShares,
  densityOf,
  typeCount,
  type CarModel,
  type TypeBands
} from '../../../src/lib/sim/cars';
import { exp, log } from '../../../src/lib/timelapse/math';
import { MARGINS } from './config';
import { fitMnl, type MnlFit, type MnlOpts } from './mnl';
import { type AcsRow, type PumsRow } from './population';

/** One block group's fit: observed B25044 households by level, shares before and after constants. */
export interface BgFit {
  geoid: string;
  /** Start households in the zone (the sim's). */
  households: number;
  /** B25044 households by level (owner + renter). */
  observed: number[];
  observedTotal: number;
  /** Predicted shares from the across-zone terms alone (constants zero). */
  before: number[];
  /** Predicted shares with the zone constants. */
  after: number[];
}

export interface FitTerm {
  name: string;
  coef: number[];
  se: number[];
  /** The data cannot identify it (no variation, or too few PUMAs or zones): coefficient 0. */
  dropped?: boolean;
}

export interface FitStats {
  stage1: { records: number; logLik: number; iterations: number; terms: FitTerm[] };
  stage2: {
    zones: number;
    logLik: number;
    /** The same fit without access: what the grid measure adds. */
    logLikNoAccess: number;
    iterations: number;
    terms: FitTerm[];
  };
  constants: {
    /** Zones whose constants were fitted (an observation and a type mix). */
    fitted: number;
    /** Zones with no B25044 households: constants 0. */
    noObservation: number;
    /** Fitted zones with no start household: the citywide type mix stands in. */
    cityMix: number;
    /** (zone, level) cells with an observed zero, held at OBS_FLOOR. */
    floored: number;
    /** Largest |predicted - observed| share after the constants. */
    maxErr: number;
  };
}

/** The choice model's part of `CarModel` this task fits, plus what the report reads. */
export type CarChoiceModel = Pick<CarModel, 'schema' | 'bands' | 'choice' | 'threePlusMean'> & {
  parking: { supplyOverUse: number } | null;
};

/** PUMAs (stage 1) or peopled zones (stage 2) a location term needs. */
export const MIN_LOCATIONS = 3;
/** An observed zero share is held at this, so its zone constant stays finite. */
export const OBS_FLOOR = 1e-9;
/** Zone-constant iterations at most, and the share tolerance they stop at. */
export const CONSTANTS = { maxIter: 20_000, tol: 1e-10 } as const;

/** Per zone, B25044 households by level 0, 1, 2, 3+ (owner and renter added): zones x 4. */
export function observedLevels(rows: readonly AcsRow[], zones: readonly string[]): Float64Array {
  const zix = new Map(zones.map((z, i) => [z, i]));
  const cells = MARGINS[0].cells;
  const out = new Float64Array(zones.length * CAR_LEVELS);
  for (const r of rows) {
    const z = zix.get(r.geoid);
    const c = cells[r.variable];
    if (z === undefined || c === undefined) continue;
    out[z * CAR_LEVELS + (c % CAR_LEVELS)] += Math.max(0, r.estimate);
  }
  return out;
}

/** Cars per 3+ household: the WGTP-weighted mean of VEH (6 = 6 or more) over VEH >= 3. */
export function threePlusMeanOf(rows: readonly PumsRow[]): number {
  let w = 0;
  let s = 0;
  for (const r of rows)
    if (r.veh >= 3 && r.wgtp > 0) {
      w += r.wgtp;
      s += r.wgtp * r.veh;
    }
  if (!(w > 0)) throw new Error('cars: no PUMS household with 3 or more vehicles');
  return s / w;
}

/** The household features of a type: band dummies against the first band, and renter. */
function householdFeatures(b: TypeBands): { names: string[]; of: (t: number) => number[] } {
  const nS = b.size.length;
  const nW = b.workers.length;
  const nI = b.income.length;
  const last = (edges: number[], i: number) => (i === edges.length - 1 ? '+' : '');
  const names = [
    ...b.size.slice(1).map((e, i) => `size ${e}${last(b.size, i + 1)}`),
    ...b.workers.slice(1).map((e, i) => `workers ${e}${last(b.workers, i + 1)}`),
    ...b.income.slice(1).map((_, i) => `income ${i + 2}`),
    'renter'
  ];
  const of = (t: number) => {
    const renter = t % 2;
    const i = (t >> 1) % nI;
    const w = Math.floor(t / (2 * nI)) % nW;
    const s = Math.floor(t / (2 * nI * nW));
    const f = new Array<number>(names.length).fill(0);
    if (s > 0) f[s - 1] = 1;
    if (w > 0) f[nS - 1 + w - 1] = 1;
    if (i > 0) f[nS - 1 + nW - 1 + i - 1] = 1;
    f[names.length - 1] = renter;
    return f;
  };
  return { names, of };
}

const terms = (
  names: string[],
  coef: Float64Array,
  se: Float64Array,
  offset = 0,
  keep?: boolean[]
): FitTerm[] => {
  const nFeat = coef.length / 3;
  return names.map((name, j) => ({
    name,
    coef: [0, 1, 2].map((k) => coef[k * nFeat + offset + j]),
    se: [0, 1, 2].map((k) => se[k * nFeat + offset + j]),
    ...(keep && !keep[offset + j] ? { dropped: true } : {})
  }));
};

/**
 * fitMnl on the kept columns only; a dropped column gets coefficient 0 and standard error NaN in
 * the full-width result.
 */
function fitKept(
  x: Float64Array,
  nFeat: number,
  keep: boolean[],
  choice: Uint8Array,
  weight: Float64Array,
  opts: MnlOpts
): MnlFit {
  const cols = keep.flatMap((k, f) => (k ? [f] : []));
  const n = choice.length;
  const F = cols.length;
  const xk = new Float64Array(n * F);
  for (let i = 0; i < n; i++) for (let j = 0; j < F; j++) xk[i * F + j] = x[i * nFeat + cols[j]];
  const r = fitMnl(xk, F, choice, weight, CAR_LEVELS, opts);
  const coef = new Float64Array((CAR_LEVELS - 1) * nFeat);
  const se = new Float64Array((CAR_LEVELS - 1) * nFeat).fill(NaN);
  for (let k = 0; k < CAR_LEVELS - 1; k++)
    cols.forEach((f, j) => {
      coef[k * nFeat + f] = r.coef[k * F + j];
      se[k * nFeat + f] = r.se[k * F + j];
    });
  return { ...r, coef, se };
}

/**
 * Fit the choice. `pums` are the latest release's records on the zones' PUMAs with the type bands
 * and the release's five-year window;
 * `observed` is `observedLevels` (B25044 households by zone and level); `data` the start
 * population, zones, areas and access. Returns the model's choice, the zone constants (zones x 3,
 * level-major per zone) and the per-zone fit.
 */
export function fitChoice(
  pums: { rows: readonly PumsRow[]; bands: TypeBands; window: [from: string, to: string] },
  observed: Float64Array,
  data: CarData
): { choice: CarModel['choice']; constant: Float64Array; fit: BgFit[]; stats: FitStats } {
  const { bands } = pums;
  const T = typeCount(bands);
  if (T !== data.types) throw new Error(`cars: ${T} types from the bands, ${data.types} in data`);
  const Z = data.zones.length;
  const cells = T * CAR_LEVELS;
  const hf = householdFeatures(bands);
  const nH = hf.names.length;
  const typeFeat = Array.from({ length: T }, (_, t) => hf.of(t));

  // Zone and PUMA location covariates from the start population.
  const zoneHh = new Float64Array(Z);
  for (let z = 0; z < Z; z++)
    for (let i = 0; i < cells; i++) zoneHh[z] += data.households[z * cells + i];
  const density = Float64Array.from(zoneHh, (h, z) => densityOf(h, data.areaM2[z]));
  const nP = data.pumas.length;
  const pHh = new Float64Array(nP);
  const pHa = new Float64Array(nP);
  const pAcc = new Float64Array(nP);
  for (let z = 0; z < Z; z++) {
    const p = data.zonePuma[z];
    pHh[p] += zoneHh[z];
    pHa[p] += data.areaM2[z] / 10_000;
    pAcc[p] += zoneHh[z] * data.access[z];
  }
  const pDensity = Float64Array.from(pHh, (h, p) => (pHa[p] > 0 ? h / pHa[p] : 0));
  const pAccess = Float64Array.from(pHh, (h, p) => (h > 0 ? pAcc[p] / h : 0));

  // Stage 1: PUMS records. Features: constant, household dummies, PUMA density and access. A
  // dummy no record varies on is dropped (coefficient 0), and the PUMA terms need 3 PUMAs.
  const pumaIx = new Map(data.pumas.map((p, i) => [p, i]));
  const recs = pums.rows.filter((r) => r.wgtp > 0);
  const F1 = 1 + nH + 2;
  const x1 = new Float64Array(recs.length * F1);
  const c1 = new Uint8Array(recs.length);
  const w1 = new Float64Array(recs.length);
  const levelW = new Float64Array(CAR_LEVELS);
  const recPumas = new Set<number>();
  recs.forEach((r, i) => {
    const p = pumaIx.get(r.puma);
    if (p === undefined) throw new Error(`cars: PUMS record in unknown PUMA ${r.puma}`);
    recPumas.add(p);
    const owner = r.ten === 1 || r.ten === 2;
    const t = typeOfRow(bands, r, owner);
    x1[i * F1] = 1;
    x1.set(typeFeat[t], i * F1 + 1);
    x1[i * F1 + 1 + nH] = pDensity[p];
    x1[i * F1 + 2 + nH] = pAccess[p];
    c1[i] = Math.min(Math.max(r.veh, 0), CAR_LEVELS - 1);
    w1[i] = r.wgtp;
    levelW[c1[i]] += r.wgtp;
  });
  levelW.forEach((w, k) => {
    if (!(w > 0)) throw new Error(`cars: no PUMS household with ${['0', '1', '2', '3+'][k]} cars`);
  });
  const keep1 = new Array<boolean>(F1).fill(true);
  for (let j = 0; j < nH; j++) {
    let on = 0;
    for (let i = 0; i < recs.length; i++) on += w1[i] * x1[i * F1 + 1 + j];
    let all = 0;
    for (let i = 0; i < recs.length; i++) all += w1[i];
    keep1[1 + j] = on > 0 && on < all;
  }
  keep1[1 + nH] = keep1[2 + nH] = recPumas.size >= MIN_LOCATIONS;
  const s1 = fitKept(x1, F1, keep1, c1, w1, {});
  const hhTerms = terms(hf.names, s1.coef, s1.se, 1, keep1);
  const household = new Array<number>(T * 3).fill(0);
  for (let t = 0; t < T; t++)
    for (let k = 0; k < 3; k++) {
      let u = 0;
      for (let j = 0; j < nH; j++) u += typeFeat[t][j] * hhTerms[j].coef[k];
      household[t * 3 + k] = u;
    }

  // Stage 2: the start population as (zone, type, level) records with the household utility as
  // an offset. Features: constant, density, access; density and access need 3 zones with
  // households over which they vary.
  let n2 = 0;
  for (let i = 0; i < data.households.length; i++) if (data.households[i] > 0) n2++;
  const x2 = new Float64Array(n2 * 3);
  const c2 = new Uint8Array(n2);
  const w2 = new Float64Array(n2);
  const off2 = new Float64Array(n2 * 3);
  let j2 = 0;
  for (let z = 0; z < Z; z++)
    for (let t = 0; t < T; t++)
      for (let k = 0; k < CAR_LEVELS; k++) {
        const h = data.households[z * cells + t * CAR_LEVELS + k];
        if (!(h > 0)) continue;
        x2[j2 * 3] = 1;
        x2[j2 * 3 + 1] = density[z];
        x2[j2 * 3 + 2] = data.access[z];
        c2[j2] = k;
        w2[j2] = h;
        for (let l = 0; l < 3; l++) off2[j2 * 3 + l] = household[t * 3 + l];
        j2++;
      }
  const peopled = [...zoneHh.keys()].filter((z) => zoneHh[z] > 0);
  const varies = (v: Float64Array) =>
    peopled.length >= MIN_LOCATIONS && peopled.some((z) => v[z] !== v[peopled[0]]);
  const keep2 = [true, varies(density), varies(data.access)];
  // Stage 2's SEs are stated at the PUMS sample size (indicative: the zone shares are B25044's).
  const seN = recs.length;
  const s2 = fitKept(x2, 3, keep2, c2, w2, { offset: off2, seN });
  const s2n = keep2[2]
    ? fitKept(x2, 3, [true, keep2[1], false], c2, w2, { offset: off2, seN })
    : s2;
  const loc = terms(['constant', 'density', 'access'], s2.coef, s2.se, 0, keep2);
  const choice: CarModel['choice'] = {
    asc: loc[0].coef,
    household,
    location: { density: loc[1].coef, access: loc[2].coef },
    terms: [...hhTerms, ...loc].map((t) => ({ name: t.name, coef: t.coef })),
    provenance: {
      tier: 1,
      label:
        'fitted: ACS PUMS household terms, ACS B25044 block-group location terms and constants',
      sources: [
        {
          label: 'U.S. Census Bureau, ACS 5-year PUMS (household and person files)',
          url: 'https://www2.census.gov/programs-surveys/acs/data/pums/'
        },
        {
          label: 'U.S. Census Bureau, ACS 5-year B25044 by block group (table-based summary file)',
          url: 'https://www2.census.gov/programs-surveys/acs/summary_file/'
        }
      ],
      method:
        'Multinomial logit over 0, 1, 2, 3+ cars. Stage 1: household terms (size, workers, ' +
        'income band, tenure) on PUMS records weighted by WGTP, with PUMA-mean density and ' +
        'transit access. Stage 2: household terms fixed; constants, density (households per ' +
        'hectare) and access (transit grid, homes-weighted per block group) on the start ' +
        'population by block group. Zone constants (cars.bin) match each block group to B25044.',
      n: recs.length,
      window: pums.window
    }
  };

  // Zone constants. City type mix for zones with an observation and no start household.
  const cityMix = new Float64Array(T);
  for (let z = 0; z < Z; z++)
    for (let t = 0; t < T; t++)
      for (let k = 0; k < CAR_LEVELS; k++)
        cityMix[t] += data.households[z * cells + t * CAR_LEVELS + k];
  const constant = new Float64Array(Z * 3);
  const model = { choice } as CarModel;
  const zt = { access: data.access, constant };
  const fit: BgFit[] = [];
  const stats: FitStats['constants'] = {
    fitted: 0,
    noObservation: 0,
    cityMix: 0,
    floored: 0,
    maxErr: 0
  };
  const mix = new Float64Array(T);
  const base = new Float64Array(T * 3);
  const shares = new Float64Array(CAR_LEVELS);
  const target = new Float64Array(CAR_LEVELS);
  const pred = new Float64Array(CAR_LEVELS);
  const predict = (z: number, out: number[] | Float64Array) => {
    let m = 0;
    for (let t = 0; t < T; t++) m += mix[t];
    for (let k = 0; k < CAR_LEVELS; k++) out[k] = 0;
    for (let t = 0; t < T; t++) {
      if (mix[t] === 0) continue;
      carShares(model, zt, z, t, density[z], shares);
      for (let k = 0; k < CAR_LEVELS; k++) out[k] += (mix[t] / m) * shares[k];
    }
  };
  for (let z = 0; z < Z; z++) {
    const obs = Array.from(observed.subarray(z * CAR_LEVELS, (z + 1) * CAR_LEVELS));
    const obsTotal = obs.reduce((a, b) => a + b, 0);
    let own = 0;
    for (let t = 0; t < T; t++) {
      let s = 0;
      for (let k = 0; k < CAR_LEVELS; k++) s += data.households[z * cells + t * CAR_LEVELS + k];
      mix[t] = s;
      own += s;
    }
    if (own === 0) mix.set(cityMix);
    const before = [0, 0, 0, 0];
    predict(z, before);
    const row: BgFit = {
      geoid: data.zones[z],
      households: own,
      observed: obs,
      observedTotal: obsTotal,
      before,
      after: before
    };
    fit.push(row);
    if (!(obsTotal > 0)) {
      stats.noObservation++;
      continue;
    }
    stats.fitted++;
    if (own === 0) stats.cityMix++;
    let tsum = 0;
    for (let k = 0; k < CAR_LEVELS; k++) {
      target[k] = obs[k] / obsTotal;
      if (target[k] < OBS_FLOOR) {
        target[k] = OBS_FLOOR;
        stats.floored++;
      }
      tsum += target[k];
    }
    for (let k = 0; k < CAR_LEVELS; k++) target[k] /= tsum;
    fitConstants(z, T, mix, choice, density[z], data.access[z], target, base, constant, pred);
    const after = [0, 0, 0, 0];
    predict(z, after);
    row.after = after;
    for (let k = 0; k < CAR_LEVELS; k++)
      stats.maxErr = Math.max(stats.maxErr, Math.abs(after[k] - obs[k] / obsTotal));
  }

  return {
    choice,
    constant,
    fit,
    stats: {
      stage1: {
        records: recs.length,
        logLik: s1.logLik,
        iterations: s1.iterations,
        terms: [
          ...terms(['constant'], s1.coef, s1.se, 0, keep1),
          ...hhTerms,
          ...terms(['PUMA density', 'PUMA access'], s1.coef, s1.se, 1 + nH, keep1)
        ]
      },
      stage2: {
        zones: Z,
        logLik: s2.logLik,
        logLikNoAccess: s2n.logLik,
        iterations: s2.iterations,
        terms: loc
      },
      constants: stats
    }
  };
}

function typeOfRow(b: TypeBands, r: PumsRow, owner: boolean): number {
  const band = (edges: number[], x: number) => {
    let n = 0;
    for (const e of edges) if (e <= x) n++;
    return n === 0 ? 0 : n - 1;
  };
  const s = band(b.size, r.np);
  const w = band(b.workers, r.workers);
  const i = band(b.income, r.hincp_adj);
  return ((s * b.workers.length + w) * b.income.length + i) * 2 + (owner ? 0 : 1);
}

/**
 * One zone's constants: c_k += log(target_k / pred_k) - log(target_0 / pred_0) until every share
 * is within CONSTANTS.tol (the mixture over types makes it a contraction, not one step).
 */
function fitConstants(
  z: number,
  T: number,
  mix: Float64Array,
  choice: CarModel['choice'],
  density: number,
  access: number,
  target: Float64Array,
  base: Float64Array,
  constant: Float64Array,
  pred: Float64Array
): void {
  let m = 0;
  for (let t = 0; t < T; t++) m += mix[t];
  for (let t = 0; t < T; t++)
    for (let k = 0; k < 3; k++)
      base[t * 3 + k] = exp(
        choice.asc[k] +
          choice.household[t * 3 + k] +
          choice.location.density[k] * density +
          choice.location.access[k] * access
      );
  const c = [0, 0, 0];
  const ec = [1, 1, 1];
  for (let it = 0; it < CONSTANTS.maxIter; it++) {
    pred.fill(0);
    for (let t = 0; t < T; t++) {
      if (mix[t] === 0) continue;
      const e1 = base[t * 3] * ec[0];
      const e2 = base[t * 3 + 1] * ec[1];
      const e3 = base[t * 3 + 2] * ec[2];
      const w = mix[t] / m / (1 + e1 + e2 + e3);
      pred[0] += w;
      pred[1] += w * e1;
      pred[2] += w * e2;
      pred[3] += w * e3;
    }
    let err = 0;
    for (let k = 0; k < CAR_LEVELS; k++) err = Math.max(err, Math.abs(pred[k] - target[k]));
    if (err < CONSTANTS.tol) break;
    const d0 = log(target[0] / pred[0]);
    for (let k = 0; k < 3; k++) {
      c[k] += log(target[k + 1] / pred[k + 1]) - d0;
      ec[k] = exp(c[k]);
    }
  }
  for (let k = 0; k < 3; k++) constant[z * 3 + k] = c[k];
}
