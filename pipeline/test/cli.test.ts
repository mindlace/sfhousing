import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

describe('pipeline cli', () => {
  it('an unknown command such as lesscars-cnns gets the usage, naming no lesscars command, and exit 2', () => {
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx', join(REPO_ROOT, 'pipeline/cli.ts'), 'lesscars-cnns'],
      { encoding: 'utf8', cwd: REPO_ROOT }
    );
    expect(r.status).toBe(2);
    expect(r.stderr.startsWith('Usage:')).toBe(true);
    expect(r.stderr).not.toContain('lesscars');
  });
});
