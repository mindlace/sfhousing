// Shared /lesscars test setup on the mini fixture: the build's step chain (SQL, scenario, transit,
// policy) the way policy-step.test.ts runs it, then the mini plan's freed land carved into lc_site.
// Memoised per test file, like miniDuck.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParcelRecord } from '../../src/lib/data/parcel';
import type { PolicyParcels } from '../../src/lib/data/policy-codec';
import type { ScenarioParcels } from '../../src/lib/data/scenario-codec';
import { decodeTransit } from '../../src/lib/data/transit-codec';
import type { TransitNetwork } from '../../src/lib/data/transit';
import { parseLessCarsPlan, type LessCarsPlan } from '../../src/lib/data/lesscars/plan';
import type { Day } from '../../src/lib/timelapse/time';
import type { Duck } from '../lib/duck';
import { readLock } from '../lib/lock';
import { Report } from '../lib/report';
import { POLICY_BIN } from '../lib/scenario-files';
import { runSql } from '../lib/sql';
import { LESSCARS_FREEWAY_LAND_JSON, LESSCARS_PLAN_JSON } from '../lesscars-config';
import { readFreewayLand } from '../lib/lesscars/freeway-land';
import { readRoadLotRows } from '../lib/road-lots';
import { asOfFromLock } from '../project-records/parse';
import { readParcelRecords, writeNeighborhoods } from '../steps/chunks';
import { carveFreedLand, notNeighboursOf, removalsOf } from '../steps/lesscars-sql';
import { readPolicyBin, writePolicy } from '../steps/policy';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../steps/scenario';
import { transitTargetDate, writeTransit } from '../steps/transit';
import { MINI, miniDuck } from './helpers';

export interface LessCarsMini {
  db: Duck;
  outDir: string;
  /** The scenario step's derived directory (parcel-panel.parquet, road-lots.csv). */
  derivedDir: string;
  records: { rec: ParcelRecord; cellId: string }[];
  capDay: Day;
  parcels: ScenarioParcels;
  policy: PolicyParcels;
  transit: TransitNetwork;
  /** The build counts: the scenario step's (returned) and every buildCounts owner's. */
  counts: Record<string, number>;
}

/** The mini plan (`pipeline/test/fixtures/mini/enrichment/lesscars-plan.json`), parsed. */
export function miniLessCarsPlan(): LessCarsPlan {
  return parseLessCarsPlan(JSON.parse(readFileSync(LESSCARS_PLAN_JSON.fixture, 'utf8')));
}

/**
 * Carve the mini plan's freed land with the fixture catalog and the road-like lots (road_lots, the
 * records' `roadLike`), as writeLessCars does.
 */
export async function carveMini(db: Duck): Promise<void> {
  const removed = removalsOf(miniLessCarsPlan());
  const catalog = readFreewayLand(LESSCARS_FREEWAY_LAND_JSON.fixture);
  const roadLike = (await readRoadLotRows(db)).keys();
  return carveFreedLand(db, removed, notNeighboursOf(catalog, removed, roadLike));
}

let memo: Promise<LessCarsMini> | undefined;

/**
 * The mini database after runSql, the scenario step, neighbourhoods, the transit step and the
 * policy step (outputs in `outDir`), with the mini plan's freed land in lc_site and
 * lc_site_neighbour. Memoised: callers that re-carve must carve the mini plan again afterwards.
 */
export function lesscarsMini(): Promise<LessCarsMini> {
  memo ??= (async () => {
    const db = await miniDuck();
    await runSql(db);
    const records = await readParcelRecords(db);
    const lock = readLock(join(MINI, 'sources.lock.json'));
    const capDay = asOfFromLock(lock);
    const root = mkdtempSync(join(tmpdir(), 'sfh-lesscars-'));
    const outDir = join(root, 'out');
    const derivedDir = join(root, 'derived');
    const buildCounts: Record<string, number> = {};
    const scenario = await writeScenario({
      db,
      outDir,
      derivedDir,
      datasetVersion: 'fixture-0',
      records,
      capDay,
      report: new Report(),
      buildCounts,
      freewayLand: readFreewayLand(LESSCARS_FREEWAY_LAND_JSON.fixture)
    });
    await writeNeighborhoods(db, outDir);
    writeTransit({
      lock,
      rawDir: join(MINI, 'raw'),
      byName: true,
      outDir,
      targetDate: transitTargetDate(lock),
      strict: false
    });
    const policyStep = await writePolicy({
      db,
      outDir,
      datasetVersion: 'fixture-0',
      records,
      capDay,
      buildCounts
    });
    await carveMini(db);
    const parcels = readParcelsBin(join(outDir, PARCELS_BIN));
    const policy = readPolicyBin(join(outDir, POLICY_BIN), parcels);
    const transit = decodeTransit(JSON.parse(readFileSync(join(outDir, 'transit.json'), 'utf8')));
    const counts = { ...buildCounts, ...scenario.counts, ...policyStep.counts };
    return { db, outDir, derivedDir, records, capDay, parcels, policy, transit, counts };
  })();
  return memo;
}
