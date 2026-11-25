// The car back-cast (spec "Back-cast"): the car model stepped over observed history, from the
// 2000 block-group households (SF3 H044 on today's block groups) through every ACS 5-year
// release, with the homes completed and lost in each month from the project records, transit
// access by year, and a table refresh each year, as the sim steps it (system.ts). Compared with
// each release citywide, by tract for the latest, and once more with a model fitted only on data
// through the 2009-2013 release (the held-out check). Pure: the step reads the tables and passes
// rows and the fitted models in.
import type { CarData } from '../../../src/lib/data/cars-codec';
import {
  CAR_LEVELS,
  CAR_P,
  MIXES,
  refreshTable,
  roundSystematic,
  splitSystematic,
  stepZone,
  type CarDraw,
  type CarModel,
  type CarState
} from '../../../src/lib/sim/cars';
import { drawOn, seedHash, streamOf, zoneEntity } from '../../../src/lib/sim/scenario/rng';
import type { ProjectHistory } from '../../../src/lib/timelapse/types';
import type { AcsRow } from './population';
import type { MoverRow } from './rates';

/** The held-out fit reads ACS releases and PUMS through this end year (the 2009-2013 release). */
export const HELD_OUT_THROUGH = 2013;
/** The start: the 2000 Census (SF3), April 1. */
export const BACKCAST_START = { year: 2000, month: 4 } as const;
/** The draws' seed; one future, so one seed. */
export const BACKCAST_SEED = 1;
/** Published zero-car shares (Streetsblog SF, from ACS), shown beside the pulled tables. */
export const PUBLISHED_NO_CAR: Readonly<Record<number, number>> = {
  2000: 0.286,
  2009: 0.298,
  2010: 0.303,
  2012: 0.314
};

/** B25044 (and SF3 H044, the same 15 cells): households, and those with no vehicle. */
export const NO_CAR = { total: 'B25044_001', owner: 'B25044_003', renter: 'B25044_010' } as const;

/** One ACS 5-year release on the zones (crosswalked where its block groups are older). */
export interface AcsRelease {
  /** End year: 2009 is 2005-2009. */
  year: number;
  /** Cells on the zones' GEOIDs. */
  rows: readonly AcsRow[];
  /** Citywide, from the release's own block groups. */
  city: { households: number; carless: number };
}

export interface PumsRelease {
  release: number;
  rows: readonly MoverRow[];
}

/** A fitted model and its zone data, `households` the start population on the model's types. */
export interface BackcastModel {
  model: CarModel;
  data: CarData;
}

/** Homes completed (`mix` an index of MIXES) or lost (`mix` -1) in a zone in a step month. */
export interface HomeFlow {
  /** 1 = the first month after the start (April 2000). */
  month: number;
  zone: number;
  mix: number;
  homes: number;
}

export interface BackcastInput {
  seed: number;
  start: { year: number; month: number };
  /** The last calendar year stepped (to its December). */
  endYear: number;
  zones: readonly string[];
  /** The start's observed share with no car (SF3), for the first row. */
  startObserved: number;
  releases: readonly AcsRelease[];
  pums: readonly PumsRelease[];
  /** The model on data of the given releases only (the held-out run passes those through 2013). */
  fit(o: { acs: readonly AcsRelease[]; pums: readonly PumsRelease[] }): BackcastModel;
  flows: readonly HomeFlow[];
  /** Zone access by calendar year; a year outside holds at the nearest. */
  access: readonly { year: number; access: Float64Array }[];
  /** Zone subsets compared as well (by release): observed and predicted over their zones. */
  subsets?: readonly { name: string; zones: Uint8Array }[];
}

export interface YearRow {
  year: number;
  observed: number;
  predicted: number;
}

export interface BackcastResult {
  start: 2000 | 2009;
  years: YearRow[];
  tracts: { tract: string; observed: number; predicted: number; households: number }[];
  heldOut: { fitThrough: 2013; year: number; observed: number; predicted: number };
  /** The held-out model's series, every release. */
  heldOutYears: YearRow[];
  subsets: { name: string; years: YearRow[] }[];
  /** Citywide after each month (0 = the start). */
  series: { month: number; households: number; carless: number }[];
  /** Households of `lost` homes a zone did not have, summed. */
  unmatched: number;
}

const L = CAR_LEVELS;
const NM = MIXES.length;

