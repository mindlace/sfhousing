import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boxesLockProblem, BOXES_ID } from '../lib/lidar/artifact';
import { LIDAR_PROJECT, LIDAR_VENV } from '../lib/lidar/python';
import { readLock, writeLock, type Lock } from '../lib/lock';
import { doctor, lidarSyncHint, reportDoctor, type DoctorCheck } from '../steps/doctor';
import { MINI } from './helpers';

const fakeRun = (outputs: Record<string, string>) => async (cmd: string, args: string[]) => {
  const key = [cmd, ...args].join(' ');
  if (!(key in outputs)) return { stdout: '', stderr: 'not found', code: 127 };
  return { stdout: outputs[key], stderr: '', code: 0 };
};

const PROBE = [
  'uv run --project',
  LIDAR_PROJECT,
  '--frozen python -c import laspy, lazrs, numpy, scipy, pyproj'
].join(' ');

describe('doctor', () => {
  it('passes with pinned tools, accepting brew version when pmtiles prints dev', async () => {
    const checks = await doctor({
      nodeVersion: 'v24.2.0',
      // The mini lock and its current artifact: the live lock's building-boxes entry may go stale.
      lockPath: join(MINI, 'sources.lock.json'),
      which: async (c) => `/opt/homebrew/bin/${c}`,
      run: fakeRun({
        'tippecanoe --version': 'tippecanoe v2.79.0\n',
        'pmtiles version': 'pmtiles dev, commit none, built at unknown\n',
        'brew list --versions pmtiles': 'pmtiles 1.31.2\n',
        'npx wrangler --version': '4.114.0\n',
        'uv --version': 'uv 0.7.13\n',
        [PROBE]: ''
      })
    });
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.find((c) => c.name === 'boxes-lock')).toMatchObject({
      ok: true,
      found: 'building-boxes current'
    });
    expect(checks.find((c) => c.name === 'uv')).toMatchObject({ ok: true, optional: true });
    expect(checks.find((c) => c.name === 'lidar-python')).toMatchObject({
      ok: true,
      optional: true
    });
    // the basemap split writes MBTiles with node:sqlite
    expect(checks.find((c) => c.name === 'node:sqlite')).toMatchObject({ ok: true });
  });

  it('fails with an install hint when tippecanoe is missing or the wrong version', async () => {
    const checks = await doctor({
      nodeVersion: 'v20.1.0',
      which: async (c) => (c === 'tippecanoe' ? null : `/bin/${c}`),
      run: fakeRun({ 'pmtiles version': 'pmtiles 1.30.0', 'npx wrangler --version': '4' })
    });
    const failed = Object.fromEntries(checks.filter((c) => !c.ok).map((c) => [c.name, c.hint]));
    expect(failed.node).toMatch(/22/);
    expect(failed.tippecanoe).toMatch(/brew install tippecanoe/);
    expect(failed.pmtiles).toMatch(/brew install pmtiles/);
  });

  it('flags a missing uv as an optional failure', async () => {
    const checks = await doctor({
      nodeVersion: 'v24.2.0',
      which: async (c) => (c === 'uv' ? null : `/bin/${c}`),
      run: fakeRun({})
    });
    expect(checks.find((c) => c.name === 'uv')).toEqual({
      name: 'uv',
      ok: false,
      optional: true,
      hint: 'brew install uv (only for fetch --only usgs-lidar-sf)'
    });
    expect(checks.find((c) => c.name === 'lidar-python')).toBeUndefined();
  });

  it('flags a failed import probe as an optional lidar-python failure', async () => {
    const checks = await doctor({
      nodeVersion: 'v24.2.0',
      which: async (c) => `/bin/${c}`,
      run: async (cmd: string, args: string[]) => {
        const key = [cmd, ...args].join(' ');
        if (key === 'uv --version') return { stdout: 'uv 0.7.13\n', stderr: '', code: 0 };
        if (key === PROBE) return { stdout: '', stderr: 'No module named laspy', code: 1 };
        return { stdout: '', stderr: 'not found', code: 127 };
      }
    });
    expect(checks.find((c) => c.name === 'lidar-python')).toMatchObject({
      name: 'lidar-python',
      ok: false,
      optional: true,
      hint: lidarSyncHint()
    });
    // Absolute: uv resolves a relative UV_PROJECT_ENVIRONMENT against the project, not the cwd.
    expect(lidarSyncHint()).toBe(
      `UV_PROJECT_ENVIRONMENT=${LIDAR_VENV} uv sync --project ${LIDAR_PROJECT} --frozen` +
        ' (needs network once)'
    );
    expect(LIDAR_VENV).toMatch(/^\/.*\/pipeline\/\.cache\/lidar-venv$/);
  });
});

