// Scenario build step (scenario-data spec §4.4-§4.8, §4.10): runs the scenario SQL, computes the
// base-envelope yields of every panel row with the shared generator, writes the T13 parcel panel
// (`scenario_panel`, parcel-panel.parquet) and lineage (parcel-lineage.parquet) to the derived
// cache, and assembles, encodes and writes the T11 file `scenarios/fzp/parcels.bin`.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import {
  FILL_LEVELS,
  LAND_USE_CLASSES,
  SCENARIO_FORMAT,
  decodeScenarioPayload,
  encodeScenarioPayload,
  fillStories,
  type ScenarioParcels
} from '../../src/lib/data/scenario-codec';
import { capScenarioYield, scenarioYield } from '../../src/lib/data/scenario-yield';
import type { Day } from '../../src/lib/timelapse/time';
import type { Provenance } from '../../src/lib/timelapse/types';
import { SQL_VARS } from '../config';
import {
  BULLETIN_11_URL,
  FZP_EFFECTIVE_DAY,
  UNVERIFIED_DISTRICTS,
  densityCap,
  densityCapRule
} from '../lib/density-caps';
import { createTableFromRows, type CellValue, type Duck } from '../lib/duck';
import type { HeightDistrict } from '../lib/heights';
import { localProgramEnvelope } from '../lib/local-program';
import type { Report } from '../lib/report';
import { PARCELS_BIN } from '../lib/scenario-files';
import { runScenarioSql } from './scenario-sql';

export { PARCELS_BIN };
/** The golden's canonical dump of the decoded T11 payload (spec §4.11). */
export const SCENARIO_DUMP = 'scenarios/fzp/parcels.decoded.json';

const F = FILL_LEVELS.length;
/** u16 column ceiling (codec width, spec §4.8): a larger yield is clamped and counted. */
const U16_MAX = 0xffff;
/** T11 `baseCap` sentinel for "no cap" (spec §2 internal types). */
const NULL_CAP = 0xffff;
/** Storey height for existingHeightM = existingStories × 3.1 (SQL_VARS.floors_m, tier 3). */
const FLOORS_M = SQL_VARS.floors_m;
/** Rent Ordinance year: pre-1979 buildings (spec §4.4, tier 2, I). */
const RENT_CONTROL_BEFORE = 1979;
/**
 * §206.10(b)(9): demolition on a site with more than 2 rent-controlled units (Bulletin 11, tier
 * 1); read from the roll's non-condo units, the exclusion is tier 2 (spec §4.4).
 */
const RENT_CONTROL_MIN_UNITS = 3;
/**
 * Main ruling 4c: warn (report to main) when split or generic-NC parcels exceed 10% of hostable
 * ones. A reporting threshold set by main, not a simulation parameter.
 */
const UNVERIFIED_SHARE_WARN = 0.1;
const OTHER = LAND_USE_CLASSES.indexOf('other');
const FIXTURE_RE = /^fixture-\d+$/;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const homepage = (id: string) => `https://data.sf.gov/d/${id}`;
const SRC = {
  height: { label: 'DataSF Zoning Map – Height and Bulk Districts', url: homepage('h9wh-cg3m') },
  attrs: { label: 'DataSF Parcels (attributes, active and retired)', url: homepage('acdm-wktn') },
  roll: {
    label: 'DataSF Assessor Historical Secured Property Tax Rolls',
    url: homepage('wv5m-vpq2')
  },
  bulletin: { label: 'Planning Director Bulletin No. 11', url: BULLETIN_11_URL }
};
const CAP_RULES =
  'Base-zoning density caps from the Planning Code (tier 1, pipeline/lib/density-caps.ts); a ' +
  'split zoning code takes its most permissive component and generic NCD/NCT codes have no ' +
  'cap (both tier 4, made up); districts not verified against the official Code default to no ' +
  `cap (${UNVERIFIED_DISTRICTS.join(', ')}).`;

/** One sc_features row: the inputs of `scenarioRecord`. */
interface FeatureRow {
  mapblklot: string;
  existing_units: number;
  existing_floor_area_m2: number;
  existing_stories: number;
  base_stories: number;
  base_density_cap: number | null;
}

/**
 * Spec §4.5 "one scenario view of a parcel": the chunk record with units, floor area and height
 * from the roll features (existingHeightM = existingStories × 3.1).
 */
