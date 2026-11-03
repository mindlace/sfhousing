// Freeway land (lesscars v1.1 Task 2): the catalog format and parser, the mini build's lot 19
// made unbuildable while its freeway stands, the homes check and V17 with and without the catalog.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PROFILE } from '../config';
import { LESSCARS_FREEWAY_LAND_JSON } from '../lesscars-config';
import {
  parseFreewayLand,
  readFreewayLand,
  readFreewayLandSet,
  type FreewayLandFile
} from '../lib/lesscars/freeway-land';
import { Report } from '../lib/report';
import { SB79_EXEMPTIONS_CSV } from '../sources/sfbos';
import { lesscarsCnns } from '../steps/lesscars-cnns';
import { lesscarsFreewayLand, type FreewayCandidatesFile } from '../steps/lesscars-freeway-land';
import { checkDataset, type CheckExtras } from '../steps/check';
import { writeScenario } from '../steps/scenario';
import { MINI } from './helpers';
import { lesscarsMini } from './lesscars-helpers';

const FIXTURE_0 = 'e2e/fixtures/data/fixture-0';

const segment = (over: Record<string, unknown> = {}) => ({
  id: 'fx-i80',
  freeway: 'I-80',
  label: 'Fixture I-80',
  ref: null,
  cnn: ['4000'],
  removedBy: 'hwy',
  curated: 'hand',
  parcels: ['3512019'],
  excluded: [],
  ...over
});
const twoSegments = {
  schema: 1,
  segments: [segment(), segment({ id: 'fx-i80-b', cnn: ['4001'] })]
};
const listedAndExcluded = {
  schema: 1,
  segments: [segment({ excluded: [{ parcel: '3512019', reason: 'a park' }] })]
};
const noReason = {
  schema: 1,
  segments: [segment({ excluded: [{ parcel: '3512018', reason: '' }] })]
};

/** The scenario step on the mini with a catalog of one segment over `parcels`. */
async function scenarioWithCatalog(parcels: string[]) {
  const mini = await lesscarsMini();
  const root = mkdtempSync(join(tmpdir(), 'sfh-freeway-land-'));
  const freewayLand: FreewayLandFile = parseFreewayLand({
    schema: 1,
    segments: [segment({ parcels })]
  });
  return writeScenario({
    db: mini.db,
    outDir: join(root, 'out'),
    derivedDir: join(root, 'derived'),
    datasetVersion: 'fixture-0',
    records: mini.records,
    capDay: mini.capDay,
    report: new Report(),
    buildCounts: {},
    freewayLand
  });
}

/** V17 on the committed fixture-0 with its report's counts. */
async function v17(dir: string, extras: Pick<CheckExtras, 'freewayLand'>) {
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as {
    counts: Record<string, number>;
  };
  const r = await checkDataset(dir, FIXTURE_PROFILE, {
    counts: report.counts,
    reencodeIdentical: true,
    ...extras
  });
  return r.find((x) => x.id === 'V17')!;
}

describe('freeway-land catalog', () => {
  it('parses the fixture catalog and gives its parcel set', () => {
    expect([...readFreewayLandSet(LESSCARS_FREEWAY_LAND_JSON.fixture)]).toEqual(['3512019']);
    const f = readFreewayLand(LESSCARS_FREEWAY_LAND_JSON.fixture)!;
    expect(f.segments.map((s) => [s.id, s.freeway, s.removedBy])).toEqual([
      ['fx-i80', 'I-80', 'hwy']
    ]);
    expect(f.segments[0].excluded).toEqual([
      { parcel: '3512018', reason: '2 homes: freeway land holds none' }
    ]);
  });

  it('a missing catalog is an empty set', () => {
    expect(readFreewayLandSet('/nonexistent/freeway-land.json').size).toBe(0);
    expect(readFreewayLand('/nonexistent/freeway-land.json')).toBeNull();
  });

  it('rejects a parcel in two segments, a parcel both listed and excluded, an empty reason', () => {
    expect(() => parseFreewayLand(twoSegments)).toThrow(/3512019.*two segments|twice/);
    expect(() => parseFreewayLand(listedAndExcluded)).toThrow(/3512019.*excluded/);
    expect(() => parseFreewayLand(noReason)).toThrow(/excluded\.0\.reason/);
  });

  it('rejects a bad schema, an unknown key, unsorted parcels and a bad curated value', () => {
    expect(() => parseFreewayLand({ schema: 2, segments: [] })).toThrow(/schema/);
    expect(() => parseFreewayLand({ schema: 1, segments: [segment({ extra: 1 })] })).toThrow(
      /segments\.0\.extra/
    );
    expect(() =>
      parseFreewayLand({ schema: 1, segments: [segment({ parcels: ['3512019', '3512001'] })] })
    ).toThrow(/segments\.0\.parcels.*sorted/);
    expect(() => parseFreewayLand({ schema: 1, segments: [segment({ curated: 'auto' })] })).toThrow(
      /segments\.0\.curated/
    );
    expect(() => parseFreewayLand({ schema: 1, segments: [segment(), segment()] })).toThrow(
      /segments\.1\.id/
    );
  });
});

