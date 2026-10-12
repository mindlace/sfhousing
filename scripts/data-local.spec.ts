import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../src/lib/data/manifest';
import { collectDataPaths, isSpritePath } from './data-local';

const fixture = JSON.parse(readFileSync('pipeline/test/fixtures/legacy/manifest.json', 'utf8'));
const chunk = (cellId: string) => ({
  cellId,
  bbox: [0, 0, 1, 1] as [number, number, number, number],
  url: `/data/fixture-0/parcels/${cellId}.json`,
  parcelCount: 1
});
const manifest = ManifestSchema.parse({
  ...fixture,
  chunks: [chunk('0_0'), chunk('0_1')],
  sprite: '/data/fixture-0/sprite/basemap'
});

describe('collectDataPaths', () => {
  it('returns sorted, de-duplicated relative paths including sprite variants', () => {
    expect(collectDataPaths(manifest, 'fixture-0')).toEqual([
      'basemap.pmtiles',
      'buildings.pmtiles',
      'manifest.json',
      'neighborhoods.geojson',
      'parcels/0_0.json',
      'parcels/0_1.json',
      'sprite/basemap.json',
      'sprite/basemap.png',
      'sprite/basemap@2x.json',
      'sprite/basemap@2x.png'
    ]);
  });

  it('de-duplicates repeated chunk urls', () => {
    const dup = { ...manifest, chunks: [chunk('0_0'), chunk('0_0')] };
    expect(collectDataPaths(dup, 'fixture-0').filter((p) => p === 'parcels/0_0.json')).toHaveLength(
      1
    );
  });

  it('excludes the glyphs template and source urls', () => {
    const paths = collectDataPaths(manifest, 'fixture-0').join('\n');
    expect(paths).not.toContain('fonts');
    expect(paths).not.toContain('http');
  });

  it('throws for a url outside the version', () => {
    const bad = { ...manifest, neighborhoods: '/data/fixture-1/neighborhoods.geojson' };
    expect(() => collectDataPaths(bad, 'fixture-0')).toThrow(/outside version/);
  });

  it('throws for a traversal url that stays under the version prefix', () => {
    const bad = { ...manifest, chunks: [chunk('0_0')] };
    bad.chunks[0].url = '/data/fixture-0/../../etc/x';
    expect(() => collectDataPaths(bad, 'fixture-0')).toThrow();
  });
});

describe('isSpritePath', () => {
  it('matches sprite variants wherever the sprite base lives', () => {
    const m = { ...manifest, sprite: '/data/fixture-0/assets/atlas' };
    expect(isSpritePath(m, 'fixture-0', 'assets/atlas@2x.png')).toBe(true);
    expect(isSpritePath(m, 'fixture-0', 'assets/atlas.json')).toBe(true);
    expect(isSpritePath(m, 'fixture-0', 'parcels/0_0.json')).toBe(false);
  });
});

it('includes supported roof child paths while preserving existing paths', () => {
  const m = {
    ...manifest,
    buildingRoofs: {
      schemaVersion: 1,
      indexUrl: '/data/fixture-0/roofs/index.json',
      auditUrl: '/data/fixture-0/roofs/audit.json',
      reportUrl: '/data/fixture-0/roofs/report.json'
    }
  };
  const index = {
    schemaVersion: 1 as const,
    datasetVersion: 'fixture-0',
    chunks: [
      {
        chunkId: 'x',
        bbox: [0, 0, 1, 1] as [number, number, number, number],
        headerUrl: '/data/fixture-0/roofs/x.json',
        meshUrl: '/data/fixture-0/roofs/x.bin',
        headerSha256: 'a'.repeat(64),
        meshSha256: 'b'.repeat(64),
        headerBytes: 400,
        meshBytes: 96,
        gzipBytes: 200,
        pieceCount: 1,
        modelCount: 1
      }
    ]
  };
  expect(collectDataPaths(m, 'fixture-0', index)).toContain('roofs/x.bin');
  expect(collectDataPaths(m, 'fixture-0', index)).toContain('roofs/x.json');
  expect(
    collectDataPaths(
      { ...m, buildingRoofs: { ...m.buildingRoofs, schemaVersion: 99 } },
      'fixture-0',
      index
    )
  ).not.toContain('roofs/x.bin');
});

it('copies every generated roof child and purges stale local cache after completion', async () => {
  const { copyDataLocal } = await import('./data-local');
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'data-local-roof-'));
  const cache = join(root, '.wrangler/state/v3/cache');
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, 'stale'), 'old');
  const copied = new Map<string, Buffer>();
  const fetcher = (async (url: RequestInfo | URL) => {
    const path = new URL(String(url)).pathname.replace('/data/fixture-0/', '');
    try {
      return new Response(readFileSync(join('e2e/fixtures/data/fixture-0', path)));
    } catch {
      return new Response(null, { status: 404 });
    }
  }) as typeof fetch;
  try {
    await copyDataLocal({
      version: 'fixture-0',
      origin: 'http://offline',
      projectRoot: root,
      fetch: fetcher,
      put: async (_v, rel, file) => {
        copied.set(rel, readFileSync(file));
      }
    });
    const index = JSON.parse(copied.get('roofs/index.json')!.toString());
    expect(index.chunks.length).toBeGreaterThan(0);
    for (const c of index.chunks) {
      expect(copied.has(c.headerUrl.replace('/data/fixture-0/', ''))).toBe(true);
      expect(copied.has(c.meshUrl.replace('/data/fixture-0/', ''))).toBe(true);
    }
    expect(existsSync(cache)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