describe('doctor boxes-lock', () => {
  const fixed = { nodeVersion: 'v24.2.0', which: async () => null, run: fakeRun({}) };
  const miniLock = (): Lock => {
    const l = readLock('pipeline/test/fixtures/mini/sources.lock.json');
    return { sources: l.sources.filter((s) => s.id !== BOXES_ID) };
  };
  const tmpLock = (lock: Lock): string => {
    const p = join(mkdtempSync(join(tmpdir(), 'sfh-doctor-')), 'sources.lock.json');
    writeLock(p, lock);
    return p;
  };

  it('is ok without a lock or without a building-boxes entry', async () => {
    const none = await doctor({ ...fixed, lockPath: join(tmpdir(), 'sfh-no-such-lock.json') });
    expect(none.find((c) => c.name === 'boxes-lock')).toMatchObject({ ok: true });
    const bare = await doctor({ ...fixed, lockPath: tmpLock(miniLock()) });
    const check = bare.find((c) => c.name === 'boxes-lock');
    expect(check).toMatchObject({ ok: true });
    expect(check?.optional).toBeUndefined();
  });

  it('is a required failure carrying the boxesLockProblem message when stale', async () => {
    const lock = miniLock();
    lock.sources.push({
      id: BOXES_ID,
      files: [],
      retrievedAt: '2026-10-10T00:00:00.000Z',
      upstreamVersion:
        'boxes/1 code=aaaaaaaaaaaa config=aaaaaaaaaaaa overture-buildings=aaaaaaaaaaaa ' +
        'overture-building-parts=- usgs-lidar-sf=- datasf-parcels=- datasf-streets=- ' +
        'datasf-neighborhoods=-',
      rowCount: 0,
      license: 'ODbL-1.0',
      homepage: 'https://www.usgs.gov/3d-elevation-program'
    });
    const problem = boxesLockProblem(lock);
    expect(problem).toMatch(/npm run pipeline -- boxes/);
    const checks = await doctor({ ...fixed, lockPath: tmpLock(lock) });
    const check = checks.find((c) => c.name === 'boxes-lock');
    expect(check).toMatchObject({ ok: false, hint: problem });
    expect(check?.optional).toBeUndefined();
    expect(reportDoctor([check!], () => {})).toBe(1);
  });
});

describe('reportDoctor', () => {
  const ok: DoctorCheck = { name: 'node', ok: true, found: 'v24.2.0' };

  it('exits 0 and prints warnings when only optional checks fail', () => {
    const lines: string[] = [];
    const code = reportDoctor(
      [ok, { name: 'uv', ok: false, optional: true, hint: 'brew install uv' }],
      (l) => lines.push(l)
    );
    expect(code).toBe(0);
    expect(lines).toEqual(['OK   node  v24.2.0', 'WARN uv  -> brew install uv']);
  });

  it('exits 1 when a required check fails', () => {
    const lines: string[] = [];
    const code = reportDoctor([ok, { name: 'tippecanoe', ok: false, hint: 'brew' }], (l) =>
      lines.push(l)
    );
    expect(code).toBe(1);
    expect(lines[1]).toBe('FAIL tippecanoe  -> brew');
  });
});
