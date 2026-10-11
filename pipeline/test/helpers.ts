import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDuck, type Duck } from '../lib/duck';
import { readLock, sha256File } from '../lib/lock';
import { loadNormalised, normalise, SOURCE_IDS } from '../sources/normalise';

export const MINI = 'pipeline/test/fixtures/mini';

let memo: Promise<Duck> | undefined;

/** openDuck + normalise every mini source into a temp norm dir + loadNormalised (memoised per file). */
export function miniDuck(): Promise<Duck> {
  memo ??= (async () => {
    const lock = readLock(path.join(MINI, 'sources.lock.json'));
    const rawDir = path.join(MINI, 'raw');
    // Raw files are read by name, but still verified against the lock's sha256.
    for (const e of lock.sources) {
      for (const f of e.files) {
        if ((await sha256File(path.join(rawDir, f.name))) !== f.sha256) {
          throw new Error(`mini fixture out of date: ${f.name} (re-run make-fixture.ts)`);
        }
      }
    }
    const normDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-mini-norm-'));
    const db = await openDuck();
    for (const id of SOURCE_IDS) {
      const entry = lock.sources.find((s) => s.id === id);
      if (!entry) throw new Error(`mini lock has no entry for ${id}`);
      const files = entry.files.map((f) => path.resolve(rawDir, f.name));
      await normalise(db, id, files, path.join(normDir, `${id}.parquet`));
    }
    await loadNormalised(db, normDir);
    return db;
  })();
  return memo;
}