/** Share with no car of a release's cells over the zones `keep` marks (all when absent). */
export function noCarShare(
  rows: readonly AcsRow[],
  zones: readonly string[],
  keep?: Uint8Array
): { households: number; carless: number } {
  const zix = new Map(zones.map((z, i) => [z, i]));
  let households = 0;
  let carless = 0;
  for (const r of rows) {
    const z = zix.get(r.geoid);
    if (z === undefined || (keep && !keep[z])) continue;
    if (r.variable === NO_CAR.total) households += r.estimate;
    else if (r.variable === NO_CAR.owner || r.variable === NO_CAR.renter) carless += r.estimate;
  }
  return { households, carless };
}

/** Crosswalk weights: from GEOID to its parts in the newer vintage (weights sum to 1). */
export type Xwalk = Map<string, { to: string; weight: number }[]>;

export function xwalkOf(rows: readonly { from: string; to: string; weight: number }[]): Xwalk {
  const x: Xwalk = new Map();
  for (const r of rows) {
    if (!x.has(r.from)) x.set(r.from, []);
    x.get(r.from)!.push({ to: r.to, weight: r.weight });
  }
  return x;
}

/** a then b: 2000 → 2010 → 2020, each part's weight the product (parts merged by target). */
export function chainXwalk(a: Xwalk, b: Xwalk): Xwalk {
  const out: Xwalk = new Map();
  for (const [from, parts] of a) {
    const acc = new Map<string, number>();
    for (const p of parts)
      for (const q of b.get(p.to) ?? []) acc.set(q.to, (acc.get(q.to) ?? 0) + p.weight * q.weight);
    out.set(
      from,
      [...acc].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([to, weight]) => ({ to, weight }))
    );
  }
  return out;
}

/** Cells moved onto the newer GEOIDs by the weights (a GEOID with no weights is dropped). */
export function crosswalkRows(rows: readonly AcsRow[], x: Xwalk): AcsRow[] {
  const acc = new Map<string, number>();
  for (const r of rows)
    for (const p of x.get(r.geoid) ?? []) {
      const k = `${p.to}\u0000${r.variable}`;
      acc.set(k, (acc.get(k) ?? 0) + r.estimate * p.weight);
    }
  return [...acc]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, estimate]) => {
      const [geoid, variable] = k.split('\u0000');
      return { geoid, variable, estimate };
    });
}

/** SF3 H044 cells as B25044's (the same 15 cells: total, owner, owner 0..5+, renter, ...). */
export function h044AsB25044(rows: readonly { geoid: string; variable: string; value: number }[]) {
  return rows
    .filter((r) => /^H044\d{3}$/.test(r.variable))
    .map((r) => ({ geoid: r.geoid, variable: `B25044_${r.variable.slice(4)}`, estimate: r.value }));
}

