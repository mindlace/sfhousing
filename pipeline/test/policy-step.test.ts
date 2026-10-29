// The policy step (writePolicy, 82_policy.sql) on the mini database: use district, historic status,
// exemptions and the FZP yield cap, in parcels.bin row order (the helpers.ts pattern).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  HISTORIC_CODES,
  NULL_CAP,
  SB79_STATUSES,
  S207_STATUSES,
  type PolicyParcels
} from '../../src/lib/data/policy-codec';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import type { Duck } from '../lib/duck';
import { readLock } from '../lib/lock';
import { qualityRule } from '../lib/quality';
import { Report } from '../lib/report';
import { POLICY_BIN } from '../lib/scenario-files';
import { runSql } from '../lib/sql';
import { asOfFromLock } from '../project-records/parse';
import { readParcelRecords } from '../steps/chunks';
import { readPolicyBin, writePolicy } from '../steps/policy';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../steps/scenario';
import { MINI, miniDuck } from './helpers';

const LOT = {
  2: '3512002',
  3: '8711023C',
  12: '3512012',
  13: '3512013',
  15: '3512015',
  18: '3512018'
} as const;

let db: Duck;
let s: ScenarioParcels;
let pol: PolicyParcels;
let counts: Record<string, number>;
let buildCounts: Record<string, number>;
let zoning: Map<string, string>;

beforeAll(async () => {
  db = await miniDuck();
  await runSql(db);
  const records = await readParcelRecords(db);
  const capDay = asOfFromLock(readLock(join(MINI, 'sources.lock.json')));
  const root = mkdtempSync(join(tmpdir(), 'sfh-policy-step-'));
  const outDir = join(root, 'out');
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
  ({ counts } = await writePolicy({
    db,
    outDir,
    datasetVersion: 'fixture-0',
    records,
    capDay,
    buildCounts
  }));
  s = readParcelsBin(join(outDir, PARCELS_BIN));
  pol = readPolicyBin(join(outDir, POLICY_BIN), s);
  const z = await db.all<{ id: string; code: string }>(
    "SELECT id, coalesce(zoning_code, '') AS code FROM sc_zoning"
  );
  zoning = new Map(z.map((r) => [r.id, r.code]));
});

const row = (id: string) => {
  const i = s.index.get(id);
  if (i === undefined) throw new Error(`no parcel ${id}`);
  return i;
};
const historicOf = (id: string) => HISTORIC_CODES[pol.historic[row(id)]];

describe('writePolicy on the mini fixture', () => {
  it('takes the most protective historic code of the parcel rows', () => {
    expect(historicOf(LOT[18])).toBe('');
    expect(historicOf(LOT[2])).toBe('A');
    expect(pol.historicProtected[row(LOT[2])]).toBe(1);
    expect(historicOf(LOT[13])).toBe('A*');
    expect(pol.historicProtected[row(LOT[13])]).toBe(1);
    expect(historicOf(LOT[3])).toBe('B');
    expect(pol.historicProtected[row(LOT[3])]).toBe(0);
    expect(counts['policy.historic.none']).toBe(1);
    expect(counts['policy.historic.protected']).toBe(
      counts['policy.historic.A'] + counts['policy.historic.A*']
    );
  });

  it('flags the permanent and temporary exemptions', () => {
    expect(pol.exemptPermanent[row(LOT[12])]).toBe(1);
    expect(pol.exemptTemporary[row(LOT[12])]).toBe(0);
    expect(pol.exemptTemporary[row(LOT[15])]).toBe(1);
    expect(pol.exemptPermanent[row(LOT[15])]).toBe(0);
    expect(counts['policy.exempt.permanent']).toBe(1);
    expect(counts['policy.exempt.temporary']).toBe(1);
  });

  it('ships the use district of datasf-parcel-attrs', () => {
    expect(pol.useDistricts[pol.useDistrict[row(LOT[18])]]).toBe('RM-1');
    for (let i = 0; i < pol.count; i++)
      expect(pol.useDistricts[pol.useDistrict[i]], s.id[i]).toBe(zoning.get(s.id[i]));
    expect(counts['policy.use_district_mismatch']).toBe(0);
  });

  it('copies FZP into the current-law columns and leaves SB 79 outside', () => {
    expect(Array.from(pol.currentYield)).toEqual(Array.from(s.yield));
    expect(Array.from(pol.currentStories)).toEqual(Array.from(s.envelopeStories));
    expect(Array.from(pol.hostableCurrent)).toEqual(Array.from(s.hostable));
    expect(Array.from(pol.currentCap)).toEqual(Array.from(pol.fzpYieldCap));
    expect(pol.currentFromS207.every((v) => v === 0)).toBe(true);
    expect(pol.sb79Status.every((v) => SB79_STATUSES[v] === 'outside')).toBe(true);
    expect(pol.s207Status.every((v) => S207_STATUSES[v] === 'outside')).toBe(true);
    expect(pol.sb79Cap.every((v) => v === NULL_CAP)).toBe(true);
    expect(pol.sb79Yield.every((v) => v === 0)).toBe(true);
    expect(pol.sb79Stories.every((v) => v === 0)).toBe(true);
    expect(pol.hostableSb79.every((v) => v === 0)).toBe(true);
  });

  it('has no FZP yield cap on Local Program rows', () => {
    let lp = 0;
    for (let i = 0; i < s.count; i++)
      if (s.localProgram[i]) {
        lp++;
        expect(pol.fzpYieldCap[i], s.id[i]).toBe(NULL_CAP);
      }
    expect(lp).toBeGreaterThan(0);
    // Off the Local Program the cap is the zoning's: lot 18 is RM-1 outside R-4.
    expect(s.localProgram[row(LOT[18])]).toBe(0);
    expect(pol.fzpYieldCap[row(LOT[18])]).not.toBe(NULL_CAP);
  });

  it('reports sd.historic.no-row and sd.exempt.unmatched', () => {
    expect(qualityRule('sd.historic.no-row').kind).toBe('missing');
    expect(buildCounts['quality.sd.historic.no-row.fired']).toBe(1);
    expect(buildCounts['quality.sd.historic.no-row.of']).toBe(18);
    // The stand-in pseudo-lot 3512999 matches no active parcel.
    expect(buildCounts['quality.sd.exempt.unmatched.fired']).toBe(1);
    expect(buildCounts['quality.sd.exempt.unmatched.of']).toBe(3);
    expect(counts['policy.bytes.payload']).toBeGreaterThan(0);
    expect(counts['policy.bytes.file']).toBeUndefined();
  });
});
