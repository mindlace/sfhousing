// The car-ownership step (spec "Households"): car zones (block groups of the latest ACS vintage),
// each lot's zone, the start household population by zone, type and car level, and today's zone
// transit access, and the fitted ownership choice (pipeline/lib/cars/fit.ts: the model's choice,
// the zone constants in cars.bin, report section 14); then move rates, the refill and new-home
// mixes and the parking facts (pipeline/lib/cars/rates.ts), completing the CarModel that
// calibration.json carries as `cars`. Writes scenarios/fzp/cars.bin and
// scenarios/fzp/car-zones.json. Without the Census lock entries it writes nothing and returns
// nulls.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { decodeCarData, encodeCarData, type CarData } from '../../src/lib/data/cars-codec';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { TransitNetwork } from '../../src/lib/data/transit';
import { CAR_LEVELS, typeCount, type CarModel } from '../../src/lib/sim/cars';
import { buildAccessGrid } from '../../src/lib/transit/grid';
import { parseProjectsFile } from '../../src/lib/timelapse/projects';
import type { ProjectHistory } from '../../src/lib/timelapse/types';
import { DMV_ID, acsBgVintage, censusTableOf, type CensusTable } from '../census-config';
import { AMI_JSON, parseAmiFile, type AmiFile } from '../enrichment/ami-schema';
import { CPI_JSON, parseCpiFile } from '../enrichment/cpi-schema';
import { parseMarketFile } from '../enrichment/market-schema';
import { PARKING_JSON, parseParkingFile, type ParkingFile } from '../enrichment/parking-schema';
import { accessByYear, zoneAccess } from '../lib/cars/access';
import {
  BACKCAST_SEED,
  BACKCAST_START,
  chainXwalk,
  crosswalkRows,
  h044AsB25044,
  historyFlows,
  NO_CAR,
  noCarShare,
  runBackcast,
  xwalkOf,
  type AcsRelease,
  type BackcastModel,
  type PumsRelease
} from '../lib/cars/backcast';
import { IPF, IPF_REPORT_ERR, MARGINS, WORKERS_TOTAL, typeBandsOf } from '../lib/cars/config';
import {
  effectiveSizes,
  fitChoice,
  observedLevels,
  refitConstants,
  threePlusMeanOf,
  type CarChoiceModel,
  type MoeRow
} from '../lib/cars/fit';
import {
  acsMargins,
  occupiedShares,
  pumsSeed,
  startPopulation,
  zoneHomes,
  type AcsRow,
  type Seed
} from '../lib/cars/population';
import {
  REFRESH_MONTHS,
  moveRates,
  newHomeMixes,
  parkingOf,
  type MoverRow
} from '../lib/cars/rates';
import { backcastReportLines, carsModelReportLines, carsReportLines } from '../lib/cars/report';
import { assignZones, zoneFeatures } from '../lib/cars/zones';
import type { Duck } from '../lib/duck';
import type { Lock } from '../lib/lock';
import { CARS_BIN, CAR_ZONES_JSON } from '../lib/scenario-files';
import { MARKET_JSON } from './calibration';
import { PROJECTS_JSON } from './projects';
import type { TransitYears } from './transit';

/** The decoded cars.bin the golden compares (deflate bytes may differ across zlib builds). */
export const CARS_DUMP = 'scenarios/fzp/cars.decoded.json';