/** Calendar month of a day number (days since 1970-01-01) as year * 12 + month - 1. */
const monthOfDay = (day: number): number => {
  const d = new Date(day * 86_400_000);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

/** Homes a history ends with: the latest stage's count (complete, then back to filed). */
export function completedHomes(h: ProjectHistory): number {
  for (const s of ['complete', 'permitIssued', 'permitFiled', 'entitled', 'filed'] as const) {
    const v = h.unitsAt[s];
    if (v !== undefined && Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

export interface FlowStats {
  completions: number;
  homes: number;
  affordableHomes: number;
  lost: number;
  /** Homes completed or lost whose parcels are in no zone (no lot today, or a lot in no zone). */
  unplacedHomes: number;
  unplacedLost: number;
}

/**
 * Monthly flows from the project records: each completed history's homes in its completion month,
 * placed at the zone of its first parcel that is a lot today; its Planning-proposed affordable
 * homes (when recorded) split over the affordable tiers by `tiers`, the rest market; each history
 * entering construction loses its existing homes in that month. Months before the start or after
 * `endYear` are left out.
 */
export function historyFlows(
  histories: readonly ProjectHistory[],
  lotIndex: ReadonlyMap<string, number>,
  lotZone: Int32Array,
  start: { year: number; month: number },
  endYear: number,
  tiers: { veryLow: number; low: number; moderate: number }
): { flows: HomeFlow[]; stats: FlowStats } {
  const m0 = start.year * 12 + start.month - 1;
  const last = endYear * 12 + 11;
  const flows: HomeFlow[] = [];
  const stats: FlowStats = {
    completions: 0,
    homes: 0,
    affordableHomes: 0,
    lost: 0,
    unplacedHomes: 0,
    unplacedLost: 0
  };
  const zoneOf = (h: ProjectHistory): number => {
    for (const id of h.parcelIds) {
      const lot = lotIndex.get(id);
      if (lot !== undefined) return lotZone[lot];
    }
    return -1;
  };
  const tierW = [tiers.veryLow, tiers.low, tiers.moderate];
  const split = new Int32Array(3);
  for (const h of histories) {
    const zone = zoneOf(h);
    const con = h.entered.construction;
    if (con !== undefined && h.existingUnits > 0) {
      const cm = monthOfDay(con);
      if (cm >= m0 && cm <= last) {
        stats.lost += h.existingUnits;
        if (zone < 0) stats.unplacedLost += h.existingUnits;
        else flows.push({ month: cm - m0 + 1, zone, mix: -1, homes: h.existingUnits });
      }
    }
    if (h.end.kind !== 'complete') continue;
    const cm = monthOfDay(h.end.day);
    const homes = completedHomes(h);
    if (cm < m0 || cm > last || homes <= 0) continue;
    stats.completions++;
    stats.homes += homes;
    if (zone < 0) {
      stats.unplacedHomes += homes;
      continue;
    }
    const month = cm - m0 + 1;
    const aff = Math.min(homes, Math.max(0, h.planningProposed?.affordable ?? 0));
    if (aff > 0) {
      stats.affordableHomes += aff;
      splitSystematic(aff, tierW, 0.5, split);
      for (let k = 0; k < 3; k++)
        if (split[k] > 0) flows.push({ month, zone, mix: k + 1, homes: split[k] });
    }
    if (homes - aff > 0) flows.push({ month, zone, mix: 0, homes: homes - aff });
  }
  flows.sort((a, b) => a.month - b.month || a.zone - b.zone || a.mix - b.mix);
  return { flows, stats };
}

interface Run {
  /** Per step month (0 = start): citywide households and households with no car. */
  hh: Float64Array;
  carless: Float64Array;
  /** Per release, per zone: households and carless summed over the release's months. */
  zoneHh: Float64Array[];
  zoneCarless: Float64Array[];
  unmatched: number;
}

/** One run of a model from its start population over the flows; sums per release window. */
function step(o: BackcastInput, bm: BackcastModel, months: number): Run {
  const { model, data } = bm;
  const Z = o.zones.length;
  const T = data.types;
  if (data.zones.length !== Z) throw new Error('cars: back-cast model zones differ from input');
  const s: CarState = {
    zones: Z,
    types: T,
    hh: Int32Array.from(data.households),
    table: new Float64Array(Z * T * L)
  };
  const terms: CarData = { ...data, access: new Float64Array(Z) };
  const accessOf = (year: number): Float64Array => {
    const a = o.access;
    if (a.length === 0) return data.access;
    let best = a[0];
    for (const x of a) if (Math.abs(x.year - year) < Math.abs(best.year - year)) best = x;
    return best.access;
  };
  const entity = Float64Array.from(o.zones, (g) => zoneEntity(g));
  const sh = seedHash(o.seed);
  const m0 = o.start.year * 12 + o.start.month - 1;
  const windows = o.releases.map((r) => [(r.year - 4) * 12, r.year * 12 + 11]);
  const run: Run = {
    hh: new Float64Array(months + 1),
    carless: new Float64Array(months + 1),
    zoneHh: o.releases.map(() => new Float64Array(Z)),
    zoneCarless: o.releases.map(() => new Float64Array(Z)),
    unmatched: 0
  };
  const record = (m: number) => {
    const cal = m0 + m - 1;
    let n = 0;
    let c = 0;
    for (let z = 0; z < Z; z++) {
      let zn = 0;
      let zc = 0;
      for (let i = z * T * L; i < (z + 1) * T * L; i += L) {
        zn += s.hh[i] + s.hh[i + 1] + s.hh[i + 2] + s.hh[i + 3];
        zc += s.hh[i];
      }
      n += zn;
      c += zc;
      if (m === 0) continue;
      for (let r = 0; r < windows.length; r++)
        if (cal >= windows[r][0] && cal <= windows[r][1]) {
          run.zoneHh[r][z] += zn;
          run.zoneCarless[r][z] += zc;
        }
    }
    run.hh[m] = n;
    run.carless[m] = c;
  };
  record(0);
  const pendFill = new Int32Array(Z * NM);
  const pendLost = new Int32Array(Z);
  const fills = new Int32Array(NM);
  let f = 0;
  for (let m = 1; m <= months; m++) {
    if ((m - 1) % model.refreshMonths === 0) {
      terms.access = accessOf(o.start.year + Math.floor((o.start.month - 1 + m - 1) / 12));
      refreshTable(s, model, terms);
    }
    pendFill.fill(0);
    pendLost.fill(0);
    for (; f < o.flows.length && o.flows[f].month <= m; f++) {
      const x = o.flows[f];
      if (x.month < m) continue;
      if (x.mix < 0) pendLost[x.zone] += x.homes;
      else pendFill[x.zone * NM + x.mix] += x.homes;
    }
    let curZone = -1;
    let cur = 0;
    const draw: CarDraw = (zone, purpose, index) => {
      if (zone !== curZone) {
        curZone = zone;
        cur = streamOf(sh, entity[zone], m);
      }
      return drawOn(cur, purpose, index);
    };
    for (let z = 0; z < Z; z++) {
      const occ = data.occupied[z];
      for (let k = 0; k < NM; k++) {
        const homes = pendFill[z * NM + k];
        fills[k] = homes > 0 ? roundSystematic(occ * homes, draw(z, CAR_P.OCCUPY, k)) : 0;
      }
      const homes = pendLost[z];
      const lost = homes > 0 ? roundSystematic(occ * homes, draw(z, CAR_P.OCCUPY, NM)) : 0;
      run.unmatched += stepZone(s, model, terms, z, fills, lost, draw);
    }
    record(m);
  }
  return run;
}

/** Observed and predicted (households-weighted over the release's months) for every release. */
function yearRows(
  o: BackcastInput,
  run: Run,
  keep?: Uint8Array
): { year: number; observed: number; predicted: number }[] {
  return o.releases.map((r, i) => {
    const obs = keep ? noCarShare(r.rows, o.zones, keep) : r.city;
    let n = 0;
    let c = 0;
    for (let z = 0; z < o.zones.length; z++) {
      if (keep && !keep[z]) continue;
      n += run.zoneHh[i][z];
      c += run.zoneCarless[i][z];
    }
    return {
      year: r.year,
      observed: obs.households > 0 ? obs.carless / obs.households : NaN,
      predicted: n > 0 ? c / n : NaN
    };
  });
}

/**
 * The back-cast: the model fitted on every release steps from the start over the flows; so does
 * the one fitted on releases and PUMS through HELD_OUT_THROUGH. Each release compares the observed
 * share with no car to the model's, households-weighted over the release's five years.
 */
export function runBackcast(o: BackcastInput): BackcastResult {
  if (o.releases.length === 0) throw new Error('cars: the back-cast has no ACS release');
  const months = o.endYear * 12 + 11 - (o.start.year * 12 + o.start.month - 1);
  const full = step(o, o.fit({ acs: o.releases, pums: o.pums }), months);
  const held = step(
    o,
    o.fit({
      acs: o.releases.filter((r) => r.year <= HELD_OUT_THROUGH),
      pums: o.pums.filter((p) => p.release <= HELD_OUT_THROUGH)
    }),
    months
  );
  const start = {
    year: o.start.year,
    observed: o.startObserved,
    predicted: full.hh[0] > 0 ? full.carless[0] / full.hh[0] : NaN
  };
  const years = [start, ...yearRows(o, full)];
  const heldOutYears = yearRows(o, held);
  const last = o.releases.length - 1;
  const latest = o.releases[last];
  const heldLatest = heldOutYears[last];

  // Tracts of the latest release.
  const byTract = new Map<string, { n: number; c: number; on: number; oc: number }>();
  const zix = new Map(o.zones.map((z, i) => [z, i]));
  o.zones.forEach((g, z) => {
    const t = g.slice(0, 11);
    if (!byTract.has(t)) byTract.set(t, { n: 0, c: 0, on: 0, oc: 0 });
    const x = byTract.get(t)!;
    x.n += full.zoneHh[last][z];
    x.c += full.zoneCarless[last][z];
  });
  for (const r of latest.rows) {
    const z = zix.get(r.geoid);
    if (z === undefined) continue;
    const x = byTract.get(r.geoid.slice(0, 11))!;
    if (r.variable === NO_CAR.total) x.on += r.estimate;
    else if (r.variable === NO_CAR.owner || r.variable === NO_CAR.renter) x.oc += r.estimate;
  }
  const tracts = [...byTract]
    .filter(([, x]) => x.on > 0 && x.n > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([tract, x]) => ({
      tract,
      observed: x.oc / x.on,
      predicted: x.c / x.n,
      households: x.on
    }));

  return {
    start: o.start.year === 2000 ? 2000 : 2009,
    years,
    tracts,
    heldOut: {
      fitThrough: HELD_OUT_THROUGH,
      year: latest.year,
      observed: heldLatest.observed,
      predicted: heldLatest.predicted
    },
    heldOutYears,
    subsets: (o.subsets ?? []).map((x) => ({ name: x.name, years: yearRows(o, full, x.zones) })),
    series: Array.from(full.hh, (households, month) => ({
      month,
      households,
      carless: full.carless[month]
    })),
    unmatched: full.unmatched
  };
}
