import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listJoin, overtureNotice, sourceRows } from './credits';

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../e2e/fixtures/data/fixture-0/manifest.json', import.meta.url)),
    'utf8'
  )
) as { sources: { id: string; label?: string; license: string }[] };

describe('overtureNotice', () => {
  it('fixture-0: [{ ODbL-1.0: Microsoft ML Buildings, OpenStreetMap, USGS Lidar }, { CC-BY-4.0: Esri Community Maps }]', () => {
    expect(overtureNotice(fixture.sources)).toEqual([
      { license: 'ODbL-1.0', names: ['Microsoft ML Buildings', 'OpenStreetMap', 'USGS Lidar'] },
      { license: 'CC-BY-4.0', names: ['Esri Community Maps'] }
    ]);
  });

  it('no overture: source gives no clauses (AboutData then renders the ODbL-only sentence)', () => {
    expect(
      overtureNotice([
        { id: 'overture-buildings', label: 'Overture Maps Buildings', license: 'ODbL-1.0' },
        { id: 'datasf-parcels', license: 'PDDL-1.0' }
      ])
    ).toEqual([]);
  });

  it('a third licence gets its own clause, after CC BY 4.0', () => {
    expect(
      overtureNotice([
        { id: 'overture:Other', label: 'Other via Overture Maps', license: 'CDLA-Permissive-2.0' },
        { id: 'overture:Esri', license: 'CC-BY-4.0' },
        { id: 'overture:OSM', label: 'OpenStreetMap via Overture Maps', license: 'ODbL-1.0' }
      ])
    ).toEqual([
      { license: 'ODbL-1.0', names: ['OpenStreetMap'] },
      { license: 'CC-BY-4.0', names: ['Esri'] },
      { license: 'CDLA-Permissive-2.0', names: ['Other'] }
    ]);
  });
});

describe('listJoin', () => {
  it('joins with commas and a final "and"', () => {
    expect(listJoin([])).toBe('');
    expect(listJoin(['a'])).toBe('a');
    expect(listJoin(['a', 'b'])).toBe('a and b');
    expect(listJoin(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('sourceRows (P13: one row per source family)', () => {
  const src = (
    id: string,
    over: Partial<{ label: string; license: string; retrievedAt: string }> = {}
  ) => ({
    id,
    label: over.label ?? id,
    url: `https://example.org/${id}`,
    license: over.license ?? 'Public domain (U.S. Census Bureau)',
    retrievedAt: over.retrievedAt ?? '2026-10-10T00:00:00.000Z'
  });

  it('folds every census- source into one row at the first one, naming its kinds and years', () => {
    const rows = sourceRows([
      src('datasf-parcels', { license: 'PDDL-1.0' }),
      src('census-acs5-bg-2009'),
      src('census-acs5-bg-2024', { retrievedAt: '2026-11-25T06:21:27.653Z' }),
      src('census-pums5-2024'),
      src('census-sf3-2000-bg'),
      src('census-tiger-bg-2020'),
      src('census-xwalk-2000-2010'),
      src('census-puma-2020'),
      src('ca-dmv-vehicles-zip', { label: 'California DMV vehicle fuel type counts by ZIP code' })
    ]);
    expect(rows.map((r) => r.key)).toEqual(['datasf-parcels', 'census', 'ca-dmv-vehicles-zip']);
    expect(rows[1]).toEqual({
      key: 'census',
      label:
        'U.S. Census Bureau (ACS, PUMS, decennial SF3, TIGER/Line, relationship files), 2000–2024',
      url: 'https://www.census.gov/',
      license: 'Public domain (U.S. Census Bureau)',
      retrievedAt: '2026-11-25T06:21:27.653Z'
    });
    // A family of one keeps its own row.
    expect(rows[2].label).toBe('California DMV vehicle fuel type counts by ZIP code');
    expect(rows[0]).toEqual({
      key: 'datasf-parcels',
      label: 'datasf-parcels',
      url: 'https://example.org/datasf-parcels',
      license: 'PDDL-1.0',
      retrievedAt: '2026-10-10T00:00:00.000Z'
    });
  });

  it("an operator's GTFS by year is one row with its years; operators stay apart (their licences differ)", () => {
    const rows = sourceRows([
      src('gtfs-muni', { label: 'SFMTA Muni GTFS', license: 'SFMTA' }),
      src('gtfs-bart', { label: 'BART GTFS', license: 'BART' }),
      src('gtfs-muni-2015', { label: 'SFMTA Muni GTFS (2015 archive)', license: 'SFMTA' }),
      src('gtfs-muni-2019', { label: 'SFMTA Muni GTFS (2019 archive)', license: 'SFMTA' })
    ]);
    expect(rows.map((r) => [r.key, r.label, r.license])).toEqual([
      ['gtfs-muni', 'SFMTA Muni GTFS, 2015–2019', 'SFMTA'],
      ['gtfs-bart', 'BART GTFS', 'BART']
    ]);
  });

  it('a family with mixed licences lists each once', () => {
    const rows = sourceRows([
      src('ca-dmv-vehicles-2019', { label: 'DMV 2019', license: 'A' }),
      src('ca-dmv-vehicles-2024', { label: 'DMV 2024', license: 'B' })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].license).toBe('A; B');
    expect(rows[0].label).toBe('California DMV vehicle counts by ZIP code, 2019–2024');
  });

  it("fixture-0's census sources are one row", () => {
    const rows = sourceRows(
      fixture.sources.map((s) => ({ url: '', retrievedAt: '2026-10-10T00:00:00.000Z', ...s }))
    );
    expect(rows.filter((r) => r.label.includes('Census')).map((r) => r.key)).toEqual(['census']);
    expect(rows.length).toBe(fixture.sources.length - 4);
  });
});
