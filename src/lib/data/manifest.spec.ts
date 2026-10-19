import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestSchema, ManifestSourcesSchema, manifestUrl } from './manifest';

const validManifest = {
  datasetVersion: 'fixture-0',
  builtAt: '2026-10-10T00:00:00.000Z',
  sources: [
    {
      id: 'datasf-parcels',
      label: 'DataSF parcels',
      url: 'https://data.sfgov.org/',
      retrievedAt: '2026-10-10T00:00:00.000Z',
      license: 'PDDL'
    },
    {
      id: 'overture-buildings',
      url: 'https://overturemaps.org/',
      retrievedAt: '2026-10-10T00:00:00.000Z',
      license: 'ODbL'
    }
  ],
  chunks: [
    {
      cellId: '0_0',
      bbox: [-122.52, 37.7, -122.35, 37.83],
      url: '/data/fixture-0/parcels/0_0.json',
      parcelCount: 3
    }
  ],
  buildingsTiles: '/data/fixture-0/buildings.pmtiles',
  basemapTiles: '/data/fixture-0/basemap.pmtiles',
  glyphs: '/data/fixture-0/fonts/{fontstack}/{range}.pbf',
  neighborhoods: '/data/fixture-0/neighborhoods.geojson'
};

describe('ManifestSchema', () => {
  it('parses a valid I12 manifest', () => {
    expect(ManifestSchema.safeParse(validManifest).success).toBe(true);
  });

  it('still parses a manifest with an extra unknown top-level field', () => {
    expect(ManifestSchema.safeParse({ ...validManifest, extra: 1 }).success).toBe(true);
  });

  it('rejects datasetVersion that does not match the I12 pattern', () => {
    expect(ManifestSchema.safeParse({ ...validManifest, datasetVersion: 'test-v1' }).success).toBe(
      false
    );
  });
});

describe('URL hardening', () => {
  const parse = (patch: object) => ManifestSchema.safeParse({ ...validManifest, ...patch });

  it('rejects traversal and empty segments in root-relative urls', () => {
    expect(parse({ neighborhoods: '/data/../x' }).success).toBe(false);
    expect(parse({ neighborhoods: '/data//x' }).success).toBe(false);
    expect(parse({ neighborhoods: '/data/fixture-0/./x' }).success).toBe(false);
    expect(parse({ buildingsTiles: '/data/fixture-0/../../etc/x' }).success).toBe(false);
  });

  it('still accepts the glyphs template', () => {
    expect(parse({ glyphs: '/data/fixture-0/fonts/{fontstack}/{range}.pbf' }).success).toBe(true);
  });

  it('rejects non-http(s) source urls', () => {
    const src = (url: string) => ({ ...validManifest.sources[0], url });
    expect(parse({ sources: [src('javascript:alert(1)')] }).success).toBe(false);
    expect(parse({ sources: [src('data:text/html,x')] }).success).toBe(false);
    expect(parse({ sources: [src('https://data.sfgov.org/')] }).success).toBe(true);
  });
});

describe('ManifestSourcesSchema', () => {
  it('parses an object whose chunks are malformed (attribution ignores chunk shape)', () => {
    const parsed = ManifestSourcesSchema.safeParse({
      datasetVersion: 'fixture-0',
      builtAt: '2026-10-10T00:00:00.000Z',
      sources: validManifest.sources,
      chunks: 'not-an-array'
    });
    expect(parsed.success).toBe(true);
  });

  it('keeps scenarios.fzp from the fixture-0 manifest', () => {
    const raw = JSON.parse(readFileSync('e2e/fixtures/data/fixture-0/manifest.json', 'utf8'));
    const parsed = ManifestSourcesSchema.parse(raw);
    expect(parsed.scenarios?.fzp.calibration).toBe(
      '/data/fixture-0/scenarios/fzp/calibration.json'
    );
  });

  it('still parses a manifest without scenarios', () => {
    const parsed = ManifestSourcesSchema.parse({
      datasetVersion: 'fixture-0',
      builtAt: '2026-10-10T00:00:00.000Z',
      sources: validManifest.sources
    });
    expect(parsed.scenarios).toBeUndefined();
  });
});

describe('manifestUrl', () => {
  it('builds the root-relative manifest path for a version', () => {
    expect(manifestUrl('fixture-0')).toBe('/data/fixture-0/manifest.json');
  });
});

describe('fixture dataset', () => {
  it('e2e/fixtures/data/fixture-0/manifest.json parses against the I12 schema', () => {
    const raw = JSON.parse(readFileSync('e2e/fixtures/data/fixture-0/manifest.json', 'utf8'));
    expect(ManifestSchema.safeParse(raw).success).toBe(true);
  });
});
