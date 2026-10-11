import { describe, expect, it } from 'vitest';
import golden from './fixtures/manifest.golden.json';
import { ManifestError, parseManifest } from './manifest';

const g = () => structuredClone(golden) as Record<string, unknown>;

describe('parseManifest', () => {
  it('accepts the golden (basemapTiles + glyphs, no sprite)', () => {
    const m = parseManifest(g());
    expect(m.datasetVersion).toBe('2026-10-10-3fa9c2d1');
    expect(m.sprite).toBeUndefined();
  });

  it.each([
    'datasetVersion',
    'builtAt',
    'sources',
    'chunks',
    'buildingsTiles',
    'basemapTiles',
    'glyphs',
    'neighborhoods'
  ])('rejects a missing %s', (key) => {
    const m = g();
    delete m[key];
    expect(() => parseManifest(m)).toThrow(ManifestError);
  });

  it('rejects a bad datasetVersion', () => {
    expect(() => parseManifest({ ...g(), datasetVersion: '2026-10-10-3FA9C2D1' })).toThrow(
      ManifestError
    );
  });

  it('rejects urls that are not /data/<v>/…', () => {
    expect(() =>
      parseManifest({ ...g(), neighborhoods: 'https://x/neighborhoods.geojson' })
    ).toThrow(ManifestError);
    expect(() =>
      parseManifest({ ...g(), neighborhoods: '/data/fixture-0/neighborhoods.geojson' })
    ).toThrow(ManifestError);
    expect(() => parseManifest({ ...g(), basemapTiles: 'basemap.pmtiles' })).toThrow(ManifestError);
  });

  it('rejects a malformed or duplicate cellId and an inverted bbox', () => {
    const chunk = golden.chunks[0];
    expect(() => parseManifest({ ...g(), chunks: [{ ...chunk, cellId: '50-25' }] })).toThrow(
      ManifestError
    );
    expect(() => parseManifest({ ...g(), chunks: [chunk, chunk] })).toThrow(ManifestError);
    expect(() =>
      parseManifest({ ...g(), chunks: [{ ...chunk, bbox: [-122.41, 37.76, -122.42, 37.77] }] })
    ).toThrow(ManifestError);
  });

  it('accepts negative cell ids', () => {
    const chunk = {
      ...golden.chunks[0],
      cellId: '-1_-3',
      url: '/data/2026-10-10-3fa9c2d1/parcels/-1_-3.json'
    };
    expect(parseManifest({ ...g(), chunks: [chunk] }).chunks[0].cellId).toBe('-1_-3');
  });

  it('reports issues on the error', () => {
    try {
      parseManifest({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestError);
      expect((e as ManifestError).issues.length).toBeGreaterThan(0);
    }
  });
});
