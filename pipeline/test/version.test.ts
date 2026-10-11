import { describe, expect, it } from 'vitest';
import { DATASET_VERSION_RE } from '../../src/lib/data/manifest';
import type { Lock } from '../lib/lock';
import { codeTreeHash, computeDatasetVersion } from '../lib/version';

const lock = (): Lock => ({
  sources: [
    {
      id: 'datasf-parcels',
      files: [
        {
          url: 'https://data.sf.gov/a',
          sha256: 'a'.repeat(64),
          bytes: 10,
          archiveKey: `sources/${'a'.repeat(64)}.geojson`,
          name: 'page-000.geojson'
        }
      ],
      retrievedAt: '2026-10-09T23:59:00.000Z',
      upstreamVersion: 'x',
      rowCount: 1,
      license: 'PDDL-1.0',
      homepage: 'https://data.sf.gov/d/acdm-wktn'
    },
    {
      id: 'overture-buildings',
      files: [
        {
          url: 's3://o',
          sha256: 'b'.repeat(64),
          bytes: 10,
          archiveKey: `sources/${'b'.repeat(64)}.parquet`,
          name: 'buildings.parquet'
        }
      ],
      retrievedAt: '2026-10-10T00:00:01.000Z',
      upstreamVersion: '2026-09-23.1',
      rowCount: 1,
      license: 'ODbL-1.0',
      homepage: 'https://overturemaps.org'
    }
  ]
});
const tools = { tippecanoe: '2.79.0', pmtiles: '1.31.2' };

describe('computeDatasetVersion', () => {
  it('is stable, dated by newest retrievedAt (UTC), and matches DATASET_VERSION_RE', () => {
    const a = computeDatasetVersion({ lock: lock(), codeHash: 'c1', toolVersions: tools });
    expect(a).toBe(
      computeDatasetVersion({
        lock: lock(),
        codeHash: 'c1',
        toolVersions: { pmtiles: '1.31.2', tippecanoe: '2.79.0' }
      })
    );
    expect(a).toMatch(DATASET_VERSION_RE);
    expect(a.startsWith('2026-10-10-')).toBe(true);
  });
  it('changes when any sha, the code hash or a tool version changes', () => {
    const base = computeDatasetVersion({ lock: lock(), codeHash: 'c1', toolVersions: tools });
    const l = lock();
    l.sources[0].files[0].sha256 = 'c'.repeat(64);
    expect(computeDatasetVersion({ lock: l, codeHash: 'c1', toolVersions: tools })).not.toBe(base);
    expect(computeDatasetVersion({ lock: lock(), codeHash: 'c2', toolVersions: tools })).not.toBe(
      base
    );
    expect(
      computeDatasetVersion({
        lock: lock(),
        codeHash: 'c1',
        toolVersions: { ...tools, tippecanoe: '2.80.0' }
      })
    ).not.toBe(base);
  });
});

describe('codeTreeHash', () => {
  it('returns a non-empty stable string for the current repo', async () => {
    const root = process.cwd();
    const a = await codeTreeHash(root);
    const b = await codeTreeHash(root);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toBe(b);
  });
});
