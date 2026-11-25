// The car model's turnover and new-building parts (spec "When cars change", "Parking in new
// buildings"): monthly move rates by household type and the movers' refill mix per PUMA, from PUMS
// "when moved in" (MV); the type mixes of new homes' households (market and each affordable tier)
// from PUMS recent movers into recently built homes, with the tiers' income limits from SF's AMI
// table; and the parking facts with each cost per space brought to one dollars year. Pure: the
// step reads the tables and files.
import {
  MIXES,
  typeCount,
  typeIndex,
  type CarModel,
  type Mix,
  type TypeBands
} from '../../../src/lib/sim/cars';
import { AMI_TIER_BOUNDS } from '../../../src/lib/sim/finance/tiers';
import { exp, log } from '../../../src/lib/timelapse/math';
import type { Provenance } from '../../../src/lib/timelapse/types';
import type { AmiFile } from '../../enrichment/ami-schema';
import type { CpiFile } from '../../enrichment/cpi-schema';
import type { MarketFile } from '../../enrichment/market-schema';
import type { ParkingFile } from '../../enrichment/parking-schema';
import { isOwner } from './config';
import type { PumsRow } from './population';

/** One PUMS household with the columns moves and new homes read (src_pums_hh). */
export interface MoverRow extends PumsRow {
  /** MV, when moved in: 1 = 12 months or less. */
  mv: number | null;
  /** The built-year code of the file's column (`ybl_src`: YBL or YRBLT). */
  ybl: number | null;
  ybl_src: string;
}

/** PUMS MV code of a household that moved in within the last 12 months. */
export const MOVED_WITHIN_YEAR = 1;
/** A type's own move rate needs this many PUMS records; fewer take its tenure's rate. */
export const MIN_CELL_RECORDS = 30;
/** New homes are those built in the last this-many years before the release, as the codes allow. */
export const RECENT_BUILD_YEARS = 10;
/** Months between the car system's refreshes (spec "When cars change"). */
export const REFRESH_MONTHS = 12;

const PUMS_SOURCE = {
  label: 'U.S. Census Bureau, ACS 5-year PUMS (household and person files)',
  url: 'https://www2.census.gov/programs-surveys/acs/data/pums/'
};

/**
 * Below-grade cost per space derived from two SF figures, for the report beside the cited cost:
 * the Controller's 2026 parking hard cost per gross square foot ($245 to $360, Triennial Review of
 * Economic Feasibility 2026, p. 11) times about 400 square feet of building per space (Seifel for
 * Planning, Central SoMa, 2016; Planning's post-2019 project records give 353 to 403). An
 * inference, never used by the model (docs/dev/cars-data.md, Cost per space).
 */
export const COST_CROSS_CHECK = { perGsf: [245, 360] as const, gsfPerSpace: 400, year: 2026 };

/** Monthly rate of an annual probability p: 1 - (1 - p)^(1/12), fdlibm exp and log. */
export function monthlyRate(p: number): number {
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  return 1 - exp(log(1 - p) / 12);
}

export interface TenureRate {
  records: number;
  households: number;
  annual: number;
  perMonth: number;
}

export interface MoveStats {
  records: number;
  /** Records without MV, left out. */
  noMv: number;
  tenure: { owner: TenureRate; renter: TenureRate };
  /** Types with fewer than MIN_CELL_RECORDS records: their tenure's rate. */
  fallback: number;
  perMonthRange: [number, number];
}

/**
 * Move rates by type (`perMonth`, T). A type's annual rate is its WGTP-weighted share of
 * households with MV 1; a type with fewer than MIN_CELL_RECORDS records takes its tenure's share
 * (a tenure with no record, the citywide share). Movers are replaced type for type by the same
 * rates (`stepZone`: arrivals by type in proportion to departures), so the refill needs nothing
 * more and a zone keeps its composition.
 */
