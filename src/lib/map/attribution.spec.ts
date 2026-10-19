import { describe, expect, it } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import { readFileSync } from 'node:fs';
import { attributionHtml, attributionText, datasfLicences } from './attribution';

const src = (id: string, label?: string) =>
  ({
    id,
    ...(label === undefined ? {} : { label }),
    url: 'https://example.com',
    retrievedAt: '2026-10-10T00:00:00.000Z',
    license: 'ODbL-1.0'
  }) as Manifest['sources'][number];

describe('attribution', () => {
  it('lists overture:* contributors from the manifest in order', () => {
    const sources = [
      src('datasf-parcels', 'DataSF Parcels'),
      src('overture-buildings', 'Overture Maps Buildings'),
      src('overture:Esri Community Maps', 'Esri Community Maps via Overture Maps'),
      src('overture:Esri Community Maps', 'Esri Community Maps via Overture Maps'),
      src('overture:Microsoft ML Buildings', ' Microsoft ML Buildings via Overture Maps '),
      src('protomaps-basemap', 'Protomaps basemap'),
      src('overture:USGS Lidar')
    ];
    expect(attributionText(sources)).toBe(
      '© OpenStreetMap · Overture Maps (Esri Community Maps, Microsoft ML Buildings, USGS Lidar) · DataSF · Protomaps'
    );
  });

  it('shows plain Overture Maps with no contributors', () => {
    const sources = [src('overture-buildings', 'Overture Maps Buildings'), src('overture:', '  ')];
    expect(attributionText(sources)).toBe('© OpenStreetMap · Overture Maps · DataSF · Protomaps');
    expect(attributionText([])).toBe('© OpenStreetMap · Overture Maps · DataSF · Protomaps');
  });

  it('escapes contributor names in the html', () => {
    const html = attributionHtml([src('overture:x', 'A<b>&"C" via Overture Maps')]);
    expect(html).toContain('Overture Maps (A&lt;b&gt;&amp;&quot;C&quot;)');
    expect(html).not.toContain('<b>');
    expect(html).toContain('href="/attribution"');
  });
});

describe('datasfLicences', () => {
  const fixture = JSON.parse(readFileSync('e2e/fixtures/data/fixture-0/manifest.json', 'utf8')) as {
    sources: Manifest['sources'];
  };
  const mainSources = fixture.sources.filter((s) => s.id !== 'datasf-dev-pipeline');
  const title = (sources: Manifest['sources']) =>
    /title="([^"]*)"/.exec(attributionHtml(sources))?.[1];
  const lic = (id: string, license: string) => ({ ...src(id), license });

  it('names PDDL and public domain for the fixture without the dev-pipeline source', () => {
    expect(datasfLicences(mainSources)).toBe('PDDL / public domain');
    expect(title(mainSources)).toBe(
      'Data &amp; licences: OpenStreetMap and Overture data under ODbL; ' +
        'DataSF under PDDL / public domain; Protomaps basemap'
    );
  });

  it('adds CC0 for the current fixture sources', () => {
    expect(fixture.sources.some((s) => s.id === 'datasf-dev-pipeline')).toBe(true);
    expect(datasfLicences(fixture.sources)).toBe('PDDL / public domain / CC0');
    expect(title(fixture.sources)).toBe(
      'Data &amp; licences: OpenStreetMap and Overture data under ODbL; ' +
        'DataSF under PDDL / public domain / CC0; Protomaps basemap'
    );
  });

  it('falls back to PDDL / public domain for an empty list', () => {
    expect(datasfLicences([])).toBe('PDDL / public domain');
  });

  it('ignores non-datasf sources and unknown licences', () => {
    expect(datasfLicences([lic('other-thing', 'CC0-1.0'), lic('datasf-x', 'PDDL-1.0')])).toBe(
      'PDDL'
    );
    expect(datasfLicences([lic('datasf-x', 'MIT'), lic('datasf-y', 'CC0-1.0')])).toBe('CC0');
    expect(datasfLicences([lic('other-thing', 'CC0-1.0')])).toBe('PDDL / public domain');
  });

  it('orders PDDL, public domain, CC0 regardless of manifest order', () => {
    expect(
      datasfLicences([
        lic('datasf-a', 'CC0-1.0'),
        lic('datasf-b', 'public-domain'),
        lic('datasf-c', 'PDDL-1.0')
      ])
    ).toBe('PDDL / public domain / CC0');
  });
});
