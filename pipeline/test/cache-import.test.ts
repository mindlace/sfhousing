import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { boxesKey, readBoxesIndex } from '../lib/boxes-index.js';
import { localCacheNotice, sharedCache, type SharedCache } from '../lib/cache-root.js';
import { BOXES_FILES, boxesUpstreamVersion, type BoxesInputs } from '../lib/lidar/artifact.js';
import { canonicalJson, type LockEntry } from '../lib/lock.js';
import { cacheImport } from '../steps/cache-import.js';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const put = (p: string, data = 'x'): void => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
};

let dir: string;
let wt: string;
let from: string;
let lockPath: string;
let shared: SharedCache;
let out: string[];
let err: string[];

const inputs: BoxesInputs = {
  schema: 1,
  code: sha('code'),
  config: sha('config'),
  sources: { 'overture-buildings': sha('ob') }
};
const inputsText = canonicalJson(inputs) + '\n';
const bodies: [string, string][] = [
  [BOXES_FILES.inputs, inputsText],
  [BOXES_FILES.boxes, 'boxes body'],
  [BOXES_FILES.roofs, 'boxes meta']
];

function entryFor(upstreamVersion = boxesUpstreamVersion(inputs)): LockEntry {
  const files = bodies.map(([name, body]) => ({
    url: `file://${name}`,
    sha256: sha(body),
    bytes: body.length,
    archiveKey: `sources/${sha(body)}`,
    name
  }));
  return {
    id: 'building-boxes',
    files,
    retrievedAt: '2026-01-01T00:00:00Z',
    upstreamVersion,
    rowCount: 1,
    license: 'ODbL',
    homepage: 'https://example.test'
  };
}

function setUp(opts: { withBad?: boolean; upstreamVersion?: string } = {}): LockEntry {
  const raw = join(from, 'raw');
  put(join(raw, sha('A')), 'A');
  put(join(raw, sha('B')), 'B');
  const entry = entryFor(opts.upstreamVersion);
  for (const [, body] of bodies) put(join(raw, sha(body)), body);
  if (opts.withBad) {
    put(join(raw, sha('not C')), 'C');
    put(join(raw, 'x.part'), 'partial');
  }
  put(join(shared.raw, sha('A')), 'A');
  put(join(from, 'ept/ept.json'), '{}');
  put(join(from, 'ept/n/0-0-0-0.laz'), 'laz');
  put(join(shared.ept, 'n/0-0-0-0.laz'), 'laz');
  put(join(from, 'ept/h/0-0-0-0.json'), '{}');
  put(join(from, 'lidar-work/abcd1234/0_0/tile.json'), '{}');
  mkdirSync(join(from, 'lidar-work/abcd1234/.1_1.tmp'), { recursive: true });
  put(join(from, 'derived/v/x'));
  put(join(from, 'lidar-venv/bin/python'));
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify({ sources: [entry] }));
  return entry;
}