function scenarioRecord(
  rec: ParcelRecord,
  f: { existingUnits: number; existingFloorAreaM2: number; existingStories: number }
): ParcelRecord {
  return {
    ...rec,
    existingUnits: f.existingUnits,
    existingFloorAreaM2: f.existingFloorAreaM2,
    existingHeightM: f.existingStories * FLOORS_M
  };
}

const sqlStr = (s: string) => `'${s.replaceAll("'", "''")}'`;

/**
 * Panel base yields (spec §4.7): `scenarioYield(scenarioRecord(rec, row), base_stories,
 * base_density_cap)` for every sc_features row, memoised on the inputs, streamed one roll year
 * at a time. Writes sc_base_yield (one row per distinct input) and returns its size.
 */
async function writeBaseYields(db: Duck, recById: Map<string, ParcelRecord>): Promise<number> {
  const years = await db.all<{ y: number }>(
    'SELECT DISTINCT roll_year y FROM sc_features ORDER BY y'
  );
  const memo = new Map<string, CellValue[]>();
  for (const { y } of years) {
    const rows = await db.all<FeatureRow>(
      `SELECT mapblklot, existing_units, existing_floor_area_m2, existing_stories, base_stories,
              base_density_cap
       FROM sc_features WHERE roll_year = ${y} ORDER BY mapblklot`
    );
    for (const r of rows) {
      // String(double) is the shortest round-trip form, so equal keys mean equal inputs.
      const key = [
        r.mapblklot,
        r.existing_units,
        r.existing_floor_area_m2,
        r.existing_stories,
        r.base_stories,
        r.base_density_cap
      ].join('|');
      if (memo.has(key)) continue;
      const rec = recById.get(r.mapblklot);
      if (!rec) throw new Error(`scenario: panel parcel ${r.mapblklot} has no chunk record`);
      const view = scenarioRecord(rec, {
        existingUnits: r.existing_units,
        existingFloorAreaM2: r.existing_floor_area_m2,
        existingStories: r.existing_stories
      });
      memo.set(key, [
        r.mapblklot,
        r.existing_units,
        r.existing_floor_area_m2,
        r.existing_stories,
        r.base_stories,
        r.base_density_cap,
        scenarioYield(view, r.base_stories, r.base_density_cap)
      ]);
    }
  }
  await createTableFromRows(
    db,
    'sc_base_yield',
    [
      ['mapblklot', 'VARCHAR'],
      ['existing_units', 'INTEGER'],
      ['existing_floor_area_m2', 'DOUBLE'],
      ['existing_stories', 'INTEGER'],
      ['base_stories', 'INTEGER'],
      ['base_density_cap', 'INTEGER'],
      ['base_yield', 'INTEGER']
    ],
    [...memo.values()]
  );
  return memo.size;
}

/**
 * T13 panel, spec §4.6: exactly T13's columns plus the listed additions, sorted by (mapblklot,
 * roll_year). potential_ratio_base is FLOAT, rounded as T11's Float32 `potentialRatio.base`.
 */
const PANEL_SQL = `
CREATE OR REPLACE TABLE scenario_panel AS
SELECT f.mapblklot, f.roll_year,
       f.existing_units, f.existing_stories, f.year_built, f.land_value, f.improvement_value,
       f.use_code, f.land_use_class::INTEGER AS land_use_class, f.zoning_code,
       f.base_stories, f.base_density_cap, y.base_yield,
       f.lien_day, f.lot_area_m2, f.improvement_share, f.rent_control_likely, f.imputed,
       (y.base_yield / greatest(f.existing_units, 1))::FLOAT AS potential_ratio_base,
       (f.base_stories - f.existing_stories)::INTEGER AS stories_gap_base,
       (f.eligible AND f.base_stories >= 1 AND y.base_yield > 0) AS hostable_base
FROM sc_features f
JOIN sc_base_yield y
  ON y.mapblklot = f.mapblklot AND y.existing_units = f.existing_units
 AND y.existing_floor_area_m2 = f.existing_floor_area_m2
 AND y.existing_stories = f.existing_stories AND y.base_stories = f.base_stories
 AND y.base_density_cap IS NOT DISTINCT FROM f.base_density_cap
ORDER BY f.mapblklot, f.roll_year`;