export function moveRates(
  rows: readonly MoverRow[],
  bands: TypeBands,
  window: [string, string]
): { moves: CarModel['moves']; stats: MoveStats; warnings: string[] } {
  const T = typeCount(bands);
  const n = new Int32Array(T);
  const w = new Float64Array(T);
  const wm = new Float64Array(T);
  const ten = { owner: [0, 0, 0], renter: [0, 0, 0] }; // records, weight, mover weight
  let used = 0;
  let noMv = 0;
  for (const r of rows) {
    if (r.mv === null) {
      noMv++;
      continue;
    }
    const owner = isOwner(r.ten);
    const t = typeIndex(bands, r.np, r.workers, r.hincp_adj, owner);
    const moved = r.mv === MOVED_WITHIN_YEAR;
    const c = owner ? ten.owner : ten.renter;
    used++;
    n[t]++;
    w[t] += r.wgtp;
    c[0]++;
    c[1] += r.wgtp;
    if (!moved) continue;
    wm[t] += r.wgtp;
    c[2] += r.wgtp;
  }
  const cityAll = ten.owner[1] + ten.renter[1];
  if (!(cityAll > 0)) throw new Error('cars: no PUMS household with a move-in year (MV)');
  const cityAnnual = (ten.owner[2] + ten.renter[2]) / cityAll;
  const tenureRate = (c: number[]): TenureRate => {
    const annual = c[1] > 0 ? c[2] / c[1] : cityAnnual;
    return { records: c[0], households: c[1], annual, perMonth: monthlyRate(annual) };
  };
  const tenure = { owner: tenureRate(ten.owner), renter: tenureRate(ten.renter) };
  let fallback = 0;
  const perMonth = Array.from({ length: T }, (_, t) => {
    if (n[t] >= MIN_CELL_RECORDS && w[t] > 0) return monthlyRate(wm[t] / w[t]);
    fallback++;
    // Tenure is the type index's last digit: owner 0, renter 1.
    return t % 2 === 0 ? tenure.owner.perMonth : tenure.renter.perMonth;
  });
  if (!(ten.owner[2] + ten.renter[2] > 0))
    throw new Error('cars: no PUMS household moved in within 12 months (MV 1)');
  const provenance: Provenance = {
    tier: 1,
    label: 'ACS PUMS households by when moved in (MV), by type',
    sources: [PUMS_SOURCE],
    method:
      "A type's annual move rate is the WGTP-weighted share of its households that moved in " +
      'within 12 months (MV 1); monthly = 1 - (1 - annual)^(1/12). A type with fewer than ' +
      `${MIN_CELL_RECORDS} records takes its tenure's rate. A zone's movers are replaced type ` +
      "for type in proportion to its departures (the type's rate times its households), so " +
      'the zone keeps its composition.',
    n: used,
    window
  };
  return {
    moves: { perMonth, provenance },
    stats: {
      records: used,
      noMv,
      tenure,
      fallback,
      perMonthRange: [Math.min(...perMonth), Math.max(...perMonth)]
    },
    warnings: []
  };
}

/**
 * Lower year of each built-year code. YRBLT (2020 on): the code is the year, decades before 2020
 * (1939 = 1939 or earlier). YBL (2009-2013 data dictionary): 1 = 1939 or earlier, 2-7 = the
 * decades 1940-1990, 8 = 2000-2004, 9-17 = single years 2005-2013.
 */
function codeEdges(src: string, release: number): { code: number; year: number }[] {
  if (src === 'YRBLT') {
    const out = [{ code: 1939, year: 1939 }];
    for (let y = 1940; y <= 2010; y += 10) out.push({ code: y, year: y });
    for (let y = 2020; y <= release; y++) out.push({ code: y, year: y });
    return out;
  }
  if (src === 'YBL') {
    const years = [1939, 1940, 1950, 1960, 1970, 1980, 1990, 2000];
    for (let y = 2005; y <= 2013; y++) years.push(y);
    return years.map((year, i) => ({ code: i + 1, year }));
  }
  throw new Error(`cars: unknown PUMS built-year column ${src}`);
}

/**
 * The first built-year code of a new home: the latest code whose lower year is at or before
 * release - RECENT_BUILD_YEARS, so new homes cover at least the last decade the codes allow.
 */
export function builtFromCutoff(release: number, src: string): { code: number; year: number } {
  const edges = codeEdges(src, release);
  let best = edges[0];
  for (const e of edges) if (e.year <= release - RECENT_BUILD_YEARS) best = e;
  return best;
}

export interface NewHomeStats {
  release: number;
  builtFrom: number;
  amiYear: number;
  /** Records in each mix. */
  records: Record<Mix, number>;
  /** WGTP households in each mix. */
  households: Record<Mix, number>;
  /** Mixes with no new-home record: recent movers into homes of any age. */
  allHomes: Mix[];
  /** Where the affordable tier shares come from. */
  tiersFrom: 'projects' | 'pums';
  byTier: { veryLow: number; low: number; moderate: number };
}

