import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATASET_VERSION_RE } from '../../src/lib/data/manifest';
import { TOOL_VERSIONS } from '../config';
import {
  BOXES_CODE_PATHS,
  boxesCodeHash,
  codePathsDirty,
  codeTreeHash,
  computeDatasetVersion,
  treeDatasetVersion
} from '../lib/version';
import { lock, tempRepo, writeLock } from './helpers/temp-repo';

const tools = { tippecanoe: '2.79.0', pmtiles: '1.31.2' };

describe('computeDatasetVersion', () => {
  it('is stable, dated by newest retrievedAt (UTC), and matches DATASET_VERSION_RE', () => {
    const a = computeDatasetVersion({ lock: lock(), codeHash: 'c1', toolVersions: tools });
    expect(a).toBe(
      computeDatasetVersion({
        lock: lock(),
        codeHash: 'c1',
        toolVersions: { pmtiles: '1.31.2', tippecanoe: '2.79.0' }
      })
    );
    expect(a).toMatch(DATASET_VERSION_RE);
    expect(a.startsWith('2026-10-10-')).toBe(true);
  });
  it('changes when any sha, the code hash or a tool version changes', () => {
    const base = computeDatasetVersion({ lock: lock(), codeHash: 'c1', toolVersions: tools });
    const l = lock();
    l.sources[0].files[0].sha256 = 'c'.repeat(64);
    expect(computeDatasetVersion({ lock: l, codeHash: 'c1', toolVersions: tools })).not.toBe(base);
    expect(computeDatasetVersion({ lock: lock(), codeHash: 'c2', toolVersions: tools })).not.toBe(
      base
    );
    expect(
      computeDatasetVersion({
        lock: lock(),
        codeHash: 'c1',
        toolVersions: { ...tools, tippecanoe: '2.80.0' }
      })
    ).not.toBe(base);
  });
});

