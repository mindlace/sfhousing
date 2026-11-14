import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TOOL_VERSIONS } from '../config';
import { openDuck } from '../lib/duck';
import { run as realRun, which as realWhich } from '../lib/exec';
import { BOXES_ID, boxesLockProblem } from '../lib/lidar/artifact';
import { LIDAR_PROJECT, LIDAR_VENV, uvRun } from '../lib/lidar/python';
import { readLock } from '../lib/lock';

const LIVE_LOCK = join(resolve(import.meta.dirname, '../..'), 'pipeline/sources.lock.json');

const LIDAR_IMPORTS = 'import laspy, lazrs, numpy, scipy, pyproj';

/** The command that installs the rasterizer's pinned Python into LIDAR_VENV. */
export function lidarSyncHint(): string {
  const env = `UV_PROJECT_ENVIRONMENT=${LIDAR_VENV}`;
  return `${env} uv sync --project ${LIDAR_PROJECT} --frozen (needs network once)`;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  /** Needed only by an optional command (fetch --only usgs-lidar-sf): a failure is a warning. */
  optional?: boolean;
  found?: string;
  hint?: string;
}

/** Print one line per check; exit 1 only when a required check failed. */
export function reportDoctor(checks: DoctorCheck[], out: (line: string) => void): number {
  for (const c of checks) {
    const detail = c.ok ? (c.found ?? '') : `${c.found ? `${c.found} ` : ''}-> ${c.hint ?? ''}`;
    const tag = c.ok ? 'OK  ' : c.optional ? 'WARN' : 'FAIL';
    out(`${tag} ${c.name}${detail ? `  ${detail}` : ''}`);
  }
  return checks.every((c) => c.ok || c.optional) ? 0 : 1;
}

/**
 * Required: a building-boxes artifact in the lock must match its gated sources (`build` would
 * stop on it). OK without a lock or without the entry.
 */
export function boxesLockCheck(lockPath: string): DoctorCheck {
  if (!existsSync(lockPath)) return { name: 'boxes-lock', ok: true, found: 'no lock' };
  const lock = readLock(lockPath);
  if (!lock.sources.some((s) => s.id === BOXES_ID))
    return { name: 'boxes-lock', ok: true, found: `no ${BOXES_ID} entry` };
  const problem = boxesLockProblem(lock);
  return problem
    ? { name: 'boxes-lock', ok: false, found: `stale ${BOXES_ID}`, hint: problem }
    : { name: 'boxes-lock', ok: true, found: `${BOXES_ID} current` };
}

export async function doctor(
  deps: {
    run: typeof realRun;
    which: typeof realWhich;
    nodeVersion?: string;
    /** The main lock (default pipeline/sources.lock.json). */
    lockPath?: string;
  } = {
    run: realRun,
    which: realWhich
  }
): Promise<DoctorCheck[]> {
  const { run, which } = deps;
  const checks: DoctorCheck[] = [];

  const nodeVersion = deps.nodeVersion ?? process.version;
  const major = Number(/^v?(\d+)/.exec(nodeVersion)?.[1] ?? 0);
  checks.push({
    name: 'node',
    ok: major >= 22,
    found: nodeVersion,
    hint: major >= 22 ? undefined : 'install Node >=22 (see .nvmrc / engines in package.json)'
  });

  const tipHint = 'brew install tippecanoe';
  if (!(await which('tippecanoe'))) {
    checks.push({ name: 'tippecanoe', ok: false, hint: tipHint });
  } else {
    const r = await run('tippecanoe', ['--version']);
    const out = `${r.stdout}${r.stderr}`.trim();
    const ok = r.code === 0 && out.includes(`v${TOOL_VERSIONS.tippecanoe}`);
    checks.push({
      name: 'tippecanoe',
      ok,
      found: out || undefined,
      hint: ok ? undefined : `${tipHint} (need ${TOOL_VERSIONS.tippecanoe})`
    });
  }

  const pmHint = 'brew install pmtiles';
  if (!(await which('pmtiles'))) {
    checks.push({ name: 'pmtiles', ok: false, hint: pmHint });
  } else {
    const r = await run('pmtiles', ['version']);
    let out = `${r.stdout}${r.stderr}`.trim();
    let ok = r.code === 0 && out.includes(TOOL_VERSIONS.pmtiles);
    if (r.code === 0 && !ok && /\bdev\b/.test(out)) {
      const b = await run('brew', ['list', '--versions', 'pmtiles']);
      out = b.stdout.trim();
      ok = b.code === 0 && out.includes(TOOL_VERSIONS.pmtiles);
    }
    checks.push({
      name: 'pmtiles',
      ok,
      found: out || undefined,
      hint: ok ? undefined : `${pmHint} (need ${TOOL_VERSIONS.pmtiles})`
    });
  }

  const w = await run('npx', ['wrangler', '--version']);
  checks.push({
    name: 'wrangler',
    ok: w.code === 0,
    found: w.stdout.trim() || undefined,
    hint: w.code === 0 ? undefined : 'npm install'
  });

  // The tiles step writes the split basemap's MBTiles with node:sqlite (pmtiles-rewrite.ts).
  try {
    const { DatabaseSync } = await import('node:sqlite');
    new DatabaseSync(':memory:').close();
    checks.push({ name: 'node:sqlite', ok: true, found: 'node:sqlite' });
  } catch (e) {
    checks.push({
      name: 'node:sqlite',
      ok: false,
      found: e instanceof Error ? e.message.split('\n')[0] : String(e),
      hint: 'use Node 24 (.nvmrc): the basemap split needs node:sqlite'
    });
  }

  for (const ext of ['spatial', 'httpfs']) {
    try {
      const db = await openDuck({ httpfs: ext === 'httpfs' });
      db.close();
      checks.push({ name: `duckdb-${ext}`, ok: true, found: `LOAD ${ext}` });
    } catch (e) {
      checks.push({
        name: `duckdb-${ext}`,
        ok: false,
        found: e instanceof Error ? e.message.split('\n')[0] : String(e),
        hint: 'npm install (needs network once to INSTALL DuckDB extensions)'
      });
    }
  }

  checks.push(boxesLockCheck(deps.lockPath ?? LIVE_LOCK));

  // The LiDAR rasterizer (fetch --only usgs-lidar-sf) runs in a pinned uv project. Nothing else
  // needs Python, so both checks are optional.
  if (!(await which('uv'))) {
    checks.push({
      name: 'uv',
      ok: false,
      optional: true,
      hint: 'brew install uv (only for fetch --only usgs-lidar-sf)'
    });
  } else {
    const v = await run('uv', ['--version']);
    checks.push({ name: 'uv', ok: true, optional: true, found: v.stdout.trim() || undefined });
    const probe = await uvRun(['python', '-c', LIDAR_IMPORTS], {}, { run });
    const ok = probe.code === 0;
    checks.push({
      name: 'lidar-python',
      ok,
      optional: true,
      found: ok
        ? 'laspy lazrs numpy scipy pyproj'
        : probe.stderr.trim().split('\n').at(-1) || undefined,
      // Absolute paths: uv resolves a relative UV_PROJECT_ENVIRONMENT against the project root.
      hint: ok ? undefined : lidarSyncHint()
    });
  }

  return checks;
}
