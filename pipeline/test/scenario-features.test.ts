// The single-definition rule (scenario-data spec §6): the T13 panel's latest-year rows and the
// shipped T11 payload carry the same feature values and imputation mask, parcel by parcel.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  FILL_LEVELS,
  decodeScenarioPayload,
  featureValue,
  type ScenarioParcels
} from '../../src/lib/data/scenario-codec';
import { parseManifest } from '../../src/lib/data/manifest';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { FIXTURE_PROFILE } from '../config';
import { openDuck, type Duck } from '../lib/duck';
import { readLock } from '../lib/lock';
import { createQualityTables } from '../lib/quality';
import { Report } from '../lib/report';
import { runSql } from '../lib/sql';
import { asOfFromLock } from '../project-records/parse';
import { build } from '../steps/build';
import { readParcelRecords } from '../steps/chunks';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../steps/scenario';
import { MINI, miniDuck } from './helpers';

/** Spec §4.6 and the T13 row: exactly the contract columns, in this order. */
const PANEL_COLUMNS = [
  'mapblklot',
  'roll_year',
  'lien_day',
  'existing_units',
  'existing_stories',
  'year_built',
  'land_value',
  'improvement_value',
  'use_code',
  'land_use_class',
  'zoning_code',
  'base_stories',
  'base_density_cap',
  'base_yield',
  'lot_area_m2',
  'improvement_share',
  'rent_control_likely',
  'imputed',
  'potential_ratio_base',
  'stories_gap_base',
  'hostable_base'
];

interface PanelRow {
  mapblklot: string;
  roll_year: number;
  existing_units: number;
  existing_stories: number;
  year_built: number;
  land_use_class: number;
  base_stories: number;
  base_density_cap: number | null;
  base_yield: number;
  lot_area_m2: number;
  improvement_share: number;
  rent_control_likely: boolean;
  imputed: number;
  potential_ratio_base: number;
  stories_gap_base: number;
  hostable_base: boolean;
}

const F = FILL_LEVELS.length;
let derived: string;
let outDir: string;
let p: ScenarioParcels;
let db: Duck;
let counts: Record<string, number>;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'sfh-scenario-features-'));
  derived = join(root, 'derived', 'fixture-0');
  ({ outDir } = await build({
    lockPath: join(MINI, 'sources.lock.json'),
    rawDir: join(MINI, 'raw'),
    rawByName: true,
    outRoot: root,
    datasetVersion: 'fixture-0',
    builtAt: '2026-10-10T00:00:00.000Z',
    profile: FIXTURE_PROFILE,
    skipTiles: true,
    derivedRoot: join(root, 'derived')
  }));
  p = decodeScenarioPayload(
    new Uint8Array(inflateRawSync(readFileSync(join(outDir, 'scenarios/fzp/parcels.bin'))))
  );
  counts = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')).counts;
  db = await openDuck();
});

const panel = () =>
  db.all<PanelRow>(
    `SELECT * FROM read_parquet('${join(derived, 'parcel-panel.parquet')}')
     ORDER BY mapblklot, roll_year`
  );

