import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lockSha256, type Lock } from '../lib/lock';
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
const STACKS = ['NotoSans-Regular', 'NotoSans-Medium', 'NotoSans-Italic'];
const ok = (id: string) => ({ id, ok: true, detail: '' });
/** A minimal publishable dataset: every file the manifest names, all invariants passing. */
function outDir(v = 'fixture-7', report: Record<string, unknown> = {}) {
  const d = mkdtempSync(join(tmpdir(), 'sfh-up-'));
  mkdirSync(join(d, 'parcels'));
  writeFileSync(join(d, 'parcels', '50_25.json'), '{}');
  writeFileSync(join(d, 'neighborhoods.geojson'), '{}');
  writeFileSync(join(d, 'buildings.pmtiles'), 'b');
  writeFileSync(join(d, 'basemap.pmtiles'), 'm');
  for (const s of STACKS) {
    mkdirSync(join(d, 'fonts', s), { recursive: true });
    writeFileSync(join(d, 'fonts', s, '0-255.pbf'), 'g');
  }
  writeFileSync(
    join(d, 'report.json'),
    JSON.stringify({
      invariants: ['V1', 'V11', 'V13'].map(ok),
      tilesSkipped: false,
      lockSha256: lockSha256(lock),
      ...report
    })
  );
  const base = `/data/${v}`;
  writeFileSync(
    join(d, 'manifest.json'),
    JSON.stringify({
      datasetVersion: v,
      builtAt: '2026-10-10T00:00:00.000Z',
      sources: [],
      chunks: [
        { cellId: '50_25', bbox: [0, 0, 1, 1], url: `${base}/parcels/50_25.json`, parcelCount: 1 }
      ],
      buildingsTiles: `${base}/buildings.pmtiles`,
      basemapTiles: `${base}/basemap.pmtiles`,
      glyphs: `${base}/fonts/{fontstack}/{range}.pbf`,
      neighborhoods: `${base}/neighborhoods.geojson`
    })
  );
  return d;
}
const lock: Lock = { sources: [] };
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
    const rep = puts.indexOf('put data/fixture-7/report.json');
    expect(rep).toBeGreaterThanOrEqual(0);
    expect(rep).toBeLessThan(puts.indexOf('put data/fixture-7/manifest.json'));
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
  it.each(['my notes.txt', '.DS_Store', 'x/ y.json'])(
    'rejects the invalid key %s with zero puts',
    async (name) => {
      const { t, calls } = fakeTarget();
      const o = opts(t);
      if (name.includes('/')) mkdirSync(join(o.outDir, 'x'));
      writeFileSync(join(o.outDir, name), '');
      expect(await upload(o)).toBe(1);
      expect(calls.filter((c) => c.startsWith('put'))).toEqual([]);
    }
  );
  it('rejects an invalid archive key with zero puts', async () => {
    const { t, calls } = fakeTarget();
    const lk = {
      sources: [
        {
          id: 's',
          files: [{ url: 'u', sha256: 'a', bytes: 1, archiveKey: 'sources/a b', name: 'a' }],
          retrievedAt: '',
          upstreamVersion: '',
          rowCount: 0,
          license: '',
          homepage: ''
        }
      ]
    };
    expect(await upload(opts(t, { lock: lk }))).toBe(1);
    expect(calls.filter((c) => c.startsWith('put'))).toEqual([]);
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
  describe('refuses an unpublishable dataset with zero puts and no V13 probe', () => {
    const refuses = async (o: ReturnType<typeof opts>) => {
      const { t, calls } = fakeTarget();
      const logs: string[] = [];
      expect(await upload({ ...o, target: t, log: (s: string) => logs.push(s) })).toBe(1);
      expect(calls).toEqual([]);
      return logs.join('\n');
    };
    it('a failed invariant', async () => {
      const o = opts(fakeTarget().t, {
        outDir: outDir('fixture-7', {
          invariants: [ok('V1'), { id: 'V11', ok: false, detail: 'over budget' }]
        })
      });
      expect(await refuses(o)).toContain('invariant V11 failed');
    });
    it('a missing report.json', async () => {
      const o = opts(fakeTarget().t);
      rmSync(join(o.outDir, 'report.json'));
      expect(await refuses(o)).toContain('report.json');
    });
    it('a --skip-tiles build', async () => {
      const o = opts(fakeTarget().t, { outDir: outDir('fixture-7', { tilesSkipped: true }) });
      expect(await refuses(o)).toContain('--skip-tiles');
    });
    it('a report without tilesSkipped (pre-dates the flag)', async () => {
      const o = opts(fakeTarget().t, { outDir: outDir('fixture-7', { tilesSkipped: undefined }) });
      expect(await refuses(o)).toContain('no tilesSkipped');
    });
    it.each([
      'buildings.pmtiles',
      'basemap.pmtiles',
      'neighborhoods.geojson',
      'parcels/50_25.json',
      'fonts/NotoSans-Italic/0-255.pbf'
    ])('a missing referenced file %s', async (rel) => {
      const o = opts(fakeTarget().t);
      rmSync(join(o.outDir, rel));
      expect(await refuses(o)).toContain(`${rel} is missing`);
    });
    it('a live version whose current lock is not the lock that built it', async () => {
      const v = '2026-10-10-abcdef12';
      const other: Lock = {
        sources: [
          {
            id: 's',
            files: [],
            retrievedAt: '2026-10-10T00:00:00.000Z',
            upstreamVersion: '',
            rowCount: 0,
            license: '',
            homepage: ''
          }
        ]
      };
      const o = opts(fakeTarget().t, { outDir: outDir(v), datasetVersion: v, lock: other });
      expect(await refuses(o)).toContain('is not the lock that built');
    });
  });
  it('uploads a live version built from the current lock', async () => {
    const v = '2026-10-10-abcdef12';
    const { t, calls } = fakeTarget();
    expect(await upload(opts(t, { outDir: outDir(v), datasetVersion: v }))).toBe(0);
    expect(calls[calls.length - 1]).toBe(`put data/${v}/manifest.json`);
  });
  it('skips the lock check for fixture versions', async () => {
    const { t } = fakeTarget();
    const o = opts(t, { outDir: outDir('fixture-7', { lockSha256: 'f'.repeat(64) }) });
    expect(await upload(o)).toBe(0);
  });
});
