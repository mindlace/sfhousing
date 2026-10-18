// The SQL-side scenario-data T14 rules (scenario-data spec §4.5, §4.12, §6 "scenario-quality.test.ts"),
// on synthetic cases in copies of the mini tables (the scenario-sql.test.ts precedent). Each case
// asserts the written value, the mask bit, and the rule's fired/of and sample as recordSqlQuality
// passes them to recordQuality (the counts it writes and the quality_sample rows it reads).
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import { LAND_USE_CLASSES } from '../../src/lib/data/scenario-codec';
import { FZP_EFFECTIVE_DAY, densityCap } from '../lib/density-caps';
import type { Duck } from '../lib/duck';
import {
  QUALITY_RULES,
  createQualityTables,
  qualityRule,
  writeQualityReport
} from '../lib/quality';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { readParcelRecords } from '../steps/chunks';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../steps/scenario';
import { SUPERSEDED_SCENARIO_COUNTS, miniDuck } from './helpers';

/** Bits of the T11/T13 `imputed` mask (RA1 mask convention). */
const BIT = { year: 1, stories: 2, share: 4, units: 8, carried: 32, floor: 64 };
const RESIDENTIAL = 0;
const OTHER = LAND_USE_CLASSES.indexOf('other');

interface Feature {
  mapblklot: string;
  roll_year: number;
  lien_day: number;
  existing_units: number;
  existing_stories: number;
  year_built: number;
  existing_floor_area_m2: number;
  noncondo_units: number;
  base_density_cap: number | null;
  imputed: number;
}

interface Synthetic {
  schema: string;
  /** The build's `counts` that runScenarioSql's recordSqlQuality wrote into. */
  quality: Record<string, number>;
  scenarioCounts: Record<string, number>;
  outDir: string;
  /** The chunk records the scenario step ran on, by id. */
  records: Map<string, ParcelRecord>;
  warnings: string[];
}

let db: Duck;

beforeAll(async () => {
  db = await miniDuck();
  await runSql(db);
});

/**
 * A copy of the mini tables in schema `schema`, edited by `edit` (SQL run with `USE schema`), with
 * chunk-record fields overridden by `recs`, then the whole scenario step on it.
 */
async function synthetic(
  schema: string,
  edit: string[],
  recs: Record<string, Partial<ParcelRecord>> = {},
  datasetVersion = 'fixture-0'
): Promise<Synthetic> {
  await db.run(`ATTACH ':memory:' AS ${schema}`);
  for (const t of ['parcels', 'parcel_out', 'src_height_bulk', 'src_parcel_attrs', 'src_roll']) {
    await db.run(`CREATE TABLE ${schema}.${t} AS SELECT * FROM memory.${t}`);
  }
  await db.run(`CREATE TABLE ${schema}.report_counts AS SELECT * FROM memory.report_counts`);
  await db.run(`USE ${schema}`);
  try {
    await createQualityTables(db);
    for (const sql of edit) await db.run(sql);
    const records = (await readParcelRecords(db)).map(({ rec, cellId }) => ({
      rec: { ...rec, ...recs[rec.id] },
      cellId
    }));
    const quality: Record<string, number> = {};
    const root = mkdtempSync(join(tmpdir(), `sfh-scenario-quality-${schema}-`));
    const outDir = join(root, 'out');
    const { counts, warnings } = await writeScenario({
      db,
      outDir,
      derivedDir: join(root, 'derived'),
      datasetVersion,
      records,
      capDay: Date.UTC(2026, 9, 10) / 86400000,
      report: new Report(),
      buildCounts: quality
    });
    return {
      schema,
      quality,
      scenarioCounts: counts,
      outDir,
      records: new Map(records.map(({ rec }) => [rec.id, rec])),
      warnings
    };
  } finally {
    await db.run('USE memory');
  }
}

/** A copy of a roll row (`parcel_number`, `from` year) as another year or parcel number. */
const copyRow = (
  id: string,
  from: number,
  set: { year?: number; units?: number; parcel?: string }
) =>
  `INSERT INTO src_roll SELECT * REPLACE (${set.year ?? from} AS closed_roll_year,
     ${set.units === undefined ? 'number_of_units' : set.units} AS number_of_units,
     '${set.parcel ?? id}' AS parcel_number)
   FROM src_roll WHERE parcel_number = '${id}' AND closed_roll_year = ${from}`;
const setRow = (id: string, years: number[], set: string) =>
  `UPDATE src_roll SET ${set} WHERE parcel_number = '${id}'
   AND closed_roll_year IN (${years.join(', ')})`;

const features = async (s: Synthetic, id: string) =>
  db.all<Feature>(
    `SELECT * FROM ${s.schema}.sc_features WHERE mapblklot = '${id}' ORDER BY roll_year`
  );
const feature = async (s: Synthetic, id: string, year: number) =>
  (await features(s, id)).find((f) => f.roll_year === year)!;
/** The rule's counts and its sample, as recordSqlQuality passes them to recordQuality. */
async function tally(s: Synthetic, id: string) {
  const sample = await db.all<{ record_id: string }>(
    `SELECT record_id FROM ${s.schema}.quality_sample WHERE rule_id = '${id}' ORDER BY record_id`
  );
  const k = (x: string) => s.quality[`quality.${id}.${x}`];
  return {
    fired: k('fired'),
    of: k('of'),
    ...(k('units') === undefined ? {} : { units: k('units'), unitsOf: k('unitsOf') }),
    sample: sample.map((r) => r.record_id)
  };
}
/**
 * A TS-side rule's counts and its sample as recorded by recordQuality: the counts from `quality`,
 * the sample from the rule's quality-report.md section (its first 25 ids, sorted).
 */
async function reported(s: Synthetic, id: string) {
  const file = join(s.outDir, '..', `quality-${s.schema}.md`);
  writeQualityReport(file, 'fixture-0', s.quality);
  const [, section] = readFileSync(file, 'utf8').split(`### ${id}\n\n`);
  const [first, ids] = section.split('\n\n');
  return {
    fired: s.quality[`quality.${id}.fired`],
    of: s.quality[`quality.${id}.of`],
    sample: first.startsWith('No affected ids') ? [] : ids.trim().split(', ')
  };
}
const median = async (s: Synthetic, year: number, cls: number) => {
  const [m] = await db.all<{ year_built: number }>(
    `SELECT year_built FROM ${s.schema}.sc_medians WHERE roll_year = ${year}
     AND land_use_class = ${cls}`
  );
  return m.year_built;
};

