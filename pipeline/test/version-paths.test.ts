import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PATHS } from '../lib/version';
import { pathsProblems } from './helpers/import-walk';

const REPO_ROOT = resolve(import.meta.dirname, '../..');

/** A throwaway tree: each key is a repo-relative file, each value its text. */
function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sfh-walk-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }
  return dir;
}

describe('PATHS and the pipeline imports', () => {
  it('PATHS covers exactly what pipeline/cli.ts imports', () => {
    expect(pathsProblems(REPO_ROOT, 'pipeline/cli.ts', PATHS)).toEqual([]);
  });

  it('names a reached module outside PATHS', () => {
    const dir = tree({
      'pipeline/cli.ts': "import { a } from '../src/lib/x/a.js';\nexport const c = a;\n",
      'src/lib/x/a.ts': 'export const a = 1;\n'
    });
    expect(pathsProblems(dir, 'pipeline/cli.ts', ['pipeline'])).toEqual([
      'module outside PATHS: src/lib/x/a.ts'
    ]);
  });

  it('names a PATHS entry no import reaches', () => {
    const dir = tree({
      'pipeline/cli.ts': "import { a } from '../src/lib/x/a.js';\nexport const c = a;\n",
      'src/lib/x/a.ts': 'export const a = 1;\n'
    });
    expect(pathsProblems(dir, 'pipeline/cli.ts', ['pipeline', 'src/lib/x', 'src/lib/y'])).toEqual([
      'PATHS entry reaches no module: src/lib/y'
    ]);
  });

  it('names a relative or $lib specifier that resolves to no file', () => {
    const dir = tree({
      'pipeline/cli.ts': "import type { B } from '$lib/missing';\nexport type C = B;\n"
    });
    expect(pathsProblems(dir, 'pipeline/cli.ts', ['pipeline'])).toEqual([
      'unresolved import: $lib/missing in pipeline/cli.ts'
    ]);
  });

  it('follows export-from, literal import() and index files, and stops at json', () => {
    const dir = tree({
      'pipeline/cli.ts':
        "export * from '../src/lib/x';\nexport const l = () => import('../src/lib/y.js');\n",
      'src/lib/x/index.ts': "import data from './d.json';\nexport const x = data;\n",
      'src/lib/x/d.json': '{}\n',
      'src/lib/y.ts': "import 'zod';\nexport const y = 1;\n"
    });
    expect(
      pathsProblems(dir, 'pipeline/cli.ts', ['pipeline', 'src/lib/x', 'src/lib/y.ts'])
    ).toEqual([]);
  });
});
