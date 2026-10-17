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
import { MINI } from './helpers';
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
  it('matches the golden byte for byte and is identical across two builds (V12)', async () => {
    const a = mkdtempSync(join(tmpdir(), 'sfh-fx-a-'));
    const b = mkdtempSync(join(tmpdir(), 'sfh-fx-b-'));
    const da = mkdtempSync(join(tmpdir(), 'sfh-fx-da-'));
    const db = mkdtempSync(join(tmpdir(), 'sfh-fx-db-'));
    expect(await fixture({ outDir: a, skipTiles, derivedRoot: da })).toBe(0);
    expect(await fixture({ outDir: b, skipTiles, derivedRoot: db })).toBe(0);
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

  it('lot 4: rent-control excluded, envelope 4, pre-FZP NC-1 cap 4, FZP cap none (C2)', () => {
    const r = L(4);
    expect(r).toMatchObject({ localProgram: 0, envelopeStories: 4, baseStories: 4, baseCap: 4 });
    for (const y of r.baseYield) expect(y).toBeLessThanOrEqual(4);
    // FZP yield is uncapped: it differs from the base yield where the generator exceeds 4 units.
    expect(r.yield.some((y) => y > 4)).toBe(true);
    expect(r.yield.map((y) => Math.min(y, 4))).toEqual(r.baseYield);
    expect(counts['scenario.excluded.rent_control']).toBe(1);
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
    expect(r.imputed & 0b10000).toBe(0b10000);
    expect(counts['scenario.height.dbl_non_r4']).toBe(1);
  });

  it('lot 14: R4 normalised to -R-4, Local Program, envelope 65', () => {
    expect(L(14)).toMatchObject({
      district: '120/400//120/650-R-4',
      localProgram: 1,
      envelopeStories: 65
    });
  });

  it('report totals', () => {
    expect(counts['scenario.units.total']).toBe(66);
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
      'projects.pipelineConflicts',
      'projects.pathwayDefaulted',
      'projects.excludedAlterationUnits',
      'projects.netDropped',
      'projects.stories.tier0',
      'projects.stories.tier3',
      'projects.stories.null',
      'projects.parcels.mapped',
      'projects.parcels.unmapped',
      'histories.total',
      ...STAGE_ORDER.map((s) => `histories.clamped.${s}`),
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
