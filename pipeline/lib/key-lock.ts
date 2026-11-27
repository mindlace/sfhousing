import { linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { tempSibling } from './atomic.js';

export interface LockHolder {
  pid: number;
  host: string;
  startedAt: string;
}

export interface KeyLockDeps {
  /** Default: a setTimeout promise. */
  sleep?: (ms: number) => Promise<void>;
  /** Default: process.kill(pid, 0); ESRCH = dead. */
  isAlive?: (pid: number) => boolean;
  /** Default: os.hostname(). */
  host?: string;
  /** Default 5000. */
  pollMs?: number;
  /** Called once, on the first wait. */
  onWait?: (holder: LockHolder) => void;
  /** Test seam: read the lock file's text. Default: readFileSync utf8. */
  readLockFile?: (path: string) => string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** The holder; 'gone' when the file vanished before the read; null when unparsable. */
function readHolder(lockFile: string, read: (p: string) => string): LockHolder | null | 'gone' {
  try {
    const h = JSON.parse(read(lockFile)) as Partial<LockHolder> | null;
    if (h && typeof h.pid === 'number' && typeof h.host === 'string') {
      return { pid: h.pid, host: h.host, startedAt: String(h.startedAt ?? '') };
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'gone';
    // unreadable or unparsable: stale
  }
  return null;
}

/**
 * Run `fn` holding an exclusive lock file. The lock is linked into place from a temp file, so
 * it is never half-written. A holder on this host whose pid is dead, or an unparsable lock, is
 * stale and removed. Known limit: two waiters breaking the same stale lock at once can both
 * proceed.
 */
export async function withKeyLock<T>(
  lockFile: string,
  fn: () => Promise<T>,
  deps: KeyLockDeps = {}
): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  const isAlive = deps.isAlive ?? defaultIsAlive;
  const host = deps.host ?? hostname();
  const pollMs = deps.pollMs ?? 5000;
  const mine: LockHolder = { pid: process.pid, host, startedAt: new Date().toISOString() };
  const read = deps.readLockFile ?? ((p: string) => readFileSync(p, 'utf8'));
  mkdirSync(dirname(lockFile), { recursive: true });
  const tmp = tempSibling(lockFile);
  writeFileSync(tmp, JSON.stringify(mine));
  try {
    let waited = false;
    for (;;) {
      try {
        linkSync(tmp, lockFile);
        break;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      }
      const holder = readHolder(lockFile, read);
      // Released since the failed link: retry now; unlinking could delete a new holder's lock.
      if (holder === 'gone') continue;
      if (holder === null || (holder.host === host && !isAlive(holder.pid))) {
        rmSync(lockFile, { force: true });
        continue;
      }
      if (!waited) {
        waited = true;
        deps.onWait?.(holder);
      }
      await sleep(pollMs);
    }
  } finally {
    rmSync(tmp, { force: true });
  }
  try {
    return await fn();
  } finally {
    rmSync(lockFile, { force: true });
  }
}
