import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATASET_VERSION_RE } from '../../src/lib/data/manifest';
import type { Lock } from '../lib/lock';
import { codeTreeHash, computeDatasetVersion } from '../lib/version';

const lock = (): Lock => ({
  sources: [
    {
      id: 'datasf-parcels',
      files: [
        {
          url: 'https://data.sf.gov/a',
          sha256: 'a'.repeat(64),
          bytes: 10,
          archiveKey: `sources/${'a'.repeat(64)}.geojson`,
          name: 'page-000.geojson'
        }
      ],
      retrievedAt: '2026-10-09T23:59:00.000Z',
      upstreamVersion: 'x',
      rowCount: 1,
      license: 'PDDL-1.0',
      homepage: 'https://data.sf.gov/d/acdm-wktn'
    },
    {
      id: 'overture-buildings',
      files: [
        {
          url: 's3://o',
          sha256: 'b'.repeat(64),
          bytes: 10,
          archiveKey: `sources/${'b'.repeat(64)}.parquet`,
          name: 'buildings.parquet'
        }
      ],
      retrievedAt: '2026-10-10T00:00:01.000Z',
      upstreamVersion: '2026-09-23.1',
      rowCount: 1,
      license: 'ODbL-1.0',
      homepage: 'https://overturemaps.org'
    }
  ]
});
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

  /** A throwaway repo with committed pipeline/ + src/lib/data/ code (never the real repo). */
  function tempRepo(): { dir: string; git: (...a: string[]) => void } {
    const dir = mkdtempSync(join(tmpdir(), 'sfh-ver-'));
    const git = (...a: string[]) => {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], {
        cwd: dir,
        stdio: 'ignore'
      });
    };
    git('init', '-q');
    mkdirSync(join(dir, 'pipeline'), { recursive: true });
    mkdirSync(join(dir, 'src/lib/data'), { recursive: true });
    writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'src/lib/data/b.ts'), 'export const b = 2;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'code');
    return { dir, git };
  }
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
});
