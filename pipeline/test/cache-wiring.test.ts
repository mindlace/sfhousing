import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sharedCache } from '../lib/cache-root';
import type { RunResult } from '../lib/exec';
import type { Lock } from '../lib/lock';
import type { R2Target } from '../lib/r2';
import { fetchAll } from '../steps/fetch';
import { fetchLidar, lidarUpstreamVersion } from '../sources/lidar';

const made: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'sfh-wiring-'));
  made.push(d);
  return d;
};

/** A fresh cache root per test, so one test's directories never satisfy another's check. */
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SFH_CACHE_DIR;
  process.env.SFH_CACHE_DIR = tmp();
});
afterEach(() => {
  if (saved === undefined) delete process.env.SFH_CACHE_DIR;
  else process.env.SFH_CACHE_DIR = saved;
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fake rasterizer that records its args and writes no tiles. */
function fakeRun() {
  const calls: string[][] = [];
  const run = async (_cmd: string, args: string[]): Promise<RunResult> => {
    calls.push(args);
    return { stdout: '', stderr: '', code: 0 };
  };
  return { run, calls };
}
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe('shared cache wiring', () => {
  it('fetch --restore without rawDir lands in the shared raw dir', async () => {
    const dir = tmp();
    const bytes = new TextEncoder().encode('raw bytes');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const lock: Lock = {
      sources: [
        {
          id: 'x',
          files: [
            {
              url: 'u',
              sha256: sha,
              bytes: bytes.length,
              archiveKey: `sources/${sha}.x`,
              name: 'x.json'
            }
          ],
          retrievedAt: 't',
          upstreamVersion: 'v',
          rowCount: 1,
          license: 'l',
          homepage: 'h'
        }
      ]
    };
    const lockPath = join(dir, 'sources.lock.json');
    const lidarLockPath = join(dir, 'lidar.lock.json');
    writeFileSync(lockPath, JSON.stringify(lock));
    writeFileSync(lidarLockPath, JSON.stringify({ sources: [] }));
    const r2: R2Target = {
      exists: async () => true,
      put: async () => {},
      get: async (_key, file) => {
        writeFileSync(file, bytes);
        return true;
      }
    };
    expect(await fetchAll({ lockPath, lidarLockPath, r2, restore: true })).toBe(0);
    expect(existsSync(join(process.env.SFH_CACHE_DIR!, 'raw', sha))).toBe(true);
  });

  it('fetchLidar defaults its work and EPT dirs to the shared cache', async () => {
    const { run, calls } = fakeRun();
    await fetchLidar(tmp(), { tiles: [[0, 0]], dryRun: true }, { run });
    const hash8 = createHash('sha256').update(lidarUpstreamVersion()).digest('hex').slice(0, 8);
    expect(after(calls[0], '--out')).toBe(join(sharedCache().lidarWork, hash8));
    expect(after(calls[0], '--cache')).toBe(sharedCache().ept);
  });

  it('an explicit eptDir wins', async () => {
    const { run, calls } = fakeRun();
    const eptDir = join(tmp(), 'my-ept');
    await fetchLidar(tmp(), { tiles: [[0, 0]], dryRun: true, eptDir }, { run });
    expect(after(calls[0], '--cache')).toBe(eptDir);
    expect(existsSync(eptDir)).toBe(true);
    expect(existsSync(sharedCache().ept)).toBe(false);
  });
});
