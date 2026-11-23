import { describe, expect, it } from 'vitest';
import golden from '../src/lib/data/fixtures/manifest.golden.json';
import { parseManifest } from '../src/lib/data/manifest';
import {
  devVarsVersion,
  lockDrift,
  manifestWithTransit,
  withTransit
} from './lib/data-transit-helpers';

describe('data:transit helpers', () => {
  it('reads PUBLIC_DATASET_VERSION from .dev.vars text', () => {
    expect(devVarsVersion('# c\nPUBLIC_DATASET_VERSION=fixture-0\nX=1\n')).toBe('fixture-0');
    expect(devVarsVersion('PUBLIC_DATASET_VERSION="2026-10-10-3fa9c2d1"')).toBe(
      '2026-10-10-3fa9c2d1'
    );
    expect(devVarsVersion('X=1')).toBeNull();
  });

  it('adds transit to a manifest and keeps it valid', () => {
    const m = withTransit(parseManifest(structuredClone(golden)));
    expect(m.transit).toBe(`/data/${m.datasetVersion}/transit.json`);
    expect(parseManifest(m).transit).toBe(m.transit);
  });

  it('rewrites an older manifest with only transit set, keeping scenarios.lesscars and the mark', () => {
    const v = golden.datasetVersion;
    const lesscars = { plan: `/data/${v}/scenarios/lesscars/plan.json` };
    const raw = {
      ...structuredClone(golden),
      scenarios: {
        fzp: {
          parcels: `/data/${v}/scenarios/fzp/parcels.bin`,
          projects: `/data/${v}/scenarios/fzp/projects.json`,
          calibration: `/data/${v}/scenarios/fzp/calibration.json`
        },
        lesscars
      }
    };
    const written = JSON.parse(JSON.stringify(manifestWithTransit(raw))) as Record<string, unknown>;
    expect((written.scenarios as Record<string, unknown>).lesscars).toEqual(lesscars);
    expect(written).not.toHaveProperty('splitRoads');
    expect(written.transit).toBe(`/data/${v}/transit.json`);
    expect(parseManifest(written).splitRoads).toBe(true);
  });

  it('reports gtfs entries whose bytes differ from the committed lock', () => {
    const entry = (id: string, sha256: string) => ({
      id,
      files: [{ url: 'u', sha256, bytes: 1, archiveKey: 'k', name: `${id}.zip` }],
      retrievedAt: '2026-10-14T00:00:00.000Z',
      upstreamVersion: 'v',
      rowCount: 1,
      license: 'l',
      homepage: 'https://x.invalid'
    });
    const committed = { sources: [entry('gtfs-muni', 'a'), entry('gtfs-bart', 'b')] };
    const fetched = {
      sources: [entry('gtfs-muni', 'a'), entry('gtfs-bart', 'c'), entry('gtfs-caltrain', 'd')]
    };
    expect(lockDrift(committed, fetched)).toEqual([
      'gtfs-bart: fetched bytes differ from pipeline/sources.lock.json (feed rolled over)',
      'gtfs-caltrain: not in pipeline/sources.lock.json'
    ]);
  });
});