/**
 * The new-home type mixes: `market` from PUMS households that moved in within 12 months (MV 1)
 * into homes built from `builtFromCutoff`; each affordable tier's mix restricts those to incomes
 * at or below the tier's AMI bound (AMI_TIER_BOUNDS) for the household's size in the release's
 * AMI year (incomes are in the release's dollars, ADJINC). A tier with no such record drops the
 * built-year limit (warned). `affordableTiers` is `byTier` (the dataset's affordable completions,
 * projects.json rhnaCompletedNet.byTier) renormalised; when it sums to 0 (ruling P4), the new-home
 * movers at or below the moderate limit, split into the tiers by the same AMI table (warned).
 */
export function newHomeMixes(
  rows: readonly MoverRow[],
  bands: TypeBands,
  ami: AmiFile,
  byTier: { veryLow: number; low: number; moderate: number },
  o: { release: number; window: [string, string] }
): { newHomes: CarModel['newHomes']; stats: NewHomeStats; warnings: string[] } {
  const T = typeCount(bands);
  const srcs = [...new Set(rows.map((r) => r.ybl_src))];
  if (srcs.length !== 1)
    throw new Error(`cars: PUMS rows carry ${srcs.length} built-year columns (${srcs.join(', ')})`);
  const cut = builtFromCutoff(o.release, srcs[0]);
  const year = ami.years.filter((y) => y.year <= o.release).at(-1);
  if (!year) throw new Error(`cars: no SF AMI year at or before PUMS ${o.release} (ami.json)`);
  const bound = AMI_TIER_BOUNDS.value;
  const share = (r: MoverRow) => r.hincp_adj / year.bySize[Math.min(Math.max(r.np, 1), 8) - 1];
  const movers = rows.filter((r) => r.mv === MOVED_WITHIN_YEAR);
  const recent = movers.filter((r) => r.ybl !== null && r.ybl >= cut.code);
  const keep: Record<Mix, (r: MoverRow) => boolean> = {
    market: () => true,
    veryLow: (r) => share(r) <= bound.veryLow,
    low: (r) => share(r) <= bound.low,
    moderate: (r) => share(r) <= bound.moderate
  };
  const warnings: string[] = [];
  const allHomes: Mix[] = [];
  const records = {} as Record<Mix, number>;
  const households = {} as Record<Mix, number>;
  const mix = {} as Record<Mix, number[]>;
  const typeOf = (r: MoverRow) => typeIndex(bands, r.np, r.workers, r.hincp_adj, isOwner(r.ten));
  for (const m of MIXES) {
    let pool = recent.filter(keep[m]);
    if (pool.length === 0) {
      pool = movers.filter(keep[m]);
      allHomes.push(m);
      warnings.push(
        `cars: no PUMS mover into a home built from ${cut.year} in the ${m} mix; it takes ` +
          'movers into homes of any age'
      );
    }
    const v = new Float64Array(T);
    let total = 0;
    for (const r of pool) {
      v[typeOf(r)] += r.wgtp;
      total += r.wgtp;
    }
    if (!(total > 0)) throw new Error(`cars: no PUMS mover for the ${m} new-home mix`);
    mix[m] = Array.from(v, (x) => x / total);
    records[m] = pool.length;
    households[m] = total;
  }

  const sourceSum = byTier.veryLow + byTier.low + byTier.moderate;
  let affordableTiers: CarModel['newHomes']['affordableTiers'];
  let tiersFrom: NewHomeStats['tiersFrom'] = 'projects';
  if (sourceSum > 0) {
    affordableTiers = {
      veryLow: byTier.veryLow / sourceSum,
      low: byTier.low / sourceSum,
      moderate: byTier.moderate / sourceSum
    };
  } else {
    tiersFrom = 'pums';
    const pool = (recent.some(keep.moderate) ? recent : movers).filter(keep.moderate);
    const t = { veryLow: 0, low: 0, moderate: 0 };
    for (const r of pool) {
      const s = share(r);
      t[s <= bound.veryLow ? 'veryLow' : s <= bound.low ? 'low' : 'moderate'] += r.wgtp;
    }
    const total = t.veryLow + t.low + t.moderate;
    if (!(total > 0)) throw new Error('cars: no PUMS mover at or below the moderate AMI limit');
    affordableTiers = {
      veryLow: t.veryLow / total,
      low: t.low / total,
      moderate: t.moderate / total
    };
    warnings.push(
      "cars: the dataset's affordable completions by tier (rhnaCompletedNet.byTier very low, " +
        'low, moderate) sum to 0; the tier shares are the PUMS new-home movers at or below the ' +
        'moderate AMI limit, split by the AMI table'
    );
  }

  const provenance: Provenance = {
    tier: 1,
    label: 'ACS PUMS recent movers into recently built homes, by type; tiers by SF AMI',
    sources: [
      PUMS_SOURCE,
      ...ami.sources.slice(-1).map((s) => ({ label: s.label, url: s.url })),
      ...(tiersFrom === 'projects'
        ? [
            {
              label: 'DataSF Housing Production (xdht-4php)',
              url: 'https://data.sf.gov/d/xdht-4php'
            }
          ]
        : [])
    ],
    method:
      `Market: type shares (WGTP) of households that moved in within 12 months (MV 1) into ` +
      `homes built from ${cut.year} (${srcs[0]} code ${cut.code} on; the latest code at or ` +
      `before ${o.release} - ${RECENT_BUILD_YEARS}). Each affordable tier: the same, at incomes ` +
      `(HINCP x ADJINC) at or below ${bound.veryLow}, ${bound.low} or ${bound.moderate} of SF ` +
      `AMI ${year.year} for the household's size (MOHCD, ami.json). Tier shares: ` +
      (tiersFrom === 'projects'
        ? 'net affordable homes completed by tier since the RHNA window opened ' +
          '(projects.json rhnaCompletedNet.byTier, very low, low and moderate renormalised).'
        : 'the PUMS new-home movers at or below the moderate limit split by tier (the ' +
          "dataset's completions by tier sum to 0)."),
    n: recent.length,
    window: o.window
  };
  return {
    newHomes: { mix, affordableTiers, provenance },
    stats: {
      release: o.release,
      builtFrom: cut.year,
      amiYear: year.year,
      records,
      households,
      allHomes,
      tiersFrom,
      byTier: { ...byTier }
    },
    warnings
  };
}