describe('scenario T13 panel and T11 features (mini fixture)', () => {
  it("every parcel's 2025 panel row equals its T11 features and mask", async () => {
    const rows = (await panel()).filter((r) => r.roll_year === 2025);
    // Lots 9, 12 and 13 have no 2025 roll row (mini README), so 14 of the 17 parcels.
    expect(rows).toHaveLength(14);
    expect(p.rollYear).toBe(2025);
    for (const r of rows) {
      const i = p.index.get(r.mapblklot);
      expect(i, r.mapblklot).toBeDefined();
      const k = i as number;
      expect(
        {
          existing_units: r.existing_units,
          existing_stories: r.existing_stories,
          lot_area_m2: r.lot_area_m2,
          year_built: r.year_built,
          improvement_share: r.improvement_share,
          rent_control_likely: r.rent_control_likely ? 1 : 0,
          land_use_class: r.land_use_class,
          imputed: r.imputed,
          potential_ratio_base: r.potential_ratio_base,
          stories_gap_base: r.stories_gap_base,
          base_stories: r.base_stories,
          base_density_cap: r.base_density_cap ?? 0xffff,
          base_yield: r.base_yield,
          hostable_base: r.hostable_base ? 1 : 0
        },
        r.mapblklot
      ).toEqual({
        existing_units: featureValue(p, k, 'existingUnits', 'base'),
        existing_stories: p.existingStories[k],
        lot_area_m2: featureValue(p, k, 'lotAreaM2', 'base'),
        year_built: featureValue(p, k, 'yearBuilt', 'base'),
        improvement_share: featureValue(p, k, 'improvementShare', 'base'),
        rent_control_likely: featureValue(p, k, 'rentControlLikely', 'base'),
        land_use_class: featureValue(p, k, 'landUseClass', 'base'),
        imputed: p.imputed[k],
        potential_ratio_base: featureValue(p, k, 'potentialRatio', 'base'),
        stories_gap_base: featureValue(p, k, 'storiesGap', 'base'),
        base_stories: p.baseStories[k],
        base_density_cap: p.baseCap[k],
        base_yield: p.baseYield[k * F + F - 1],
        hostable_base: p.hostableBase[k]
      });
    }
    expect(counts['scenario.panel.feature_mismatch']).toBe(0);
    // Underwater lot 16 has a 2025 row but is not eligible.
    expect(counts['scenario.roll.latest_eligible_matched']).toBe(12);
  });

  it('hostable_base changes by at most 5% between consecutive roll years (no exemptions)', async () => {
    // Partner ruling (option c): the density cap no longer gates the at-risk set, so a cap change
    // such as the 2022-11-27 fourplex ordinance cannot flip it. Trivially true on mini (all its
    // roll years follow the ordinance), still asserted; V18 asserts it on every build. Compared
    // over the parcels with a row in both years: mini's panel grows from 2 rows (2023) to 16
    // (2024) and 14 (2025), which is coverage, not flips. Vacant lots 15 and 17 are hostable in
    // 2024 and 2025; underwater lot 16 never is.
    const rows = await panel();
    const years = [...new Set(rows.map((r) => r.roll_year))].sort();
    expect(years.map((y) => counts[`scenario.panel.hostable_base.${y}`])).toEqual(
      years.map((y) => rows.filter((r) => r.roll_year === y && r.hostable_base).length)
    );
    expect(years.map((y) => counts[`scenario.panel.hostable_base.${y}`])).toEqual([2, 10, 9]);
    const at = new Map(rows.map((r) => [`${r.mapblklot}:${r.roll_year}`, r.hostable_base]));
    for (const y of years.slice(1)) {
      const both = rows.filter((r) => r.roll_year === y && at.has(`${r.mapblklot}:${y - 1}`));
      const cur = both.filter((r) => r.hostable_base).length;
      const prev = both.filter((r) => at.get(`${r.mapblklot}:${y - 1}`)).length;
      expect({ cur, prev }, String(y)).toEqual({
        cur: counts[`scenario.panel.hostable_base.${y}.both`],
        prev: counts[`scenario.panel.hostable_base.${y}.both_prev`]
      });
      expect(Math.abs(cur - prev), `${y - 1} → ${y}`).toBeLessThanOrEqual(0.05 * prev);
    }
  });

  it('the panel has roll years 2023 to 2025 and every T13 column', async () => {
    const rows = await panel();
    expect([...new Set(rows.map((r) => r.roll_year))]).toEqual([2023, 2024, 2025]);
    expect(counts['scenario.panel.years']).toBe(3);
    const cols = await db.all<{ column_name: string; column_type: string }>(
      `DESCRIBE SELECT * FROM read_parquet('${join(derived, 'parcel-panel.parquet')}')`
    );
    expect(cols.map((c) => c.column_name)).toEqual(PANEL_COLUMNS);
    const type = Object.fromEntries(cols.map((c) => [c.column_name, c.column_type]));
    expect(type.land_use_class).toBe('INTEGER');
    expect(type.potential_ratio_base).toBe('FLOAT');
    // Sorted by (mapblklot, roll_year) as written.
    const raw = await db.all<{ mapblklot: string; roll_year: number }>(
      `SELECT mapblklot, roll_year FROM read_parquet('${join(derived, 'parcel-panel.parquet')}')`
    );
    expect(raw).toEqual(rows.map((r) => ({ mapblklot: r.mapblklot, roll_year: r.roll_year })));
    // Lot 12's 2024 row carries the retired 3512099's 7 units via lineage (spec §4.11).
    expect(rows.find((r) => r.mapblklot === '3512012')).toMatchObject({
      roll_year: 2024,
      existing_units: 7
    });
  });

  it("every parcel's T11 floor area and mask equal its latest-year sc_features row", async () => {
    // sc_features holds existing_floor_area_m2 (not a T13 contract column), so this runs the
    // scenario step on its own database and reads the table directly (IA-8, V18).
    const sdb = await miniDuck();
    await createQualityTables(sdb);
    await runSql(sdb);
    const root = mkdtempSync(join(tmpdir(), 'sfh-scenario-features-sql-'));
    await writeScenario({
      db: sdb,
      outDir: join(root, 'out'),
      derivedDir: join(root, 'derived'),
      datasetVersion: 'fixture-0',
      records: await readParcelRecords(sdb),
      capDay: asOfFromLock(readLock(join(MINI, 'sources.lock.json'))),
      report: new Report(),
      buildCounts: {}
    });
    const t11 = readParcelsBin(join(root, 'out', PARCELS_BIN));
    const rows = await sdb.all<{
      mapblklot: string;
      existing_floor_area_m2: number;
      imputed: number;
    }>(
      `SELECT mapblklot, existing_floor_area_m2, imputed FROM sc_features
       WHERE roll_year = (SELECT max(roll_year) FROM sc_features) ORDER BY mapblklot`
    );
    expect(rows).toHaveLength(14);
    for (const r of rows) {
      const i = t11.index.get(r.mapblklot);
      expect(i, r.mapblklot).toBeDefined();
      expect({ floor: t11.existingFloorAreaM2[i!], imputed: t11.imputed[i!] }, r.mapblklot).toEqual(
        { floor: r.existing_floor_area_m2, imputed: r.imputed }
      );
    }
  });

  it('no-row parcels (lots 9, 12, 13) get imputed 95 and the rounded chunk floor area', async () => {
    // Spec §4.5 step 5, AC 16: sd.roll.no-row sets bits 0–4 and sd.roll.floor-area-missing bit 6.
    const m = parseManifest(JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')));
    const recs = new Map(
      m.chunks
        .flatMap((c) =>
          decodeParcelChunk(
            readFileSync(join(outDir, c.url.replace('/data/fixture-0/', '')), 'utf8')
          )
        )
        .map((r) => [r.id, r])
    );
    const latest = new Set(
      (await panel()).filter((r) => r.roll_year === 2025).map((r) => r.mapblklot)
    );
    const noRow = p.id.filter((id) => !latest.has(id));
    expect(noRow).toEqual(['3512009', '3512012', '3512013']);
    for (const id of noRow) {
      const i = p.index.get(id)!;
      expect({ imputed: p.imputed[i], floor: p.existingFloorAreaM2[i] }, id).toEqual({
        imputed: 95,
        floor: Math.round(recs.get(id)!.existingFloorAreaM2)
      });
    }
    expect(counts['scenario.imputed.no_roll']).toBe(3);
  });

  it('parcel-lineage.parquet has the retired rows', async () => {
    const rows = await db.all<{
      blklot: string;
      retired_mapblklot: string;
      current_mapblklot: string | null;
      d: string;
    }>(
      `SELECT blklot, retired_mapblklot, current_mapblklot, strftime(date_rec_drop, '%Y-%m-%d') d
       FROM read_parquet('${join(derived, 'parcel-lineage.parquet')}') ORDER BY blklot`
    );
    expect(rows).toEqual([
      {
        blklot: '3512096',
        retired_mapblklot: '3512096',
        current_mapblklot: '3512015',
        d: '2024-06-30'
      },
      {
        blklot: '3512098',
        retired_mapblklot: '3512098',
        current_mapblklot: '3512001',
        d: '2019-03-01'
      },
      {
        blklot: '3512099',
        retired_mapblklot: '3512099',
        current_mapblklot: '3512012',
        d: '2024-06-30'
      }
    ]);
  });
});
