import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boxesKey, lockFileFor, readBoxesIndex } from '../lib/boxes-index';
import { withKeyLock } from '../lib/key-lock';
import { BOXES_FILES, BOXES_ID, boxesInputsOf } from '../lib/lidar/artifact';
import { canonicalJson, readLock, writeLock, type LockEntry } from '../lib/lock';
import { boxesCodeHash } from '../lib/version';
import { readLidarLock } from '../sources/lidar';
import { boxesCommand, type BoxesCommandOpts } from '../steps/boxes';
import { boxesReusing } from '../steps/boxes-reuse';
import { MINI } from './helpers';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

type Setup = ReturnType<typeof setup>;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'sfh-boxes-reuse-'));
  dirs.push(dir);
  cpSync(join(MINI, 'sources.lock.json'), join(dir, 'sources.lock.json'));
  cpSync(join(MINI, 'lidar.lock.json'), join(dir, 'lidar.lock.json'));
  cpSync(join(MINI, 'raw'), join(dir, 'raw'), { recursive: true });
  const lockPath = join(dir, 'sources.lock.json');
  const strip = () => {
    const l = readLock(lockPath);
    writeLock(lockPath, { sources: l.sources.filter((s) => s.id !== BOXES_ID) });
  };
  strip();
  return {
    dir,
    lockPath,
    lidarLockPath: join(dir, 'lidar.lock.json'),
    rawDir: join(dir, 'raw'),
    indexDir: join(dir, 'index'),
    strip
  };
}

async function inputsOf(s: Setup, code?: string) {
  const lock = readLock(s.lockPath);
  const lidar = readLidarLock(s.lidarLockPath);
  return boxesInputsOf(lock, lidar, code ?? (await boxesCodeHash(process.cwd())));
}

/** A fake run that stores three small files and the lock entry; `code` moves the inputs. */
function fake(s: Setup, opts: { code?: string; exit?: number; gate?: Promise<void> } = {}) {
  const state = { calls: 0 };
  const run = async (o: BoxesCommandOpts): Promise<number> => {
    state.calls++;
    if (opts.gate) await opts.gate;
    if (opts.exit) return opts.exit;
    const lock = readLock(o.lockPath);
    const inputs = await inputsOf(s, opts.code);
    const dir = o.rawDir;
    mkdirSync(join(dir, BOXES_ID), { recursive: true });
    const contents: Record<string, string> = {
      [BOXES_FILES.boxes]: 'boxes-standin',
      [BOXES_FILES.roofs]: 'roofs-standin',
      [BOXES_FILES.inputs]: canonicalJson(inputs) + '\n'
    };
    const files = Object.entries(contents).map(([name, text]) => {
      writeFileSync(join(dir, name), text);
      const sha256 = createHash('sha256').update(text).digest('hex');
      return {
        url: `derived:${name}`,
        sha256,
        bytes: text.length,
        archiveKey: `k/${sha256}`,
        name
      };
    });
    const entry: LockEntry = {
      id: BOXES_ID,
      files,
      retrievedAt: new Date().toISOString(),
      upstreamVersion: 'fake',
      rowCount: 1,
      license: 'ODbL-1.0',
      homepage: 'https://example.org'
    };
    writeLock(o.lockPath, { sources: [...lock.sources.filter((x) => x.id !== BOXES_ID), entry] });
    return 0;
  };
  return { state, run };
}

function opts(s: Setup, out: string[], extra: object = {}) {
  return {
    lockPath: s.lockPath,
    lidarLockPath: s.lidarLockPath,
    rawDir: s.rawDir,
    byName: true,
    repoRoot: process.cwd(),
    fixture: true,
    indexDir: s.indexDir,
    out: (l: string) => out.push(l),
    err: () => {},
    ...extra
  };
}