/** The Controller's construction cost index (market.json): its source and values by year. */
export type CostIndex = Pick<MarketFile, 'source' | 'costIndex'>;

export interface CostLine {
  type: ParkingType;
  value: number;
  dollarsYear: number;
  /** Real cost index I(min(P, last)) / I(dollarsYear): construction cost in real terms. */
  factor: number;
  /** CPI(cpiYear) / CPI(dollarsYear): the general price level, to nominal P dollars. */
  cpiFactor: number;
  escalated: number;
  sources: string[];
}

export type ParkingType = 'surface' | 'podium' | 'belowGrade';
const PARKING_TYPES: readonly ParkingType[] = ['surface', 'podium', 'belowGrade'];

/**
 * The dollars of the finance prototypes (`PROTOTYPES.costPerHome`, src/lib/sim/finance/
 * prototypes.ts): the Controller's Triennial Review of Economic Feasibility 2026. The odds shift
 * divides a parking cost by it, so cost per space is stated in these dollars.
 */
export const PROTOTYPE_DOLLARS_YEAR = 2026;

export interface ParkingStats {
  supply: { value: number; tier: number; sources: string[] };
  /** null: the link is off. */
  costs: CostLine[] | null;
  /** Types with no cost while others have one: projects of that type get no parking cost. */
  unpriced: ParkingType[];
  /** The dollars year of every cost (the prototypes'); null with the link off. */
  commonYear: number | null;
  /** The cost index's last year (held flat after it). */
  indexLast: number | null;
  /** The CPI year standing for commonYear: the latest published annual average at or before it. */
  cpiYear: number | null;
  cpiSeries: string;
  searched: string[];
}

/**
 * The model's parking facts from parking.json. Each cited SF cost per space, in its source's
 * nominal dollars of year y, is brought to the prototypes' nominal dollars of year P:
 *
 *   cost_P = cost_y x I(min(P, last)) / I(y) x CPI(P) / CPI(y)
 *
 * I is the Controller's Blended Construction Cost Index (market.json `costIndex`, inflation-
 * adjusted, 2016 = 100), held flat after its last year: it moves the cost in real terms. CPI is
 * BLS CPI-U San Francisco-Oakland-Hayward, all items, annual average (cpi.json): it moves the real
 * figure to nominal dollars. When P's annual average is not yet published, CPI(P) is the latest
 * published year's (stats.cpiYear, stated in the report). Whole dollars. A cost dated before the
 * index's first year, or in a year with no CPI, stops the build. A type with no cost stays null
 * (projects of that type get no parking cost; warned); no cost at all is the link off.
 */
