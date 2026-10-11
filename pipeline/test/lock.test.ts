import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  archiveKeyFor,
  canonicalJson,
  readLock,
  sha256File,
  verifyRaw,
  writeLock,
  type Lock
} from '../lib/lock';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  return dir;
}

async function makeLock(dir: string): Promise<Lock> {
  const files = [];
  for (const [name, content] of [
    ['page-000.geojson', 'hello'],
    ['buildings.parquet', 'world']
  ]) {
    const tmp = path.join(dir, `tmp-${name}`);
    fs.writeFileSync(tmp, content);
    const sha = await sha256File(tmp);
    fs.renameSync(tmp, path.join(dir, sha));
    files.push({
      url: 'https://x/' + name,
      sha256: sha,
      bytes: content.length,
      archiveKey: archiveKeyFor(sha, name),
      name
    });
  }
  return {
    sources: [
      {
        id: 'src-a',
        files: [files[0]],
        retrievedAt: '2026-10-10T00:00:00.000Z',
        upstreamVersion: 'v',
        rowCount: 1,
        license: 'L',
        homepage: 'https://h'
      },
      {
        id: 'src-b',
        files: [files[1]],
        retrievedAt: '2026-10-10T00:00:00.000Z',
        upstreamVersion: 'v',
        rowCount: 1,
        license: 'L',
        homepage: 'https://h'
      }
    ]
  };
}

describe('lock', () => {
  it('canonicalJson sorts keys recursively without whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });
  it('archiveKeyFor keeps the extension of the name', () => {
    const sha = 'f'.repeat(64);
    expect(archiveKeyFor(sha, 'page-000.geojson')).toBe(`sources/${sha}.geojson`);
  });
  it('verifyRaw passes for intact files and names the source on corruption', async () => {
    const dir = setup();
    const lock = await makeLock(dir);
    expect(await verifyRaw(lock, dir)).toEqual([]);
    const target = path.join(dir, lock.sources[1].files[0].sha256);
    const buf = fs.readFileSync(target);
    buf[0] ^= 0xff;
    fs.writeFileSync(target, buf);
    const msgs = await verifyRaw(lock, dir);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('src-b');
  });
  it('verifyRaw reports missing files', async () => {
    const dir = setup();
    const lock = await makeLock(dir);
    fs.rmSync(path.join(dir, lock.sources[0].files[0].sha256));
    const msgs = await verifyRaw(lock, dir);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain('src-a');
  });
  it('writeLock/readLock round-trip with canonical formatting and sorted sources', async () => {
    const dir = setup();
    const lock = await makeLock(dir);
    const p = path.join(dir, 'sources.lock.json');
    writeLock(p, { sources: [...lock.sources].reverse() });
    const text = fs.readFileSync(p, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "sources"');
    expect(readLock(p)).toEqual(lock);
  });
});
