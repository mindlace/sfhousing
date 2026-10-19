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

/** DataSF licences named in the on-map link title: PDDL, public domain, CC0, in that order. */
const DATASF_LICENCES: [RegExp | string, string][] = [
  [/^PDDL/i, 'PDDL'],
  ['public-domain', 'public domain'],
  [/^CC0/i, 'CC0']
];

/** Distinct licences of the manifest's `datasf-*` sources; 'PDDL / public domain' when none. */
export function datasfLicences(sources: Manifest['sources']): string {
  const found = new Set<string>();
  for (const s of sources) {
    if (!s.id.startsWith('datasf-')) continue;
    for (const [match, name] of DATASF_LICENCES) {
      if (typeof match === 'string' ? s.license === match : match.test(s.license)) found.add(name);
    }
  }
  const names = DATASF_LICENCES.map(([, name]) => name).filter((name) => found.has(name));
  return names.length ? names.join(' / ') : 'PDDL / public domain';
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
    `DataSF under ${escapeHtml(datasfLicences(sources))}; Protomaps basemap">` +
    `© OpenStreetMap · ${overture} · DataSF · Protomaps` +
    '</a>'
  );
}