describe('the scenario-data rules in the registry (spec §4.12 tables, DQ-4 rulings)', () => {
  // [id, source, field, kind, action, tier, valueTier, maskBit, denominator, unitsWeighted]
  const TABLE: [
    string,
    string,
    string,
    string,
    string,
    number,
    number | null,
    number | null,
    string,
    boolean
  ][] = [
    [
      'sd.roll.year-built-range',
      'datasf-assessor-roll',
      'year_property_built',
      'bound',
      'replace',
      4,
      2,
      0,
      'roll rows with a year',
      false
    ],
    [
      'sd.roll.stories-max',
      'datasf-assessor-roll',
      'number_of_stories',
      'bound',
      'replace',
      4,
      2,
      1,
      'roll rows with stories',
      false
    ],
    [
      'sd.roll.units-capacity',
      'sc_roll_agg',
      'number_of_units',
      'outlier',
      'replace',
      4,
      2,
      3,
      'observed parcel-years',
      true
    ],
    [
      'sd.roll.units-spike',
      'sc_roll_agg',
      'number_of_units',
      'outlier',
      'replace',
      4,
      2,
      3,
      'observed parcel-years',
      true
    ],
    [
      'sd.roll.units-latest-jump',
      'scenario_panel',
      'existing_units',
      'outlier',
      'none',
      4,
      null,
      null,
      'parcels with rows in the latest and the previous roll year',
      false
    ],
    [
      'sd.roll.units-large',
      'scenario_panel',
      'existing_units',
      'outlier',
      'none',
      4,
      null,
      null,
      'panel parcel-years',
      false
    ],
    [
      'sd.roll.year-gap',
      'sc_roll_agg',
      'every roll column',
      'gap',
      'default',
      2,
      2,
      5,
      'panel parcel-years (observed and carried)',
      false
    ],
    [
      'sd.roll.unmatched',
      'datasf-assessor-roll',
      'parcel_number',
      'shape',
      'drop',
      2,
      null,
      null,
      'roll rows',
      true
    ],
    [
      'sd.features.year-built-median',
      'sc_roll_agg',
      'year_built',
      'missing',
      'default',
      2,
      2,
      0,
      'non-vacant parcel-years',
      false
    ],
    [
      'sd.features.stories-height',
      'sc_roll_agg',
      'stories',
      'missing',
      'default',
      2,
      3,
      1,
      'observed parcel-years',
      false
    ],
    [
      'sd.features.share-median',
      'sc_roll_agg',
      'land, impr',
      'missing',
      'default',
      2,
      2,
      2,
      'non-vacant parcel-years',
      false
    ],
    [
      'sd.features.median-fallback',
      'sc_medians',
      'year_built, improvement_share',
      'missing',
      'default',
      4,
      4,
      null,
      'values imputed by the two median rules',
      false
    ],
    [
      'sd.roll.floor-area-missing',
      'sc_roll_agg',
      'property_area',
      'missing',
      'default',
      2,
      3,
      6,
      'panel parcel-years plus T11 no-row parcels',
      false
    ],
    // The TS-side rules (spec §4.12 tables; observation rules take tier 4).
    [
      'sd.roll.no-row',
      'datasf-assessor-roll',
      'every roll column',
      'missing',
      'default',
      4,
      4,
      4,
      'T11 parcels',
      false
    ],
    [
      'sd.zoning.split-code',
      'datasf-parcel-attrs',
      'zoning_code',
      'shape',
      'replace',
      4,
      4,
      null,
      'hostable parcels',
      false
    ],
    [
      'sd.zoning.generic-nc',
      'datasf-parcel-attrs',
      'zoning_code',
      'shape',
      'default',
      4,
      4,
      null,
      'hostable parcels',
      false
    ],
    [
      'sd.yield.nonmonotone',
      'parcels.bin',
      'yield',
      'shape',
      'none',
      4,
      null,
      null,
      'parcels',
      false
    ],
    [
      'sd.yield.zero-hostable',
      'parcels.bin',
      'yield',
      'shape',
      'none',
      4,
      null,
      null,
      'eligible parcels with envelopeStories ≥ 1',
      false
    ],
    // DQ-4 registered rules (controller rulings, Task 3 review): as-built drop and default.
    [
      'sd.roll.no-year',
      'datasf-assessor-roll',
      'closed_roll_year',
      'shape',
      'drop',
      4,
      null,
      null,
      'roll rows',
      false
    ],
    [
      'sd.roll.units-missing',
      'sc_roll_agg',
      'number_of_units',
      'missing',
      'default',
      4,
      4,
      3,
      'observed parcel-years',
      false
    ],
    // DQ-4 registered rules (final fix wave, review Important 1): the normalise TRY_CAST
    // rewrites, flagged per row in cast_flags and tallied in 80_scenario.sql.
    ...(
      [
        ['sd.roll.roll-year-cast', 'closed_roll_year', 'replace', 0, null, 'a roll year'],
        ['sd.roll.year-built-cast', 'year_property_built', 'replace', 0, 0, 'a year'],
        ['sd.roll.stories-cast', 'number_of_stories', 'replace', 0, 1, 'stories'],
        ['sd.roll.units-cast', 'number_of_units', 'replace', 0, 3, 'units'],
        ['sd.roll.floor-area-cast', 'property_area', 'null', null, 6, 'a floor area'],
        ['sd.roll.land-value-cast', 'assessed_land_value', 'null', null, 2, 'a land value'],
        [
          'sd.roll.improvement-value-cast',
          'assessed_improvement_value',
          'null',
          null,
          2,
          'an improvement value'
        ]
      ] as const
    ).map(([id, field, action, valueTier, bit, what]): (typeof TABLE)[number] => [
      id,
      'datasf-assessor-roll',
      field,
      'shape',
      action,
      4,
      valueTier,
      bit,
      `roll rows with ${what}`,
      false
    ]),
    ...(
      [
        ['sd.attrs.latitude-cast', 'centroid_latitude', 'null', null, 'a latitude'],
        ['sd.attrs.longitude-cast', 'centroid_longitude', 'null', null, 'a longitude'],
        ['sd.attrs.added-date-cast', 'date_rec_add', 'replace', 0, 'an added date'],
        ['sd.attrs.dropped-date-cast', 'date_rec_drop', 'replace', 0, 'a dropped date']
      ] as const
    ).map(([id, field, action, valueTier, what]): (typeof TABLE)[number] => [
      id,
      'datasf-parcel-attrs',
      field,
      'shape',
      action,
      4,
      valueTier,
      null,
      `parcel rows with ${what}`,
      false
    ]),
    [
      'sd.attrs.active-unknown',
      'datasf-parcel-attrs',
      'active',
      'shape',
      'default',
      4,
      4,
      null,
      'parcel rows',
      false
    ],
    [
      'sd.attrs.no-blklot',
      'datasf-parcel-attrs',
      'blklot',
      'shape',
      'drop',
      4,
      null,
      null,
      'parcel rows',
      false
    ],
    [
      'sd.height.blank',
      'datasf-height-bulk',
      'height',
      'shape',
      'drop',
      4,
      null,
      null,
      'height polygons',
      false
    ],
    // Spec-stated behaviour, counted (final fix wave): observe · none.
    [
      'sd.zoning.missing',
      'datasf-parcel-attrs',
      'zoning_code',
      'observe',
      'none',
      4,
      null,
      null,
      'hostable parcels',
      false
    ],
    [
      'sd.features.no-building',
      'sc_roll_agg',
      'stories',
      'observe',
      'none',
      4,
      null,
      null,
      'observed parcel-years',
      false
    ],
    // The vacant-lot definition (coordinator ruling, final fix wave): observe · none per field.
    [
      'sd.features.vacant-year-built',
      'sc_roll_agg',
      'year_built',
      'observe',
      'none',
      4,
      null,
      null,
      'panel parcel-years',
      false
    ],
    [
      'sd.features.vacant-share',
      'sc_roll_agg',
      'land, impr',
      'observe',
      'none',
      4,
      null,
      null,
      'panel parcel-years',
      false
    ]
  ];
  /** Partner-approved share overrides (DQ-4, 2026-10-17; design RA1 "Share overrides"). */
  const OVERRIDES: Record<string, { warnShare: number; failShare: number }> = {
    'sd.roll.units-capacity': { warnShare: 0.05, failShare: 0.1 },
    'sd.roll.floor-area-missing': { warnShare: 0.07, failShare: 0.15 },
    'sd.zoning.generic-nc': { warnShare: 0.05, failShare: 0.1 },
    'sd.yield.zero-hostable': { warnShare: 0.09, failShare: 0.15 }
  };
  it('lists every registered scenario-data rule', () => {
    expect(TABLE.map(([id]) => id).sort()).toEqual(
      QUALITY_RULES.filter((r) => r.owner === 'scenario-data').map((r) => r.id)
    );
  });
  it.each(TABLE)(
    '%s',
    (id, source, field, kind, action, tier, valueTier, maskBit, denominator, unitsWeighted) => {
      const r = qualityRule(id);
      expect(r).toMatchObject({
        owner: 'scenario-data',
        source,
        field,
        kind,
        action,
        tier,
        valueTier,
        maskBit,
        denominator,
        unitsWeighted,
        ...(OVERRIDES[id] ?? { warnShare: kind === 'missing' ? 0.05 : 0.01, failShare: 0.1 })
      });
      expect(r.label.length).toBeGreaterThan(10);
    }
  );
});

