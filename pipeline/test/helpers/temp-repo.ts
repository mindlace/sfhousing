import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Lock } from '../../lib/lock';

export const lock = (): Lock => ({
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
/** A throwaway repo with committed pipeline/ and src/lib/ code (never the real repo). */
export function tempRepo(): { dir: string; git: (...a: string[]) => void } {
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
  mkdirSync(join(dir, 'src/lib/plan'), { recursive: true });
  mkdirSync(join(dir, 'src/lib/generator'), { recursive: true });
  mkdirSync(join(dir, 'src/lib/timelapse'), { recursive: true });
  mkdirSync(join(dir, 'src/lib/sim/scenario'), { recursive: true });
  mkdirSync(join(dir, 'src/lib/sim/levers'), { recursive: true });
  mkdirSync(join(dir, 'src/lib/sim/other'), { recursive: true });
  mkdirSync(join(dir, 'src/lib/scoreboard'), { recursive: true });
  writeFileSync(join(dir, 'pipeline/a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'src/lib/data/b.ts'), 'export const b = 2;\n');
  writeFileSync(join(dir, 'src/lib/plan/geometry.ts'), 'export const g = 3;\n');
  writeFileSync(join(dir, 'src/lib/plan/other.ts'), 'export const o = 4;\n');
  writeFileSync(join(dir, 'src/lib/plan/types.ts'), 'export type T = 1;\n');
  writeFileSync(join(dir, 'src/lib/generator/gen.ts'), 'export const gen = 5;\n');
  writeFileSync(join(dir, 'src/lib/timelapse/time.ts'), 'export const tl = 6;\n');
  writeFileSync(join(dir, 'src/lib/sim/scenario/engine.ts'), 'export const e = 7;\n');
  writeFileSync(join(dir, 'src/lib/sim/levers/apply.ts'), 'export const l = 8;\n');
  writeFileSync(join(dir, 'src/lib/sim/other/x.ts'), 'export const x = 9;\n');
  writeFileSync(join(dir, 'src/lib/scoreboard/index.ts'), 'export const sb = 10;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'code');
  return { dir, git };
}
export const writeLock = (dir: string): void =>
  writeFileSync(join(dir, 'pipeline/sources.lock.json'), JSON.stringify(lock()));
