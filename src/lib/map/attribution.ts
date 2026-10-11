import type { Manifest } from '$lib/data/manifest';

const PREFIX = 'overture:';
const SUFFIX = / via Overture Maps$/;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Overture contributor names from the manifest's `overture:*` sources, in manifest order. */
function contributors(sources: Manifest['sources']): string[] {
  const names: string[] = [];
  for (const s of sources) {
    if (!s.id.startsWith(PREFIX)) continue;
    const label = s.label?.trim();
    const name = (label ? label.replace(SUFFIX, '') : s.id.slice(PREFIX.length)).trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function attributionText(sources: Manifest['sources']): string {
  const names = contributors(sources);
  const overture = names.length ? `Overture Maps (${names.join(', ')})` : 'Overture Maps';
  return `© OpenStreetMap · ${overture} · DataSF · Protomaps`;
}

export function attributionHtml(sources: Manifest['sources']): string {
  const names = contributors(sources).map(escapeHtml);
  const overture = names.length ? `Overture Maps (${names.join(', ')})` : 'Overture Maps';
  return (
    '<a href="/attribution" title="Data &amp; licences: OpenStreetMap and Overture data under ODbL; ' +
    'DataSF under PDDL / public domain; Protomaps basemap">' +
    `© OpenStreetMap · ${overture} · DataSF · Protomaps` +
    '</a>'
  );
}
