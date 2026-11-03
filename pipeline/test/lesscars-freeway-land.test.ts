// Freeway land (lesscars v1.1 Task 2): the catalog format and parser, the mini build's lot 19
// made unbuildable while its freeway stands, the homes check and V17 with and without the catalog.
import { mkdtempSync, readFileSync } from 'node:fs';
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
import { checkDataset, type CheckExtras } from '../steps/check';
import { writeScenario } from '../steps/scenario';
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
