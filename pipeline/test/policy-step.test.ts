// The policy step (writePolicy, 82_policy.sql) on the mini database: use district, historic status,
// exemptions and the FZP yield cap, in parcels.bin row order (the helpers.ts pattern).
import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
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
import { unitsFor } from '../lib/sb79';
import { MUNI_TIER2_STOP_IDS } from '../sb79-config';
import { readPolicyBin, writePolicy } from '../steps/policy';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../steps/scenario';
import { MINI, miniDuck } from './helpers';

const LOT = {
  1: '3512001',
  2: '3512002',
  3: '8711023C',
  7: '3512007',
  11: '3512011',
  12: '3512012',
  13: '3512013',
  15: '3512015',
  16: '3512016',
  17: '3512017',
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
  // The transit step's output, as build writes it before the policy step.
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(MINI, 'golden', 'transit.json'), join(outDir, 'transit.json'));
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

  const s207 = (id: string) => S207_STATUSES[pol.s207Status[row(id)]];
  const F = () => s.fillLevels.length;
  const current = (id: string) => {
    const i = row(id);
    return {
      stories: pol.currentStories[i],
      cap: pol.currentCap[i],
      yield: Array.from(pol.currentYield.subarray(i * F(), (i + 1) * F())),
      hostable: pol.hostableCurrent[i],
      fromS207: pol.currentFromS207[i]
    };
  };
  const fzp = (id: string) => {
    const i = row(id);
    return {
      stories: s.envelopeStories[i],
      cap: pol.fzpYieldCap[i],
      yield: Array.from(s.yield.subarray(i * F(), (i + 1) * F())),
      hostable: s.hostable[i],
      fromS207: 0
    };
  };

  it('raises lot 17 (RH-2, 30 ft, tier 1 half band) to 40 ft under §207.11', () => {
    expect(s207(LOT[17])).toBe('applies');
    const i = row(LOT[17]);
    expect(s.envelopeStories[i]).toBe(3);
    expect(current(LOT[17]).stories).toBe(4);
    expect(current(LOT[17]).fromS207).toBe(1);
    expect(current(LOT[17]).cap).toBe(unitsFor(100, s.lotAreaM2[i], 0.5, 'round'));
    expect(current(LOT[17]).hostable).toBe(1);
  });

  it('applies §207.11 on lot 18: its RM-1 cap is below half the adjacent tier 1 density', () => {
    // Planning's (b)(8): 0.5 × 160 du/ac on 300 m² is 6 homes; RM-1 permits 4.
    const i = row(LOT[18]);
    expect(pol.fzpYieldCap[i]).toBeLessThan(unitsFor(80, s.lotAreaM2[i], 1, 'round'));
    expect(s207(LOT[18])).toBe('applies');
    expect(current(LOT[18]).cap).toBe(unitsFor(160, s.lotAreaM2[i], 0.5, 'round'));
    expect(current(LOT[18]).fromS207).toBe(1);
  });

  it('keeps FZP on exempt, uncapped and minimum-meeting lots', () => {
    expect(s207(LOT[15])).toBe('exempt');
    expect(current(LOT[15])).toEqual(fzp(LOT[15]));
    expect(s207(LOT[12])).toBe('exempt');
    // Lots 1–4 are in 40//65-R-4, but none has a numeric FZP cap (Local Program on 1 and 2,
    // form-based NCT and NC-1 on 3 and 4) and 40 ft is not under 40: (b)(3) comes first.
    for (const id of [LOT[1], LOT[2], LOT[3], '0026T001A']) expect(s207(id), id).toBe('no-limit');
    expect(s207(LOT[13])).toBe('no-limit'); // C-3-O at 120 ft, before its A* historic status
    for (const id of ['3512005', '3512008', '3512010']) expect(s207(id), id).toBe('meets-minimum');
    for (let k = 0; k < pol.count; k++)
      if (!pol.currentFromS207[k]) expect(current(s.id[k]), s.id[k]).toEqual(fzp(s.id[k]));
  });

  it('counts the §207.11 statuses and the current-law layer', () => {
    const statuses = S207_STATUSES.reduce((n, st) => n + counts[`policy.s207.${st}`], 0);
    expect(statuses).toBe(pol.count);
    expect(counts['policy.s207.applies']).toBe(3);
    expect(counts['policy.s207.exempt']).toBe(2);
    expect(counts['policy.s207.no-limit']).toBe(7);
    expect(counts['policy.s207.meets-minimum']).toBe(3);
    expect(counts['policy.s207.not-eligible']).toBe(3);
    expect(counts['policy.s207.base_ft_mismatch']).toBe(0);
    expect(counts['policy.current.from_s207']).toBe(2);
    expect(counts['policy.current.yield_mismatch']).toBe(0);
    let net = 0;
    for (let k = 0; k < pol.count; k++)
      if (pol.hostableCurrent[k])
        net += Math.max(0, pol.currentYield[(k + 1) * F() - 1] - s.existingUnits[k]);
    expect(counts['policy.current.net_capacity']).toBe(net);
  });

  const sb79 = (id: string) => {
    const i = row(id);
    return {
      tier: pol.todTier[i],
      band: pol.todBand[i],
      status: SB79_STATUSES[pol.sb79Status[i]],
      stories: pol.sb79Stories[i]
    };
  };

  it('applies SB 79 as written at the README stop positions', () => {
    // Lot 18: within 200 ft of FX-1 (BART, tier 1): 95 ft → 9 stories, 160 du/ac.
    expect(sb79(LOT[18])).toEqual({ tier: 1, band: 1, status: 'applies', stories: 9 });
    const i18 = row(LOT[18]);
    expect(pol.sb79Cap[i18]).toBe(unitsFor(160, s.lotAreaM2[i18]));
    expect(pol.hostableSb79[i18]).toBe(1);
    // Lot 1: ≈ 89 m to the Caltrain platforms (80 trains a day at the station, tier 1). Its 2
    // homes of 1912 are not more than two (§65912.157(h)), so it gets the 75 ft envelope.
    expect(sb79(LOT[1])).toEqual({ tier: 1, band: 2, status: 'applies', stories: 7 });
    expect(sb79(LOT[11])).toEqual({ tier: 1, band: 2, status: 'applies', stories: 7 });
    // Lot 2's 3 condo homes of 1975 are more than two: excluded.
    expect(sb79(LOT[2]).status).toBe('rent-control');
    // Lots 15 and 17: ≈ 721 m and ≈ 718 m to FX-1. Lot 15 is temporarily exempt, which SB 79 as
    // written ignores (ruling 3).
    expect(pol.exemptTemporary[row(LOT[15])]).toBe(1);
    expect(sb79(LOT[15])).toEqual({ tier: 1, band: 3, status: 'applies', stories: 6 });
    expect(sb79(LOT[17])).toEqual({ tier: 1, band: 3, status: 'applies', stories: 6 });
  });

  it('gives no SB 79 envelope where the lot is ineligible or the zoning excluded', () => {
    expect(sb79(LOT[16]).status).toBe('not-eligible');
    expect(sb79(LOT[7]).status).toBe('not-eligible');
    expect(sb79(LOT[12]).status).toBe('zone'); // P, also permanently exempt
    for (let i = 0; i < pol.count; i++) {
      const applies = SB79_STATUSES[pol.sb79Status[i]] === 'applies';
      expect(pol.hostableSb79[i], s.id[i]).toBe(applies ? 1 : 0);
      if (applies) continue;
      expect(pol.sb79Stories[i], s.id[i]).toBe(0);
      expect(pol.sb79Cap[i], s.id[i]).toBe(NULL_CAP);
      for (let k = 0; k < s.fillLevels.length; k++)
        expect(pol.sb79Yield[i * s.fillLevels.length + k]).toBe(0);
    }
  });

  it('counts the SB 79 stops and statuses', () => {
    expect(counts['policy.sb79.stops.tier1']).toBe(3); // FX-1, 70011, 70012
    expect(counts['policy.sb79.stops.tier2']).toBe(2); // m4, m5
    expect(counts['policy.sb79.not-eligible']).toBeGreaterThanOrEqual(2);
    expect(counts['policy.sb79.zone']).toBeGreaterThanOrEqual(1);
    const statuses = SB79_STATUSES.reduce((n, st) => n + counts[`policy.sb79.${st}`], 0);
    expect(statuses).toBe(pol.count);
    expect(counts['policy.sb79.tod_share']).toBe(
      Math.round((1e4 * pol.todBand.filter((b) => b > 0).length) / pol.count)
    );
    // No MUNI_TIER2_STOP_IDS id is in the mini network (m1-m3 are plain bus stops, mini README).
    expect(buildCounts['quality.sd.sb79.tier2-unmatched.fired']).toBe(MUNI_TIER2_STOP_IDS.size);
    expect(buildCounts['quality.sd.sb79.tier2-unmatched.of']).toBe(MUNI_TIER2_STOP_IDS.size);
    expect(buildCounts['quality.sd.sb79.zone-unlisted.fired']).toBe(0);
    expect(buildCounts['quality.sd.sb79.zone-unlisted.of']).toBe(
      pol.todBand.filter((b) => b > 0).length
    );
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
