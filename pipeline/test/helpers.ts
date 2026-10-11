import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDuck, type Duck } from '../lib/duck';
import { readLock, verifyRaw } from '../lib/lock';
import { loadNormalised, normaliseAll } from '../sources/normalise';

export const MINI = 'pipeline/test/fixtures/mini';

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
