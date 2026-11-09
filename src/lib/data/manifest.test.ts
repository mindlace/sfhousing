import { describe, expect, it } from 'vitest';
import golden from './fixtures/manifest.golden.json';
import {
  GLYPH_RANGES,
  ManifestError,
  SPRITE_SUFFIXES,
  manifestFiles,
  parseManifest
} from './manifest';

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

  it('accepts a date-only retrievedAt and rejects a non-ISO one', () => {
    const src = (retrievedAt: string) => [{ ...golden.sources[0], retrievedAt }];
    expect(parseManifest({ ...g(), sources: src('2026-10-01') }).sources[0].retrievedAt).toBe(
      '2026-10-01'
    );
    expect(() => parseManifest({ ...g(), sources: src('yesterday') })).toThrow(ManifestError);
  });

  it('rejects a sprite without the version prefix', () => {
    expect(() => parseManifest({ ...g(), sprite: '/data/fixture-0/sprite' })).toThrow(
      ManifestError
    );
    expect(parseManifest({ ...g(), sprite: '/data/2026-10-10-3fa9c2d1/sprite' }).sprite).toBe(
      '/data/2026-10-10-3fa9c2d1/sprite'
    );
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

  it('accepts an optional transit URL under the version prefix', () => {
    const m = g();
    m.transit = `/data/${m.datasetVersion as string}/transit.json`;
    expect(parseManifest(m).transit).toBe(m.transit);
    expect(parseManifest(g()).transit).toBeUndefined();
  });

  it('rejects a transit URL outside the version prefix', () => {
    const m = g();
    m.transit = '/data/2026-01-01-00000000/transit.json';
    expect(() => parseManifest(m)).toThrow(/transit: url must start with/);
  });

  describe('scenarios', () => {
    const v = '2026-10-10-3fa9c2d1';
    const fzp = () => ({
      parcels: `/data/${v}/scenarios/fzp/parcels.bin`,
      projects: `/data/${v}/scenarios/fzp/projects.json`,
      calibration: `/data/${v}/scenarios/fzp/calibration.json`
    });

    it('scenarios is optional', () => {
      expect(parseManifest(g()).scenarios).toBeUndefined();
    });

    it('a full scenarios object parses', () => {
      const m = parseManifest({ ...g(), scenarios: { fzp: fzp() } });
      expect(m.scenarios?.fzp).toEqual(fzp());
    });

    it('a partial fzp object is rejected', () => {
      const { parcels, projects } = fzp();
      expect(() => parseManifest({ ...g(), scenarios: { fzp: { parcels, projects } } })).toThrow(
        ManifestError
      );
    });

    it('a scenarios url with another version prefix is rejected', () => {
      const bad = {
        ...fzp(),
        calibration: '/data/2026-01-01-00000000/scenarios/fzp/calibration.json'
      };
      expect(() => parseManifest({ ...g(), scenarios: { fzp: bad } })).toThrow(
        /scenarios\.fzp\.calibration: url must start with/
      );
    });

    it('the golden manifest, which has no policy/frontage keys, parses without them', () => {
      const m = parseManifest(g());
      expect(m.scenarios?.fzp.policy).toBeUndefined();
      expect(m.scenarios?.fzp.frontage).toBeUndefined();
    });

    it('policy and frontage parse when present', () => {
      const full = {
        ...fzp(),
        policy: `/data/${v}/scenarios/fzp/policy.bin`,
        frontage: `/data/${v}/scenarios/fzp/frontage.bin`
      };
      const m = parseManifest({ ...g(), scenarios: { fzp: full } });
      expect(m.scenarios?.fzp.policy).toBe(full.policy);
      expect(m.scenarios?.fzp.frontage).toBe(full.frontage);
    });

    it('a policy url under another version is rejected', () => {
      const bad = { ...fzp(), policy: '/data/2026-01-01-00000000/scenarios/fzp/policy.bin' };
      expect(() => parseManifest({ ...g(), scenarios: { fzp: bad } })).toThrow(
        /scenarios\.fzp\.policy: url must start with/
      );
    });

    it('accepts scenarios.lesscars and checks its url prefix', () => {
      const lesscars = {
        plan: `/data/${v}/scenarios/lesscars/plan.json`,
        sites: `/data/${v}/scenarios/lesscars/sites.json`,
        summary: `/data/${v}/scenarios/lesscars/summary.json`,
        timeline: `/data/${v}/scenarios/lesscars/timeline.bin`
      };
      const m = parseManifest({ ...g(), scenarios: { fzp: fzp(), lesscars } });
      expect(m.scenarios?.lesscars).toEqual(lesscars);
      const bad = { ...lesscars, timeline: '/data/2026-01-01-00000000/scenarios/lesscars/t.bin' };
      expect(() => parseManifest({ ...g(), scenarios: { fzp: fzp(), lesscars: bad } })).toThrow(
        /scenarios\.lesscars\.timeline: url must start with/
      );
    });

    it('the golden manifest still validates', () => {
      expect(parseManifest(g()).datasetVersion).toBe(v);
    });
  });
});

