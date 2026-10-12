import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLocal } from './r2-load-local';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'r2-load-local-'));
  dirs.push(d);
  return d;
}
function touch(file: string): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, 'x');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('loadLocal', async () => {
  it('puts every nested file except README.md and dotfiles, sorted, with posix keys', async () => {
    const src = tmp();
    for (const f of ['manifest.json', 'README.md', '.DS_Store', 'parcels/0_0.json'])
      touch(join(src, f));
    touch(join(src, 'fonts/Noto Sans/0-255.pbf'));
    const puts: string[] = [];
    const n = await loadLocal(src, 'fixture-0', tmp(), (v, rel) => {
      puts.push(`${v}:${rel}`);
    });
    expect(puts).toEqual([
      'fixture-0:fonts/Noto Sans/0-255.pbf',
      'fixture-0:manifest.json',
      'fixture-0:parcels/0_0.json'
    ]);
    expect(n).toBe(3);
  });

  // The adapter's worker caches responses with a cacheable Cache-Control in caches.default and
  // `wrangler dev` persists that cache, so /data responses (immutable, 1y) outlive a reload of
  // the same version and serve the old fixture. Reloading must drop the persisted cache.
  it('purges the persisted local Cache API state and leaves R2/D1 state alone', async () => {
    const src = tmp();
    touch(join(src, 'manifest.json'));
    const project = tmp();
    const state = join(project, '.wrangler/state/v3');
    touch(join(state, 'cache/default/blobs/stale'));
    touch(join(state, 'r2/sfhousing/blobs/keep'));
    touch(join(state, 'd1/db.sqlite'));
    await loadLocal(src, 'fixture-0', project, () => {});
    expect(existsSync(join(state, 'cache'))).toBe(false);
    expect(existsSync(join(state, 'r2/sfhousing/blobs/keep'))).toBe(true);
    expect(existsSync(join(state, 'd1/db.sqlite'))).toBe(true);
  });

  it('works when there is no local state yet', async () => {
    const src = tmp();
    touch(join(src, 'manifest.json'));
    expect(await loadLocal(src, 'fixture-0', tmp(), () => {})).toBe(1);
  });
});

it('loads generated roof header and binary files through the existing fixture loader', async () => {
  const puts: string[] = [];
  await loadLocal('e2e/fixtures/data/fixture-0', 'fixture-0', tmp(), (_v, rel) => {
    puts.push(rel);
  });
  expect(puts).toContain('roofs/index.json');
  expect(puts.some((p) => /^roofs\/.+\.bin$/.test(p))).toBe(true);
});
