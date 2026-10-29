// The frontage step (writeFrontage, 83_frontage.sql) on the mini database, after the scenario and
// policy steps as build runs them: the known answers of the mini README "Streets".
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { STREET_CLASSES, frontingRows, type Frontage } from '../../src/lib/data/frontage-codec';
import { isNeighborhoodCommercial } from '../../src/lib/data/policy-codec';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { Duck } from '../lib/duck';
import { readLock } from '../lib/lock';
import { qualityRule } from '../lib/quality';
import { Report } from '../lib/report';
import { FRONTAGE_BIN, POLICY_BIN } from '../lib/scenario-files';
import { runSql } from '../lib/sql';
import { asOfFromLock } from '../project-records/parse';
import { readParcelRecords } from '../steps/chunks';
import { readFrontageBin, writeFrontage } from '../steps/frontage';
import { readPolicyBin, writePolicy } from '../steps/policy';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../steps/scenario';
import { MINI, miniDuck } from './helpers';

const LOT: Record<number, string> = {
  1: '3512001',
  2: '3512002',
  3: '8711023C',
  4: '0026T001A',
  ...Object.fromEntries(
    Array.from({ length: 14 }, (_, k) => [k + 5, `35120${String(k + 5).padStart(2, '0')}`])
  )
};

let db: Duck;
let s: ScenarioParcels;
let f: Frontage;
let outDir: string;
let counts: Record<string, number>;
let buildCounts: Record<string, number>;

beforeAll(async () => {
  db = await miniDuck();
  await runSql(db);
  const records = await readParcelRecords(db);
  const capDay = asOfFromLock(readLock(join(MINI, 'sources.lock.json')));
  const root = mkdtempSync(join(tmpdir(), 'sfh-frontage-step-'));
  outDir = join(root, 'out');
  buildCounts = {};
  await writeScenario({
    db,
    outDir,
    derivedDir: join(root, 'derived'),
    datasetVersion: 'fixture-0',
    records,
    capDay,
    report: new Report(),
    buildCounts
  });
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(MINI, 'golden', 'transit.json'), join(outDir, 'transit.json'));
  await writePolicy({ db, outDir, datasetVersion: 'fixture-0', records, capDay, buildCounts });
  ({ counts } = await writeFrontage({ db, outDir, datasetVersion: 'fixture-0', buildCounts }));
  s = readParcelsBin(join(outDir, PARCELS_BIN));
  f = readFrontageBin(join(outDir, FRONTAGE_BIN), s);
});

const row = (lot: number) => {
  const i = s.index.get(LOT[lot]);
  if (i === undefined) throw new Error(`no parcel for lot ${lot}`);
  return i;
};
/** A lot's entries as [cnn, depth], in file order. */
const entries = (lot: number) => {
  const i = row(lot);
  const out: [number, number][] = [];
  for (let e = f.rowStart[i]; e < f.rowStart[i + 1]; e++)
    out.push([f.segCnn[f.frontSeg[e]], f.frontDepth[e]]);
  return out;
};

describe('writeFrontage on the mini fixture', () => {
  it('keeps the three city street segments, not PAPER ST or I-80', () => {
    expect(Array.from(f.segCnn)).toEqual([1000, 1001, 2000]);
    expect(f.names).toEqual(['FIXTURE AVE', 'MISSION ST']);
    expect(Array.from(f.segName, (k) => f.names[k])).toEqual([
      'MISSION ST',
      'MISSION ST',
      'FIXTURE AVE'
    ]);
    expect(Array.from(f.segClass, (c) => STREET_CLASSES[c])).toEqual([
      'arterial',
      'arterial',
      'residential'
    ]);
    expect(f.count).toBe(s.count);
  });

  it('fronts lots 1-9 on cnn 1000 only, and lot 10 on both sides of the split at x = 95', () => {
    for (let lot = 1; lot <= 9; lot++) expect(entries(lot), `lot ${lot}`).toEqual([[1000, 0]]);
    expect(entries(10)).toEqual([
      [1000, 0],
      [1001, 0]
    ]);
  });

  it('fronts lots 11-13 on cnn 1001; lot 13 is one lot deep on Fixture Ave behind corner lot 14', () => {
    expect(entries(11)).toEqual([[1001, 0]]);
    expect(entries(12)).toEqual([[1001, 0]]);
    expect(entries(13)).toEqual([
      [1001, 0],
      [2000, 1]
    ]);
    expect(entries(14)).toEqual([
      [1001, 0],
      [2000, 0]
    ]);
  });

  it('gives lot 18 depth 1 on cnn 1001 only, and lots 15-17 nothing', () => {
    expect(entries(18)).toEqual([[1001, 1]]);
    for (const lot of [15, 16, 17]) expect(entries(lot), `lot ${lot}`).toEqual([]);
  });

  it('counts segments, entries, corners and eligible lots with no frontage', () => {
    expect(counts).toMatchObject({
      'frontage.segments': 3,
      'frontage.entries.depth0': 16,
      'frontage.entries.depth1': 2,
      'frontage.no_frontage': 3,
      'frontage.corner': 1,
      'frontage.depth1_orphan': 0
    });
    expect(counts['frontage.bytes.payload']).toBeGreaterThan(0);
    expect(counts['frontage.bytes.file']).toBeUndefined();
  });

  it('reports sd.streets.no-frontage over the eligible parcels', () => {
    expect(qualityRule('sd.streets.no-frontage')).toMatchObject({
      source: 'datasf-streets',
      field: 'frontage',
      kind: 'missing',
      action: 'none',
      tier: 4,
      valueTier: null,
      denominator: 'eligible parcels',
      warnShare: 0.05,
      failShare: 0.1
    });
    expect(buildCounts['quality.sd.streets.no-frontage.fired']).toBe(3);
    expect(buildCounts['quality.sd.streets.no-frontage.of']).toBe(15);
  });

  it('composes the commercial corridor: arterial frontage ∩ neighborhood commercial (ruling 5)', () => {
    const pol = readPolicyBin(join(outDir, POLICY_BIN), s);
    const arterial = (k: number) => STREET_CLASSES[f.segClass[k]] === 'arterial';
    const nc = (i: number) => isNeighborhoodCommercial(pol.useDistricts[pol.useDistrict[i]]);
    for (const depth of [0, 1] as const)
      expect(
        frontingRows(f, arterial, depth)
          .filter(nc)
          .map((i) => s.id[i])
      ).toEqual([LOT[3], LOT[4]].sort());
  });
});
