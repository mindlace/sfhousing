// `fixture --out` empties its target, so it must refuse anything that is not a fresh or previous
// fixture output. Only temp dirs are written; repo paths are probed with names that do not exist.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture, outTargetError } from '../steps/fixture';

const ROOT = resolve(import.meta.dirname, '../..');
const tmp = () => mkdtempSync(join(tmpdir(), 'sfh-fx-out-'));

describe('fixture --out target guard', () => {
  it('refuses a non-empty directory that is not a previous fixture output, leaving it intact', async () => {
    const d = tmp();
    writeFileSync(join(d, 'precious.txt'), 'keep me');
    expect(await fixture({ outDir: d, skipTiles: true })).toBe(1);
    expect(readFileSync(join(d, 'precious.txt'), 'utf8')).toBe('keep me');
  });

  it('refuses a directory whose manifest is not a fixture version', async () => {
    const d = tmp();
    writeFileSync(
      join(d, 'manifest.json'),
      JSON.stringify({ datasetVersion: '2026-10-10-abcdef12' })
    );
    expect(await fixture({ outDir: d, skipTiles: true })).toBe(1);
    expect(existsSync(join(d, 'manifest.json'))).toBe(true);
  });

  it('replaces a previous fixture output', async () => {
    const d = tmp();
    writeFileSync(join(d, 'manifest.json'), JSON.stringify({ datasetVersion: 'fixture-3' }));
    writeFileSync(join(d, 'stale.txt'), 'old');
    expect(await fixture({ outDir: d, skipTiles: true })).toBe(0);
    expect(existsSync(join(d, 'stale.txt'))).toBe(false);
    expect(JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')).datasetVersion).toBe(
      'fixture-0'
    );
  });

  it('refuses targets inside the committed fixture trees, without creating them', async () => {
    for (const rel of ['e2e/fixtures/__sfh_nope__', 'pipeline/test/fixtures/mini/__sfh_nope__']) {
      const p = join(ROOT, rel);
      expect(outTargetError(p), rel).toMatch(/^refusing --out .*: inside /);
      expect(await fixture({ outDir: p, skipTiles: true })).toBe(1);
      expect(existsSync(p)).toBe(false);
    }
    expect(outTargetError(join(ROOT, 'e2e/fixtures/data/fixture-0/../fixture-0'))).toMatch(
      /inside e2e\/fixtures$/
    );
  });

  it('allows a missing or empty directory', () => {
    expect(outTargetError(tmp())).toBeNull();
    expect(outTargetError(join(tmp(), 'new'))).toBeNull();
  });
});
