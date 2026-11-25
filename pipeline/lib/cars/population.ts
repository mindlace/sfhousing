// The start household population: PUMS households of each zone's PUMA, reweighted (IPF) to the
// zone's ACS margins, scaled to its occupied homes and integerised per zone. Pure; the step reads
// the tables and passes rows in.
import { CAR_LEVELS, splitSystematic, typeIndex, type TypeBands } from '../../../src/lib/sim/cars';
import { B19001_EDGES, MARGINS, OCCUPANCY, ROUND_U, isOwner } from './config';
import { balance } from './ipf';

/** One occupied PUMS household (src_pums_hh, the columns the population needs). */
export interface PumsRow {
  puma: string;
  wgtp: number;
  veh: number;
  np: number;
  workers: number;
  hincp_adj: number;
  ten: number;
}

/** One ACS block-group cell (src_acs_bg of one release). */
export interface AcsRow {
  geoid: string;
  variable: string;
  estimate: number;
}

/** The PUMS records as struct-of-arrays: PUMA index, weight, type, car level, margin classes. */
export interface Seed {
  puma: Int32Array;
  weight: Float64Array;
  type: Int32Array;
  level: Int32Array;
  workers: Int32Array;
  /** One array per MARGINS entry: the record's class in it. */
  classes: Int32Array[];
}

/** Count of edges <= x, minus one, clamped to 0. */
function bracket(edges: readonly number[], x: number): number {
  let n = 0;
  for (const e of edges) if (e <= x) n++;
  return n === 0 ? 0 : n - 1;
}

/** Class each record on the household type, its car level (0, 1, 2, 3+) and every margin. */
export function pumsSeed(rows: readonly PumsRow[], bands: TypeBands, pumas: string[]): Seed {
  const n = rows.length;
  const s: Seed = {
    puma: new Int32Array(n),
    weight: new Float64Array(n),
    type: new Int32Array(n),
    level: new Int32Array(n),
    workers: new Int32Array(n),
    classes: MARGINS.map(() => new Int32Array(n))
  };
  const pumaIx = new Map(pumas.map((p, i) => [p, i]));
  rows.forEach((r, i) => {
    const owner = isOwner(r.ten);
    const tenure = owner ? 0 : 4;
    const p = pumaIx.get(r.puma);
    if (p === undefined) throw new Error(`cars: PUMS record in unknown PUMA ${r.puma}`);
    s.puma[i] = p;
    s.weight[i] = r.wgtp;
    s.type[i] = typeIndex(bands, r.np, r.workers, r.hincp_adj, owner);
    s.level[i] = Math.min(Math.max(r.veh, 0), CAR_LEVELS - 1);
    s.workers[i] = r.workers;
    s.classes[0][i] = tenure + s.level[i];
    s.classes[1][i] = tenure + Math.min(Math.max(r.np, 1), 4) - 1;
    s.classes[2][i] = bracket(B19001_EDGES, r.hincp_adj);
  });
  return s;
}

/**
 * Each zone's margins, in MARGINS order: the class targets from the ACS cells, or null when the
 * zone has no row for that table or its cells sum to zero.
 */
export function acsMargins(
  rows: readonly AcsRow[],
  zones: readonly string[]
): (Float64Array | null)[][] {
  const zix = new Map(zones.map((z, i) => [z, i]));
  const out = zones.map(() => MARGINS.map((m) => new Float64Array(m.size)));
  const seen = zones.map(() => MARGINS.map(() => false));
  const byCell = new Map<string, [number, number]>();
  MARGINS.forEach((m, k) => {
    for (const [cell, c] of Object.entries(m.cells)) byCell.set(cell, [k, c]);
  });
  for (const r of rows) {
    const z = zix.get(r.geoid);
    const hit = byCell.get(r.variable);
    if (z === undefined || !hit) continue;
    out[z][hit[0]][hit[1]] += Math.max(0, r.estimate);
    seen[z][hit[0]] = true;
  }
  return out.map((ms, z) =>
    ms.map((t, k) => (seen[z][k] && t.reduce((a, b) => a + b, 0) > 0 ? t : null))
  );
}

/**
 * Occupied share of homes per zone (B25002 occupied over total), held constant by the sim. A zone
 * with no total takes the citywide share; `fallback` counts them.
 */
export function occupiedShares(
  rows: readonly AcsRow[],
  zones: readonly string[]
): { occupied: Float64Array; fallback: number } {
  const zix = new Map(zones.map((z, i) => [z, i]));
  const total = new Float64Array(zones.length);
  const occ = new Float64Array(zones.length);
  for (const r of rows) {
    const z = zix.get(r.geoid);
    if (z === undefined) continue;
    if (r.variable === OCCUPANCY.total) total[z] += r.estimate;
    else if (r.variable === OCCUPANCY.occupied) occ[z] += r.estimate;
  }
  let T = 0;
  let O = 0;
  for (let z = 0; z < zones.length; z++) {
    T += total[z];
    O += occ[z];
  }
  const city = T > 0 ? O / T : 0;
  const occupied = new Float64Array(zones.length);
  let fallback = 0;
  for (let z = 0; z < zones.length; z++) {
    if (total[z] > 0) occupied[z] = Math.min(1, Math.max(0, occ[z] / total[z]));
    else {
      occupied[z] = city;
      fallback++;
    }
  }
  return { occupied, fallback };
}