describe('scenario-data SQL rules on a synthetic copy of mini', () => {
  let s: Synthetic;
  beforeAll(async () => {
    s = await synthetic(
      'q',
      [
        // Roll year 2023 for two more lots (copies of their 2025 rows; mini has lots 3 and 4 in
        // 2023), and one unmatched row.
        copyRow('3512010', 2025, { year: 2023, units: 5 }),
        copyRow('3512014', 2025, { year: 2023, units: 50 }),
        copyRow('3512001', 2025, { parcel: '9999999', units: 7 }),
        // sd.roll.year-built-range: 1700 and roll year + 1 go; 1850 and the roll year stay.
        setRow('3512001', [2025], 'year_property_built = 1700'),
        setRow('3512006', [2025], 'year_property_built = 2026'),
        setRow('3512010', [2025], 'year_property_built = 1850'),
        setRow('3512008', [2025], 'year_property_built = 2025'),
        // sd.features.year-built-median: a source NULL on a non-vacant parcel-year.
        setRow('3512013', [2024], 'year_property_built = NULL'),
        // sd.roll.stories-max: lot 6's only row, and one of lot 2's three condo rows.
        setRow('3512006', [2025], 'number_of_stories = 999'),
        setRow('3512101', [2025], 'number_of_stories = 999'),
        setRow('3512102', [2025], 'number_of_stories = 4'),
        // sd.roll.units-capacity, each step of the chain. Mini's own RA1 cases (spec §4.11) give
        // lot 3 5,000 in 2023 and 2025 and lot 4 3, 900, 3; lot 4's 2023 becomes 2 here, so the
        // earlier-first tie with 2025 shows in the value.
        setRow('0026T001A', [2023], 'number_of_units = 2'),
        setRow('3512005', [2024, 2025], 'number_of_units = 1000'),
        setRow('3512008', [2025], 'number_of_units = 120'),
        // Capacity before spike: 5, 5,000, 5 on a 2-story 300 m² lot (capacity 60).
        setRow('3512010', [2024], 'number_of_units = 5000'),
        setRow('3512010', [2025], 'number_of_units = 5'),
        // sd.roll.units-spike: 50, 1,500, 50 on a lot whose capacity is 1,800.
        setRow('3512014', [2024], 'number_of_units = 1500'),
        setRow('3512014', [2025], 'number_of_units = 50'),
        // Observation rules: 600 units in 2025 after 2 in 2024, on a lot whose capacity is 1,000.
        setRow('3512001', [2025], 'number_of_units = 600'),
        // sd.roll.floor-area-missing: no roll floor area on lot 11 in 2025.
        setRow('3512011', [2025], 'property_area = 0'),
        // sd.roll.units-missing: lot 6's only 2024 row has no units.
        setRow('3512006', [2024], 'number_of_units = NULL'),
        // sd.roll.no-year: a copy of lot 7's 2025 row (0 units) without a roll year.
        `INSERT INTO src_roll SELECT * REPLACE (NULL AS closed_roll_year)
         FROM src_roll WHERE parcel_number = '3512007' AND closed_roll_year = 2025`
      ],
      {
        '3512005': { areaM2: 255, existingUnits: 30 },
        '3512014': { areaM2: 3000 },
        '3512001': { areaM2: 5000 }
      }
    );
  });

  it('sd.roll.year-built-range nulls 1700 and roll year + 1, then imputes the class median', async () => {
    const lot1 = await feature(s, '3512001', 2025);
    expect(lot1.year_built).toBe(await median(s, 2025, RESIDENTIAL));
    expect(lot1.imputed & BIT.year).toBe(BIT.year);
    const lot6 = await feature(s, '3512006', 2025);
    expect(lot6.year_built).toBe(await median(s, 2025, RESIDENTIAL));
    expect(lot6.imputed & BIT.year).toBe(BIT.year);
    // 1850 and the roll year itself are kept, with no bit 0.
    expect(await feature(s, '3512010', 2025)).toMatchObject({ year_built: 1850 });
    expect((await feature(s, '3512010', 2025)).imputed & BIT.year).toBe(0);
    expect(await feature(s, '3512008', 2025)).toMatchObject({ year_built: 2025 });
    expect((await feature(s, '3512008', 2025)).imputed & BIT.year).toBe(0);
    // Mini's own year "0" on lot 5's 2024 row (normalise keeps it now) fires too. Of: the 28 mini
    // rows, minus lot 7's two without a year, plus the four copies, minus lot 13's NULL.
    expect(await tally(s, 'sd.roll.year-built-range')).toEqual({
      fired: 3,
      of: 29,
      sample: ['3512001:2025', '3512005:2024', '3512006:2025']
    });
  });

  it('sd.features.year-built-median counts a source NULL only, not a nulled year', async () => {
    const f = await feature(s, '3512013', 2024);
    expect(f.year_built).toBe(await median(s, 2024, RESIDENTIAL));
    expect(f.imputed & BIT.year).toBe(BIT.year);
    // Of: the 27 observed parcel-years and lot 3's carried 2024 row, less lot 7's two vacant ones.
    expect(await tally(s, 'sd.features.year-built-median')).toEqual({
      fired: 1,
      of: 26,
      sample: ['3512013:2024']
    });
  });

  it('sd.roll.stories-max nulls 999 stories: height fallback, and bit 1 beside a 4-story sibling', async () => {
    const lot6 = await feature(s, '3512006', 2025);
    // Lot 6's chunk height is 9 m: round(9 / 3.1) = 3 (sd.features.stories-height).
    expect(lot6.existing_stories).toBe(3);
    expect(lot6.imputed & BIT.stories).toBe(BIT.stories);
    const lot2 = await feature(s, '3512002', 2025);
    expect(lot2.existing_stories).toBe(4);
    expect(lot2.imputed & BIT.stories).toBe(BIT.stories);
    expect((await feature(s, '3512002', 2024)).imputed & BIT.stories).toBe(0);
    expect(await tally(s, 'sd.roll.stories-max')).toEqual({
      fired: 2,
      of: 32,
      sample: ['3512006:2025', '3512101:2025']
    });
    expect(await tally(s, 'sd.features.stories-height')).toEqual({
      fired: 1,
      of: 27,
      sample: ['3512006:2025']
    });
  });

  it('sd.roll.unmatched drops a row with no current parcel, weighted by its units', async () => {
    const [{ units }] = await db.all<{ units: number }>(
      'SELECT sum(coalesce(number_of_units, 0))::INTEGER units FROM q.src_roll'
    );
    expect(await tally(s, 'sd.roll.unmatched')).toEqual({
      fired: 1,
      of: 32,
      units: 7,
      unitsOf: units,
      sample: ['9999999:2025']
    });
    expect(s.scenarioCounts['scenario.roll.unmatched.2025']).toBe(1);
    expect(s.scenarioCounts['scenario.roll.unmatched_units.2025']).toBe(7);
  });

  it('sd.roll.units-capacity: the nearest passing year, the earlier one on a tie', async () => {
    // Lot 4: 2, 900, 3 on 3 stories and 300 m² (capacity 90). 2023 and 2025 tie; 2023 wins.
    const f = await features(s, '0026T001A');
    expect(f.map((r) => [r.roll_year, r.existing_units, r.imputed & BIT.units])).toEqual([
      [2023, 2, 0],
      [2024, 2, BIT.units],
      [2025, 3, 0]
    ]);
    // noncondo_units is capped at the replacement.
    expect(f[1].noncondo_units).toBe(2);
  });

  it('sd.roll.units-capacity: the LUDB value when no year passes, noncondo_units capped', async () => {
    // Lot 3: 5,000 in 2023 and 2025, capacity 90; the chunk record's LUDB units 4 pass. Its 2024
    // row is carried from 2023, bit 3 included.
    const f = await features(s, '8711023C');
    expect(f.map((r) => [r.existing_units, r.noncondo_units, r.imputed & BIT.units])).toEqual([
      [4, 4, BIT.units],
      [4, 4, BIT.units],
      [4, 4, BIT.units]
    ]);
    // bit 3 reaches T11 (AC 16).
    const p = readParcelsBin(join(s.outDir, PARCELS_BIN));
    const i = p.index.get('8711023C')!;
    expect(p.existingUnits[i]).toBe(4);
    expect(p.imputed[i] & BIT.units).toBe(BIT.units);
  });

  it('sd.roll.units-capacity: floor(capacity) when the LUDB value fails too', async () => {
    // Lot 5: 1,000 in both years on 1 story and 255 m², capacity 25.5; LUDB 30 fails too.
    const f = await features(s, '3512005');
    expect(f.map((r) => [r.existing_units, r.imputed & BIT.units])).toEqual([
      [25, BIT.units],
      [25, BIT.units]
    ]);
  });

  it('sd.roll.units-capacity: a parcel-year exactly at capacity does not fire', async () => {
    // Lot 8: 120 units on 4 stories and 300 m², capacity 120.
    expect(await feature(s, '3512008', 2025)).toMatchObject({ existing_units: 120 });
    expect((await feature(s, '3512008', 2025)).imputed & BIT.units).toBe(0);
  });

  it('sd.roll.units-capacity tally: replaced parcel-years, weighted by their original units', async () => {
    const [{ units }] = await db.all<{ units: number }>(
      'SELECT sum(units)::INTEGER units FROM q.sc_roll_agg'
    );
    expect(await tally(s, 'sd.roll.units-capacity')).toEqual({
      fired: 6,
      of: 27,
      units: 900 + 5000 + 5000 + 5000 + 1000 + 1000,
      unitsOf: units,
      sample: [
        '0026T001A:2024',
        '3512005:2024',
        '3512005:2025',
        '3512010:2024',
        '8711023C:2023',
        '8711023C:2025'
      ]
    });
  });

  it('capacity runs before spike: 5, 5,000, 5 is replaced by the capacity rule only', async () => {
    const f = await features(s, '3512010');
    expect(f.map((r) => [r.roll_year, r.existing_units, r.imputed & BIT.units])).toEqual([
      [2023, 5, 0],
      [2024, 5, BIT.units],
      [2025, 5, 0]
    ]);
    expect((await tally(s, 'sd.roll.units-spike')).sample).not.toContain('3512010:2024');
  });

  it('sd.roll.units-spike: 50, 1,500, 50 within capacity is replaced by the spike rule', async () => {
    const f = await features(s, '3512014');
    expect(f.map((r) => [r.roll_year, r.existing_units, r.imputed & BIT.units])).toEqual([
      [2023, 50, 0],
      [2024, 50, BIT.units],
      [2025, 50, 0]
    ]);
    const [{ units }] = await db.all<{ units: number }>(
      `SELECT sum(existing_units)::INTEGER units FROM q.sc_features
       WHERE (imputed & ${BIT.carried}) = 0`
    );
    // unitsOf is the post-capacity series' total: the spike's 1,500 in place of its 50.
    expect(await tally(s, 'sd.roll.units-spike')).toEqual({
      fired: 1,
      of: 27,
      units: 1500,
      unitsOf: units - 50 + 1500,
      sample: ['3512014:2024']
    });
  });

  it('sd.roll.floor-area-missing takes the rounded chunk floor area and sets bit 6', async () => {
    // Lot 11's chunk floor area is 600.6 m²; its 2024 roll area 6,000 sf is 557.4 m².
    const lot11 = await features(s, '3512011');
    expect(lot11.map((r) => [r.existing_floor_area_m2, r.imputed & BIT.floor])).toEqual([
      [557, 0],
      [601, BIT.floor]
    ]);
    const p = readParcelsBin(join(s.outDir, PARCELS_BIN));
    const i = p.index.get('3512011')!;
    expect(p.existingFloorAreaM2[i]).toBe(601);
    expect(p.imputed[i] & BIT.floor).toBe(BIT.floor);
    // Lot 7 (vacant) has no roll floor area in either year. The no-row parcels (lots 9, 12 and
    // 13, which have no 2025 row) also fire it (spec §4.5 step 5): fired and of each gain 3. Of:
    // the 28 panel parcel-years (lot 3's carried 2024 row included) plus those 3.
    expect(await tally(s, 'sd.roll.floor-area-missing')).toEqual({
      fired: 6,
      of: 31,
      sample: ['3512007:2024', '3512007:2025', '3512009', '3512011:2025', '3512012', '3512013']
    });
  });

  it('sd.roll.no-row: a parcel without a latest-year row gets the defaults and imputed 95', async () => {
    const p = readParcelsBin(join(s.outDir, PARCELS_BIN));
    for (const id of ['3512009', '3512012', '3512013']) {
      const i = p.index.get(id)!;
      const rec = s.records.get(id)!;
      expect(
        {
          imputed: p.imputed[i],
          existingUnits: p.existingUnits[i],
          existingFloorAreaM2: p.existingFloorAreaM2[i],
          landUseClass: p.landUseClass[i],
          rentControlLikely: p.rentControlLikely[i]
        },
        id
      ).toEqual({
        imputed: 95,
        existingUnits: 0,
        existingFloorAreaM2: Math.round(rec.existingFloorAreaM2),
        landUseClass: OTHER,
        rentControlLikely: 0
      });
    }
    // Lot 13 has a building height (21.3 m): round(21.3 / 3.1) = 7 stories; lot 9 has none.
    expect(p.existingStories[p.index.get('3512013')!]).toBe(7);
    expect(p.existingStories[p.index.get('3512009')!]).toBe(0);
    expect(await reported(s, 'sd.roll.no-row')).toEqual({
      fired: 3,
      of: 14,
      sample: ['3512009', '3512012', '3512013']
    });
    expect(s.scenarioCounts['scenario.imputed.no_roll']).toBe(3);
    expect(s.scenarioCounts['scenario.imputed.floor_area']).toBe(5);
  });

  it('sd.roll.units-missing: a parcel-year whose rows all lack units has 0 and bit 3', async () => {
    expect(await feature(s, '3512006', 2024)).toMatchObject({ existing_units: 0 });
    expect((await feature(s, '3512006', 2024)).imputed & BIT.units).toBe(BIT.units);
    expect((await feature(s, '3512006', 2025)).imputed & BIT.units).toBe(0);
    expect(await tally(s, 'sd.roll.units-missing')).toEqual({
      fired: 1,
      of: 27,
      sample: ['3512006:2024']
    });
  });

  it('sd.roll.no-year drops a roll row without a roll year', async () => {
    const [{ n }] = await db.all<{ n: number }>(
      `SELECT count(*)::INTEGER n FROM q.src_roll WHERE closed_roll_year IS NULL`
    );
    expect(n).toBe(1);
    expect(await tally(s, 'sd.roll.no-year')).toEqual({ fired: 1, of: 33, sample: ['3512007'] });
    // The dropped row reaches no parcel-year: lot 7 keeps one row per roll year.
    expect((await features(s, '3512007')).map((f) => f.roll_year)).toEqual([2024, 2025]);
  });

  it('sd.features.share-median and the median fallback', async () => {
    // Lot 11 (GOVT, other) has land + impr = 0; no other row of class other has a share.
    expect(await tally(s, 'sd.features.share-median')).toEqual({
      fired: 2,
      of: 26,
      sample: ['3512011:2024', '3512011:2025']
    });
    // Of: every median-imputed value (four years, two shares); fired: the two shares.
    expect(await tally(s, 'sd.features.median-fallback')).toEqual({
      fired: 2,
      of: 6,
      sample: ['3512011:2024', '3512011:2025']
    });
  });

  it('sd.roll.units-latest-jump and sd.roll.units-large count and change nothing', async () => {
    const f = await feature(s, '3512001', 2025);
    expect(f.existing_units).toBe(600);
    expect(f.imputed & BIT.units).toBe(0);
    // Of: the 11 parcels with rows in 2024 and 2025.
    expect(await tally(s, 'sd.roll.units-latest-jump')).toEqual({
      fired: 1,
      of: 11,
      sample: ['3512001']
    });
    expect(await tally(s, 'sd.roll.units-large')).toEqual({
      fired: 1,
      of: 28,
      sample: ['3512001:2025']
    });
  });

  it('sd.roll.year-gap carries only mini lot 3’s 2024, and the latest-year V18 equality holds', async () => {
    expect(await tally(s, 'sd.roll.year-gap')).toEqual({
      fired: 1,
      of: 28,
      sample: ['8711023C:2024']
    });
    expect(s.scenarioCounts['scenario.panel.feature_mismatch']).toBe(0);
  });

  it('every scenario-data rule reports once (recordQuality throws on a second report)', () => {
    const ids = QUALITY_RULES.filter((r) => r.owner === 'scenario-data').map((r) => r.id);
    expect(ids).toHaveLength(38);
    const got = Object.keys(s.quality)
      .filter((k) => k.endsWith('.fired'))
      .map((k) => k.slice('quality.'.length, -'.fired'.length))
      .sort();
    expect(got).toEqual(ids);
    for (const id of ids) expect(s.quality[`quality.${id}.of`], id).toBeTypeOf('number');
    // The superseded scenario.* counts are gone (spec §4.10).
    for (const k of SUPERSEDED_SCENARIO_COUNTS) expect(s.scenarioCounts).not.toHaveProperty(k);
  });
});

