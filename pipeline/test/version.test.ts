import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATASET_VERSION_RE } from '../../src/lib/data/manifest';
import { TOOL_VERSIONS } from '../config';
import {
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
    ['src/lib/sim/scenario', 'src/lib/sim/scenario/engine.ts'],
    ['src/lib/sim/levers', 'src/lib/sim/levers/apply.ts'],
    ['src/lib/scoreboard', 'src/lib/scoreboard/index.ts']
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
  it('does not cover other sim code', async () => {
    const { dir, git } = tempRepo();
    const clean = await codeTreeHash(dir);
    writeFileSync(join(dir, 'src/lib/sim/other/x.ts'), 'export const x = 10;\n');
    git('commit', '-q', '-am', 'other sim');
    expect(await codeTreeHash(dir)).toBe(clean);
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
