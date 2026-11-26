import { readFileSync } from 'node:fs';
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

  it('buildManifest omits scenarios by default', () => {
    const m = buildManifest({
      datasetVersion: 'fixture-3',
      builtAt: '2026-10-10T00:00:00.000Z',
      lock: { sources: [] },
      chunks: [],
      overtureContrib: []
    });
    expect('scenarios' in m).toBe(false);
  });

  it('never names frontage', () => {
    const m = buildManifest({
      datasetVersion: 'fixture-3',
      builtAt: '2026-10-10T00:00:00.000Z',
      lock: { sources: [] },
      chunks: [],
      overtureContrib: [],
      scenarios: true,
      policy: true
    });
    expect(m.scenarios?.fzp.policy).toBe('/data/fixture-3/scenarios/fzp/policy.bin');
    expect('frontage' in m.scenarios!.fzp).toBe(false);
  });

  it('ignores policy without scenarios', () => {
    const m = buildManifest({
      datasetVersion: 'fixture-3',
      builtAt: '2026-10-10T00:00:00.000Z',
      lock: { sources: [] },
      chunks: [],
      overtureContrib: [],
      policy: true
    });
    expect('scenarios' in m).toBe(false);
  });

  it('emits the three urls under /data/<v>/scenarios/fzp/ when scenarios is true', () => {
    const m = buildManifest({
      datasetVersion: 'fixture-3',
      builtAt: '2026-10-10T00:00:00.000Z',
      lock: { sources: [] },
      chunks: [],
      overtureContrib: [],
      scenarios: true
    });
    expect(m.scenarios).toEqual({
      fzp: {
        parcels: '/data/fixture-3/scenarios/fzp/parcels.bin',
        projects: '/data/fixture-3/scenarios/fzp/projects.json',
        calibration: '/data/fixture-3/scenarios/fzp/calibration.json'
      }
    });
  });

  it('buildManifest names gross.bin only with scenarios and gross', () => {
    const at = (scenarios: boolean, gross: boolean) =>
      buildManifest({
        datasetVersion: 'fixture-3',
        builtAt: '2026-10-10T00:00:00.000Z',
        lock: { sources: [] },
        chunks: [],
        overtureContrib: [],
        scenarios,
        gross
      });
    expect(at(true, true).scenarios?.fzp.gross).toBe('/data/fixture-3/scenarios/fzp/gross.bin');
    expect('gross' in at(true, false).scenarios!.fzp).toBe(false);
    expect('scenarios' in at(false, true)).toBe(false);
  });
});

describe('buildManifest cars', () => {
  it('names cars.bin and car-zones.json only with scenarios and cars', () => {
    const at = (scenarios: boolean, cars: boolean) =>
      buildManifest({
        datasetVersion: 'fixture-3',
        builtAt: '2026-10-10T00:00:00.000Z',
        lock: { sources: [] },
        chunks: [],
        overtureContrib: [],
        scenarios,
        cars
      });
    expect(at(true, true).scenarios?.fzp.cars).toBe('/data/fixture-3/scenarios/fzp/cars.bin');
    expect(at(true, true).scenarios?.fzp.carZones).toBe(
      '/data/fixture-3/scenarios/fzp/car-zones.json'
    );
    expect('cars' in at(true, false).scenarios!.fzp).toBe(false);
    expect('carZones' in at(true, false).scenarios!.fzp).toBe(false);
    expect('scenarios' in at(false, true)).toBe(false);
  });
});

describe('the mini manifest', () => {
  it('the manifest lists building-boxes', () => {
    for (const f of [
      'pipeline/test/fixtures/mini/golden/manifest.json',
      'e2e/fixtures/data/fixture-0/manifest.json'
    ]) {
      const m = JSON.parse(readFileSync(f, 'utf8')) as { sources: { id: string }[] };
      expect(m.sources).toContainEqual(
        expect.objectContaining({
          id: 'building-boxes',
          license: 'ODbL-1.0',
          label: 'Building boxes (USGS 3DEP LiDAR 2023 and Overture)'
        })
      );
    }
  });
});