describe('the TS-side zoning and yield rules on a synthetic copy of mini', () => {
  let s: Synthetic;
  beforeAll(async () => {
    // A split code on lot 10 (hostable) and on lot 7 (ineligible, so not hostable). Lot 3 keeps
    // its generic NC code. A non-fixture version, so no fixture-only path hides a warning.
    s = await synthetic(
      'z',
      [
        `UPDATE src_parcel_attrs SET zoning_code = 'RH-2|RM-1'
         WHERE mapblklot IN ('3512010', '3512007')`
      ],
      {},
      'synthetic-0'
    );
  });

  it('sd.zoning.split-code counts hostable parcels with a split code', async () => {
    const hostable = s.scenarioCounts['scenario.hostable'];
    expect(hostable).toBe(8);
    expect(await reported(s, 'sd.zoning.split-code')).toEqual({
      fired: 1,
      of: hostable,
      sample: ['3512010']
    });
  });

  it('sd.zoning.generic-nc counts hostable parcels with a generic NC code', async () => {
    expect(await reported(s, 'sd.zoning.generic-nc')).toEqual({
      fired: 1,
      of: 8,
      sample: ['8711023C']
    });
  });

  it('sd.yield.zero-hostable and sd.yield.nonmonotone count and change nothing', async () => {
    // Eligible with an envelope: the 8 hostable parcels and lots 6, 8 and 14, whose yields are 0.
    expect(await reported(s, 'sd.yield.zero-hostable')).toEqual({
      fired: 3,
      of: 11,
      sample: ['3512006', '3512008', '3512014']
    });
    expect(await reported(s, 'sd.yield.nonmonotone')).toEqual({ fired: 0, of: 14, sample: [] });
  });

  it('keeps the unverified-districts warning and drops the ad hoc 10% warning', () => {
    // Split 1 and generic NC 1 of 8 hostable parcels: 12.5%, above the old 10% line.
    expect(s.warnings.some((w) => w.startsWith('scenario: density caps unverified for'))).toBe(
      true
    );
    expect(s.warnings.some((w) => w.includes('exceed 10%'))).toBe(false);
    expect(s.scenarioCounts['scenario.density_cap.rule.unlisted']).toBeTypeOf('number');
    for (const k of SUPERSEDED_SCENARIO_COUNTS) expect(s.scenarioCounts).not.toHaveProperty(k);
  });
});

