/**
 * The Overture buildings notice, built from the manifest: Overture's contributors are recorded
 * there as `overture:<name>` sources, each with its licence (docs/dev/pipeline.md).
 */

/** Licences named in a notice: the words shown and the licence's page. */
export const LICENCE_LINK: Readonly<Record<string, { text: string; url: string }>> = {
  'ODbL-1.0': { text: 'the ODbL', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  'CC-BY-4.0': { text: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }
};

const ORDER = ['ODbL-1.0', 'CC-BY-4.0'];
const VIA = / via Overture Maps$/;

/** The Overture notice from the manifest's `overture:*` sources, grouped by licence, names in
 *  manifest order: ODbL-1.0 first, then CC-BY-4.0, then any other licence as its own clause. */
/** A name is the source's label less " via Overture Maps", else the id after "overture:".
 *  AboutData renders the clauses into the sentence in The strings, linking each licence. */
export function overtureNotice(
  sources: { id: string; label?: string; license: string }[]
): { license: string; names: string[] }[] {
  const byLicence = new Map<string, string[]>();
  for (const s of sources) {
    if (!s.id.startsWith('overture:')) continue;
    const name = s.label?.replace(VIA, '') ?? s.id.slice('overture:'.length);
    const names = byLicence.get(s.license) ?? [];
    names.push(name);
    byLicence.set(s.license, names);
  }
  const rank = (l: string) => (ORDER.includes(l) ? ORDER.indexOf(l) : ORDER.length);
  // A stable sort keeps any other licences in the order the manifest first names them.
  return [...byLicence]
    .map(([license, names]) => ({ license, names }))
    .sort((a, b) => rank(a.license) - rank(b.license));
}

/** 'a', 'a and b', 'a, b and c'. */
export function listJoin(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
