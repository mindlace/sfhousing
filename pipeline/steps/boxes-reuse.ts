import { existsSync } from 'node:fs';
import {
  boxesKey,
  inputsFileOf,
  lockFileFor,
  reusableEntry,
  writeBoxesIndex
} from '../lib/boxes-index.js';
import { withKeyLock, type KeyLockDeps } from '../lib/key-lock.js';
import { BOXES_ID, boxesInputsOf } from '../lib/lidar/artifact.js';
import { readLock, verifyRaw, writeLock } from '../lib/lock.js';
import { boxesCodeHash } from '../lib/version.js';
import { readLidarLock } from '../sources/lidar.js';
import { boxesCommand, type BoxesCommandOpts } from './boxes.js';

export interface BoxesReuseOpts extends BoxesCommandOpts {
  /** null: no skip and no index (the --fixture run). */
  indexDir: string | null;
  /** --force: run in full, then rewrite the index record. */
  force?: boolean;
  lockDeps?: KeyLockDeps;
}

/**
 * boxesCommand, skipped when an earlier run with the same code, config and inputs left its
 * files in raw: the lock entry is restored from the index and nothing is derived.
 */
export async function boxesReusing(
  o: BoxesReuseOpts,
  run: (o: BoxesCommandOpts) => Promise<number> = boxesCommand
): Promise<number> {
  const { indexDir, force, lockDeps, ...cmd } = o;
  if (indexDir === null || !existsSync(o.lockPath)) return run(cmd);
  const out = o.out ?? ((l: string) => console.log(l));
  const lock = readLock(o.lockPath);
  const lidarLock = readLidarLock(o.lidarLockPath);
  const main = { sources: lock.sources.filter((s) => s.id !== BOXES_ID) };
  const bad = await verifyRaw(main, o.rawDir, { byName: o.byName });
  const badLidar = lidarLock ? await verifyRaw(lidarLock, o.rawDir, { byName: o.byName }) : [];
  // Let the command print its usual errors.
  if (bad.length + badLidar.length > 0) return run(cmd);

  const key = boxesKey(boxesInputsOf(lock, lidarLock, await boxesCodeHash(o.repoRoot)));
  return withKeyLock(
    lockFileFor(indexDir, key),
    async () => {
      if (!force) {
        const entry = await reusableEntry(indexDir, key, o.rawDir, o.byName);
        if (entry) {
          // The lock may have changed while waiting; keep its other entries.
          const now = readLock(o.lockPath);
          writeLock(o.lockPath, {
            sources: [...now.sources.filter((s) => s.id !== BOXES_ID), entry]
          });
          out(`boxes: reused ${key}`);
          return 0;
        }
      }
      const code = await run(cmd);
      if (code !== 0) return code;
      const entry = readLock(o.lockPath).sources.find((s) => s.id === BOXES_ID);
      if (!entry) return code;
      const sha = inputsFileOf(entry).sha256;
      if (sha === key) writeBoxesIndex(indexDir, key, entry);
      else out(`boxes: not indexed: the run's inputs ${sha} are not ${key}`);
      return code;
    },
    {
      ...lockDeps,
      onWait: (h) => out(`boxes: waiting for pid ${h.pid} on ${h.host} (${key.slice(0, 12)})`)
    }
  );
}
