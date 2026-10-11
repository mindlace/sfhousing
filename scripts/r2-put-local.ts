import { execFileSync } from 'node:child_process';

/** Upload one file to local R2 at sfhousing/data/<version>/<rel> (no shell interpolation). */
export function putLocal(version: string, rel: string, file: string): void {
  execFileSync(
    'npx',
    [
      'wrangler',
      'r2',
      'object',
      'put',
      `sfhousing/data/${version}/${rel}`,
      '--local',
      '--file',
      file
    ],
    { stdio: 'inherit' }
  );
}
