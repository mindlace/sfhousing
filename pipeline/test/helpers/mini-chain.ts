// Shared test setup on the mini fixture: the build's step chain (SQL, scenario with the fixture
// freeway-land catalog, neighbourhoods, transit, policy) the way policy-step.test.ts runs it.
// Memoised per test file, like miniDuck.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ParcelRecord } from '../../../src/lib/data/parcel';
import type { PolicyParcels } from '../../../src/lib/data/policy-codec';
import type { ScenarioParcels } from '../../../src/lib/data/scenario-codec';
import { decodeTransit } from '../../../src/lib/data/transit-codec';
import type { TransitNetwork } from '../../../src/lib/data/transit';
import type { Day } from '../../../src/lib/timelapse/time';
import { FREEWAY_LAND_JSON } from '../../config';
import type { Duck } from '../../lib/duck';
import { readFreewayLand } from '../../lib/freeway-land';
import { readLock } from '../../lib/lock';
import { Report } from '../../lib/report';
import { POLICY_BIN } from '../../lib/scenario-files';
import { runSql } from '../../lib/sql';
import { asOfFromLock } from '../../project-records/parse';
import { readParcelRecords, writeNeighborhoods } from '../../steps/chunks';
import { readPolicyBin, writePolicy } from '../../steps/policy';
import { PARCELS_BIN, readParcelsBin, writeScenario } from '../../steps/scenario';
import { transitTargetDate, writeTransit } from '../../steps/transit';
import { MINI, miniDuck } from '../helpers';

export interface MiniChain {
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

let memo: Promise<MiniChain> | undefined;

/**
 * The mini database after runSql, the scenario step, neighbourhoods, the transit step and the
 * policy step (outputs in `outDir`). Memoised.
 */
export function miniChain(): Promise<MiniChain> {
  memo ??= (async () => {
    const db = await miniDuck();
    await runSql(db);
    const records = await readParcelRecords(db);
    const lock = readLock(join(MINI, 'sources.lock.json'));
    const capDay = asOfFromLock(lock);
    const root = mkdtempSync(join(tmpdir(), 'sfh-mini-chain-'));
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
      freewayLand: readFreewayLand(FREEWAY_LAND_JSON.fixture)
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
    const parcels = readParcelsBin(join(outDir, PARCELS_BIN));
    const policy = readPolicyBin(join(outDir, POLICY_BIN), parcels);
    const transit = decodeTransit(JSON.parse(readFileSync(join(outDir, 'transit.json'), 'utf8')));
    const counts = { ...buildCounts, ...scenario.counts, ...policyStep.counts };
    return { db, outDir, derivedDir, records, capDay, parcels, policy, transit, counts };
  })();
  return memo;
}
