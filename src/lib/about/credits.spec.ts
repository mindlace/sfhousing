import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { listJoin, overtureNotice } from './credits';

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
