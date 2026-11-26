import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cacheRoot, localCacheNotice, sharedCache } from '../lib/cache-root';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'sfh-cache-root-'));
  made.push(d);
  return d;
};

describe('cacheRoot', () => {
  it('resolves SFH_CACHE_DIR, then XDG_CACHE_HOME, then ~/.cache', () => {
    expect(cacheRoot({ SFH_CACHE_DIR: '/ext/sfh', XDG_CACHE_HOME: '/x' }, '/h')).toBe('/ext/sfh');
    expect(cacheRoot({ XDG_CACHE_HOME: '/x' }, '/h')).toBe('/x/sfhousing');
    expect(cacheRoot({}, '/h')).toBe('/h/.cache/sfhousing');
  });

  it('treats empty as unset, resolves a relative SFH_CACHE_DIR, ignores a relative XDG', () => {
    expect(cacheRoot({ SFH_CACHE_DIR: '' }, '/h')).toBe('/h/.cache/sfhousing');
    expect(cacheRoot({ SFH_CACHE_DIR: 'rel' }, '/h')).toBe(resolve('rel'));
    expect(cacheRoot({ XDG_CACHE_HOME: 'rel' }, '/h')).toBe('/h/.cache/sfhousing');
  });

  it('names the shared dirs', () => {
    expect(sharedCache('/c')).toEqual({
      root: '/c',
      raw: '/c/raw',
      ept: '/c/ept',
      lidarWork: '/c/lidar-work',
      boxesIndex: '/c/boxes-index'
    });
  });

  it('runs the pipeline tests against a temp root, never ~/.cache/sfhousing', () => {
    expect(basename(cacheRoot())).toMatch(/^sfh-cache-test-/);
    expect(cacheRoot()).not.toBe(join(homedir(), '.cache/sfhousing'));
  });
});

describe('localCacheNotice', () => {
  it('notices a local raw, ept or lidar-work, and nothing else', () => {
    const local = tmp();
    mkdirSync(join(local, 'raw'));
    writeFileSync(join(local, 'raw/x'), 'x');
    mkdirSync(join(local, 'ept'));
    writeFileSync(join(local, 'ept/y'), 'y');
    mkdirSync(join(local, 'derived'));
    writeFileSync(join(local, 'derived/z'), 'z');
    mkdirSync(join(local, 'lidar-venv'));
    writeFileSync(join(local, 'lidar-venv/z'), 'z');
    expect(localCacheNotice(local, '/c')).toBe(
      `${local} holds raw, ept: move them to /c with npm run pipeline -- cache import ${local}`
    );
  });

  it('is null for only derived and lidar-venv, an empty raw, or local equal to the root', () => {
    const local = tmp();
    mkdirSync(join(local, 'derived/a'), { recursive: true });
    mkdirSync(join(local, 'lidar-venv/a'), { recursive: true });
    mkdirSync(join(local, 'raw'));
    expect(localCacheNotice(local, '/c')).toBeNull();
    writeFileSync(join(local, 'raw/x'), 'x');
    expect(localCacheNotice(local, local)).toBeNull();
  });
});