/** The latest-year panel row of a parcel with the exclusion inputs from sc_features. */
interface LatestRow {
  mapblklot: string;
  existing_units: number;
  existing_stories: number;
  year_built: number;
  lot_area_m2: number;
  improvement_share: number;
  rent_control_likely: boolean;
  land_use_class: number;
  imputed: number;
  potential_ratio_base: number;
  stories_gap_base: number;
  existing_floor_area_m2: number;
  noncondo_units: number;
  hotel: boolean;
  status_n: boolean;
}

interface DistrictRow {
  id: string;
  district: string;
  kind: string;
  base_ft: number | null;
  lp_ft: number | null;
  r4: boolean;
  split: boolean;
  zoning_code: string | null;
  lot_area_m2: number;
}

function provenance(capDay: Day, rollYear: number): ScenarioParcels['provenance'] {
  const capDate = new Date(capDay * 86400000).toISOString().slice(0, 10);
  const preFzp = new Date((FZP_EFFECTIVE_DAY - 1) * 86400000).toISOString().slice(0, 10);
  const p = (
    tier: Provenance['tier'],
    label: string,
    sources: Provenance['sources'],
    method: string
  ): Provenance => ({ tier, label, sources, method });
  return {
    envelope: p(
      3,
      'FZP envelope in stories',
      [SRC.height],
      'Stories = min(80, floor(height ft / 10)) (orchestrator rule, tier 3) on the adopted FZP ' +
        'height string of the district with the largest overlap: the Local Program height on ' +
        'Local Program parcels, else the base side. The base height is the current string’s ' +
        'left side, used as the height in force for every roll year (no pre-FZP height map ' +
        'exists, tier 3).'
    ),
    localProgram: p(
      2,
      'Local Program eligibility',
      [SRC.height, SRC.roll, SRC.bulletin],
      'R-4 bulk from h9wh-cg3m; exclusions approximated from wv5m-vpq2; register listings not ' +
        'modelled (assumed eligible, tier 4). Rent control: ≥ 3 non-condo units built before 1979 ' +
        'on the latest roll; hotels: hotel property classes (motels eligible). Lots of 8,000 sf ' +
        'or more get at least 65 ft (§206.10(d)(1)(C)); corner lots are not modelled, so they ' +
        'are understated.'
    ),
    features: p(
      0,
      'Redevelopment features (assessor roll)',
      [SRC.roll, SRC.attrs],
      `Per parcel from the ${rollYear} secured roll (lien date 1 January), roll rows mapped to ` +
        'current parcels through acdm-wktn (retired lots by centroid). Imputations are tier 2: ' +
        'missing year built and improvement share take the median of the same land-use class ' +
        'and roll year (a year-wide median, then 0, when the class has none: tier 4); missing ' +
        'stories come from the building height. Sanity rules (tier 4, made up): roll stories ' +
        'above 80 are missing; a bracketed run of implausible units (≥ 100 and over 10× its ' +
        'neighbouring years) takes the previous year’s units (imputed bit 3). Parcels without ' +
        'a latest-year roll row take ' +
        'the "other" class medians. Assessed values reflect the Prop 13 acquisition basis, not ' +
        `market value. ${CAP_RULES}`
    ),
    existingUnits: p(
      0,
      'Existing homes (assessor)',
      [SRC.roll],
      `Σ number_of_units over the parcel’s roll rows in the latest roll year (${rollYear}); no ` +
        'LUDB fallback. A parcel without a latest-year row has 0. An implausible bracketed run ' +
        '(≥ 100 units and over 10× the neighbouring years) takes the previous year’s value ' +
        '(tier 4, imputed bit 3).'
    ),
    yield: p(
      3,
      'Units by fill level',
      [SRC.height, SRC.roll, SRC.attrs],
      'Gross units from the project’s typology generator (src/lib/generator, mode max, seed ' +
        'fnv1a32(id)), replacement typologies only, at max(1, round(fill × stories)) for each ' +
        'FILL_LEVELS fill (a tier-4 quantisation grid). FZP yields have no density cap on ' +
        `Local Program parcels and the cap on ${capDate} elsewhere; base yields use the base ` +
        `height and the pre-FZP cap (${preFzp}). ${CAP_RULES}`
    )
  };
}