/** Homes per zone: the sum of existingUnits over each zone's lots (lots in no zone left out). */
export function zoneHomes(
  lotZone: Int32Array,
  existingUnits: ArrayLike<number>,
  zones: number
): Int32Array {
  const homes = new Int32Array(zones);
  for (let i = 0; i < lotZone.length; i++)
    if (lotZone[i] >= 0) homes[lotZone[i]] += existingUnits[i];
  return homes;
}

/** A zone's start households: round(occupied x homes), as floor(x + 0.5). V38 checks it. */
export function startTotal(occupied: number, homes: number): number {
  return Math.floor(occupied * homes + ROUND_U);
}

export interface PopulationIn {
  types: number;
  zonePuma: Int32Array;
  homes: Int32Array;
  occupied: Float64Array;
  seed: Seed;
  /** Per zone, per margin: class targets (any scale) or null. */
  margins: (Float64Array | null)[][];
  /**
   * Per zone, car-level targets (0, 1, 2, 3+; any scale) that replace B25044's tenure-by-vehicles
   * margin (MARGINS[0]): the choice's shrunk shares, so the start agrees with the model. Null (or
   * absent) keeps B25044. Tenure stays controlled by B25009.
   */
  levels?: (Float64Array | null)[];
  ipf: { maxIter: number; tol: number };
}

export interface PopulationOut {
  /** zones x types x CAR_LEVELS. */
  households: Int32Array;
  /** Per zone: IPF's largest relative miss (0 with no margins or no households). */
  maxRelErr: Float64Array;
  iterations: Int32Array;
  /** Per zone: workers of the raked records, scaled to the zone's households (a cross-check). */
  workers: Float64Array;
  /** Zones with households but no margin: the PUMA's PUMS mix as it is. */
  seedOnly: number;
}

/**
 * Households per zone, type and car level. A zone holds round(occupied x homes) households
 * (floor(x + 0.5)); its PUMA's records are raked to the zone's margins, each margin scaled to
 * that total, and the type-by-level weights split it with `splitSystematic` at u = 0.5, so each
 * zone's total is exact.
 */
export function startPopulation(o: PopulationIn): PopulationOut {
  const Z = o.homes.length;
  const cells = o.types * CAR_LEVELS;
  const households = new Int32Array(Z * cells);
  const maxRelErr = new Float64Array(Z);
  const iterations = new Int32Array(Z);
  const workers = new Float64Array(Z);
  let seedOnly = 0;
  // Records by PUMA, in record order.
  const byPuma = new Map<number, number[]>();
  for (let i = 0; i < o.seed.puma.length; i++) {
    const p = o.seed.puma[i];
    if (!byPuma.has(p)) byPuma.set(p, []);
    byPuma.get(p)!.push(i);
  }
  const mass = new Float64Array(cells);
  const out = new Int32Array(cells);
  for (let z = 0; z < Z; z++) {
    const n = startTotal(o.occupied[z], o.homes[z]);
    if (n <= 0) continue;
    const recs = byPuma.get(o.zonePuma[z]);
    if (!recs || recs.length === 0)
      throw new Error(`cars: zone ${z} has households but its PUMA has no PUMS record`);
    const seed = Float64Array.from(recs, (i) => o.seed.weight[i]);
    const rows: Int32Array[] = [];
    const targets: Float64Array[] = [];
    const levels = o.levels?.[z] ?? null;
    o.margins[z].forEach((t, k) => {
      if (k === 0 && levels) {
        const sum = levels.reduce((a, b) => a + b, 0);
        rows.push(Int32Array.from(recs, (i) => o.seed.level[i]));
        targets.push(Float64Array.from(levels, (v) => (v / sum) * n));
        return;
      }
      if (!t) return;
      const sum = t.reduce((a, b) => a + b, 0);
      rows.push(Int32Array.from(recs, (i) => o.seed.classes[k][i]));
      targets.push(Float64Array.from(t, (v) => (v / sum) * n));
    });
    if (rows.length === 0) seedOnly++;
    const r = balance(seed, rows, targets, o.ipf);
    maxRelErr[z] = r.maxRelErr;
    iterations[z] = r.iterations;
    mass.fill(0);
    let total = 0;
    for (const v of r.weights) total += v;
    // Margins that zero every record (none of them fit) fall back to the PUMA mix.
    const w = total > 0 ? r.weights : seed;
    if (!(total > 0)) maxRelErr[z] = 1;
    let wk = 0;
    let wsum = 0;
    recs.forEach((i, j) => {
      mass[o.seed.type[i] * CAR_LEVELS + o.seed.level[i]] += w[j];
      wk += w[j] * o.seed.workers[i];
      wsum += w[j];
    });
    workers[z] = (wk / wsum) * n;
    splitSystematic(n, mass, ROUND_U, out);
    households.set(out, z * cells);
  }
  return { households, maxRelErr, iterations, workers, seedOnly };
}
