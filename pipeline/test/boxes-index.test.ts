import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  boxesKey,
  indexFile,
  inputsFileOf,
  lockFileFor,
  readBoxesIndex,
  reusableEntry,
  writeBoxesIndex
} from '../lib/boxes-index.js';
import type { BoxesInputs } from '../lib/lidar/artifact.js';
import { readLock, type LockEntry } from '../lib/lock.js';

const MINI = resolve(import.meta.dirname, 'fixtures/mini');
const entry: LockEntry = readLock(join(MINI, 'sources.lock.json')).sources.find(
  (s) => s.id === 'building-boxes'
)!;

let dir: string;
let raw: string;
let idx: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'boxes-index-'));
  raw = join(dir, 'raw');
  idx = join(dir, 'idx');
  cpSync(join(MINI, 'raw'), raw, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const key = (): string =>
  boxesKey(
    JSON.parse(readFileSync(join(raw, 'building-boxes/inputs.json'), 'utf8')) as BoxesInputs
  );

describe('boxes index', () => {
  it('the key is the sha256 of the inputs.json a run writes', () => {
    expect(key()).toBe(inputsFileOf(entry).sha256);
  });

  it('inputsFileOf throws when absent', () => {
    expect(() => inputsFileOf({ ...entry, files: [] })).toThrow();
  });

  it('names the index and lock files', () => {
    expect(indexFile('/d', 'k')).toBe('/d/k.json');
    expect(lockFileFor('/d', 'k')).toBe('/d/k.lock');
  });

  it('writes and reads a record', () => {
    const k = key();
    writeBoxesIndex(idx, k, entry);
    expect(readBoxesIndex(idx, k)).toEqual({
      schema: 1,
      key: k,
      upstreamVersion: entry.upstreamVersion,
      requires: entry.files.map((f) => f.sha256),
      entry
    });
    expect(readFileSync(indexFile(idx, k), 'utf8').endsWith('\n')).toBe(true);
    expect(readdirSync(idx).filter((f) => f.includes('.tmp-'))).toEqual([]);
  });

  it('reusableEntry returns the entry when every file is present', async () => {
    const k = key();
    writeBoxesIndex(idx, k, entry);
    expect(await reusableEntry(idx, k, raw, true)).toEqual(entry);
  });

  describe('reusableEntry is null', () => {
    it('with no record', async () => {
      expect(await reusableEntry(idx, key(), raw, true)).toBeNull();
    });

    it('when the key field differs', async () => {
      const k = key();
      writeBoxesIndex(idx, k, entry);
      const rec = JSON.parse(readFileSync(indexFile(idx, k), 'utf8'));
      writeFileSync(indexFile(idx, k), JSON.stringify({ ...rec, key: 'f'.repeat(64) }));
      expect(await reusableEntry(idx, k, raw, true)).toBeNull();
    });

    it('when a file is deleted from raw', async () => {
      const k = key();
      writeBoxesIndex(idx, k, entry);
      rmSync(join(raw, 'building-boxes/roofs.parquet'));
      expect(await reusableEntry(idx, k, raw, true)).toBeNull();
    });

    it('when a file changed', async () => {
      const k = key();
      writeBoxesIndex(idx, k, entry);
      writeFileSync(join(raw, 'building-boxes/roofs.parquet'), 'changed');
      expect(await reusableEntry(idx, k, raw, true)).toBeNull();
    });

    it('when requires does not match entry.files', async () => {
      const k = key();
      writeBoxesIndex(idx, k, entry);
      const rec = JSON.parse(readFileSync(indexFile(idx, k), 'utf8'));
      writeFileSync(indexFile(idx, k), JSON.stringify({ ...rec, requires: ['a'] }));
      expect(await reusableEntry(idx, k, raw, true)).toBeNull();
    });

    it('when the entry id is not building-boxes', async () => {
      const k = key();
      writeBoxesIndex(idx, k, { ...entry, id: 'other' });
      expect(await reusableEntry(idx, k, raw, true)).toBeNull();
    });

    it('when the entry inputs.json sha256 is not the key', async () => {
      const k = key();
      const files = entry.files.map((f) =>
        f.name.endsWith('inputs.json') ? { ...f, sha256: 'e'.repeat(64) } : f
      );
      writeBoxesIndex(idx, k, { ...entry, files });
      expect(await reusableEntry(idx, k, raw, true)).toBeNull();
    });

    it('when the entry has no inputs.json', async () => {
      const k = key();
      writeBoxesIndex(idx, k, {
        ...entry,
        files: entry.files.filter((f) => !f.name.endsWith('inputs.json'))
      });
      expect(await reusableEntry(idx, k, raw, true)).toBeNull();
    });

    it('when the JSON is unparsable', async () => {
      const k = key();
      writeBoxesIndex(idx, k, entry);
      writeFileSync(indexFile(idx, k), '{nope');
      expect(await reusableEntry(idx, k, raw, true)).toBeNull();
      expect(existsSync(indexFile(idx, k))).toBe(true);
    });
  });
});