describe('boxesReusing', () => {
  it('a miss runs in full and indexes the entry', async () => {
    const s = setup();
    const f = fake(s);
    expect(await boxesReusing(opts(s, []), f.run)).toBe(0);
    const key = boxesKey(await inputsOf(s));
    const entry = readLock(s.lockPath).sources.find((x) => x.id === BOXES_ID);
    expect(f.state.calls).toBe(1);
    expect(readBoxesIndex(s.indexDir, key)!.entry).toEqual(entry);
  });

  it('a hit restores the same lock without running', async () => {
    const s = setup();
    const f = fake(s);
    const out: string[] = [];
    await boxesReusing(opts(s, out), f.run);
    const saved = readFileSync(s.lockPath, 'utf8');
    s.strip();
    const key = boxesKey(await inputsOf(s));
    expect(await boxesReusing(opts(s, out), f.run)).toBe(0);
    expect(f.state.calls).toBe(1);
    expect(out).toContain(`boxes: reused ${key}`);
    expect(readFileSync(s.lockPath, 'utf8')).toBe(saved);
  });

  it('a probe goes straight to the command and leaves the lock bytes unchanged', async () => {
    const s = setup();
    const f = fake(s);
    await boxesReusing(opts(s, []), f.run);
    s.strip();
    const before = readFileSync(s.lockPath);
    const seen: BoxesCommandOpts[] = [];
    const probeRun = async (o: BoxesCommandOpts): Promise<number> => {
      seen.push(o);
      return 0;
    };
    const out: string[] = [];
    expect(await boxesReusing(opts(s, out, { probe: ['b1'] }), probeRun)).toBe(0);
    expect(seen.map((o) => o.probe)).toEqual([['b1']]);
    expect(out.some((l) => l.startsWith('boxes:'))).toBe(false);
    expect(readFileSync(s.lockPath).equals(before)).toBe(true);
  });

  it('--force runs in full', async () => {
    const s = setup();
    const f = fake(s);
    await boxesReusing(opts(s, []), f.run);
    s.strip();
    await boxesReusing(opts(s, [], { force: true }), f.run);
    expect(f.state.calls).toBe(2);
  });

  it('no indexDir: no skip, no index', async () => {
    const s = setup();
    const f = fake(s);
    await boxesReusing(opts(s, [], { indexDir: null }), f.run);
    s.strip();
    await boxesReusing(opts(s, [], { indexDir: null }), f.run);
    expect(f.state.calls).toBe(2);
    expect(existsSync(s.indexDir)).toBe(false);
  });

  it('missing raw file runs in full', async () => {
    const s = setup();
    const f = fake(s);
    await boxesReusing(opts(s, []), f.run);
    rmSync(join(s.rawDir, BOXES_FILES.boxes));
    s.strip();
    await boxesReusing(opts(s, []), f.run);
    expect(f.state.calls).toBe(2);
  });

  it('a failed run writes no index', async () => {
    const s = setup();
    const f = fake(s, { exit: 1 });
    expect(await boxesReusing(opts(s, []), f.run)).toBe(1);
    expect(readBoxesIndex(s.indexDir, boxesKey(await inputsOf(s)))).toBeNull();
  });

  it('a run whose inputs moved is not indexed', async () => {
    const s = setup();
    const f = fake(s, { code: 'f'.repeat(64) });
    const out: string[] = [];
    expect(await boxesReusing(opts(s, out), f.run)).toBe(0);
    expect(readBoxesIndex(s.indexDir, boxesKey(await inputsOf(s)))).toBeNull();
    expect(out.some((l) => l.startsWith('boxes: not indexed'))).toBe(true);
  });

  it('a second run for the same key waits, then reuses', async () => {
    const s = setup();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const f = fake(s, { gate });
    let finish!: () => void;
    const firstDone = new Promise<void>((r) => (finish = r));
    const out2: string[] = [];
    const first = boxesReusing(opts(s, []), f.run).finally(finish);
    // Let the first call take the key lock and reach the gate before the second starts.
    while (f.state.calls === 0) await new Promise((r) => setImmediate(r));
    const second = boxesReusing(
      opts(s, out2, {
        lockDeps: {
          sleep: () => {
            open();
            return firstDone;
          },
          isAlive: () => true
        }
      }),
      f.run
    );
    expect(await first).toBe(0);
    expect(await second).toBe(0);
    expect(f.state.calls).toBe(1);
    expect(out2.some((l) => l.startsWith('boxes: waiting for pid'))).toBe(true);
    expect(out2.some((l) => l.startsWith('boxes: reused'))).toBe(true);
  });

  it('a lock that changes while waiting is not reused', async () => {
    const s = setup();
    const oldKey = boxesKey(await inputsOf(s));
    // A record exists under the old key, so only the recomputed key keeps the second from reusing it.
    await boxesReusing(opts(s, []), fake(s).run);
    s.strip();
    const f = fake(s);
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    // Another process holds the old key's lock, then the lock file changes under the waiter.
    const holder = withKeyLock(lockFileFor(s.indexDir, oldKey), () => gate);
    const code = await boxesReusing(
      opts(s, [], {
        lockDeps: {
          sleep: async () => {
            const l = readLock(s.lockPath);
            l.sources.find((x) => x.id === 'datasf-parcels')!.files[0].sha256 = 'a'.repeat(64);
            writeLock(s.lockPath, l);
            open();
            await holder;
          },
          isAlive: () => true
        }
      }),
      f.run
    );
    expect(code).toBe(0);
    expect(f.state.calls).toBe(1);
    expect(readBoxesIndex(s.indexDir, oldKey)).not.toBeNull();
  });

  it('with the real derivation, a rerun is byte-identical', async () => {
    const s = setup();
    const out2: string[] = [];
    const real = (o: BoxesCommandOpts) => boxesCommand({ ...o, out: () => {} });
    expect(
      await boxesReusing(opts(s, [], { now: new Date('2026-11-01T00:00:00.000Z') }), real)
    ).toBe(0);
    const first = readFileSync(s.lockPath, 'utf8');
    s.strip();
    expect(
      await boxesReusing(opts(s, out2, { now: new Date('2026-11-02T00:00:00.000Z') }), real)
    ).toBe(0);
    expect(out2.some((l) => l.startsWith('boxes: reused'))).toBe(true);
    expect(readFileSync(s.lockPath, 'utf8')).toBe(first);
    expect(first).toContain('2026-11-01T00:00:00.000Z');
  }, 180_000);
});