describe('the cast, attrs, height and no-building rules on a synthetic copy of mini', () => {
  // `cast_flags` is what normalise writes when a TRY_CAST rewrote the raw text (normalise.test.ts
  // covers the raw-text side); here the flags are set on rows whose value is left as it was, so
  // each rule must count and set its bit without changing a value. `c0` is the unedited baseline.
  let s: Synthetic;
  let s0: Synthetic;
  const flag = (id: string, year: number, bits: number) =>
    `UPDATE src_roll SET cast_flags = ${bits} WHERE parcel_number = '${id}'
     AND closed_roll_year = ${year}`;
  beforeAll(async () => {
    s0 = await synthetic('c0', []);
    s = await synthetic('c', [
      flag('3512001', 2025, 1), // sd.roll.roll-year-cast (no bit)
      flag('3512008', 2025, 2), // sd.roll.year-built-cast, bit 0
      flag('3512010', 2025, 4), // sd.roll.stories-cast, bit 1
      flag('3512011', 2025, 8), // sd.roll.units-cast, bit 3
      flag('3512014', 2025, 16), // sd.roll.floor-area-cast, bit 6
      flag('3512006', 2025, 32), // sd.roll.land-value-cast, bit 2
      flag('3512006', 2024, 64), // sd.roll.improvement-value-cast, bit 2
      // sd.attrs.no-blklot: a copy of lot 1's row without a blklot (before the flags below).
      `INSERT INTO src_parcel_attrs SELECT * REPLACE (NULL AS blklot)
       FROM src_parcel_attrs WHERE blklot = '3512001'`,
      `UPDATE src_parcel_attrs SET cast_flags = 1 WHERE blklot = '3512001'`,
      `UPDATE src_parcel_attrs SET cast_flags = 2 WHERE blklot = '3512010'`,
      `UPDATE src_parcel_attrs SET cast_flags = 4 WHERE blklot = '3512011'`,
      `UPDATE src_parcel_attrs SET cast_flags = 8 WHERE blklot = '3512098'`,
      // sd.attrs.active-unknown: one of lot 2's three condo rows (all RH-2).
      `UPDATE src_parcel_attrs SET active = NULL WHERE blklot = '3512102'`,
      // sd.height.blank: a blank copy of the 520 polygon (it sorts first, so hid 1).
      `INSERT INTO src_height_bulk SELECT * REPLACE ('   ' AS height)
       FROM src_height_bulk WHERE gen_hght = '520'`,
      // sd.features.no-building: lot 5 (no building height) loses its roll stories; lot 7 keeps
      // its source 0, which is the source's own value and does not fire.
      `UPDATE src_roll SET number_of_stories = NULL WHERE parcel_number = '3512005'`
    ]);
  });

  /** Every feature value of a parcel-year except the mask. */
  const values = async (x: Synthetic, id: string, year: number) => {
    const { imputed: _, ...rest } = await feature(x, id, year);
    return rest;
  };

  // [id, lot, roll year, bit, of, baseline of]: `of` is the roll rows with a value in the field
  // (mini: 27 with a year; lot 5's two rows lose their stories below).
  it.each([
    ['sd.roll.roll-year-cast', '3512001', 2025, 0, 29, 29],
    ['sd.roll.year-built-cast', '3512008', 2025, BIT.year, 27, 27],
    ['sd.roll.stories-cast', '3512010', 2025, BIT.stories, 27, 29],
    ['sd.roll.units-cast', '3512011', 2025, BIT.units, 29, 29],
    ['sd.roll.floor-area-cast', '3512014', 2025, BIT.floor, 29, 29],
    ['sd.roll.land-value-cast', '3512006', 2025, BIT.share, 29, 29],
    ['sd.roll.improvement-value-cast', '3512006', 2024, BIT.share, 29, 29]
  ])(
    '%s counts the flagged row and sets its bit; no value changes',
    async (id, lot, y, bit, of, of0) => {
      expect(await tally(s, id)).toEqual({ fired: 1, of, sample: [`${lot}:${y}`] });
      expect(await tally(s0, id)).toEqual({ fired: 0, of: of0, sample: [] });
      expect(await values(s, lot, y)).toEqual(await values(s0, lot, y));
      const was = (await feature(s0, lot, y)).imputed;
      expect((await feature(s, lot, y)).imputed).toBe(was | bit);
    }
  );

  // [id, blklot, of]: every parcel row has a centroid (19, plus the no-blklot copy); mini leaves
  // date_rec_add empty (only the flagged row counts) and dates its two retired rows.
  it.each([
    ['sd.attrs.latitude-cast', '3512001', 20],
    ['sd.attrs.longitude-cast', '3512010', 20],
    ['sd.attrs.added-date-cast', '3512011', 1],
    ['sd.attrs.dropped-date-cast', '3512098', 2]
  ])('%s counts the flagged parcel row', async (id, blklot, of) => {
    expect(await tally(s, id)).toEqual({ fired: 1, of, sample: [blklot] });
  });

  it('sd.attrs.active-unknown reads NULL as retired, counted; zoning and lineage unchanged', async () => {
    expect(await tally(s, 'sd.attrs.active-unknown')).toEqual({
      fired: 1,
      of: 20,
      sample: ['3512102']
    });
    expect(await tally(s0, 'sd.attrs.active-unknown')).toEqual({ fired: 0, of: 19, sample: [] });
    expect(await values(s, '3512002', 2025)).toEqual(await values(s0, '3512002', 2025));
  });

  it('sd.attrs.no-blklot drops a parcel row without a blklot, counted', async () => {
    expect(await tally(s, 'sd.attrs.no-blklot')).toEqual({
      fired: 1,
      of: 20,
      sample: ['3512001']
    });
    expect(await values(s, '3512001', 2025)).toEqual(await values(s0, '3512001', 2025));
  });

  it('sd.height.blank drops a height polygon with a blank string, counted', async () => {
    expect(await tally(s, 'sd.height.blank')).toEqual({ fired: 1, of: 7, sample: ['1'] });
    expect(await tally(s0, 'sd.height.blank')).toEqual({ fired: 0, of: 6, sample: [] });
    const district = (x: Synthetic) => db.all(`SELECT * FROM ${x.schema}.sc_district ORDER BY id`);
    expect(await district(s)).toEqual(await district(s0));
  });

  it('sd.features.no-building counts missing stories without a height (0, no bit), not a 0', async () => {
    expect(await tally(s, 'sd.features.no-building')).toEqual({
      fired: 2,
      of: 25,
      sample: ['3512005:2024', '3512005:2025']
    });
    expect(await tally(s0, 'sd.features.no-building')).toEqual({ fired: 0, of: 25, sample: [] });
    for (const y of [2024, 2025]) {
      const f = await feature(s, '3512005', y);
      expect(f.existing_stories).toBe(0);
      expect(f.imputed & BIT.stories).toBe(0);
      expect((await feature(s, '3512007', y)).existing_stories).toBe(0);
    }
  });
});

