// Tagged `tools`: the Python rasterizer's pytest suite skips with a message when uv is absent.
import { beforeAll, describe, expect, it } from 'vitest';
import { which, type RunResult } from '../lib/exec';
import { openDuck } from '../lib/duck';
import { LIDAR_PROJECT, LIDAR_VENV, uvRun } from '../lib/lidar/python';

const hasUv = !!(await which('uv'));
if (!hasUv) console.log('[tools] uv not found: skipping lidar rasterizer tests');

describe.skipIf(!hasUv)('lidar rasterizer [tools]', () => {
  // A fresh checkout builds the venv on first use; do that here, under the hook timeout, so the
  // suite itself runs within the test timeout.
  beforeAll(async () => {
    const r = await uvRun(['python', '-c', 'import laspy, pyproj'], { cwd: LIDAR_PROJECT });
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
  });

  it('passes its pytest suite', async () => {
    const r = await uvRun(['pytest', '-q', '-p', 'no:cacheprovider', 'tests'], {
      cwd: LIDAR_PROJECT
    });
    expect(r.code, `${r.stdout}\n${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/\d+ passed/);
  });
});

describe('uvRun', () => {
  it('runs the frozen project with its venv under pipeline/.cache and no bytecode', async () => {
    const calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];
    const run = async (
      cmd: string,
      args: string[],
      opts: Record<string, unknown> = {}
    ): Promise<RunResult> => {
      calls.push({ cmd, args, opts });
      return { stdout: 'ok', stderr: '', code: 0 };
    };
    const r = await uvRun(['python', '-c', 'pass'], {}, { run });
    expect(r.code).toBe(0);
    expect(LIDAR_PROJECT).toMatch(/pipeline\/lidar-raster$/);
    expect(LIDAR_VENV).toMatch(/pipeline\/\.cache\/lidar-venv$/);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('uv');
    expect(calls[0].args).toEqual([
      'run',
      '--project',
      LIDAR_PROJECT,
      '--frozen',
      'python',
      '-c',
      'pass'
    ]);
    const env = calls[0].opts.env as Record<string, string>;
    expect(env.UV_PROJECT_ENVIRONMENT).toBe(LIDAR_VENV);
    expect(env.PYTHONDONTWRITEBYTECODE).toBe('1');
    expect(env.PYTHONPATH).toBe(LIDAR_PROJECT);
    expect(calls[0].opts.cwd).toBe(LIDAR_PROJECT);
  });
});

describe('CRS constant', () => {
  it('DuckDB maps (-122.4194, 37.7749) to the EPSG:7131 point pyproj gives', async () => {
    const db = await openDuck();
    try {
      const [p] = await db.all<{ x: number; y: number }>(
        `SELECT ST_X(g) AS x, ST_Y(g) AS y FROM (SELECT ST_Transform(ST_Point(-122.4194, 37.7749),
           'EPSG:4326', 'EPSG:7131', always_xy := true) AS g)`
      );
      expect(Math.abs(p.x - 50695.887)).toBeLessThan(0.01);
      expect(Math.abs(p.y - 26764.161)).toBeLessThan(0.01);
    } finally {
      db.close();
    }
  });
});