const run = (o: { from?: string } = {}) =>
  cacheImport({
    from: o.from ?? from,
    to: shared,
    lockPath,
    out: (l) => out.push(l),
    err: (l) => err.push(l)
  });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cache-import-'));
  wt = join(dir, 'wt');
  from = join(wt, 'pipeline/.cache');
  lockPath = join(wt, 'pipeline/sources.lock.json');
  mkdirSync(from, { recursive: true });
  shared = sharedCache(join(dir, 'shared'));
  out = [];
  err = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('cache import', () => {
  it('moves the shared dirs and leaves the worktree dirs', async () => {
    const entry = setUp({ withBad: true });
    const { code, report } = await run();
    expect(code).toBe(1);
    expect(existsSync(join(shared.raw, sha('B')))).toBe(true);
    for (const f of entry.files) expect(existsSync(join(shared.raw, f.sha256))).toBe(true);
    expect(existsSync(join(shared.ept, 'ept.json'))).toBe(true);
    expect(existsSync(join(shared.ept, 'h/0-0-0-0.json'))).toBe(true);
    expect(existsSync(join(shared.lidarWork, 'abcd1234/0_0/tile.json'))).toBe(true);
    expect(existsSync(join(from, 'raw', sha('A')))).toBe(false);
    expect(existsSync(join(from, 'ept/n/0-0-0-0.laz'))).toBe(false);
    expect(existsSync(join(from, 'raw', sha('not C')))).toBe(true);
    expect(existsSync(join(from, 'raw/x.part'))).toBe(true);
    expect(existsSync(join(from, 'derived/v/x'))).toBe(true);
    expect(existsSync(join(from, 'lidar-venv/bin/python'))).toBe(true);
    expect(report.raw).toEqual({
      moved: 4,
      duplicate: 1,
      mismatched: [sha('not C')],
      left: ['x.part']
    });
    expect(report.ept).toEqual({ moved: 2, duplicate: 1 });
    expect(report.lidarWork).toEqual({ moved: 1, duplicate: 0, partial: 1 });
    expect(err.join('\n')).toContain(sha('not C'));
    expect(out).toContain('raw: 4 moved, 1 already shared, 1 mismatched, 1 left');
    expect(out).toContain('ept: 2 moved, 1 already shared');
    expect(out).toContain('lidar-work: 1 moved, 0 already shared, 1 partial removed');
  });

  it("indexes the old worktree's boxes artifact", async () => {
    const entry = setUp();
    const { report } = await run();
    const key = sha(inputsText);
    expect(report.boxesIndex).toBe(key);
    expect(readBoxesIndex(shared.boxesIndex, key)!.entry).toEqual(entry);
    expect(boxesKey(inputs)).toBe(key);
    expect(out).toContain(`boxes-index: wrote ${key}`);
  });

  it('is idempotent and silences the notice', async () => {
    setUp();
    expect((await run()).code).toBe(0);
    out.length = 0;
    const second = await run();
    const key = sha(inputsText);
    expect(second.code).toBe(0);
    expect(second.report.raw).toEqual({ moved: 0, duplicate: 0, mismatched: [], left: [] });
    expect(second.report.ept).toEqual({ moved: 0, duplicate: 0 });
    expect(second.report.lidarWork).toEqual({ moved: 0, duplicate: 0, partial: 0 });
    expect(out).toContain(`boxes-index: ${key} already indexed`);
    expect(localCacheNotice(from, shared.root)).toBeNull();
    for (const d of ['raw', 'ept', 'lidar-work']) expect(existsSync(join(from, d))).toBe(false);
  });

  it('skips the index when the artifact does not check out', async () => {
    setUp({ upstreamVersion: boxesUpstreamVersion({ ...inputs, code: sha('other') }) });
    const { report } = await run();
    expect(report.boxesIndex).toBeNull();
    expect(readBoxesIndex(shared.boxesIndex, sha(inputsText))).toBeNull();
    expect(out.some((l) => l.startsWith('boxes-index: ') && !l.includes('wrote'))).toBe(true);
  });

  it('says so when the lock has no building-boxes entry', async () => {
    setUp();
    writeFileSync(lockPath, JSON.stringify({ sources: [] }));
    const { report } = await run();
    expect(report.boxesIndex).toBeNull();
    expect(out).toContain(`boxes-index: no building-boxes entry in ${lockPath}`);
  });

  it('refuses the shared root itself', async () => {
    put(join(shared.raw, sha('A')), 'A');
    for (const f of [shared.root, shared.raw]) {
      expect((await run({ from: f })).code).toBe(2);
    }
    expect(readFileSync(join(shared.raw, sha('A')), 'utf8')).toBe('A');
    expect((await run({ from: join(dir, 'missing') })).code).toBe(2);
  });

  it('refuses a from that aliases the shared cache', async () => {
    put(join(shared.raw, sha('A')), 'A');
    put(join(shared.ept, 'ept.json'), '{}');
    const alias = join(dir, 'alias');
    symlinkSync(shared.root, alias);
    expect((await run({ from: alias })).code).toBe(2);
    expect(existsSync(join(shared.raw, sha('A')))).toBe(true);
    expect(existsSync(join(shared.ept, 'ept.json'))).toBe(true);
  });

  it.each([
    ['raw', (s: SharedCache) => s.raw, sha('A')],
    ['ept', (s: SharedCache) => s.ept, 'ept.json']
  ])('refuses a symlinked %s that is the shared one', async (d, pick, file) => {
    put(join(pick(shared), file), 'A');
    symlinkSync(pick(shared), join(from, d));
    const r = await run();
    expect(r.code).toBe(2);
    expect(existsSync(join(pick(shared), file))).toBe(true);
  });
});
