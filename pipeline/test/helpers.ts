import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDuck, type Duck } from '../lib/duck';
import { readLock, verifyRaw } from '../lib/lock';
import { loadNormalised, normaliseAll } from '../sources/normalise';

export const MINI = 'pipeline/test/fixtures/mini';

/**
 * scenario.* report counts superseded by T14 counts (scenario-data spec §4.10 "Superseded by T14
 * counts"): no build may write them.
 */
export const SUPERSEDED_SCENARIO_COUNTS = [
  'scenario.roll.stories_implausible',
  'scenario.roll.units_implausible',
  'scenario.density_cap.rule.split',
  'scenario.density_cap.rule.split_hostable',
  'scenario.density_cap.rule.generic_nc',
  'scenario.density_cap.rule.generic_nc_hostable',
  'scenario.yield.nonmonotone',
  'scenario.yield.zero_hostable_eligible'
];

let memo: Promise<Duck> | undefined;

/** openDuck + normalise every mini source into a temp norm dir + loadNormalised (memoised per file). */
export function miniDuck(): Promise<Duck> {
  memo ??= (async () => {
    const lock = readLock(path.join(MINI, 'sources.lock.json'));
    const rawDir = path.join(MINI, 'raw');
    // Raw files are read by name, but still verified against the lock's sha256 (as `build` does).
    const bad = await verifyRaw(lock, rawDir, { byName: true });
    if (bad.length > 0) {
      throw new Error(`mini fixture out of date (re-run make-fixture.ts): ${bad.join('; ')}`);
    }
    const normDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-mini-norm-'));
    const db = await openDuck();
    await normaliseAll(db, lock, rawDir, normDir, { byName: true });
    await loadNormalised(db, normDir);
    return db;
  })();
  return memo;
}