/** Inflate and decode a written cars.bin against parcels.bin's row count; throws naming the file. */
export function readCarsBin(file: string, parcelCount: number): CarData {
  try {
    return decodeCarData(new Uint8Array(inflateRawSync(readFileSync(file))), parcelCount);
  } catch (e) {
    throw new Error(`cars: ${file} does not decode: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * The decoded cars.bin as JSON: every column, one line each; households one line per zone and
 * type (its CAR_LEVELS counts).
 */
export function formatCarsDump(d: CarData): string {
  const j = (v: ArrayLike<number> | string[]) => JSON.stringify(Array.from(v as ArrayLike<number>));
  const cells = d.types * CAR_LEVELS;
  const rows: string[] = [];
  for (let z = 0; z < d.zones.length; z++)
    for (let t = 0; t < d.types; t++) {
      const at = z * cells + t * CAR_LEVELS;
      rows.push(`    ${j(d.households.subarray(at, at + CAR_LEVELS))}`);
    }
  return (
    [
      '{',
      `  "zones": ${JSON.stringify(d.zones)},`,
      `  "pumas": ${JSON.stringify(d.pumas)},`,
      `  "zonePuma": ${j(d.zonePuma)},`,
      `  "areaM2": ${j(d.areaM2)},`,
      `  "occupied": ${j(d.occupied)},`,
      `  "access": ${j(d.access)},`,
      `  "constant": ${j(d.constant)},`,
      `  "lotZone": ${j(d.lotZone)},`,
      `  "types": ${d.types},`,
      '  "households": [',
      rows.join(',\n'),
      '  ]',
      '}'
    ].join('\n') + '\n'
  );
}

export interface CarsStepOut {
  data: CarData | null;
  /** The complete model (choice, moves, new-home mixes, parking): calibration.json `cars`. */
  model: CarModel | null;
  /** The fitted choice with its bands and the 3+ mean (the model's choice part). */
  choice: CarChoiceModel | null;
  /** Calibration-report lines (section 14 takes them). */
  report: string[];
  /** The back-cast's lines (section 15); empty without its inputs (the mini fixture). */
  backcast: string[];
  counts: Record<string, number>;
  warnings: string[];
}

export interface CarsStepOpts {
  outDir: string;
  lock: Lock;
  transit: TransitNetwork | null;
  parcels: ScenarioParcels;
  /** Parking facts (default pipeline/enrichment/parking.json; the fixture's on a fixture build). */
  parkingPath?: string;
  /**
   * The parking file's parser (default `parseParkingFile`, the live rules); a fixture build passes
   * `parseFixtureParkingFile`, which also takes an invented tier-4 cost (ruling P3).
   */
  parseParking?: (v: unknown) => ParkingFile;
  /** SF AMI by year and household size (default pipeline/enrichment/ami.json). */
  amiPath?: string;
  /** BLS CPI-U SF annual averages for the cost per space (default pipeline/enrichment/cpi.json). */
  cpiPath?: string;
  /** The Controller's cost index for the cost per space (default market.json). */
  marketPath?: string;
  /** The dataset's projects.json, for the affordable completions by tier (default the outDir's). */
  projectsPath?: string;
  /**
   * The project records (homes completed and lost by month) and transit by year, for the
   * back-cast (report section 15); it runs only with these and the lock's SF3, crosswalk, 2010
   * PUMA and 2009-2013 PUMS entries.
   */
  histories?: readonly ProjectHistory[];
  transitYears?: TransitYears | null;
}

/** The Census tables the start population needs. */
const REQUIRED: readonly CensusTable[] = [
  'src_acs_bg',
  'src_pums_hh',
  'src_bg_geom',
  'src_tract_puma'
];

const none = (warnings: string[] = []): CarsStepOut => ({
  data: null,
  model: null,
  choice: null,
  report: [],
  backcast: [],
  counts: {},
  warnings
});

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export async function carsStep(db: Duck, o: CarsStepOpts): Promise<CarsStepOut> {
  const have = new Set(o.lock.sources.map((s) => censusTableOf(s.id)).filter((t) => t));
  if (!REQUIRED.some((t) => have.has(t))) return none();
  const missing = REQUIRED.filter((t) => !have.has(t));
  if (missing.length > 0)
    return none([`cars: no car data, the lock lacks Census entries for ${missing.join(', ')}`]);
  const warnings: string[] = [];

  // The latest ACS release sets the zones' vintage; PUMS is the latest release on the same PUMAs.
  const [{ release }] = await db.all<{ release: number }>(
    'SELECT max(release) AS release FROM src_acs_bg'
  );
  const vintage = acsBgVintage(release);
  const [{ pumsRelease }] = await db.all<{ pumsRelease: number | null }>(
    `SELECT max(release) AS pumsRelease FROM src_pums_hh WHERE puma_vintage = ${vintage}`
  );
  if (pumsRelease === null) return none([`cars: no car data, no PUMS release on ${vintage} PUMAs`]);
  const pums = await db.all<MoverRow>(`SELECT puma, wgtp, veh, np, workers, hincp_adj, ten, mv,
    ybl, ybl_src FROM src_pums_hh WHERE release = ${pumsRelease} AND puma_vintage = ${vintage}
    ORDER BY puma, serialno`);
  const tractPuma = new Map(
    (
      await db.all<{ tract: string; puma: string }>(
        `SELECT tract, puma FROM src_tract_puma WHERE vintage = ${vintage} ORDER BY tract`
      )
    ).map((r) => [r.tract, r.puma])
  );
  const pumas = [...new Set(tractPuma.values())].sort();

  // Zones and each lot's zone.
  const p = o.parcels;
  const za = await assignZones(db, { vintage, lngLat: p.labelPoint });
  const { zones, lotZone, areaM2 } = za;
  const Z = zones.length;
  // Census tables without the block groups of the latest release's vintage would give an empty
  // cars.bin that V38 could not tell from a real one: fail instead.
  if (Z === 0)
    throw new Error(
      `cars: no ${vintage} block groups in src_bg_geom for ACS ${release} (lock a census-tiger-bg-${vintage} entry)`
    );
  const pumaIx = new Map(pumas.map((x, i) => [x, i]));
  const zonePuma = Int32Array.from(zones, (g) => {
    const ix = pumaIx.get(tractPuma.get(g.slice(0, 11)) ?? '');
    if (ix === undefined) throw new Error(`cars: block group ${g} has no ${vintage} PUMA`);
    return ix;
  });

  // Start population.
  const acs = await db.all<AcsRow>(`SELECT geoid, variable, estimate FROM src_acs_bg
    WHERE release = ${release} ORDER BY geoid, variable`);
  const { occupied, fallback } = occupiedShares(acs, zones);
  const margins = acsMargins(acs, zones);
  const homes = zoneHomes(lotZone, p.existingUnits, Z);
  const bands = typeBandsOf(pums);
  const types = typeCount(bands);
  const seed = pumsSeed(pums, bands, pumas);
  const popIn = {
    types,
    zonePuma,
    homes,
    occupied,
    seed,
    margins,
    ipf: { maxIter: IPF.maxIter, tol: IPF.tol }
  };
  // First raked to B25044 as published; re-raked below to the choice's shrunk shares.
  let pop = startPopulation(popIn);
  let startHomes = 0;
  let startHouseholds = 0;
  for (let z = 0; z < Z; z++) startHomes += homes[z];
  for (const h of pop.households) startHouseholds += h;
  if (startHomes > 0 && startHouseholds === 0)
    throw new Error(
      `cars: 0 households on ${startHomes} homes in ${Z} zones (ACS ${release} occupancy gives none)`
    );

  // Today's transit access, homes-weighted per zone.
  const lotHomes = Int32Array.from(p.existingUnits);
  let access: Float64Array = new Float64Array(Z);
  if (o.transit)
    access = zoneAccess(buildAccessGrid(o.transit), lotZone, lotHomes, p.labelPoint, Z);
  else warnings.push('cars: no transit network, zone access is 0');

  const data: CarData = {
    zones,
    pumas,
    zonePuma,
    lotZone,
    areaM2,
    occupied,
    access,
    constant: new Float64Array(Z * 3),
    types,
    households: pop.households
  };

  // The ownership choice: household terms from PUMS, location terms and zone constants from the
  // block groups' B25044 shares.
  const observed = observedLevels(acs, zones);
  // Effective sample sizes from B25044's margins of error, when the lock has them for the release.
  let sizes: { nEff: Float64Array; missing: number } | null = null;
  if (o.lock.sources.some((s) => s.id === `census-acs5-bg-moe-${release}`)) {
    const moe = await db.all<MoeRow>(`SELECT geoid, variable, moe FROM src_acs_bg_moe
      WHERE release = ${release} ORDER BY geoid, variable`);
    sizes = effectiveSizes(acs, moe, zones);
  } else
    warnings.push(
      `cars: no B25044 margins of error for ACS ${release} (census-acs5-bg-moe-${release}); ` +
        'the zone shrinkage uses estimated households'
    );
  const first = fitChoice(
    { rows: pums, bands, window: [`${pumsRelease - 4}-01-01`, `${pumsRelease}-12-31`] },
    observed,
    data,
    sizes ? { nEff: sizes.nEff, moeMissing: sizes.missing } : {}
  );
  // The start's vehicle margin is the shrunk shares (share*), not B25044's sampling noise, so the
  // start agrees with the model and zones do not drift as households turn over. The other margins
  // stay; the coefficients stay; the constants are refitted over the re-raked type mix.
  pop = startPopulation({
    ...popIn,
    levels: first.fit.map((f) => (f.observedTotal > 0 ? Float64Array.from(f.target) : null))
  });
  data.households = pop.households;
  const refit = refitConstants(first.choice, data, observed, first);
  const fit = { ...first, ...refit };
  data.constant = fit.constant;
  const choice: CarChoiceModel = {
    schema: 1,
    bands,
    choice: fit.choice,
    threePlusMean: threePlusMeanOf(pums)
  };

  // Moves, the refill and new-home mixes, and parking: the rest of the model.
  const window: [string, string] = [`${pumsRelease - 4}-01-01`, `${pumsRelease}-12-31`];
  const readJson = (path: string, what: string): unknown => {
    if (!existsSync(path)) throw new Error(`cars: no ${what} at ${path}`);
    return JSON.parse(readFileSync(path, 'utf8'));
  };
  const parkingFile = (o.parseParking ?? parseParkingFile)(
    readJson(o.parkingPath ?? PARKING_JSON, 'parking facts')
  );
  const ami = parseAmiFile(readJson(o.amiPath ?? AMI_JSON, 'SF AMI table'));
  const marketPath = o.marketPath ?? MARKET_JSON;
  const market = parseMarketFile(readJson(marketPath, 'market file'), marketPath);
  const projects = parseProjectsFile(
    readJson(o.projectsPath ?? join(o.outDir, PROJECTS_JSON), 'projects.json')
  );
  const byTier = projects.rhnaCompletedNet.byTier;
  if (!byTier) throw new Error('cars: projects.json has no rhnaCompletedNet.byTier');
  const mv = moveRates(pums, bands, window);
  const nh = newHomeMixes(pums, bands, ami, byTier, {
    release: pumsRelease,
    window
  });
  const cpi = parseCpiFile(readJson(o.cpiPath ?? CPI_JSON, 'CPI table'));
  const pk = parkingOf(parkingFile, market, cpi);
  warnings.push(...mv.warnings, ...nh.warnings, ...pk.warnings);
  const model: CarModel = {
    ...choice,
    moves: mv.moves,
    newHomes: nh.newHomes,
    parking: pk.parking,
    refreshMonths: REFRESH_MONTHS
  };
  let dmv: { year: number; lightDuty: number } | null = null;
  if (o.lock.sources.some((s) => s.id === DMV_ID)) {
    const [r] = await db.all<{ year: number | null; lightDuty: number | null }>(
      `SELECT max(year) AS year, sum(light_duty)::DOUBLE AS lightDuty FROM src_dmv_zip
        WHERE year = (SELECT max(year) FROM src_dmv_zip)`
    );
    if (r.year !== null && r.lightDuty !== null) dmv = { year: r.year, lightDuty: r.lightDuty };
  }

  const file = join(o.outDir, CARS_BIN);
  mkdirSync(dirname(file), { recursive: true });
  const body = deflateRawSync(encodeCarData(data), { level: 9 });
  writeFileSync(file, body);
  const zonesJson = Buffer.from(JSON.stringify(await zoneFeatures(db, vintage)));
  writeFileSync(join(o.outDir, CAR_ZONES_JSON), zonesJson);

  // Counts and report.
  const sum = (a: ArrayLike<number>) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i];
    return s;
  };
  const acsSum = (pred: (v: string) => boolean) =>
    acs.reduce((s, r) => (pred(r.variable) ? s + r.estimate : s), 0);
  const byLevel = new Float64Array(CAR_LEVELS);
  for (let i = 0; i < pop.households.length; i++) byLevel[i % CAR_LEVELS] += pop.households[i];
  const households = sum(pop.households);
  const acsHouseholds = acsSum((v) => v === MARGINS[0].total);
  const acsNoCar = acsSum((v) => v === 'B25044_003' || v === 'B25044_010');
  const pumsHouseholds = sum(seed.weight);
  let unmet = 0;
  let homesInZones = 0;
  for (let z = 0; z < Z; z++) {
    if (pop.maxRelErr[z] > IPF_REPORT_ERR) unmet++;
    homesInZones += homes[z];
  }
  const totalUnits = sum(p.existingUnits);
  const counts: Record<string, number> = {
    ...za.counts,
    'cars.pumas': pumas.length,
    'cars.types': types,
    'cars.acsRelease': release,
    'cars.pumsRelease': pumsRelease,
    'cars.homes': homesInZones,
    'cars.homesNoZone': totalUnits - homesInZones,
    'cars.households': households,
    'cars.households.noCar': byLevel[0],
    'cars.acs.households': Math.round(acsHouseholds),
    'cars.acs.noCar': Math.round(acsNoCar),
    'cars.pums.households': pumsHouseholds,
    'cars.zones.occupiedFallback': fallback,
    'cars.zones.seedOnly': pop.seedOnly,
    'cars.zones.ipfUnmet': unmet,
    'cars.workers': Math.round(sum(pop.workers)),
    'cars.acs.workers': Math.round(acsSum((v) => v === WORKERS_TOTAL)),
    'cars.fit.records': fit.stats.stage1.records,
    'cars.fit.constants': fit.stats.constants.fitted,
    'cars.fit.noObservation': fit.stats.constants.noObservation,
    'cars.fit.observedZero': fit.stats.constants.observedZero,
    'cars.moves.typeFallback': mv.stats.fallback,
    'cars.newHomes.records': nh.stats.records.market,
    'cars.parking.linkOn': pk.parking.costPerSpace === null ? 0 : 1,
    'cars.bytes': body.length,
    'cars.zonesJson.bytes': zonesJson.length
  };
  if (unmet > 0)
    warnings.push(
      `cars: ${unmet} block group(s) miss an ACS margin by more than ${pct(IPF_REPORT_ERR)}`
    );
  if (za.counts['cars.lotsNoZone'] > 0)
    warnings.push(
      `cars: ${za.counts['cars.lotsNoZone']} lot(s) fall in no block group ` +
        `(${totalUnits - homesInZones} homes left out)`
    );
  const report = [
    `Zones: ${Z} block groups (${vintage} vintage, ACS ${release - 4}-${release}), ` +
      `${pumas.length} PUMAs; ${za.counts['cars.lotsNoZone']} lots in no zone.`,
    `Types: ${types} (size ${bands.size.join('/')}, workers ${bands.workers.join('/')}, ` +
      `income from ${bands.income.join('/')} (PUMS ${pumsRelease - 4}-${pumsRelease} weighted ` +
      `quartiles), own or rent).`,
    `Households: ${households} on ${homesInZones} homes (occupied share by block group, ACS ` +
      `B25002); ACS ${Math.round(acsHouseholds)}, PUMS ${pumsHouseholds}.`,
    `No car: ${pct(byLevel[0] / households)} (ACS B25044 ${pct(acsNoCar / acsHouseholds)}).`,
    `Workers: ${Math.round(sum(pop.workers))} (ACS B08301 workers 16+ ` +
      `${Math.round(acsSum((v) => v === WORKERS_TOTAL))}, a person count incl. group quarters).`,
    `IPF: ${unmet} block groups miss a margin by more than ${pct(IPF_REPORT_ERR)}; ` +
      `${pop.seedOnly} take the PUMA mix unadjusted; ${fallback} take the citywide occupied share. ` +
      "The vehicle margin is the choice's shrunk shares (share*, below), not B25044 as published; " +
      'tenure comes from B25009.'
  ];
  report.push(...carsReportLines(choice, data, fit, dmv));
  report.push(
    ...carsModelReportLines(model, data, {
      moves: mv.stats,
      newHomes: nh.stats,
      parking: pk.stats,
      pumas
    })
  );
  const bc = await carsBackcast(db, o, {
    data,
    model,
    latest: { release: pumsRelease, rows: pums },
    ami,
    byTier
  });
  warnings.push(...bc.warnings);
  Object.assign(counts, bc.counts);
  return { data, model, choice, report, backcast: bc.report, counts, warnings };
}

/** Lock entries the back-cast needs beyond the start population's. */
const BACKCAST_IDS = [
  'census-sf3-2000-bg',
  'census-xwalk-2000-2010',
  'census-xwalk-2010-2020',
  'census-puma-2010',
  'census-pums5-2013'
] as const;

/** A crosswalked share at or above this puts a 2000 block group inside one of today's. */
const NESTED = 0.99;

/** The ACS cells the back-cast moves onto the zones (the held-out fit's margins and occupancy). */
const BACKCAST_TABLES = ['B25044', 'B25009', 'B19001', 'B25002'];

/**
 * The back-cast (report section 15, `runBackcast`): the 2000 households on today's block groups,
 * every ACS release on them, the project records' homes by month and access by year; the full
 * model and one fitted on the releases and PUMS through 2009-2013. Nothing without its inputs.
 */
async function carsBackcast(
  db: Duck,
  o: CarsStepOpts,
  x: {
    data: CarData;
    model: CarModel;
    latest: PumsRelease;
    ami: AmiFile;
    byTier: { veryLow: number; low: number; moderate: number };
  }
): Promise<{ report: string[]; counts: Record<string, number>; warnings: string[] }> {
  const ids = new Set(o.lock.sources.map((e) => e.id));
  const missing = BACKCAST_IDS.filter((id) => !ids.has(id));
  if (!o.histories || missing.length === BACKCAST_IDS.length)
    return { report: [], counts: {}, warnings: [] };
  if (missing.length > 0)
    return {
      report: [],
      counts: {},
      warnings: [`cars: no back-cast, the lock lacks ${missing.join(', ')}`]
    };
  const { data, model } = x;
  const zones = data.zones;
  const Z = zones.length;
  const p = o.parcels;
  const warnings: string[] = [];
  const zix = new Map(zones.map((g, i) => [g, i]));
  const ipf = { maxIter: IPF.maxIter, tol: IPF.tol };

  // Crosswalks: 2010 → 2020 as published, 2000 → 2020 through 2010 (land-area weights).
  const xw = await db.all<{ v: number; from: string; to: string; weight: number }>(
    `SELECT from_vintage AS v, from_geoid AS "from", to_geoid AS "to", weight FROM src_bg_xwalk
      ORDER BY from_vintage, from_geoid, to_geoid`
  );
  const x1020 = xwalkOf(xw.filter((r) => r.v === 2010));
  const x0020 = chainXwalk(xwalkOf(xw.filter((r) => r.v === 2000)), x1020);
  const onZones = (rows: AcsRow[], v: number): AcsRow[] =>
    v === 2020 ? rows : crosswalkRows(rows, v === 2000 ? x0020 : x1020);

  // Every ACS release, on the zones; citywide from its own block groups.
  const years = (
    await db.all<{ release: number }>('SELECT DISTINCT release FROM src_acs_bg ORDER BY release')
  ).map((r) => r.release);
  const tables = BACKCAST_TABLES.map((t) => `variable LIKE '${t}_%'`).join(' OR ');
  const releases: AcsRelease[] = [];
  for (const year of years) {
    const rows = await db.all<AcsRow>(`SELECT geoid, variable, estimate FROM src_acs_bg
      WHERE release = ${year} AND (${tables}) ORDER BY geoid, variable`);
    releases.push({
      year,
      rows: onZones(rows, acsBgVintage(year)),
      city: noCarShare(rows, [...new Set(rows.map((r) => r.geoid))])
    });
  }
  const endYear = years[years.length - 1];

  // The start: SF3 H044 on the zones; its households and tenure by cars are the start's margins.
  const sf3 = h044AsB25044(
    await db.all<{ geoid: string; variable: string; value: number }>(
      'SELECT geoid, variable, value FROM src_sf3_bg ORDER BY geoid, variable'
    )
  );
  const sf3City = noCarShare(sf3, [...new Set(sf3.map((r) => r.geoid))]);
  const sf3Zones = crosswalkRows(sf3, x0020);
  const margins2000 = acsMargins(sf3Zones, zones);
  const hh2000 = new Int32Array(Z);
  for (const r of sf3Zones) {
    const z = zix.get(r.geoid);
    if (r.variable === NO_CAR.total && z !== undefined) hh2000[z] = Math.round(r.estimate);
  }
  const ones = new Float64Array(Z).fill(1);
  const start2000 = (bands: CarModel['bands'], seed: Seed, zonePuma: Int32Array) =>
    startPopulation({
      types: typeCount(bands),
      zonePuma,
      homes: hh2000,
      occupied: ones,
      seed,
      margins: margins2000,
      ipf
    }).households;

  // Nested: 2000 block groups with >= 99% of their land in one of today's, and the zones whose
  // 2000 households come >= 99% from them (the crosswalk's sensitivity).
  const nested2000 = new Set(
    [...x0020].filter(([, parts]) => parts.some((q) => q.weight >= NESTED)).map(([g]) => g)
  );
  const zoneAll = new Float64Array(Z);
  const zoneNested = new Float64Array(Z);
  for (const r of sf3) {
    if (r.variable !== NO_CAR.total) continue;
    for (const q of x0020.get(r.geoid) ?? []) {
      const z = zix.get(q.to);
      if (z === undefined) continue;
      zoneAll[z] += r.estimate * q.weight;
      if (nested2000.has(r.geoid)) zoneNested[z] += r.estimate * q.weight;
    }
  }
  const nestedZones = Uint8Array.from(zoneAll, (a, z) =>
    a > 0 && zoneNested[z] >= NESTED * a ? 1 : 0
  );
  const sf3Bgs = new Set(sf3.map((r) => r.geoid)).size;

  // Access by calendar year, homes-weighted with today's homes.
  const calendar = Array.from(
    { length: endYear - BACKCAST_START.year + 1 },
    (_, i) => BACKCAST_START.year + i
  );
  const byYear = o.transitYears
    ? accessByYear(
        o.transitYears,
        calendar,
        data.lotZone,
        Int32Array.from(p.existingUnits),
        p.labelPoint,
        Z
      )
    : [];
  if (!o.transitYears) warnings.push("cars: back-cast without transit by year (today's access)");
  // Archived feeds reduce non-strictly (mostly lines with no vehicle assignment): one line, with
  // the first, rather than one per line and year.
  const reduceWarnings = byYear.flatMap((y) => y.warnings.map((w) => `${y.year}: ${w}`));
  if (reduceWarnings.length > 0)
    warnings.push(
      `cars: back-cast transit by year: ${reduceWarnings.length} reduce warnings over ` +
        `${byYear.filter((y) => y.warnings.length > 0).length} years (first, ${reduceWarnings[0]})`
    );
  const accessAt = (year: number) => byYear.find((y) => y.year === year)?.access ?? data.access;

  // Homes completed and lost, by month and zone.
  const { flows, stats: flowStats } = historyFlows(
    o.histories,
    p.index,
    data.lotZone,
    BACKCAST_START,
    endYear,
    model.newHomes.affordableTiers
  );

  // PUMS 2009-2013 on 2010 PUMAs: its 2012-2013 records (2009-2011's sit on 2000 PUMAs).
  const pums13 = await db.all<MoverRow>(`SELECT puma, wgtp, veh, np, workers, hincp_adj, ten, mv,
    ybl, ybl_src FROM src_pums_hh WHERE release = 2013 AND puma_vintage = 2010
    ORDER BY puma, serialno`);
  const pums: PumsRelease[] = [{ release: 2013, rows: pums13 }, x.latest];

  // Today's zones on 2010 PUMAs: each zone's 2010 block group of largest share, its tract's PUMA.
  const tract10 = new Map(
    (
      await db.all<{ tract: string; puma: string }>(
        'SELECT tract, puma FROM src_tract_puma WHERE vintage = 2010 ORDER BY tract'
      )
    ).map((r) => [r.tract, r.puma])
  );
  const pumas10 = [...new Set(tract10.values())].sort();
  const from10 = new Map<string, { from: string; weight: number }>();
  for (const [from, parts] of x1020)
    for (const q of parts) {
      const best = from10.get(q.to);
      if (!best || q.weight > best.weight) from10.set(q.to, { from, weight: q.weight });
    }
  const zonePuma10 = Int32Array.from(zones, (g) => {
    const b = from10.get(g);
    return b ? pumas10.indexOf(tract10.get(b.from.slice(0, 11)) ?? '') : -1;
  });
  // A zone with no 2010 tract on a PUMA (a water tract) takes the 2010 PUMA most zones of its
  // 2020 PUMA take.
  const votes = data.pumas.map(() => new Int32Array(pumas10.length));
  zonePuma10.forEach((ix, z) => {
    if (ix >= 0) votes[data.zonePuma[z]][ix]++;
  });
  let pumaFallback = 0;
  zonePuma10.forEach((ix, z) => {
    if (ix >= 0) return;
    const v = votes[data.zonePuma[z]];
    zonePuma10[z] = v.indexOf(Math.max(...v));
    pumaFallback++;
  });

  const held = { records: 0, households: 0, release: 0 };
  const fit = (f: { acs: readonly AcsRelease[]; pums: readonly PumsRelease[] }): BackcastModel => {
    const last = f.pums[f.pums.length - 1];
    if (last.release === x.latest.release) {
      const seed = pumsSeed(x.latest.rows, model.bands, data.pumas);
      return { model, data: { ...data, households: start2000(model.bands, seed, data.zonePuma) } };
    }
    // Held out: fitted as carsStep fits today's, on the latest release and PUMS it is given.
    const a = f.acs[f.acs.length - 1];
    const rows = last.rows;
    const window: [string, string] = [`${last.release - 4}-01-01`, `${last.release}-12-31`];
    const bands = typeBandsOf(rows);
    const types = typeCount(bands);
    const seed = pumsSeed(rows, bands, pumas10);
    const hh = new Int32Array(Z);
    for (const r of a.rows) {
      const z = zix.get(r.geoid);
      if (r.variable === NO_CAR.total && z !== undefined) hh[z] = Math.round(r.estimate);
    }
    const popIn = {
      types,
      zonePuma: zonePuma10,
      homes: hh,
      occupied: ones,
      seed,
      margins: acsMargins(a.rows, zones),
      ipf
    };
    const d: CarData = {
      zones,
      pumas: pumas10,
      zonePuma: zonePuma10,
      lotZone: data.lotZone,
      areaM2: data.areaM2,
      occupied: occupiedShares(a.rows, zones).occupied,
      access: accessAt(a.year),
      constant: new Float64Array(Z * 3),
      types,
      households: startPopulation(popIn).households
    };
    const observed = observedLevels(a.rows, zones);
    const first = fitChoice({ rows, bands, window }, observed, d);
    d.households = startPopulation({
      ...popIn,
      levels: first.fit.map((g) => (g.observedTotal > 0 ? Float64Array.from(g.target) : null))
    }).households;
    d.constant = refitConstants(first.choice, d, observed, first).constant;
    const mv = moveRates(rows, bands, window);
    const nh = newHomeMixes(rows, bands, x.ami, x.byTier, { release: last.release, window });
    held.records = rows.length;
    held.households = rows.reduce((t, r) => t + r.wgtp, 0);
    held.release = a.year;
    const heldModel: CarModel = {
      schema: 1,
      bands,
      choice: first.choice,
      threePlusMean: threePlusMeanOf(rows),
      moves: mv.moves,
      newHomes: nh.newHomes,
      parking: model.parking,
      refreshMonths: model.refreshMonths
    };
    return { model: heldModel, data: { ...d, households: start2000(bands, seed, zonePuma10) } };
  };

  const result = runBackcast({
    seed: BACKCAST_SEED,
    start: BACKCAST_START,
    endYear,
    zones,
    startObserved: sf3City.carless / sf3City.households,
    releases,
    pums,
    fit,
    flows,
    access: byYear.map((y) => ({ year: y.year, access: y.access })),
    subsets: [{ name: 'nested', zones: nestedZones }]
  });
  let nestedCount = 0;
  for (const v of nestedZones) nestedCount += v;
  const report = backcastReportLines(result, {
    start: { households: sf3City.households, bgs: sf3Bgs },
    nested: { bgs: nested2000.size, zones: nestedCount, totalZones: Z },
    flows: flowStats,
    access: byYear.map((y) => ({ year: y.year, sourceYear: y.sourceYear, sources: y.sources })),
    heldOut: { pumsRecords: held.records, pumsHouseholds: held.households, acs: held.release }
  });
  const counts: Record<string, number> = {
    'cars.backcast.releases': releases.length,
    'cars.backcast.flows': flows.length,
    'cars.backcast.unplacedHomes': flowStats.unplacedHomes,
    'cars.backcast.unmatched': result.unmatched,
    'cars.backcast.nestedZones': nestedCount,
    'cars.backcast.puma2010Fallback': pumaFallback
  };
  return { report, counts, warnings };
}