/** Canonical JSON form of a decoded T11 payload: plain arrays, no `index`, fixed key order. */
export function scenarioDump(p: ScenarioParcels): unknown {
  const a = (x: ArrayLike<number>) => Array.from(x);
  const prov = (v: Provenance) => ({
    tier: v.tier,
    label: v.label,
    sources: v.sources.map((s) => ({ label: s.label, url: s.url })),
    method: v.method,
    ...(v.n === undefined ? {} : { n: v.n }),
    ...(v.window === undefined ? {} : { window: [...v.window] })
  });
  return {
    format: p.format,
    datasetVersion: p.datasetVersion,
    scenario: p.scenario,
    rollYear: p.rollYear,
    count: p.count,
    fillLevels: [...p.fillLevels],
    cells: p.cells.map((c) => ({ cellId: c.cellId, start: c.start, count: c.count })),
    districts: [...p.districts],
    provenance: {
      envelope: prov(p.provenance.envelope),
      localProgram: prov(p.provenance.localProgram),
      features: prov(p.provenance.features),
      existingUnits: prov(p.provenance.existingUnits),
      yield: prov(p.provenance.yield)
    },
    id: [...p.id],
    labelPoint: a(p.labelPoint),
    cell: a(p.cell),
    district: a(p.district),
    envelopeStories: a(p.envelopeStories),
    baseStories: a(p.baseStories),
    localProgram: a(p.localProgram),
    hostable: a(p.hostable),
    split: a(p.split),
    imputed: a(p.imputed),
    baseCap: a(p.baseCap),
    existingUnits: a(p.existingUnits),
    existingStories: a(p.existingStories),
    lotAreaM2: a(p.lotAreaM2),
    yearBuilt: a(p.yearBuilt),
    improvementShare: a(p.improvementShare),
    rentControlLikely: a(p.rentControlLikely),
    landUseClass: a(p.landUseClass),
    hostableBase: a(p.hostableBase),
    baseYield: a(p.baseYield),
    yield: a(p.yield),
    potentialRatio: { fzp: a(p.potentialRatio.fzp), base: a(p.potentialRatio.base) },
    storiesGap: { fzp: a(p.storiesGap.fzp), base: a(p.storiesGap.base) }
  };
}

/** The dump as the golden file stores it. */
export function formatScenarioDump(p: ScenarioParcels): string {
  return JSON.stringify(scenarioDump(p), null, 2) + '\n';
}

/** Inflate and decode a written parcels.bin; throws an Error naming the file if it fails. */
export function readParcelsBin(file: string): ScenarioParcels {
  try {
    return decodeScenarioPayload(new Uint8Array(inflateRawSync(readFileSync(file))));
  } catch (e) {
    throw new Error(`scenario: ${file} does not decode: ${(e as Error).message}`, { cause: e });
  }
}

/**
 * The scenario build step. Needs runSql's tables and the records writeChunks encoded
 * (readParcelRecords). Writes the DuckDB tables scenario_panel and parcel_lineage (kept for
 * later steps of the same build), `<derivedDir>/parcel-panel.parquet`,
 * `<derivedDir>/parcel-lineage.parquet` and `<outDir>/scenarios/fzp/parcels.bin`. `capDay` is
 * "today" for the FZP cap (the build's snapshot day). Returns every scenario.* count (the SQL
 * stage's included) and warnings. Throws when the written file does not decode.
 */