describe('the vacant-lot definition rules on a synthetic copy of mini', () => {
  // Lot 10 becomes vacant in 2025 (a V property class) while its row keeps a year built and
  // assessed values, so both fields are overwritten with 0. Lot 11 becomes vacant in 2025 with no
  // assessed values (share NULL) and no year: nothing is overwritten. `v0` is the baseline.
  let s: Synthetic;
  let s0: Synthetic;
  beforeAll(async () => {
    s0 = await synthetic('v0', []);
    s = await synthetic('v', [
      setRow('3512010', [2025], `property_class_code = 'V'`),
      setRow(
        '3512011',
        [2025],
        `property_class_code = 'V', year_property_built = NULL, assessed_land_value = 0,
         assessed_improvement_value = 0`
      )
    ]);
  });

  it('counts vacant parcel-years whose source year or share is overwritten with 0', async () => {
    const [src] = await db.all<{ y: number | null; land: number; impr: number }>(
      `SELECT year_property_built y, assessed_land_value land, assessed_improvement_value impr
       FROM v.src_roll WHERE parcel_number = '3512010' AND closed_roll_year = 2025`
    );
    expect(src.y).not.toBeNull();
    expect(src.impr).toBeGreaterThan(0);
    expect(await tally(s, 'sd.features.vacant-year-built')).toEqual({
      fired: 1,
      of: 26,
      sample: ['3512010:2025']
    });
    expect(await tally(s, 'sd.features.vacant-share')).toEqual({
      fired: 1,
      of: 26,
      sample: ['3512010:2025']
    });
    for (const id of ['sd.features.vacant-year-built', 'sd.features.vacant-share'])
      expect(await tally(s0, id)).toEqual({ fired: 0, of: 26, sample: [] });
  });

  it('changes no value: vacant is 0 and 0, with no bit, as before the rules', async () => {
    for (const lot of ['3512010', '3512011']) {
      const f = await feature(s, lot, 2025);
      const [{ share }] = await db.all<{ share: number }>(
        `SELECT improvement_share AS "share" FROM v.sc_features
         WHERE mapblklot = '${lot}' AND roll_year = 2025`
      );
      expect(f.year_built).toBe(0);
      expect(share).toBe(0);
      expect(f.imputed & (BIT.year | BIT.share)).toBe(0);
    }
    // The rules' fields aside, the vacant parcel-year keeps the baseline's values.
    const pick = ({
      existing_units,
      existing_stories,
      existing_floor_area_m2,
      base_density_cap
    }: Feature) => ({ existing_units, existing_stories, existing_floor_area_m2, base_density_cap });
    expect(pick(await feature(s, '3512010', 2025))).toEqual(
      pick(await feature(s0, '3512010', 2025))
    );
  });
});

