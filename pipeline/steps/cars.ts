// The car-ownership step (spec "Households"): car zones (block groups of the latest ACS vintage),
// each lot's zone, the start household population by zone, type and car level, and today's zone
// transit access, and the fitted ownership choice (pipeline/lib/cars/fit.ts: the model's choice,
// the zone constants in cars.bin, report section 14). Writes scenarios/fzp/cars.bin and
// scenarios/fzp/car-zones.json. Without the Census lock entries it writes nothing and returns
// nulls (the mini fixture until it gains them).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { encodeCarData, type CarData } from '../../src/lib/data/cars-codec';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { TransitNetwork } from '../../src/lib/data/transit';
import { CAR_LEVELS, typeCount, type CarModel } from '../../src/lib/sim/cars';
import { buildAccessGrid } from '../../src/lib/transit/grid';
import { DMV_ID, acsBgVintage, censusTableOf, type CensusTable } from '../census-config';
import { parseParkingFile } from '../enrichment/parking-schema';
import { zoneAccess } from '../lib/cars/access';
import { IPF, IPF_REPORT_ERR, MARGINS, WORKERS_TOTAL, typeBandsOf } from '../lib/cars/config';
import {
  effectiveSizes,
  fitChoice,
  observedLevels,
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
  type PumsRow
} from '../lib/cars/population';
import { carsReportLines } from '../lib/cars/report';
import { assignZones, zoneFeatures } from '../lib/cars/zones';
import type { Duck } from '../lib/duck';
import type { Lock } from '../lib/lock';
import { CARS_BIN, CAR_ZONES_JSON } from '../lib/scenario-files';

export interface CarsStepOut {
  data: CarData | null;
  /** The complete model, once moves, new-home mixes and parking join the choice (Task 6). */
  model: CarModel | null;
  /** The fitted choice with its bands and the 3+ mean: the model's part fitted so far. */
  choice: CarChoiceModel | null;
  /** Calibration-report lines (section 14 takes them). */
  report: string[];
  counts: Record<string, number>;
  warnings: string[];
}

export interface CarsStepOpts {
  outDir: string;
  lock: Lock;
  transit: TransitNetwork | null;
  parcels: ScenarioParcels;
  /** Parking facts (pipeline/enrichment/parking.json, or the fixture's); read by later tasks. */
  parkingPath?: string;
  /** SF AMI by year and size (pipeline/enrichment/ami.json, or the fixture's); later tasks. */
  amiPath?: string;
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
  const pums = await db.all<PumsRow>(`SELECT puma, wgtp, veh, np, workers, hincp_adj, ten
    FROM src_pums_hh WHERE release = ${pumsRelease} AND puma_vintage = ${vintage}
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
  const pop = startPopulation({
    types,
    zonePuma,
    homes,
    occupied,
    seed,
    margins,
    ipf: { maxIter: IPF.maxIter, tol: IPF.tol }
  });
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
  const fit = fitChoice(
    { rows: pums, bands, window: [`${pumsRelease - 4}-01-01`, `${pumsRelease}-12-31`] },
    observed,
    data,
    sizes ? { nEff: sizes.nEff, moeMissing: sizes.missing } : {}
  );
  data.constant = fit.constant;
  const parking =
    o.parkingPath && existsSync(o.parkingPath)
      ? {
          supplyOverUse: parseParkingFile(JSON.parse(readFileSync(o.parkingPath, 'utf8')))
            .supplyOverUse.value
        }
      : null;
  const choice: CarChoiceModel = {
    schema: 1,
    bands,
    choice: fit.choice,
    threePlusMean: threePlusMeanOf(pums),
    parking
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
      `${pop.seedOnly} take the PUMA mix unadjusted; ${fallback} take the citywide occupied share.`
  ];
  report.push(...carsReportLines(choice, data, fit, dmv));
  return { data, model: null, choice, report, counts, warnings };
}
