import { describe, expect, it } from 'vitest';
import type { Manifest } from '$lib/data/manifest';
import { attributionHtml, attributionText } from './attribution';

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