describe('sd.zoning.missing on a synthetic copy of mini', () => {
  let s: Synthetic;
  beforeAll(async () => {
    // No zoning code on lot 10 (hostable) and lot 7 (ineligible, so not hostable).
    s = await synthetic('zm', [
      `UPDATE src_parcel_attrs SET zoning_code = NULL WHERE mapblklot IN ('3512010', '3512007')`
    ]);
  });

  it('counts hostable parcels with no zoning code (no density cap); changes nothing else', async () => {
    const hostable = s.scenarioCounts['scenario.hostable'];
    expect(hostable).toBe(8);
    expect(await reported(s, 'sd.zoning.missing')).toEqual({
      fired: 1,
      of: hostable,
      sample: ['3512010']
    });
    expect((await feature(s, '3512010', 2025)).base_density_cap).toBeNull();
  });
});

describe('sd.roll.year-gap on a synthetic copy of mini', () => {
  let s: Synthetic;
  beforeAll(async () => {
    const row = (id: string, year: number, built: string, units: number, stories = 1) =>
      `INSERT INTO src_roll (closed_roll_year, parcel_number, use_code, property_class_code,
         year_property_built, number_of_stories, number_of_units, property_area,
         assessed_land_value, assessed_improvement_value, status_code)
       VALUES (${year}, '${id}', 'MRES', 'A', ${built}, ${stories}, ${units}, 1000, 100000,
         100000, 'NA')`;
    s = await synthetic('g', [
      // Lot 9 (no mini rows): observed 2007, 2009, 2012. Its 2009 row fails capacity (1 story,
      // 300 m², capacity 30), so it is replaced (bit 3) by 2007's 2 units.
      row('3512009', 2007, 'NULL', 2),
      row('3512009', 2009, '1900', 5000),
      row('3512009', 2012, '1900', 3),
      // Lot 13: observed 2008, 2010, 2011 and 2020 only.
      `DELETE FROM src_roll WHERE parcel_number = '3512013'`,
      row('3512013', 2008, '1990', 5),
      row('3512013', 2010, '1990', 5),
      row('3512013', 2011, '1990', 5),
      row('3512013', 2020, '1990', 5)
    ]);
  });

  it('carries interior gaps from the latest observed year before, with bit 5 and own lien_day', async () => {
    const lot9 = await features(s, '3512009');
    expect(
      lot9.map((r) => [
        r.roll_year,
        r.existing_units,
        r.imputed & (BIT.carried | BIT.units),
        r.lien_day
      ])
    ).toEqual([
      [2007, 2, 0, Date.UTC(2007, 0, 1) / 86400000],
      [2008, 2, BIT.carried, Date.UTC(2008, 0, 1) / 86400000],
      [2009, 2, BIT.units, Date.UTC(2009, 0, 1) / 86400000],
      [2010, 2, BIT.carried | BIT.units, Date.UTC(2010, 0, 1) / 86400000],
      [2011, 2, BIT.carried | BIT.units, Date.UTC(2011, 0, 1) / 86400000],
      [2012, 3, 0, Date.UTC(2012, 0, 1) / 86400000]
    ]);
  });

  it('a parcel whose rows stop in 2020 gets no later rows; 2013–2019 are not lock years', async () => {
    const lot13 = await features(s, '3512013');
    expect(lot13.map((r) => [r.roll_year, r.imputed & BIT.carried])).toEqual([
      [2008, 0],
      [2009, BIT.carried],
      [2010, 0],
      [2011, 0],
      [2012, BIT.carried],
      [2020, 0]
    ]);
  });

  it('carried rows are imputed with their own year medians but never feed them', async () => {
    // 2010: observed lot 13 (1990) and carried lot 9 (1900). With the carried row the
    // lower median would be 1900.
    expect(await median(s, 2010, RESIDENTIAL)).toBe(1990);
    expect(await median(s, 2011, RESIDENTIAL)).toBe(1990);
    // Lot 9's 2008 row carries 2007's missing year, imputed with 2008's median (lot 13: 1990).
    const f = await feature(s, '3512009', 2008);
    expect(f.year_built).toBe(1990);
    expect(f.imputed & (BIT.year | BIT.carried)).toBe(BIT.year | BIT.carried);
  });

  it('reports the carried parcel-years against all panel parcel-years', async () => {
    // Panel: mini's 25 observed parcel-years less lot 13's 2024 row, the 7 new rows, 6 carried
    // (the 5 above and mini's own lot 3 2024, spec §4.11).
    expect(await tally(s, 'sd.roll.year-gap')).toEqual({
      fired: 6,
      of: 37,
      sample: [
        '3512009:2008',
        '3512009:2010',
        '3512009:2011',
        '3512013:2009',
        '3512013:2012',
        '8711023C:2024'
      ]
    });
    const [{ n }] = await db.all<{ n: number }>(
      `SELECT count(*)::INTEGER n FROM g.scenario_panel WHERE (imputed & ${BIT.carried}) <> 0`
    );
    expect(n).toBe(6);
    expect(s.scenarioCounts['scenario.panel.feature_mismatch']).toBe(0);
  });
});

