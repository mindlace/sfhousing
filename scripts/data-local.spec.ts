import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../src/lib/data/manifest';
import { collectDataPaths, isSpritePath } from './data-local';

const fixture = JSON.parse(readFileSync('e2e/fixtures/data/fixture-0/manifest.json', 'utf8'));
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
      'sprite/basemap@2x.png',
      'transit.json'
    ]);
  });

  it('lists transit.json only when the manifest has a transit url', () => {
    expect(collectDataPaths(manifest, 'fixture-0')).toContain('transit.json');
    const withoutTransit = { ...manifest };
    delete withoutTransit.transit;
    expect(collectDataPaths(withoutTransit, 'fixture-0')).not.toContain('transit.json');
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
