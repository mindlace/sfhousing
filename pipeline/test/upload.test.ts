import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { R2Target } from '../lib/r2';
import { upload } from '../steps/upload';

function fakeTarget(existing: string[] = [], failKeys: Record<string, number> = {}) {
  const calls: string[] = [];
  const store = new Set(existing);
  const t: R2Target = {
    exists: async (k) => {
      calls.push(`exists ${k}`);
      return store.has(k);
    },
    put: async (k) => {
      if ((failKeys[k] ?? 0) > 0) {
        failKeys[k]--;
        throw new Error('flaky');
      }
      calls.push(`put ${k}`);
      store.add(k);
    },
    get: async () => false
  };
  return { t, calls, store };
}
function outDir() {
  const d = mkdtempSync(join(tmpdir(), 'sfh-up-'));
  mkdirSync(join(d, 'parcels'));
  writeFileSync(join(d, 'parcels', '50_25.json'), '{}');
  writeFileSync(join(d, 'neighborhoods.geojson'), '{}');
  writeFileSync(join(d, 'report.json'), '{}');
  writeFileSync(join(d, 'manifest.json'), JSON.stringify({ datasetVersion: 'fixture-7' }));
  return d;
}
const lock = { sources: [] };
const opts = (target: R2Target, extra = {}) => ({
  outDir: outDir(),
  datasetVersion: 'fixture-7',
  lock,
  rawDir: '/nonexistent',
  target,
  sleep: async () => {},
  log: () => {},
  ...extra
});

describe('upload', () => {
  it('V13: aborts before any put when the version is already published', async () => {
    const { t, calls } = fakeTarget(['data/fixture-7/manifest.json']);
    expect(await upload(opts(t))).toBe(1);
    expect(calls).toEqual(['exists data/fixture-7/manifest.json']);
  });
  it('puts the manifest last and retries a flaky object', async () => {
    const { t, calls } = fakeTarget([], { 'data/fixture-7/parcels/50_25.json': 2 });
    expect(await upload(opts(t))).toBe(0);
    const puts = calls.filter((c) => c.startsWith('put'));
    expect(puts[puts.length - 1]).toBe('put data/fixture-7/manifest.json');
    expect(puts).toContain('put data/fixture-7/parcels/50_25.json');
    expect(puts).not.toContain('put data/fixture-7/report.json');
  });
  it('never puts the manifest when an artifact keeps failing', async () => {
    const { t, store } = fakeTarget([], { 'data/fixture-7/neighborhoods.geojson': 99 });
    expect(await upload(opts(t))).toBe(1);
    expect(store.has('data/fixture-7/manifest.json')).toBe(false);
  });
  it('refuses a mismatched or invalid version', async () => {
    const { t, calls } = fakeTarget();
    expect(await upload(opts(t, { datasetVersion: 'fixture-8' }))).toBe(1);
    expect(await upload(opts(t, { datasetVersion: 'v1' }))).toBe(1);
    expect(calls).toEqual([]);
  });
  it('archives lock files missing from R2 before the artifacts, skipping present ones', async () => {
    const rawDir = mkdtempSync(join(tmpdir(), 'sfh-raw-'));
    writeFileSync(join(rawDir, 'aaa'), 'x');
    writeFileSync(join(rawDir, 'bbb'), 'y');
    const f = (sha: string) => ({
      url: 'u',
      sha256: sha,
      bytes: 1,
      archiveKey: `sources/${sha}.geojson`,
      name: sha
    });
    const lk = {
      sources: [
        {
          id: 's',
          files: [f('aaa'), f('bbb')],
          retrievedAt: '',
          upstreamVersion: '',
          rowCount: 0,
          license: '',
          homepage: ''
        }
      ]
    };
    const { t, calls } = fakeTarget(['sources/bbb.geojson']);
    expect(await upload(opts(t, { lock: lk, rawDir }))).toBe(0);
    const puts = calls.filter((c) => c.startsWith('put'));
    expect(puts[0]).toBe('put sources/aaa.geojson');
    expect(puts).not.toContain('put sources/bbb.geojson');
  });
});
