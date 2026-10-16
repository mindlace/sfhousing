import { describe, expect, it } from 'vitest';
import type { Lock } from '../lib/lock';
import { buildManifest } from '../steps/manifest';

const lock: Lock = {
  sources: [
    {
      id: 'overture-buildings',
      files: [],
      retrievedAt: '2026-10-09T00:00:00.000Z',
      upstreamVersion: '2026-09-17.0',
      rowCount: 1,
      license: 'ODbL-1.0',
      label: 'Overture Maps Buildings',
      homepage: 'https://overturemaps.org'
    }
  ]
};

describe('buildManifest', () => {
  it('expands Overture contributors with SPDX licences and warns on an unknown dataset', () => {
    const warnings: string[] = [];
    const m = buildManifest({
      datasetVersion: 'fixture-3',
      builtAt: '2026-10-10T00:00:00.000Z',
      lock,
      chunks: [
        {
          cellId: '48_24',
          bbox: [-122.42, 37.75, -122.41, 37.76],
          path: 'parcels/48_24.json',
          parcelCount: 2,
          rawBytes: 1,
          gzipBytes: 1
        }
      ],
      overtureContrib: [
        { dataset: 'Esri Community Maps', n: 1 },
        { dataset: 'Mystery Source', n: 2 },
        { dataset: 'OpenStreetMap', n: 3 }
      ],
      warn: (w) => warnings.push(w)
    });
    expect(m.sources.map((s) => [s.id, s.license])).toEqual([
      ['overture-buildings', 'ODbL-1.0'],
      ['overture:Esri Community Maps', 'CC-BY-4.0'],
      ['overture:Mystery Source', 'ODbL-1.0'],
      ['overture:OpenStreetMap', 'ODbL-1.0']
    ]);
    expect(m.sources[1]).toMatchObject({
      label: 'Esri Community Maps via Overture Maps',
      url: 'https://docs.overturemaps.org/attribution',
      retrievedAt: '2026-10-09T00:00:00.000Z'
    });
    expect(m.sources[0].url).toBe('https://overturemaps.org');
    expect(warnings).toEqual([
      "unknown Overture dataset 'Mystery Source': licence assumed ODbL-1.0"
    ]);
    expect(m.chunks[0].url).toBe('/data/fixture-3/parcels/48_24.json');
    expect(m.glyphs).toBe('/data/fixture-3/fonts/{fontstack}/{range}.pbf');
    expect('sprite' in m).toBe(false);
  });

  it('names transit.json when the build wrote one', () => {
    const m = buildManifest({
      datasetVersion: 'fixture-3',
      builtAt: '2026-10-10T00:00:00.000Z',
      lock: { sources: [] },
      chunks: [],
      overtureContrib: [],
      transit: true
    });
    expect(m.transit).toBe('/data/fixture-3/transit.json');
  });
});
