import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeParcelChunk } from '../../src/lib/data/parcel-chunk';
import { parseManifest } from '../../src/lib/data/manifest';
import { FILL_LEVELS, type ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { PATHWAYS, STAGE_ORDER } from '../../src/lib/timelapse/types';
import { GOLDEN_DERIVED, fixture } from '../steps/fixture';
import { HISTORIES_JSON, PERMITS_PARQUET, PROJECTS_JSON, dumpPermits } from '../steps/projects';
import { PARCELS_BIN, SCENARIO_DUMP, formatScenarioDump, readParcelsBin } from '../steps/scenario';
import { which } from '../lib/exec';
import { QUALITY_RULES } from '../lib/quality';
import { openDuck } from '../lib/duck';
import { MINI_PARCELS, miniProjectInput } from './fixtures/mini/projects-raw';
import { MINI, SUPERSEDED_SCENARIO_COUNTS } from './helpers';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const skipTiles = !(await which('tippecanoe'));
const files = (d: string) =>
  readdirSync(d, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(d.length + 1))
    .sort();
const golden = join(MINI, 'golden');
// parcels.bin is compared through its decoded dump: deflate bytes may differ across zlib builds
// (scenario-data spec §4.8).
const COMPARED = (f: string) =>
  f.startsWith('parcels/') ||
  f === 'neighborhoods.geojson' ||
  f === 'transit.json' ||
  f === 'manifest.json' ||
  f === 'report.json' ||
  f === PROJECTS_JSON;
const stripBuiltAt = (s: string) => s.replace(/"builtAt":"[^"]*"/, '"builtAt":""');
const decodeBin = (dir: string) => readParcelsBin(join(dir, PARCELS_BIN));
const dumpOf = (dir: string) => formatScenarioDump(decodeBin(dir));

describe('pipeline fixture', () => {
  const a = mkdtempSync(join(tmpdir(), 'sfh-fx-a-'));
  const b = mkdtempSync(join(tmpdir(), 'sfh-fx-b-'));
  const da = mkdtempSync(join(tmpdir(), 'sfh-fx-da-'));
  const db = mkdtempSync(join(tmpdir(), 'sfh-fx-db-'));
  let built: [number, number];
  beforeAll(async () => {
    built = [
      await fixture({ outDir: a, skipTiles, derivedRoot: da }),
      await fixture({ outDir: b, skipTiles, derivedRoot: db })
    ];
  });

  it('matches the golden byte for byte and is identical across two builds (V12)', async () => {
    expect(built).toEqual([0, 0]);
    const fa = files(a).filter(COMPARED);
    expect(fa).toEqual(files(golden).filter(COMPARED));
    for (const f of fa) {
      const ga = stripBuiltAt(readFileSync(join(a, f), 'utf8'));
      expect(ga, f).toBe(stripBuiltAt(readFileSync(join(golden, f), 'utf8')));
      expect(ga, f).toBe(stripBuiltAt(readFileSync(join(b, f), 'utf8')));
    }
    // T11: the decoded payload, not the deflate bytes.
    const dump = dumpOf(a);
    expect(dump).toBe(readFileSync(join(golden, SCENARIO_DUMP), 'utf8'));
    expect(dump).toBe(dumpOf(b));
    // Project-records spec §4.9: the histories byte for byte, permits.parquet by row values.
    const histories = (root: string) =>
      readFileSync(join(root, 'fixture-0', HISTORIES_JSON), 'utf8');
    expect(histories(da)).toBe(
      readFileSync(join(golden, 'derived', GOLDEN_DERIVED.histories), 'utf8')
    );
    expect(histories(da)).toBe(histories(db));
    const permits = async (root: string) =>
      JSON.parse(await dumpPermits(join(root, 'fixture-0', PERMITS_PARQUET))) as Record<
        string,
        unknown
      >[];
    const pa = await permits(da);
    expect(pa).toEqual(
      JSON.parse(readFileSync(join(golden, 'derived', GOLDEN_DERIVED.permits), 'utf8'))
    );
    expect(pa).toEqual(await permits(db));
    expect(pa.find((r) => r.permit_number === '201501150014')).toMatchObject({
      prx_case_no: '2010.0002PRX',
      project_id: 'PRJ:2010.0002'
    });
    const m = parseManifest(JSON.parse(readFileSync(join(a, 'manifest.json'), 'utf8')));
    const ids = m.chunks.flatMap((c) =>
      decodeParcelChunk(readFileSync(join(a, c.url.replace('/data/fixture-0/', '')), 'utf8')).map(
        (r) => r.id
      )
    );
    // Spec §4.12: the report states the ODbL offer for the derived artifacts.
    expect(JSON.parse(readFileSync(join(a, 'report.json'), 'utf8')).license).toEqual({
      artifacts: ['basemap.pmtiles', 'buildings.pmtiles', 'parcels/*'],
      derivedData: 'ODbL-1.0',
      notice:
        'Derived data files under /data/ that incorporate OpenStreetMap or Overture data are made available under the ODbL 1.0.'
    });
    expect(ids).toContain('0026T001A');
    expect(ids).toContain('8711023C');
    // besri's piece is a dropped sliver but the building is kept, so Esri contributes too.
    expect(m.sources.map((s) => s.id)).toEqual(
      expect.arrayContaining([
        'overture:OpenStreetMap',
        'overture:USGS Lidar',
        'overture:Microsoft ML Buildings',
        'overture:Esri Community Maps'
      ])
    );
  });

  it('the panel holds roll years 2023–2025 and the RA1 rows of lots 3 and 4 (spec §4.11)', async () => {
    expect(built).toEqual([0, 0]);
    const duck = await openDuck();
    try {
      const file = join(da, 'fixture-0', 'parcel-panel.parquet');
      const rows = await duck.all<{ id: string; y: number; u: number; m: number }>(
        `SELECT mapblklot AS id, roll_year AS y, existing_units AS u, imputed AS m
         FROM read_parquet('${file}') ORDER BY 1, 2`
      );
      expect([...new Set(rows.map((r) => r.y))].sort()).toEqual([2023, 2024, 2025]);
      const of = (id: string) => rows.filter((r) => r.id === id).map((r) => [r.y, r.u, r.m & 40]);
      // Lot 3: 5,000 in 2023 and 2025 on 300 m² × 3 stories (capacity 90); no year passes, LUDB 4
      // does (bit 3). 2024 is carried from 2023 (bits 3 and 5).
      expect(of('8711023C')).toEqual([
        [2023, 4, 8],
        [2024, 4, 40],
        [2025, 4, 8]
      ]);
      // Lot 4: 3, 900, 3; 2024 takes 2023's 3 (the tie goes to the earlier year), bit 3 only.
      expect(of('0026T001A')).toEqual([
        [2023, 3, 0],
        [2024, 3, 8],
        [2025, 3, 0]
      ]);
      // Roll year 2023 has rows for lots 3 and 4 only.
      expect(rows.filter((r) => r.y === 2023).map((r) => r.id)).toEqual(['0026T001A', '8711023C']);
      // project-records' stub roll (projects-raw.ts) mirrors the built panel ("PR goldens follow
      // SD"): the same units on every parcel-year, and null where the panel has no row.
      const stub = miniProjectInput();
      const panelUnits = new Map(rows.map((r) => [`${r.id}|${r.y}`, r.u]));
      for (const id of MINI_PARCELS) {
        for (const y of [2023, 2024, 2025]) {
          expect(stub.assessorUnits(id, y), `${id} ${y}`).toBe(
            panelUnits.get(`${id}|${y}`) ?? null
          );
        }
      }
    } finally {
      duck.close();
    }
  });

  it('e2e/fixtures/data/fixture-0 is the committed output of `pipeline fixture`', () => {
    const e2e = 'e2e/fixtures/data/fixture-0';
    for (const f of files(golden).filter(COMPARED)) {
      expect(readFileSync(join(e2e, f), 'utf8'), f).toBe(readFileSync(join(golden, f), 'utf8'));
    }
    expect(dumpOf(e2e)).toBe(readFileSync(join(golden, SCENARIO_DUMP), 'utf8'));
  });
});

describe('fixture-0 scenario known answers (spec §4.11, with rulings)', () => {
  const e2e = 'e2e/fixtures/data/fixture-0';
  let p: ScenarioParcels;
  let counts: Record<string, number>;
  beforeAll(() => {
    p = decodeBin(e2e);
    counts = JSON.parse(readFileSync(join(e2e, 'report.json'), 'utf8')).counts;
  });
  const F = FILL_LEVELS.length;
  const NULL_CAP = 0xffff;
  const row = (id: string) => {
    const i = p.index.get(id);
    if (i === undefined) throw new Error(`no row ${id}`);
    return {
      district: p.districts[p.district[i]],
      localProgram: p.localProgram[i],
      hostable: p.hostable[i],
      split: p.split[i],
      imputed: p.imputed[i],
      baseStories: p.baseStories[i],
      envelopeStories: p.envelopeStories[i],
      baseCap: p.baseCap[i],
      existingUnits: p.existingUnits[i],
      rentControlLikely: p.rentControlLikely[i],
      baseYield: [...p.baseYield.subarray(i * F, i * F + F)],
      yield: [...p.yield.subarray(i * F, i * F + F)]
    };
  };
  // Mini lot ids (make-fixture.ts LOT_IDS): 35120NN, except lots 3 and 4.
  const lotId = (n: number) =>
    n === 3 ? '8711023C' : n === 4 ? '0026T001A' : `35120${String(n).padStart(2, '0')}`;
  const L = (n: number) => row(lotId(n));

  it('holds every parcel, 14 rows', () => {
    expect(p.count).toBe(14);
    expect(counts['scenario.parcels']).toBe(14);
  });

  it('lot 1: Local Program, base 4, envelope 6, rent control likely, capped base yield', () => {
    const r = L(1);
    expect(r).toMatchObject({
      localProgram: 1,
      baseStories: 4,
      envelopeStories: 6,
      rentControlLikely: 1,
      baseCap: 4
    });
    expect(r.baseYield).not.toEqual(r.yield);
    for (const y of r.baseYield) expect(y).toBeLessThanOrEqual(4);
  });

  it('lot 2: three condo units, Local Program', () => {
    expect(L(2)).toMatchObject({ existingUnits: 3, localProgram: 1 });
  });

  it('lot 3: hotel, not Local Program, envelope = base 4, no cap', () => {
    expect(L(3)).toMatchObject({
      localProgram: 0,
      baseStories: 4,
      envelopeStories: 4,
      baseCap: NULL_CAP
    });
    expect(counts['scenario.excluded.hotel']).toBe(1);
  });

  it('lot 3 (RA1): 5,000 roll units in every year become the LUDB 4, bit 3 in T11', () => {
    // 4 non-condo units built 1920: rent control likely too (spec §4.4).
    expect(L(3)).toMatchObject({ existingUnits: 4, imputed: 8, rentControlLikely: 1 });
    expect(counts['quality.sd.roll.units-capacity.fired']).toBe(3);
    expect(counts['quality.sd.roll.year-gap.fired']).toBe(1);
  });

  it('lot 4 (RA1): T11 keeps the 2025 value 3; the spike rule never sees the 900', () => {
    expect(L(4)).toMatchObject({ existingUnits: 3, imputed: 0 });
    expect(counts['quality.sd.roll.units-spike.fired']).toBe(0);
  });

  it('lot 4: rent-control excluded, envelope 4, pre-FZP NC-1 cap 4, FZP cap none (C2)', () => {
    const r = L(4);
    expect(r).toMatchObject({ localProgram: 0, envelopeStories: 4, baseStories: 4, baseCap: 4 });
    for (const y of r.baseYield) expect(y).toBeLessThanOrEqual(4);
    // FZP yield is uncapped: it differs from the base yield where the generator exceeds 4 units.
    expect(r.yield.some((y) => y > 4)).toBe(true);
    expect(r.yield.map((y) => Math.min(y, 4))).toEqual(r.baseYield);
    // Lots 4 and 3: lot 3 is a hotel AND, after sd.roll.units-capacity, has 4 non-condo units
    // built 1920, so it meets both exclusions, which are counted separately (spec §4.10;
    // controller ruling, F1 Task 5: the §4.11 "all" row's 1 predates RA1).
    expect(counts['scenario.excluded.rent_control']).toBe(2);
    expect(counts['scenario.density_cap.fzp_differs']).toBe(1);
    expect(counts['scenario.yield.nonlp_base_mismatch']).toBe(0);
  });

  it('lot 5: 65-X by largest overlap, not Local Program, cap 4, base yield = yield', () => {
    const r = L(5);
    expect(r).toMatchObject({ district: '65-X', localProgram: 0, baseCap: 4, split: 1 });
    expect(r.baseYield).toEqual(r.yield);
  });

  it('lot 6: cap 3 (260 m² with the courtyard hole = 2,798 sf, / 800)', () => {
    expect(L(6).baseCap).toBe(3);
  });

  it('lots 7 and 9 are not hostable (ineligible)', () => {
    expect(L(7).hostable).toBe(0);
    expect(L(9).hostable).toBe(0);
  });

  it('lot 10: 65-X, split', () => {
    expect(L(10)).toMatchObject({ district: '65-X', split: 1 });
  });

  it('lot 11: 0 units from the roll, government parcel counted, envelope 12', () => {
    expect(L(11)).toMatchObject({ existingUnits: 0, envelopeStories: 12, localProgram: 1 });
    expect(counts['scenario.roll.gov_zero_units']).toBe(1);
    expect(counts['scenario.roll.gov_zero_units_ludb_units']).toBe(3);
  });

  it('lot 12: Special Height District, envelope 0, not hostable', () => {
    expect(L(12)).toMatchObject({
      district: 'Special Height District',
      envelopeStories: 0,
      hostable: 0
    });
    expect(L(12).yield).toEqual([0, 0, 0, 0, 0]);
  });

  it('lots 3, 13 and 14 have no density cap', () => {
    for (const n of [3, 13, 14]) expect(L(n).baseCap, `lot ${n}`).toBe(NULL_CAP);
  });

  it('lot 13: not Local Program (non-R-4 //), base 40, envelope 40, no roll row', () => {
    const r = L(13);
    expect(r).toMatchObject({ localProgram: 0, baseStories: 40, envelopeStories: 40 });
    expect(counts['scenario.height.dbl_non_r4']).toBe(1);
  });

  it('the RA1 mask: no-row lots 9, 12 and 13 are 95, lot 7 (no roll floor area) is 64', () => {
    for (const n of [9, 12, 13]) expect(L(n).imputed, `lot ${n}`).toBe(95);
    expect(L(7).imputed).toBe(64);
    expect(L(11).imputed).toBe(4);
    expect(L(3).imputed).toBe(8);
    for (const n of [1, 2, 4, 5, 6, 8, 10, 14]) expect(L(n).imputed, `lot ${n}`).toBe(0);
    expect({
      year_built: counts['scenario.imputed.year_built'],
      existing_stories: counts['scenario.imputed.existing_stories'],
      improvement_share: counts['scenario.imputed.improvement_share'],
      existing_units: counts['scenario.imputed.existing_units'],
      no_roll: counts['scenario.imputed.no_roll'],
      carried: counts['scenario.imputed.carried'],
      floor_area: counts['scenario.imputed.floor_area']
    }).toEqual({
      year_built: 3,
      existing_stories: 3,
      improvement_share: 4,
      existing_units: 4,
      no_roll: 3,
      carried: 0,
      floor_area: 4
    });
  });

  it('report.json carries fired/of for every registered sd.* rule, with the golden values', () => {
    // [fired, of] and, for a unit-weighted rule, [units, unitsOf] (spec §6, AC 3 and 14).
    const want: Record<string, [number, number] | [number, number, number, number]> = {
      // 19 parcel rows (mini dates only its 2 retired rows and leaves date_rec_add empty).
      'sd.attrs.active-unknown': [0, 19],
      'sd.attrs.added-date-cast': [0, 0],
      'sd.attrs.dropped-date-cast': [0, 2],
      'sd.attrs.latitude-cast': [0, 19],
      'sd.attrs.longitude-cast': [0, 19],
      'sd.attrs.no-blklot': [0, 19],
      'sd.features.median-fallback': [2, 3],
      'sd.features.no-building': [0, 25],
      'sd.features.share-median': [2, 24],
      'sd.features.stories-height': [0, 25],
      'sd.features.vacant-share': [0, 26],
      'sd.features.vacant-year-built': [0, 26],
      'sd.features.year-built-median': [0, 24],
      'sd.height.blank': [0, 6],
      // Lot 9, mini's one parcel with no land-use row, has no roll row, so it stays ineligible.
      'sd.landuse.none-with-units': [0, 14],
      'sd.roll.floor-area-cast': [0, 29],
      'sd.roll.floor-area-missing': [5, 29],
      'sd.roll.improvement-value-cast': [0, 29],
      'sd.roll.land-value-cast': [0, 29],
      'sd.roll.no-row': [3, 14],
      'sd.roll.no-year': [0, 29],
      'sd.roll.roll-year-cast': [0, 29],
      'sd.roll.stories-cast': [0, 29],
      'sd.roll.stories-max': [0, 29],
      'sd.roll.units-capacity': [3, 25, 5000 + 5000 + 900, 11_044],
      'sd.roll.units-cast': [0, 29],
      'sd.roll.units-large': [0, 26],
      'sd.roll.units-latest-jump': [0, 11],
      'sd.roll.units-missing': [0, 25],
      'sd.roll.units-spike': [0, 25, 0, 155],
      'sd.roll.unmatched': [0, 29, 0, 11_044],
      'sd.roll.year-built-cast': [0, 27],
      'sd.roll.year-built-range': [1, 27],
      'sd.roll.year-gap': [1, 26],
      'sd.yield.nonmonotone': [0, 14],
      'sd.yield.zero-hostable': [3, 11],
      'sd.zoning.generic-nc': [1, 8],
      'sd.zoning.missing': [0, 8],
      'sd.zoning.split-code': [0, 8]
    };
    const sd = QUALITY_RULES.filter((r) => r.owner === 'scenario-data');
    expect(sd.map((r) => r.id)).toEqual(Object.keys(want));
    for (const r of sd) {
      const keys = r.unitsWeighted ? ['fired', 'of', 'units', 'unitsOf'] : ['fired', 'of'];
      expect(
        keys.map((k) => counts[`quality.${r.id}.${k}`]),
        r.id
      ).toEqual(want[r.id]);
    }
  });

  it('report.json has none of the superseded scenario.* counts (spec §4.10)', () => {
    for (const k of SUPERSEDED_SCENARIO_COUNTS) expect(counts, k).not.toHaveProperty(k);
    expect(counts['scenario.density_cap.rule.unlisted']).toBe(5);
  });

  it('lot 14: R4 normalised to -R-4, Local Program, envelope 65', () => {
    expect(L(14)).toMatchObject({
      district: '120/400//120/650-R-4',
      localProgram: 1,
      envelopeStories: 65
    });
  });

  it('report totals', () => {
    // 66 as built plus lot 3's 4 (RA1): FIXTURE_PROFILE.scenarioUnitsRange [70, 70].
    expect(counts['scenario.units.total']).toBe(70);
    expect(counts['scenario.roll.years']).toBe(3);
    expect(counts['scenario.panel.years']).toBe(3);
    expect(counts['scenario.yield.clamped']).toBe(0);
    expect(counts['scenario.height.parse_fail']).toBe(0);
    expect(counts['scenario.panel.feature_mismatch']).toBe(0);
    expect(p.fillLevels).toEqual([...FILL_LEVELS]);
  });
});

describe('fixture-0 project records report (project-records spec §4.9)', () => {
  const e2e = 'e2e/fixtures/data/fixture-0';
  const report = () =>
    JSON.parse(readFileSync(join(e2e, 'report.json'), 'utf8')) as {
      counts: Record<string, number>;
      warnings: string[];
    };

  it('carries every project-records count key (plan Task 10)', () => {
    const keys = Object.keys(report().counts);
    const want = [
      'projects.inFlight',
      'projects.inFlightUnits',
      ...PATHWAYS.map((p) => `projects.byPathway.${p}`),
      ...STAGE_ORDER.map((s) => `projects.byStage.${s}`),
      'projects.staleOpen',
      'projects.staleOpenUnits',
      'projects.pathwayDefaulted',
      'projects.excludedAlterationUnits',
      'projects.excludedNoUnits',
      'projects.netDropped',
      'projects.stories.tier0',
      'projects.stories.tier3',
      'projects.stories.null',
      'projects.parcels.mapped',
      'projects.parcels.unmapped',
      'histories.total',
      'histories.ppaLagDays',
      'histories.ppaLagN',
      'rhna.units',
      'rhna.crossCheck.2023',
      'rhna.crossCheck.2024',
      'rhna.crossCheck.2025',
      'rhna.xdhtLagDays',
      'params.ppaUmbrellaDays',
      'params.ppaUmbrellaDays.tier',
      'params.referralToleranceDays',
      'params.referralToleranceDays.tier',
      'multiphase.enriched',
      'multiphase.fallback',
      'multiphase.lastResort',
      'multiphase.merged',
      'multiphase.scoreOnly',
      'multiphase.nettedOut',
      'multiphase.netted.2007.0001PRX',
      'multiphase.netted.2010.0002PRX',
      'multiphase.netted.2012-000020PRX',
      'multiphase.phases.enriched',
      'multiphase.phases.fallback',
      'multiphase.scale.2007.0001PRX',
      'multiphase.u.2010.0002PRX',
      'multiphase.u.2010.0002PRX.n',
      'pipeline.cutoffDay',
      'projects.asOf'
    ];
    for (const k of want) expect(keys, k).toContain(k);
    expect(keys.some((k) => k.startsWith('link.'))).toBe(true);
    expect(report().counts['projects.asOf']).toBe(Date.parse('2026-10-10') / 86_400_000);
  });

  it('reports the pr.* tallies the fixture pins (spec §6 Golden)', () => {
    const c = report().counts;
    // M1 (permit filed before its approval) and M10 (permit B filed before its approval).
    expect(c['quality.pr.stages.forward-clamp.fired']).toBeGreaterThanOrEqual(2);
    expect(c['quality.pr.stages.forward-clamp.of']).toBe(c['histories.total']);
    // M1's completed_date 1909-06-02.
    expect(c['quality.pr.date.valid-range.fired']).toBeGreaterThanOrEqual(1);
    expect(c['quality.pr.stories.parse-range.fired']).toBe(0);
    // M15's 5,540-unit permit on 3 stories of a 300 m² lot.
    expect(c['quality.pr.units.capacity.fired']).toBe(1);
    expect(c['quality.pr.units.capacity.units']).toBe(5540);
    // M16 and M17 link; M18 is dropped.
    expect(c['quality.pr.pipeline.status-date-linked.fired']).toBe(2);
    expect(c['quality.pr.pipeline.no-status-date.fired']).toBe(1);
    expect(c['quality.pr.pipeline.no-status-date.units']).toBe(20);
    // M10 and M19 on lot 1.
    expect(c['quality.pr.parcels.shared-existing.fired']).toBe(2);
    // M20, netted by M11 and score-only.
    expect(c['quality.pr.multiphase.da-netting.fired']).toBe(1);
    expect(c['quality.pr.multiphase.score-only.fired']).toBe(1);
    // As computed: M23's two split rows list projects whose records show them complete.
    expect(c['quality.pr.pipeline.records-win.fired']).toBe(2);
    expect(c['quality.pr.pipeline.records-win.of']).toBe(10);
    // M23's two split rows omit unitsAt.filed (Ruling S2).
    expect(c['quality.pr.units.split-filed.fired']).toBe(2);
    expect(c['projects.excludedNoUnits']).toBe(900);
    expect(c['multiphase.netted.2012-000020PRX']).toBe(3);
    expect(c['multiphase.lastResort']).toBe(1);
    expect(c['multiphase.scoreOnly']).toBe(1);
  });

  it('names the DQ-2 and score-only rows in the build warnings (spec 4.2 step 10, 4.10.2)', () => {
    const w = report().warnings;
    for (const line of [
      '2024-000016PRX: linked to 2024-000016PRJ; multiphase entry unused',
      '2025-000017PRX: linked to 2025-000017PRJ with no units; excluded',
      '2026-000018PRJ: no status date and no open Planning record on its lot; dropped',
      '2012-000020PRX: no free DA parcel; score-only'
    ]) {
      expect(w).toContain(line);
    }
  });

  it('M1 carries pr.date.valid-range and pr.stages.forward-clamp (spec §4.9 fixture table)', () => {
    const f = JSON.parse(readFileSync(join(e2e, PROJECTS_JSON), 'utf8')) as {
      projects: { id: string; quality: string[] }[];
    };
    const m1 = f.projects.find((p) => p.id === 'PRJ:2019-000001PRJ');
    expect(m1?.quality).toEqual(['pr.date.valid-range', 'pr.stages.forward-clamp']);
    const m10 = f.projects.find((p) => p.id === 'PRJ:2020-000010PRJ');
    expect(m10?.quality).toEqual(['pr.parcels.shared-existing', 'pr.stages.forward-clamp']);
  });

  it('warns that the fixture xdht-4php completions are stale (633 days)', () => {
    expect(report().warnings).toContain(
      'rhna.xdhtLagDays 633 > 120: xdht-4php completions look stale'
    );
  });

  it('keeps scenarios out of the manifest until calibration.json exists', () => {
    const m = JSON.parse(readFileSync(join(e2e, 'manifest.json'), 'utf8')) as object;
    expect(existsSync(join(e2e, PROJECTS_JSON))).toBe(true);
    expect('scenarios' in m).toBe(false);
  });
});