describe('codeTreeHash', () => {
  it('returns a non-empty stable string for the current repo', async () => {
    const root = process.cwd();
    const a = await codeTreeHash(root);
    const b = await codeTreeHash(root);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toBe(b);
  });

  it('is identical whether the lock is untracked or committed', async () => {
    const { dir, git } = tempRepo();
    const before = await codeTreeHash(dir);
    writeFileSync(join(dir, 'pipeline/sources.lock.json'), '{"sources":[]}\n');
    const untracked = await codeTreeHash(dir);
    git('add', 'pipeline/sources.lock.json');
    git('commit', '-q', '-m', 'lock');
    const committed = await codeTreeHash(dir);
    expect(untracked).toBe(before);
    expect(committed).toBe(before);
  });
  it('changes with an uncommitted code change, and with a committed one', async () => {
    const { dir, git } = tempRepo();
    const clean = await codeTreeHash(dir);
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 3;\n');
    const dirty = await codeTreeHash(dir);
    expect(dirty).not.toBe(clean);
    git('commit', '-q', '-am', 'change');
    const committed = await codeTreeHash(dir);
    expect(committed).not.toBe(clean);
    expect(committed).not.toBe(dirty);
  });
  it('covers src/lib/plan/geometry.ts, the shared projection, but no other plan code', async () => {
    const { dir, git } = tempRepo();
    const clean = await codeTreeHash(dir);
    writeFileSync(join(dir, 'src/lib/plan/other.ts'), 'export const o = 5;\n');
    git('commit', '-q', '-am', 'other');
    expect(await codeTreeHash(dir)).toBe(clean);
    writeFileSync(join(dir, 'src/lib/plan/geometry.ts'), 'export const g = 6;\n');
    git('commit', '-q', '-am', 'geometry');
    expect(await codeTreeHash(dir)).not.toBe(clean);
  });
  it.each([
    ['src/lib/generator', 'src/lib/generator/gen.ts'],
    ['src/lib/timelapse', 'src/lib/timelapse/time.ts'],
    ['src/lib/plan/types.ts', 'src/lib/plan/types.ts'],
    ['src/lib/config.ts', 'src/lib/config.ts'],
    ['src/lib/sim/finance', 'src/lib/sim/finance/prototypes.ts']
  ])('codeTreeHash changes when a file under %s changes', async (_label, file) => {
    const { dir, git } = tempRepo();
    const clean = await codeTreeHash(dir);
    writeFileSync(join(dir, file), 'export const changed = 1;\n');
    const dirty = await codeTreeHash(dir);
    expect(dirty).not.toBe(clean);
    git('commit', '-q', '-am', 'change');
    const committed = await codeTreeHash(dir);
    expect(committed).not.toBe(clean);
    expect(committed).not.toBe(dirty);
  });
  it.each([
    'src/lib/sim/world/rules/stages.ts',
    'src/lib/sim/levers/apply.ts',
    'src/lib/scoreboard/index.ts'
  ])('codeTreeHash ignores a change to %s', async (file) => {
    const { dir, git } = tempRepo();
    const clean = await codeTreeHash(dir);
    writeFileSync(join(dir, file), 'export const changed = 1;\n');
    git('commit', '-q', '-am', 'change');
    expect(await codeTreeHash(dir)).toBe(clean);
  });
  it('codeTreeHash covers src/lib/sim/world/rules/rng.ts', async () => {
    const { dir, git } = tempRepo();
    mkdirSync(join(dir, 'src/lib/sim/world/rules'), { recursive: true });
    writeFileSync(join(dir, 'src/lib/sim/world/rules/rng.ts'), 'export const r = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'rng');
    const before = await codeTreeHash(dir);
    writeFileSync(join(dir, 'src/lib/sim/world/rules/rng.ts'), 'export const r = 2;\n');
    git('commit', '-q', '-am', 'rng 2');
    expect(await codeTreeHash(dir)).not.toBe(before);
  });
  it('codeTreeHash ignores pipeline/test, committed and uncommitted', async () => {
    const { dir, git } = tempRepo();
    const clean = await codeTreeHash(dir);
    mkdirSync(join(dir, 'pipeline/test/helpers'), { recursive: true });
    writeFileSync(join(dir, 'pipeline/test/helpers/t.ts'), 'export const t = 1;\n');
    expect(await codeTreeHash(dir)).toBe(clean);
    git('add', '.');
    git('commit', '-q', '-m', 'test file');
    expect(await codeTreeHash(dir)).toBe(clean);
    writeFileSync(join(dir, 'pipeline/test/helpers/t.ts'), 'export const t = 2;\n');
    expect(await codeTreeHash(dir)).toBe(clean);
    git('commit', '-q', '-am', 'test file 2');
    expect(await codeTreeHash(dir)).toBe(clean);
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 2;\n');
    expect(await codeTreeHash(dir)).not.toBe(clean);
  });
  it('codeTreeHash covers pipeline/lib', async () => {
    const { dir, git } = tempRepo();
    mkdirSync(join(dir, 'pipeline/lib'), { recursive: true });
    writeFileSync(join(dir, 'pipeline/lib/x.ts'), 'export const x = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'lib');
    const before = await codeTreeHash(dir);
    writeFileSync(join(dir, 'pipeline/lib/x.ts'), 'export const x = 2;\n');
    expect(await codeTreeHash(dir)).not.toBe(before);
    git('commit', '-q', '-am', 'lib 2');
    expect(await codeTreeHash(dir)).not.toBe(before);
  });
  it('does not cover other sim code', async () => {
    const { dir, git } = tempRepo();
    const clean = await codeTreeHash(dir);
    writeFileSync(join(dir, 'src/lib/sim/other/x.ts'), 'export const x = 10;\n');
    git('commit', '-q', '-am', 'other sim');
    expect(await codeTreeHash(dir)).toBe(clean);
  });
});

describe('treeHash refactor', () => {
  it('codeTreeHash is unchanged by the refactor', async () => {
    // Values computed with the pre-refactor codeTreeHash on this fixed temp repo state.
    const { dir } = tempRepo();
    expect(await codeTreeHash(dir)).toBe(
      '5a89e8309b76d99eb074bf2f03abdbabb2743b6eb8882c8250f39f0e287fc0fe'
    );
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(dir, 'pipeline/new.ts'), 'export const n = 1;\n');
    writeFileSync(join(dir, 'pipeline/sources.lock.json'), '{}\n');
    expect(await codeTreeHash(dir)).toBe(
      '5a89e8309b76d99eb074bf2f03abdbabb2743b6eb8882c8250f39f0e287fc0fe' +
        '33c7af423bbd34db2bd634dbdc009ffe7e642a922904ccaba46f44f58f2f53f2' +
        'e22445c7c5ef7b19b64996dfd7c78b39a0f9436fb265185ae056d4f7b93f51a2'
    );
  });
});

describe('boxesCodeHash', () => {
  it('covers the derivation modules the boxes command runs', () => {
    expect(BOXES_CODE_PATHS).toEqual([
      'pipeline/lib/lidar',
      'pipeline/steps/boxes.ts',
      'pipeline/boxes-config.ts',
      'pipeline/project-records/union-find.ts',
      'pipeline/lib/road-lots.ts',
      'pipeline/geom.ts'
    ]);
  });

  it('changes with an uncommitted edit under pipeline/lib/lidar and not with one under pipeline/sql', async () => {
    const { dir, git } = tempRepo();
    mkdirSync(join(dir, 'pipeline/lib/lidar'), { recursive: true });
    mkdirSync(join(dir, 'pipeline/sql'), { recursive: true });
    writeFileSync(join(dir, 'pipeline/lib/lidar/derive.ts'), 'export const d = 1;\n');
    writeFileSync(join(dir, 'pipeline/sql/50_clip.sql'), 'SELECT 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'boxes');
    const clean = await boxesCodeHash(dir);
    expect(clean).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(join(dir, 'pipeline/sql/50_clip.sql'), 'SELECT 2;\n');
    expect(await boxesCodeHash(dir)).toBe(clean);
    writeFileSync(join(dir, 'pipeline/lib/lidar/derive.ts'), 'export const d = 2;\n');
    const dirty = await boxesCodeHash(dir);
    expect(dirty).toMatch(/^[0-9a-f]{64}$/);
    expect(dirty).not.toBe(clean);
    writeFileSync(join(dir, 'pipeline/lib/lidar/derive.ts'), 'export const d = 1;\n');
    writeFileSync(join(dir, 'pipeline/lib/lidar/new.ts'), 'export const n = 1;\n');
    expect(await boxesCodeHash(dir)).not.toBe(clean);
  });
});

describe('treeDatasetVersion', () => {
  it('equals computeDatasetVersion over the repo lock, code hash and TOOL_VERSIONS', async () => {
    const { dir } = tempRepo();
    writeLock(dir);
    expect(await treeDatasetVersion(dir)).toBe(
      computeDatasetVersion({
        lock: lock(),
        codeHash: await codeTreeHash(dir),
        toolVersions: TOOL_VERSIONS
      })
    );
    expect(await treeDatasetVersion(dir)).toMatch(/^2026-10-10-[0-9a-f]{8}$/);
  });
  it('succeeds on a dirty tree and differs from the clean one', async () => {
    const { dir } = tempRepo();
    writeLock(dir);
    const clean = await treeDatasetVersion(dir);
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 2;\n');
    const dirty = await treeDatasetVersion(dir);
    expect(dirty).toMatch(DATASET_VERSION_RE);
    expect(dirty).not.toBe(clean);
  });
  it('throws naming the lock when it is missing', async () => {
    const { dir } = tempRepo();
    await expect(treeDatasetVersion(dir)).rejects.toThrow(/sources\.lock\.json/);
  });
});

describe('codePathsDirty', () => {
  it('is empty for a clean tree, an untracked lock, and changes outside the code paths', async () => {
    const { dir } = tempRepo();
    writeLock(dir);
    writeFileSync(join(dir, 'README.md'), 'x\n');
    expect(await codePathsDirty(dir)).toEqual([]);
  });
  it('lists a modified code file and an untracked one', async () => {
    const { dir } = tempRepo();
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(dir, 'src/lib/data/new.ts'), 'export {};\n');
    const lines = await codePathsDirty(dir);
    expect(lines.some((l) => l.endsWith('pipeline/a.ts'))).toBe(true);
    expect(lines.some((l) => l.endsWith('src/lib/data/new.ts'))).toBe(true);
  });
});