export async function writeScenario(a: {
  db: Duck;
  outDir: string;
  derivedDir: string;
  datasetVersion: string;
  records: { rec: ParcelRecord; cellId: string }[];
  capDay: Day;
  report: Report;
}): Promise<{ counts: Record<string, number>; warnings: string[] }> {
  const { db, report } = a;
  const warnings: string[] = [];
  const { parseFailures } = await report.time('scenario.sql', () => runScenarioSql(db, a.records));
  if (parseFailures.length > 0) {
    warnings.push(`scenario: height strings that do not parse: ${parseFailures.join(' | ')}`);
  }
  const recById = new Map(a.records.map(({ rec }) => [rec.id, rec]));

  // ---- T13 panel and lineage ----
  const memoSize = await report.time('scenario.base_yield', () => writeBaseYields(db, recById));
  await db.run(PANEL_SQL);
  const [{ panel, feat, years, latest }] = await db.all<{
    panel: number;
    feat: number;
    years: number;
    latest: number | null;
  }>(
    `SELECT (SELECT count(*) FROM scenario_panel) AS panel, (SELECT count(*) FROM sc_features) AS feat,
            (SELECT count(DISTINCT roll_year) FROM scenario_panel) AS years,
            (SELECT max(roll_year) FROM scenario_panel) AS latest`
  );
  if (panel !== feat) throw new Error(`scenario: ${panel} panel rows but ${feat} feature rows`);
  mkdirSync(a.derivedDir, { recursive: true });
  const panelFile = join(a.derivedDir, 'parcel-panel.parquet');
  const lineageFile = join(a.derivedDir, 'parcel-lineage.parquet');
  for (const f of [panelFile, lineageFile]) rmSync(f, { force: true });
  await db.run(
    `COPY (SELECT * FROM scenario_panel ORDER BY mapblklot, roll_year)
     TO ${sqlStr(panelFile)} (FORMAT parquet)`
  );
  await db.run(
    `COPY (SELECT * FROM parcel_lineage ORDER BY blklot, retired_mapblklot, date_rec_drop)
     TO ${sqlStr(lineageFile)} (FORMAT parquet)`
  );

  // ---- T11 rows ----
  const t0 = performance.now();
  const t11 = await (async () => {
    const rollYear = latest ?? 0;
    const latestRows = await db.all<LatestRow>(
      `SELECT p.mapblklot, p.existing_units, p.existing_stories, p.year_built, p.lot_area_m2,
              p.improvement_share, p.rent_control_likely, p.land_use_class, p.imputed,
              p.potential_ratio_base, p.stories_gap_base,
              f.existing_floor_area_m2, f.noncondo_units, f.hotel, f.status_n
       FROM scenario_panel p JOIN sc_features f USING (mapblklot, roll_year)
       WHERE p.roll_year = ${rollYear} ORDER BY p.mapblklot`
    );
    const latestById = new Map(latestRows.map((r) => [r.mapblklot, r]));
    const districts = await db.all<DistrictRow>(
      `SELECT d.id, d.district, d.kind, d.base_ft, d.lp_ft, d.r4, d.split, z.zoning_code,
              s.lot_area_m2
       FROM sc_district d JOIN sc_zoning z USING (id) JOIN sc_parcel s USING (id) ORDER BY d.id`
    );
    const districtById = new Map(districts.map((d) => [d.id, d]));
    // No-roll parcels take the latest year's 'other' medians (operator ruling).
    const [med] = await db.all<{ year_built: number; improvement_share: number }>(
      `SELECT year_built, improvement_share FROM sc_medians
       WHERE roll_year = ${rollYear} AND land_use_class = ${OTHER}`
    );
    return {
      rollYear,
      latestById,
      districtById,
      med: med ?? { year_built: 0, improvement_share: 0 }
    };
  })();

  const rows = [...a.records].sort((x, y) => cmp(x.cellId, y.cellId) || cmp(x.rec.id, y.rec.id));
  const n = rows.length;
  const districtOf = (id: string): DistrictRow => {
    const d = t11.districtById.get(id);
    if (!d) throw new Error(`scenario: parcel ${id} has no district row`);
    return d;
  };
  const districtNames = [...new Set(rows.map(({ rec }) => districtOf(rec.id).district))].sort(cmp);
  const districtIdx = new Map(districtNames.map((d, i) => [d, i]));
  const cells: ScenarioParcels['cells'] = [];
  const p: ScenarioParcels = {
    format: SCENARIO_FORMAT,
    datasetVersion: a.datasetVersion,
    scenario: 'fzp',
    rollYear: t11.rollYear,
    count: n,
    fillLevels: [...FILL_LEVELS],
    cells,
    districts: districtNames,
    provenance: provenance(a.capDay, t11.rollYear),
    id: rows.map(({ rec }) => rec.id),
    index: new Map(rows.map(({ rec }, i) => [rec.id, i])),
    labelPoint: new Float64Array(2 * n),
    cell: new Uint16Array(n),
    district: new Uint16Array(n),
    envelopeStories: new Uint8Array(n),
    baseStories: new Uint8Array(n),
    localProgram: new Uint8Array(n),
    hostable: new Uint8Array(n),
    split: new Uint8Array(n),
    imputed: new Uint8Array(n),
    baseCap: new Uint16Array(n),
    existingUnits: new Uint16Array(n),
    existingStories: new Uint8Array(n),
    lotAreaM2: new Uint32Array(n),
    yearBuilt: new Uint16Array(n),
    improvementShare: new Float32Array(n),
    rentControlLikely: new Uint8Array(n),
    landUseClass: new Uint8Array(n),
    hostableBase: new Uint8Array(n),
    baseYield: new Uint16Array(n * F),
    yield: new Uint16Array(n * F),
    potentialRatio: { fzp: new Float32Array(n), base: new Float32Array(n) },
    storiesGap: { fzp: new Int16Array(n), base: new Int16Array(n) }
  };

  const c: Record<string, number> = {};
  const inc = (k: string, by = 1) => (c[`scenario.${k}`] = (c[`scenario.${k}`] ?? 0) + by);
  for (const k of [
    'hostable',
    'local_program',
    'excluded.rent_control',
    'excluded.hotel',
    'large_lot_65',
    'roll.gov_zero_units',
    'roll.gov_zero_units_ludb_units',
    'roll.latest_eligible_matched',
    'density_cap.none',
    'density_cap.fzp_differs',
    'density_cap.rule.split',
    'density_cap.rule.generic_nc',
    'density_cap.rule.unlisted',
    'density_cap.rule.split_hostable',
    'density_cap.rule.generic_nc_hostable',
    'imputed.year_built',
    'imputed.existing_stories',
    'imputed.improvement_share',
    'imputed.no_roll',
    'units.total',
    'yield.fzp_net_total',
    'yield.zero_hostable_eligible',
    'yield.nonmonotone',
    'yield.clamped',
    'yield.nonlp_base_mismatch'
  ])
    inc(k, 0);

  const u16 = (v: number) => {
    if (v <= U16_MAX) return v;
    inc('yield.clamped');
    return U16_MAX;
  };

  rows.forEach(({ rec, cellId }, i) => {
    // Typed arrays wrap silently, so every integer column is range-checked before it is stored.
    const fit = (col: string, v: number, max: number): number => {
      if (!Number.isInteger(v) || v < 0 || v > max) {
        throw new Error(`scenario: parcel ${rec.id} ${col} = ${v} does not fit 0..${max}`);
      }
      return v;
    };
    const last = cells[cells.length - 1];
    if (last?.cellId === cellId) last.count++;
    else cells.push({ cellId, start: i, count: 1 });
    p.cell[i] = fit('cell', cells.length - 1, 0xffff);
    p.labelPoint[2 * i] = rec.labelPoint[0];
    p.labelPoint[2 * i + 1] = rec.labelPoint[1];

    const d = districtOf(rec.id);
    p.district[i] = fit('district', districtIdx.get(d.district)!, 0xffff);
    p.split[i] = d.split ? 1 : 0;

    // Features: the latest-year panel row, else the no-roll defaults (spec §4.5, rulings).
    const lat = t11.latestById.get(rec.id);
    const lotAreaM2 = lat ? lat.lot_area_m2 : d.lot_area_m2;
    p.lotAreaM2[i] = fit('lotAreaM2', lotAreaM2, 0xffffffff);
    let existingUnits: number;
    let existingStories: number;
    let floorArea: number;
    if (lat) {
      existingUnits = lat.existing_units;
      existingStories = lat.existing_stories;
      floorArea = lat.existing_floor_area_m2;
      p.yearBuilt[i] = fit('yearBuilt', lat.year_built, 0xffff);
      p.improvementShare[i] = lat.improvement_share;
      p.rentControlLikely[i] = lat.rent_control_likely ? 1 : 0;
      p.landUseClass[i] = fit('landUseClass', lat.land_use_class, LAND_USE_CLASSES.length - 1);
      p.imputed[i] = lat.imputed;
      inc('roll.latest_eligible_matched', rec.eligible ? 1 : 0);
    } else {
      existingUnits = 0;
      // Same fallback as 81_scenario_features.sql: round(height / 3.1), at least 1 (bit 1).
      const fromHeight = rec.existingHeightM > 0;
      existingStories = fromHeight ? Math.max(1, Math.round(rec.existingHeightM / FLOORS_M)) : 0;
      floorArea = rec.existingFloorAreaM2;
      p.yearBuilt[i] = fit('yearBuilt', t11.med.year_built, 0xffff);
      p.improvementShare[i] = t11.med.improvement_share;
      p.rentControlLikely[i] = 0;
      p.landUseClass[i] = OTHER;
      p.imputed[i] = 0b10101 | (fromHeight ? 0b10 : 0);
    }
    p.existingUnits[i] = fit('existingUnits', existingUnits, 0xffff);
    p.existingStories[i] = fit('existingStories', existingStories, 0xff);
    inc('units.total', existingUnits);
    if (lat?.status_n && lat.existing_units === 0 && rec.existingUnits > 0) {
      inc('roll.gov_zero_units');
      inc('roll.gov_zero_units_ludb_units', rec.existingUnits);
    }
    const bits = p.imputed[i];
    if (bits & 0b1) inc('imputed.year_built');
    if (bits & 0b10) inc('imputed.existing_stories');
    if (bits & 0b100) inc('imputed.improvement_share');
    if (bits & 0b10000) inc('imputed.no_roll');

    // Local Program and envelope (spec §4.4). Exclusions read the latest roll year.
    const rentControl =
      lat !== undefined &&
      lat.noncondo_units >= RENT_CONTROL_MIN_UNITS &&
      lat.year_built < RENT_CONTROL_BEFORE;
    const hotel = lat?.hotel ?? false;
    const district: HeightDistrict =
      d.kind === 'height' && d.base_ft !== null
        ? { kind: 'height', baseFt: d.base_ft, lpFt: d.lp_ft, r4: d.r4, normalised: d.district }
        : { kind: 'none' };
    const env = localProgramEnvelope({ district, lotAreaM2, excluded: rentControl || hotel });
    if (d.r4 && rentControl) inc('excluded.rent_control');
    if (d.r4 && hotel) inc('excluded.hotel');
    if (env.largeLot65) inc('large_lot_65');
    if (env.localProgram) inc('local_program');
    p.envelopeStories[i] = fit('envelopeStories', env.envelopeStories, 0xff);
    p.baseStories[i] = fit('baseStories', env.baseStories, 0xff);
    p.localProgram[i] = env.localProgram ? 1 : 0;

    // Caps (main ruling C2): base = the pre-FZP cap (old zoning); FZP = the cap on capDay.
    const baseCap = densityCap(d.zoning_code, lotAreaM2, d.r4, FZP_EFFECTIVE_DAY - 1);
    const fzpCap = densityCap(d.zoning_code, lotAreaM2, d.r4, a.capDay);
    p.baseCap[i] = baseCap === null ? NULL_CAP : fit('baseCap', baseCap, NULL_CAP - 1);
    if (baseCap === null) inc('density_cap.none');
    else inc(`density_cap.${d.zoning_code}`);
    if (baseCap !== fzpCap) inc('density_cap.fzp_differs');

    // Yields (spec §4.7): each distinct story count generated once, then capped per variant.
    const view = scenarioRecord(rec, {
      existingUnits,
      existingFloorAreaM2: floorArea,
      existingStories
    });
    const gross = new Map<number, number>();
    const grossAt = (stories: number) => {
      let g = gross.get(stories);
      if (g === undefined) {
        g = scenarioYield(view, stories, null);
        gross.set(stories, g);
      }
      return g;
    };
    const fzpYieldCap = env.localProgram ? null : fzpCap;
    for (let k = 0; k < F; k++) {
      const fill = FILL_LEVELS[k];
      p.yield[i * F + k] =
        env.envelopeStories === 0
          ? 0
          : u16(
              capScenarioYield(
                grossAt(fillStories(fill, env.envelopeStories)),
                fzpYieldCap,
                existingUnits
              )
            );
      p.baseYield[i * F + k] =
        env.baseStories === 0
          ? 0
          : u16(
              capScenarioYield(grossAt(fillStories(fill, env.baseStories)), baseCap, existingUnits)
            );
    }
    const top = p.yield[i * F + F - 1];
    const baseTop = p.baseYield[i * F + F - 1];
    p.hostable[i] = rec.eligible && env.envelopeStories >= 1 && top > 0 ? 1 : 0;
    p.hostableBase[i] = rec.eligible && env.baseStories >= 1 && baseTop > 0 ? 1 : 0;
    p.potentialRatio.fzp[i] = top / Math.max(existingUnits, 1);
    p.potentialRatio.base[i] = baseTop / Math.max(existingUnits, 1);
    p.storiesGap.fzp[i] = env.envelopeStories - existingStories;
    p.storiesGap.base[i] = env.baseStories - existingStories;
    if (p.hostable[i]) inc('hostable');
    if (rec.eligible && env.envelopeStories >= 1 && top === 0) inc('yield.zero_hostable_eligible');
    if (p.hostable[i] && env.localProgram)
      inc('yield.fzp_net_total', Math.max(0, top - existingUnits));
    for (let k = 1; k < F; k++) {
      if (p.yield[i * F + k] < p.yield[i * F + k - 1]) {
        inc('yield.nonmonotone');
        break;
      }
    }
    if (!env.localProgram && baseCap === fzpCap) {
      for (let k = 0; k < F; k++) {
        if (p.baseYield[i * F + k] !== p.yield[i * F + k]) {
          inc('yield.nonlp_base_mismatch');
          break;
        }
      }
    }

    // Main ruling 4c: parcels per tier-4 cap rule, all and hostable.
    const rule = densityCapRule(d.zoning_code);
    if (rule === 'split' || rule === 'generic-nc' || rule === 'unlisted') {
      const key = rule === 'generic-nc' ? 'generic_nc' : rule;
      inc(`density_cap.rule.${key}`);
      if (rule !== 'unlisted' && p.hostable[i]) inc(`density_cap.rule.${key}_hostable`);
    }
  });
  c['scenario.parcels'] = n;
  c['scenario.panel.years'] = years;
  c['scenario.panel.base_yield_memo'] = memoSize;

  // ---- File: encode, deflate, write, then decode what was written ----
  const payload = encodeScenarioPayload(p);
  const file = join(a.outDir, PARCELS_BIN);
  mkdirSync(dirname(file), { recursive: true });
  const body = deflateRawSync(payload, { level: 9 });
  writeFileSync(file, body);
  c['scenario.bytes.payload'] = payload.length;
  // Deflate bytes may differ across zlib builds (spec §4.8), so fixture reports omit them.
  if (!FIXTURE_RE.test(a.datasetVersion)) c['scenario.bytes.file'] = body.length;
  const decoded = readParcelsBin(file);
  report.timings['scenario.t11'] = Math.round(performance.now() - t0);

  // V18: the decoded T11 features (base variant) and mask equal the latest-year panel row.
  let mismatch = 0;
  for (const r of t11.latestById.values()) {
    const i = decoded.index.get(r.mapblklot);
    const same =
      i !== undefined &&
      decoded.existingUnits[i] === r.existing_units &&
      decoded.existingStories[i] === r.existing_stories &&
      decoded.lotAreaM2[i] === r.lot_area_m2 &&
      decoded.yearBuilt[i] === r.year_built &&
      decoded.improvementShare[i] === r.improvement_share &&
      decoded.rentControlLikely[i] === (r.rent_control_likely ? 1 : 0) &&
      decoded.landUseClass[i] === r.land_use_class &&
      decoded.imputed[i] === r.imputed &&
      decoded.potentialRatio.base[i] === r.potential_ratio_base &&
      decoded.storiesGap.base[i] === r.stories_gap_base;
    if (!same) mismatch++;
  }
  c['scenario.panel.feature_mismatch'] = mismatch;

  const hostable = c['scenario.hostable'];
  const split = c['scenario.density_cap.rule.split'];
  const splitH = c['scenario.density_cap.rule.split_hostable'];
  const nc = c['scenario.density_cap.rule.generic_nc'];
  const ncH = c['scenario.density_cap.rule.generic_nc_hostable'];
  warnings.push(
    `scenario: density caps unverified for ${UNVERIFIED_DISTRICTS.join(', ')} (no cap); ` +
      `tier-4 cap rules cover split ${split} parcels (${splitH} hostable), generic NC ${nc} ` +
      `(${ncH} hostable), unlisted ${c['scenario.density_cap.rule.unlisted']}`
  );
  // Fixture builds keep the counts but not this line: on mini it fires on lot 3 alone.
  if (
    !FIXTURE_RE.test(a.datasetVersion) &&
    hostable > 0 &&
    (splitH > UNVERIFIED_SHARE_WARN * hostable || ncH > UNVERIFIED_SHARE_WARN * hostable)
  ) {
    warnings.push(
      `scenario: split (${splitH}) or generic-NC (${ncH}) parcels exceed 10% of the ${hostable} ` +
        'hostable parcels (main ruling 4c: report to main)'
    );
  }

  const sqlCounts = await db.all<{ key: string; value: number }>(
    `SELECT key, value FROM report_counts WHERE key LIKE 'scenario.%' ORDER BY key`
  );
  const counts = Object.fromEntries([
    ...sqlCounts.map((r): [string, number] => [r.key, r.value]),
    ...Object.entries(c).sort(([x], [y]) => cmp(x, y))
  ]);
  return { counts, warnings };
}