function issuePaths(raw: unknown): string[][] {
  try {
    parseManifest(raw);
  } catch (e) {
    return (e as ManifestError).issues.map((i) => i.split(': ')[0].split('.'));
  }
  return [];
}

describe('scenarios.fzp.gross', () => {
  const v = '2026-10-10-3fa9c2d1';
  const fzp = (gross: string) => ({
    parcels: `/data/${v}/scenarios/fzp/parcels.bin`,
    projects: `/data/${v}/scenarios/fzp/projects.json`,
    calibration: `/data/${v}/scenarios/fzp/calibration.json`,
    gross
  });

  it('accepts scenarios.fzp.gross and rejects one outside the version', () => {
    const ok = `/data/${v}/scenarios/fzp/gross.bin`;
    expect(parseManifest({ ...g(), scenarios: { fzp: fzp(ok) } }).scenarios?.fzp.gross).toBe(ok);
    const r = issuePaths({
      ...g(),
      scenarios: { fzp: fzp('/data/other/scenarios/fzp/gross.bin') }
    });
    expect(r).toEqual([['scenarios', 'fzp', 'gross']]);
  });
});

describe('manifestFiles', () => {
  const v = '2026-10-10-3fa9c2d1';
  const u = (p: string) => `/data/${v}/${p}`;
  const full = () =>
    parseManifest({
      ...g(),
      sprite: u('sprite/basemap'),
      transit: u('transit.json'),
      scenarios: {
        fzp: {
          parcels: u('scenarios/fzp/parcels.bin'),
          projects: u('scenarios/fzp/projects.json'),
          calibration: u('scenarios/fzp/calibration.json'),
          policy: u('scenarios/fzp/policy.bin'),
          gross: u('scenarios/fzp/gross.bin'),
          frontage: u('scenarios/fzp/frontage.bin')
        },
        lesscars: {
          plan: u('scenarios/lesscars/plan.json'),
          sites: u('scenarios/lesscars/sites.json'),
          summary: u('scenarios/lesscars/summary.json'),
          timeline: u('scenarios/lesscars/timeline.bin')
        }
      }
    });

  it('every /data/ string in a manifest with every optional field set is a manifestFiles url', () => {
    const m = full();
    const urls = new Set(manifestFiles(m).map((f) => f.url));
    const found: string[] = [];
    const walk = (x: unknown): void => {
      if (typeof x === 'string') {
        if (x.startsWith('/data/')) found.push(x);
      } else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') Object.values(x).forEach(walk);
    };
    walk(m);
    expect(found.length).toBeGreaterThan(15);
    for (const s of found) {
      const covered = urls.has(s) || SPRITE_SUFFIXES.every((x) => urls.has(s + x));
      expect(covered, s).toBe(true);
    }
  });

  it('manifestFiles expands glyphs to stack × range', () => {
    const files = manifestFiles(full(), { stacks: ['A', 'B'], ranges: GLYPH_RANGES }).filter(
      (f) => f.key === 'glyphs'
    );
    expect(GLYPH_RANGES).toHaveLength(256);
    expect(files).toHaveLength(512);
    expect(files[0].url).toBe(u('fonts/A/0-255.pbf'));
    expect(files[511].url).toBe(u('fonts/B/65280-65535.pbf'));
  });

  it('only sprite variants are optional', () => {
    const files = manifestFiles(full());
    expect(files.filter((f) => f.optional).map((f) => f.url)).toEqual(
      SPRITE_SUFFIXES.map((s) => u('sprite/basemap') + s)
    );
    expect(files.filter((f) => !f.optional && f.key === 'sprite')).toEqual([]);
    expect(files.find((f) => f.key === 'glyphs')?.url).toBe(u('fonts/{fontstack}/{range}.pbf'));
    expect(files.some((f) => f.url.endsWith('manifest.json'))).toBe(false);
  });

  it('a bad glyph template is reported once', () => {
    const issues = issuePaths({ ...g(), glyphs: '/data/other/fonts/{fontstack}/{range}.pbf' });
    expect(issues).toEqual([['glyphs']]);
  });
});
