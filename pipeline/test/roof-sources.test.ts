import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { fetchRoofSources, type RoofSourceConfig } from '../roofs/sources';
import type { Http } from '../lib/http';
import syntheticTree from './fixtures/roofs/ept-tree.json';

const config: RoofSourceConfig = {
  schemaVersion: 1,
  lidar: {
    url: 'https://example.test/',
    horizontalCrs: 'EPSG:3857',
    verticalCrs: null,
    horizontalUnits: 'm',
    verticalUnits: 'm',
    acquisitionStart: null,
    acquisitionEnd: null,
    license: 'public-domain'
  },
  coverage: [{ id: 'test', bbox: [0, 0, 0.00001, 0.00001] }],
  supportBufferM: 50,
  aerial: {
    url: 'https://imagery.test/{z}/{x}/{y}.png',
    zoom: 19,
    permission: 'unconfirmed',
    alignment: 'unverified',
    enabled: false,
    tiles: []
  }
};
const objects: Record<string, unknown> = syntheticTree;
function fake(fail?: string): { http: Http; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    http: {
      async get(url) {
        const key = url.replace(config.lidar.url, '');
        calls.push(key);
        const value = objects[key];
        return {
          status: key === fail || value === undefined ? 404 : 200,
          headers: new Headers(),
          body: new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value))
        };
      }
    }
  };
}
test('archives intersecting nodes at every depth once and records denied imagery explicitly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roofs-'));
  try {
    const { http, calls } = fake();
    const entries = await fetchRoofSources({ rawDir: dir, config, http });
    expect(entries[0].files.map((f) => f.name)).toEqual([
      'ept.json',
      'ept-hierarchy/0-0-0-0.json',
      'ept-hierarchy/1-1-1-0.json',
      'ept-data/0-0-0-0.laz',
      'ept-data/1-1-1-0.laz',
      'ept-data/2-2-2-0.laz',
      'ept-data/6-22-22-0.laz'
    ]);
    expect(new Set(calls).size).toBe(calls.length);
    expect(entries[0].spatial?.supportBufferM).toBe(50);
    expect(entries[1].files).toEqual([]);
    expect(entries[1].spatial?.permission).toBe('unconfirmed');
    expect(calls.some((c) => c.includes('imagery'))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('a listed required node failing aborts acquisition', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roofs-'));
  try {
    await expect(
      fetchRoofSources({ rawDir: dir, config, http: fake('ept-data/1-1-1-0.laz').http })
    ).rejects.toThrow('404');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('confirmed aerial downloads preserve exact tile URL and fail a listed hash mismatch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roofs-'));
  const enabled: RoofSourceConfig = {
    ...config,
    aerial: {
      ...config.aerial,
      enabled: true,
      permission: 'confirmed',
      license: 'test-permission',
      tiles: [{ x: 0, y: 0, sha256: '0'.repeat(64) }]
    }
  };
  const base = fake();
  const http: Http = {
    get: async (url) =>
      url.startsWith('https://imagery.test/')
        ? { status: 200, headers: new Headers(), body: new Uint8Array([1]) }
        : base.http.get(url)
  };
  try {
    await expect(fetchRoofSources({ rawDir: dir, config: enabled, http })).rejects.toThrow(
      'sha256 mismatch'
    );
    enabled.aerial.tiles[0].sha256 = undefined;
    const entries = await fetchRoofSources({ rawDir: dir, config: enabled, http });
    expect(entries[1].files[0].url).toBe('https://imagery.test/19/0/0.png');
    expect(entries[1].spatial?.tiles?.[0].width).toBe(512);
    const bbox = entries[1].spatial!.coverage[0].bbox;
    expect(bbox[0]).toBe(-180);
    expect(bbox[1]).toBeCloseTo(85.0510695448, 9);
    expect(bbox[2]).toBeCloseTo(-179.9993133545, 9);
    expect(bbox[3]).toBeCloseTo(85.0511287798, 9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
