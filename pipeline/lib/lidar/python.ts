// Runs the pinned Python LiDAR rasterizer (pipeline/lidar-raster, a uv project). Fetch time only:
// build, fixture and test:pipeline never need Python.
import path from 'node:path';
import { run as realRun, type RunResult } from '../exec.js';

/** The uv project: pyproject.toml, uv.lock and the sfh_lidar package. */
export const LIDAR_PROJECT = path.join(import.meta.dirname, '..', '..', 'lidar-raster');

/**
 * The project's virtualenv. It lives under pipeline/.cache, which the code hash excludes
 * (pipeline/lib/version.ts), so syncing it never changes the dataset version.
 */
export const LIDAR_VENV = path.join(import.meta.dirname, '..', '..', '.cache', 'lidar-venv');

/**
 * `uv run --project LIDAR_PROJECT --frozen <args>` with UV_PROJECT_ENVIRONMENT=LIDAR_VENV and
 * PYTHONDONTWRITEBYTECODE=1 (no __pycache__ under pipeline/). PYTHONPATH is the project, so
 * `python -m sfh_lidar.<module>` works from any cwd; the default cwd is the project.
 */
export function uvRun(
  args: string[],
  opts: { cwd?: string } = {},
  deps: { run: typeof realRun } = { run: realRun }
): Promise<RunResult> {
  return deps.run('uv', ['run', '--project', LIDAR_PROJECT, '--frozen', ...args], {
    cwd: opts.cwd ?? LIDAR_PROJECT,
    env: {
      UV_PROJECT_ENVIRONMENT: LIDAR_VENV,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: LIDAR_PROJECT
    }
  });
}
