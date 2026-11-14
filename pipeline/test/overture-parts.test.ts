import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_PROFILE } from '../config';
import { readLock, writeLock, type Lock } from '../lib/lock';
import { overtureReleaseProblem } from '../sources/overture';
import { BuildError, build } from '../steps/build';
import { DEFAULT_FETCH_IDS, FETCH_IDS } from '../steps/fetch';
import { MINI } from './helpers';

const entry = (id: string, upstreamVersion: string) => ({
  id,
  files: [],
  retrievedAt: '2026-10-10T00:00:00.000Z',
  upstreamVersion,
  rowCount: 0,
  license: 'ODbL-1.0',
  homepage: 'https://overturemaps.org'
});

describe('overtureReleaseProblem', () => {
  it('is null when the releases match', () => {
    const lock: Lock = {
      sources: [
        entry('overture-building-parts', '2026-09-23.1'),
        entry('overture-buildings', '2026-09-23.1')
      ]
    };
    expect(overtureReleaseProblem(lock)).toBeNull();
  });

  it('names both releases when they differ', () => {
    const lock: Lock = {
      sources: [
        entry('overture-building-parts', '2026-10-21.0'),
        entry('overture-buildings', '2026-09-23.1')
      ]
    };
    expect(overtureReleaseProblem(lock)).toBe(
      'overture-building-parts release 2026-10-21.0 differs from overture-buildings 2026-09-23.1; refetch both with --release'
    );
  });

  it('is null when the lock has no parts', () => {
    expect(overtureReleaseProblem({ sources: [entry('overture-buildings', 'x')] })).toBeNull();
  });
});

describe('fetch ids', () => {
  it('knows the parts id; the default fetch has no duplicates and still skips LiDAR', () => {
    expect(FETCH_IDS).toContain('overture-building-parts');
    expect(new Set(DEFAULT_FETCH_IDS).size).toBe(DEFAULT_FETCH_IDS.length);
    expect(DEFAULT_FETCH_IDS).not.toContain('usgs-lidar-sf');
    expect(DEFAULT_FETCH_IDS).not.toContain('overture-building-parts');
  });
});

describe('build', () => {
  it('refuses mismatched releases', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-parts-'));
    const lock = readLock(join(MINI, 'sources.lock.json'));
    const parts = lock.sources.find((s) => s.id === 'overture-building-parts')!;
    parts.upstreamVersion = '2026-10-21.0';
    const lockPath = join(dir, 'sources.lock.json');
    writeLock(lockPath, lock);
    const run = build({
      lockPath,
      rawDir: join(MINI, 'raw'),
      rawByName: true,
      outRoot: join(dir, 'out'),
      datasetVersion: 'fixture-0',
      builtAt: '2026-10-10T00:00:00.000Z',
      profile: FIXTURE_PROFILE,
      skipTiles: true,
      derivedRoot: join(dir, 'derived')
    });
    await expect(run).rejects.toThrow(BuildError);
    await expect(run).rejects.toThrow(/release/);
  });
});
