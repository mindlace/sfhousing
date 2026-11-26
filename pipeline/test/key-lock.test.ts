import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withKeyLock, type LockHolder } from '../lib/key-lock.js';

let dir: string;
let lockFile: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'key-lock-'));
  lockFile = join(dir, 'k.lock');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const holder = (host: string): string =>
  JSON.stringify({ pid: 999999, host, startedAt: '2026-01-01T00:00:00.000Z' });

describe('withKeyLock', () => {
  it('runs fn under the lock and removes it', async () => {
    let during: unknown = null;
    const result = await withKeyLock(
      lockFile,
      async () => {
        during = JSON.parse(readFileSync(lockFile, 'utf8'));
        return 42;
      },
      { host: 'h', sleep: async () => {}, isAlive: () => true }
    );
    expect(result).toBe(42);
    expect(during).toMatchObject({ pid: process.pid, host: 'h' });
    expect(typeof (during as LockHolder).startedAt).toBe('string');
    expect(existsSync(lockFile)).toBe(false);
  });

  it('removes the lock when fn throws', async () => {
    const err = new Error('boom');
    await expect(
      withKeyLock(
        lockFile,
        async () => {
          throw err;
        },
        { host: 'h', sleep: async () => {} }
      )
    ).rejects.toBe(err);
    expect(existsSync(lockFile)).toBe(false);
  });

  it('waits for a live holder', async () => {
    writeFileSync(lockFile, holder('h'));
    const sleep = vi.fn(async () => {
      rmSync(lockFile, { force: true });
    });
    const onWait = vi.fn();
    const fn = vi.fn(async () => 'ok');
    await withKeyLock(lockFile, fn, {
      host: 'h',
      isAlive: () => true,
      sleep,
      onWait,
      pollMs: 123
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(123);
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(onWait).toHaveBeenCalledWith({
      pid: 999999,
      host: 'h',
      startedAt: '2026-01-01T00:00:00.000Z'
    });
  });

  it('breaks a lock whose holder is dead', async () => {
    writeFileSync(lockFile, holder('h'));
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => 'ok');
    await withKeyLock(lockFile, fn, { host: 'h', isAlive: () => false, sleep });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('breaks an unparsable lock', async () => {
    writeFileSync(lockFile, 'x');
    const sleep = vi.fn(async () => {});
    const fn = vi.fn(async () => 'ok');
    await withKeyLock(lockFile, fn, { host: 'h', isAlive: () => true, sleep });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('never breaks a holder on another host', async () => {
    writeFileSync(lockFile, holder('other'));
    let calls = 0;
    const sleep = vi.fn(async () => {
      calls++;
      if (calls === 2) rmSync(lockFile, { force: true });
    });
    const onWait = vi.fn();
    const fn = vi.fn(async () => 'ok');
    await withKeyLock(lockFile, fn, { host: 'h', isAlive: () => false, sleep, onWait });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
