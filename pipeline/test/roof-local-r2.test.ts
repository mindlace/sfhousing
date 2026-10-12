import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from '../lib/exec';
import { localR2Target } from '../lib/r2';

it('shares Wrangler local persistence and reopens after disposing bulk target', async () => {
  const root = mkdtempSync(join(tmpdir(), 'roof-r2-'));
  const file = join(root, 'bytes');
  writeFileSync(file, 'roof binary bytes');
  const target = await localR2Target({ projectRoot: root });
  try {
    await target.put(
      'roof-processing/a.bin',
      file,
      'application/octet-stream',
      'private, no-store'
    );
    expect(await target.exists('roof-processing/a.bin')).toBe(true);
    expect(await target.exists('missing')).toBe(false);
  } finally {
    await target.dispose();
  }
  const fetched = join(root, 'fetched');
  const r = await run(resolve('node_modules/.bin/wrangler'), [
    'r2',
    'object',
    'get',
    'sfhousing/roof-processing/a.bin',
    '--local',
    '--persist-to',
    join(root, '.wrangler/state'),
    '--file',
    fetched
  ]);
  expect(r.code).toBe(0);
  expect(readFileSync(fetched, 'utf8')).toBe('roof binary bytes');
  const reopened = await localR2Target({ projectRoot: root });
  try {
    expect(await reopened.get('roof-processing/a.bin', fetched)).toBe(true);
    expect(readFileSync(fetched, 'utf8')).toBe('roof binary bytes');
  } finally {
    await reopened.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}, 20000);