describe('freeway land in the mini build', () => {
  it('the mini build marks lot 19 unbuildable and reports what it removed', async () => {
    const mini = await lesscarsMini();
    const i = mini.parcels.index.get('3512019')!;
    expect(i).toBeDefined();
    expect(mini.parcels.eligible[i]).toBe(0);
    expect(mini.parcels.hostable[i]).toBe(0);
    expect(mini.counts['scenario.freeway_land.lots']).toBe(1);
    expect(mini.counts['scenario.freeway_land.net_removed']).toBeGreaterThan(0);
    expect(mini.counts['scenario.freeway_land.net_removed.i-80']).toBe(
      mini.counts['scenario.freeway_land.net_removed']
    );
  });

  it('a catalog parcel with homes fails the scenario step', async () => {
    await expect(scenarioWithCatalog(['3512018'])).rejects.toThrow(/3512018 has 2 existing homes/);
  });

  it('a catalog parcel missing from parcels.bin is warned about, and counts stay 0', async () => {
    const r = await scenarioWithCatalog(['9999999']);
    expect(r.warnings).toContain('scenario: freeway-land parcel(s) 9999999 are not in parcels.bin');
    expect(r.counts['scenario.freeway_land.lots']).toBe(0);
    expect(r.counts['scenario.freeway_land.net_removed']).toBe(0);
    expect(r.counts['scenario.freeway_land.net_removed.i-80']).toBe(0);
  });

  it('V17 accepts a catalog row the rule made ineligible and fails it without the catalog', async () => {
    expect((await v17(FIXTURE_0, { freewayLand: new Set(['3512019']) })).ok).toBe(true);
    expect((await v17(FIXTURE_0, { freewayLand: new Set() })).detail).toMatch(/1 eligible flag/);
  });
});

describe('lesscars-freeway-land candidates', () => {
  type Args = Parameters<typeof lesscarsFreewayLand>[0];
  const mini = (extra: Partial<Args> = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-fl-cand-'));
    const outPath = join(dir, 'freeway-land.candidates.json');
    const args: Args = {
      lockPath: join(MINI, 'sources.lock.json'),
      rawDir: join(MINI, 'raw'),
      byName: true,
      catalogPath: LESSCARS_FREEWAY_LAND_JSON.fixture,
      outPath,
      datasetDir: null,
      exemptionsCsv: SB79_EXEMPTIONS_CSV.fixture,
      ...extra
    };
    return { outPath, run: () => lesscarsFreewayLand(args) };
  };
  const runOnMini = async (extra: Partial<Args> = {}) => {
    const m = mini(extra);
    expect(await m.run()).toBe(0);
    return JSON.parse(readFileSync(m.outPath, 'utf8')) as FreewayCandidatesFile;
  };

  it('proposes lot 19 for the fixture I-80, not lot 18 (2 homes) nor lot 1 (2 homes)', async () => {
    const out = await runOnMini();
    const c = out.segments[0].candidates;
    expect(out.rule).toEqual({ bandM: 60, minShare: 0.5 });
    expect(c.map((x) => x.parcel)).toContain('3512019');
    expect(c.map((x) => x.parcel)).not.toContain('3512018');
    expect(c.find((x) => x.parcel === '3512019')).toMatchObject({
      status: 'listed',
      units: 0,
      landUse: 'VACANT',
      zoning: 'P'
    });
    expect(c.find((x) => x.parcel === '3512019')!.inBandShare).toBeGreaterThanOrEqual(0.5);
    // lot 1 is exactly half in the band but holds homes
    expect(c.map((x) => x.parcel)).not.toContain('3512001');
  });

  it('open space exactly half in the band is proposed and flagged for curation', async () => {
    // lot 7: zoning P, OPENSPACE, no building, y[0, 30], so exactly half within 60 m of y = 75
    const c = (await runOnMini()).segments[0].candidates;
    expect(c.find((x) => x.parcel === '3512007')).toMatchObject({ openSpace: true, status: 'new' });
    expect(c.find((x) => x.parcel === '3512019')).toMatchObject({ openSpace: false });
  });

  it('a parcel under half in the band is not proposed', async () => {
    // lot 7: a third within 50 m
    const narrow = await runOnMini({ rule: { bandM: 50, minShare: 0.5 } });
    expect(narrow.segments[0].candidates.map((x) => x.parcel)).not.toContain('3512007');
  });

  it('writes nothing and exits 1 when a segment names a CNN src_streets lacks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-fl-bad-'));
    const catalogPath = join(dir, 'freeway-land.json');
    const bad = JSON.parse(readFileSync(LESSCARS_FREEWAY_LAND_JSON.fixture, 'utf8'));
    bad.segments[0].cnn = ['9999999'];
    writeFileSync(catalogPath, JSON.stringify(bad));
    const m = mini({ catalogPath });
    expect(await m.run()).toBe(1);
    expect(existsSync(m.outPath)).toBe(false);
  });

  it('lesscars-cnns still resolves through the shared loader', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-fl-cnns-'));
    const inPath = join(dir, 'corridors.json');
    const outPath = join(dir, 'corridors.resolved.json');
    writeFileSync(inPath, JSON.stringify({ schema: 1, corridors: [] }));
    const code = await lesscarsCnns({
      lockPath: join(MINI, 'sources.lock.json'),
      rawDir: join(MINI, 'raw'),
      byName: true,
      inPath,
      outPath
    });
    expect(code).toBe(0);
    const out = JSON.parse(readFileSync(outPath, 'utf8'));
    expect(out.source.id).toBe('datasf-streets');
    expect(out.source.sha256).toHaveLength(1);
  });
});