describe('the base cap date on a synthetic 2027 roll row', () => {
  let s: Synthetic;
  beforeAll(async () => {
    // Lot 4 is NC-1 inside R-4 (`40//65-R-4`): capped before the FZP, uncapped after it.
    s = await synthetic('b', [copyRow('0026T001A', 2025, { year: 2027 })]);
  });

  it('a 2027 row gets the 2026-01-11 cap, not null, and V18 holds on the latest year', async () => {
    const pre = densityCap('NC-1', 300, true, FZP_EFFECTIVE_DAY - 1);
    expect(pre).toBe(4);
    expect(densityCap('NC-1', 300, true, Date.UTC(2027, 0, 1) / 86400000)).toBeNull();
    const rows = await db.all<{ roll_year: number; base_density_cap: number | null }>(
      `SELECT roll_year, base_density_cap FROM b.scenario_panel WHERE mapblklot = '0026T001A'
       ORDER BY roll_year`
    );
    expect(rows).toEqual([
      { roll_year: 2023, base_density_cap: pre },
      { roll_year: 2024, base_density_cap: pre },
      { roll_year: 2025, base_density_cap: pre },
      { roll_year: 2027, base_density_cap: pre }
    ]);
    const p = readParcelsBin(join(s.outDir, PARCELS_BIN));
    expect(p.rollYear).toBe(2027);
    expect(s.scenarioCounts['scenario.panel.feature_mismatch']).toBe(0);
  });
});