export function parkingOf(
  file: ParkingFile,
  index: CostIndex,
  cpi: CpiFile,
  P: number = PROTOTYPE_DOLLARS_YEAR
): { parking: CarModel['parking']; stats: ParkingStats; warnings: string[] } {
  const s = file.supplyOverUse;
  const supplyProvenance: Provenance = {
    tier: s.tier,
    label: 'Spaces built per space used',
    sources: s.sources.map((c) => ({ label: c.label, url: c.url })),
    method: s.method
  };
  const stats: ParkingStats = {
    supply: { value: s.value, tier: s.tier, sources: s.sources.map((c) => c.label) },
    costs: null,
    unpriced: [],
    commonYear: null,
    indexLast: null,
    cpiYear: null,
    cpiSeries: cpi.seriesId,
    searched: [...file.searched]
  };
  if (file.costPerSpace === null)
    return {
      parking: {
        supplyOverUse: s.value,
        costPerSpace: null,
        dollarsYear: null,
        provenance: [supplyProvenance]
      },
      stats,
      warnings: []
    };
  const years = Object.keys(index.costIndex.values).map(Number);
  const first = Math.min(...years);
  const last = Math.max(...years);
  const at = (y: number) => index.costIndex.values[String(Math.min(y, last))];
  const cpiYears = Object.keys(cpi.annual)
    .map(Number)
    .filter((y) => y <= P);
  if (cpiYears.length === 0) throw new Error(`cars: no CPI annual average at or before ${P}`);
  const cpiYear = Math.max(...cpiYears);
  const cpiP = cpi.annual[String(cpiYear)];
  const stand = cpiYear < P ? `; ${P} not yet published, ${cpiYear} stands in` : '';
  const cost = { surface: null, podium: null, belowGrade: null } as Record<
    ParkingType,
    number | null
  >;
  const provenance: Provenance[] = [supplyProvenance];
  const lines: CostLine[] = [];
  const cpiSource = cpi.sources.map((x) => ({ label: x.label, url: x.url }));
  for (const type of PARKING_TYPES) {
    const c = file.costPerSpace[type];
    if (c === null) {
      stats.unpriced.push(type);
      continue;
    }
    if (c.dollarsYear < first || at(c.dollarsYear) === undefined)
      throw new Error(
        `cars: ${type} cost per space is in ${c.dollarsYear} dollars, outside the cost index ` +
          `(${first}-${last}, market.json)`
      );
    const cpiY = cpi.annual[String(c.dollarsYear)];
    if (cpiY === undefined)
      throw new Error(
        `cars: no CPI annual average for ${c.dollarsYear} (${type} cost per space; cpi.json)`
      );
    const factor = at(P) / at(c.dollarsYear);
    const cpiFactor = cpiP / cpiY;
    const escalated = Math.round(c.value * factor * cpiFactor);
    cost[type] = escalated;
    // A fixture's invented cost (ruling P3; the live parser rejects one) has no source: tier 4.
    const cited = 'sources' in c ? c.sources : [];
    lines.push({
      type,
      value: c.value,
      dollarsYear: c.dollarsYear,
      factor,
      cpiFactor,
      escalated,
      sources: 'sources' in c ? c.sources.map((x) => x.label) : ['invented']
    });
    provenance.push({
      tier: 'tier' in c ? c.tier : 2,
      label: `Cost per ${type} parking space, ${P} dollars`,
      sources: [
        ...cited.map((x) => ({ label: x.label, url: x.url })),
        { label: index.source.label, url: index.source.url },
        ...cpiSource
      ],
      method:
        `${c.method} Brought from ${c.dollarsYear} to ${P} dollars: real construction cost by ` +
        `the Controller's Blended Construction Cost Index (${index.costIndex.locator}; held at ` +
        `${last} after it), then prices by BLS CPI-U San Francisco-Oakland-Hayward ` +
        `(${cpi.seriesId}, annual average${stand}): ` +
        `${c.value} x ${at(P)} / ${at(c.dollarsYear)} x ${cpiP} / ${cpiY} = ${escalated}.`,
      n: cited.length,
      window: [`${c.dollarsYear}-01-01`, `${P}-12-31`]
    });
  }
  stats.costs = lines;
  stats.commonYear = P;
  stats.indexLast = last;
  stats.cpiYear = cpiYear;
  const warnings = stats.unpriced.map(
    (t) =>
      `cars: no SF cost per space for ${t} parking; projects built with ${t} parking get no ` +
      'parking cost (zero shift)'
  );
  return {
    parking: { supplyOverUse: s.value, costPerSpace: cost, dollarsYear: P, provenance },
    stats,
    warnings
  };
}
