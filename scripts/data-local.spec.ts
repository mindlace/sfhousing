import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ManifestSchema } from '../src/lib/data/manifest';
import { FONT_STACKS } from '../pipeline/config';
import { collectDataPaths, isOptionalPath } from './data-local';

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
  sprite: '/data/fixture-0/sprite/basemap',
  scenarios: {
    fzp: {
      parcels: '/data/fixture-0/scenarios/fzp/parcels.bin',
      projects: '/data/fixture-0/scenarios/fzp/projects.json',
      calibration: '/data/fixture-0/scenarios/fzp/calibration.json',
      policy: '/data/fixture-0/scenarios/fzp/policy.bin',
      gross: '/data/fixture-0/scenarios/fzp/gross.bin'
    },
    lesscars: {
      plan: '/data/fixture-0/scenarios/lesscars/plan.json',
      sites: '/data/fixture-0/scenarios/lesscars/sites.json',
      summary: '/data/fixture-0/scenarios/lesscars/summary.json',
      timeline: '/data/fixture-0/scenarios/lesscars/timeline.bin'
    }
  }
});
const glyphPaths = Object.values(FONT_STACKS).flatMap((s) =>
  Array.from({ length: 256 }, (_, i) => `fonts/${s}/${i * 256}-${i * 256 + 255}.pbf`)
);

describe('collectDataPaths', () => {
  it('returns sorted, de-duplicated relative paths including sprite variants', () => {
    expect(collectDataPaths(manifest, 'fixture-0')).toEqual(
      [
        'basemap.pmtiles',
        'buildings.pmtiles',
        'manifest.json',
        'neighborhoods.geojson',
        'parcels/0_0.json',
        'parcels/0_1.json',
        'scenarios/fzp/calibration.json',
        'scenarios/fzp/gross.bin',
        'scenarios/fzp/parcels.bin',
        'scenarios/fzp/policy.bin',
        'scenarios/fzp/projects.json',
        'scenarios/lesscars/plan.json',
        'scenarios/lesscars/sites.json',
        'scenarios/lesscars/summary.json',
        'scenarios/lesscars/timeline.bin',
        'sprite/basemap.json',
        'sprite/basemap.png',
        'sprite/basemap@2x.json',
        'sprite/basemap@2x.png',
        'transit.json',
        ...glyphPaths
      ].sort()
    );
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

  it('lists every glyph range of every font stack and no source urls', () => {
    const all = collectDataPaths(manifest, 'fixture-0');
    const fonts = all.filter((p) => p.startsWith('fonts/'));
    expect(fonts).toHaveLength(768);
    expect(all.some((p) => p.includes('{') || p.includes('http'))).toBe(false);
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

describe('isOptionalPath', () => {
  it('isOptionalPath tolerates sprite variants and glyph ranges only', () => {
    const m = { ...manifest, sprite: '/data/fixture-0/assets/atlas' };
    expect(isOptionalPath(m, 'fixture-0', 'assets/atlas@2x.png')).toBe(true);
    expect(isOptionalPath(m, 'fixture-0', 'assets/atlas.json')).toBe(true);
    expect(isOptionalPath(m, 'fixture-0', 'parcels/0_0.json')).toBe(false);
    expect(isOptionalPath(m, 'fixture-0', 'scenarios/fzp/gross.bin')).toBe(false);
    expect(isOptionalPath(m, 'fixture-0', 'fonts/NotoSans-Regular/0-255.pbf')).toBe(true);
    expect(isOptionalPath(m, 'fixture-0', 'fonts/NotoSans-Italic/65280-65535.pbf')).toBe(true);
    expect(isOptionalPath(m, 'fixture-0', 'neighborhoods.geojson')).toBe(false);
  });
});
