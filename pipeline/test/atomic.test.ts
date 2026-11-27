import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const exdev = vi.hoisted(() => ({ failNext: false }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    renameSync: (a: string, b: string) => {
      if (exdev.failNext) {
        exdev.failNext = false;
        throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
      }
      return real.renameSync(a, b);
    }
  };
});

import { moveIntoPlace, tempSibling, writeFileAtomic } from '../lib/atomic';
import type { Lock } from '../lib/lock';
import type { R2Target } from '../lib/r2';
import { storeBytes, storeFile } from '../lib/raw';
import { restoreRaw } from '../steps/fetch';

const made: string[] = [];
afterEach(() => {
  exdev.failNext = false;
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'sfh-atomic-'));
  made.push(d);
  return d;
};

describe('tempSibling', () => {
  it('is beside the destination and differs between calls', () => {
    const a = tempSibling('/d/file');
    expect(dirname(a)).toBe('/d');
    expect(a).toMatch(/^\/d\/file\.tmp-\d+-[0-9a-f]{12}$/);
    expect(tempSibling('/d/file')).not.toBe(a);
  });
});

describe('writeFileAtomic', () => {
  it('leaves only the destination and replaces an existing file', () => {
    const d = tmp();
    const dest = join(d, 'f');
    writeFileAtomic(dest, 'one');
    writeFileAtomic(dest, new TextEncoder().encode('two'));
    expect(readFileSync(dest, 'utf8')).toBe('two');
    expect(readdirSync(d)).toEqual(['f']);
  });
});

describe('moveIntoPlace', () => {
  it('moves a file and a directory tree', () => {
    const d = tmp();
    writeFileSync(join(d, 'a'), 'A');
    moveIntoPlace(join(d, 'a'), join(d, 'b'));
    expect(existsSync(join(d, 'a'))).toBe(false);
    expect(readFileSync(join(d, 'b'), 'utf8')).toBe('A');
    mkdirSync(join(d, 'src/sub'), { recursive: true });
    writeFileSync(join(d, 'src/sub/x'), 'X');
    moveIntoPlace(join(d, 'src'), join(d, 'dst'));
    expect(existsSync(join(d, 'src'))).toBe(false);
    expect(readFileSync(join(d, 'dst/sub/x'), 'utf8')).toBe('X');
  });

  it('copies through a temp sibling on EXDEV and removes the source', () => {
    const d = tmp();
    writeFileSync(join(d, 'a'), 'A');
    exdev.failNext = true;
    moveIntoPlace(join(d, 'a'), join(d, 'b'));
    expect(existsSync(join(d, 'a'))).toBe(false);
    expect(readFileSync(join(d, 'b'), 'utf8')).toBe('A');
    expect(readdirSync(d)).toEqual(['b']);
  });

  it('copies a directory through a temp sibling on EXDEV', () => {
    const d = tmp();
    mkdirSync(join(d, 'src'));
    writeFileSync(join(d, 'src/x'), 'X');
    exdev.failNext = true;
    moveIntoPlace(join(d, 'src'), join(d, 'dst'));
    expect(readdirSync(d)).toEqual(['dst']);
    expect(readFileSync(join(d, 'dst/x'), 'utf8')).toBe('X');
  });
});

describe('raw store', () => {
  it('storeBytes does not rewrite a sha name that exists', () => {
    const raw = tmp();
    const bytes = new TextEncoder().encode('same');
    const first = storeBytes(raw, 'n.txt', 'u', bytes);
    const p = join(raw, first.sha256);
    utimesSync(p, new Date(1_000_000), new Date(1_000_000));
    const before = statSync(p);
    const again = storeBytes(raw, 'n.txt', 'u', bytes);
    const after = statSync(p);
    expect(again).toEqual(first);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
    expect(readdirSync(raw)).toEqual([first.sha256]);
  });

  it('storeFile of a duplicate removes the source and keeps the existing file', async () => {
    const raw = tmp();
    const src = tmp();
    const stored = storeBytes(raw, 'n.txt', 'u', new TextEncoder().encode('dup'));
    const p = join(raw, stored.sha256);
    const before = statSync(p);
    writeFileSync(join(src, 'dl'), 'dup');
    const lock = await storeFile(raw, 'n.txt', 'u', join(src, 'dl'));
    expect(lock.sha256).toBe(stored.sha256);
    expect(existsSync(join(src, 'dl'))).toBe(false);
    expect(statSync(p).ino).toBe(before.ino);
  });

  it('restoreRaw downloads to a temp sibling', async () => {
    const raw = tmp();
    const content = new TextEncoder().encode('archived');
    const sha = createHash('sha256').update(content).digest('hex');
    const lock: Lock = {
      sources: [
        {
          id: 'x',
          files: [
            {
              url: 'u',
              sha256: sha,
              bytes: content.length,
              archiveKey: `sources/${sha}.txt`,
              name: 'x.txt'
            }
          ],
          retrievedAt: 't',
          upstreamVersion: 'v',
          rowCount: 1,
          license: 'l',
          homepage: 'h'
        }
      ]
    };
    const files: string[] = [];
    const r2: R2Target = {
      exists: async () => true,
      put: async () => {},
      get: async (_key, file) => {
        files.push(file);
        writeFileSync(file, content);
        return true;
      }
    };
    expect(await restoreRaw(lock, raw, r2)).toEqual({ restored: 1, present: 0 });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.tmp-\d+-[0-9a-f]{12}$/);
    expect(readdirSync(raw)).toEqual([sha]);
  });
});
