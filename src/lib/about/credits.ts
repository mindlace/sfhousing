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
 *  manifest order: ODbL-1.0 first, then CC-BY-4.0, then any other licence as its own clause.
 *  A name is the source's label less " via Overture Maps", else the id after "overture:".
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

/** A manifest source as About's sources table reads it. */
export interface CreditSource {
  id: string;
  label?: string;
  url: string;
  license: string;
  retrievedAt: string;
}

/** One row of About's sources table: a source, or a family of them (P13). */
export interface SourceRow {
  /** The source's id, or the family's. */
  key: string;
  label: string;
  url: string;
  /** Each licence once, in first-seen order, joined by '; '. */
  license: string;
  /** The latest of the family. */
  retrievedAt: string;
}

/** The Census kinds a census- id names, in the order the label lists them. */
const CENSUS_KINDS: readonly [RegExp, string][] = [
  [/^census-acs5-/, 'ACS'],
  [/^census-pums/, 'PUMS'],
  [/^census-sf3-/, 'decennial SF3'],
  [/^census-tiger-/, 'TIGER/Line'],
  [/^census-(puma|xwalk)-/, 'relationship files']
];

const YEARS = /(?:19|20)\d{2}/g;
const HAS_YEAR = /(?:19|20)\d{2}/;

/** The family an id belongs to: census, the DMV, one GTFS operator; else the id itself. */
function familyOf(id: string): string {
  if (id.startsWith('census-')) return 'census';
  if (id.startsWith('ca-dmv-')) return 'ca-dmv';
  const gtfs = /^(gtfs-[a-z]+)(?:-\d{4})?$/.exec(id);
  return gtfs ? gtfs[1] : id;
}

/** ', 2000–2024' over the years the ids name; ', 2024' for one; '' for none. */
function yearsOf(ids: string[]): string {
  const ys = ids.flatMap((id) => (id.match(YEARS) ?? []).map(Number));
  if (ys.length === 0) return '';
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  return lo === hi ? `, ${lo}` : `, ${lo}–${hi}`;
}

function familyLabel(key: string, members: CreditSource[]): string {
  const ids = members.map((m) => m.id);
  if (key === 'census') {
    const kinds = CENSUS_KINDS.filter(([re]) => ids.some((id) => re.test(id))).map(([, k]) => k);
    return `U.S. Census Bureau (${kinds.join(', ')})${yearsOf(ids)}`;
  }
  if (key === 'ca-dmv') return `California DMV vehicle counts by ZIP code${yearsOf(ids)}`;
  // A GTFS operator: the current feed's label, then the years of its archives.
  const base = members.find((m) => !HAS_YEAR.test(m.id)) ?? members[0];
  return `${base.label ?? base.id}${yearsOf(ids)}`;
}

/**
 * About's sources table (ruling P13): every lock entry is a manifest source, so the Census
 * releases and tables, the DMV's years and each GTFS operator's archived years would be a row
 * each. A family of two or more is one row, where its first member was: its kinds and years, its
 * licences, its latest retrieval. A family of one, and every other source, keeps its own row.
 */
export function sourceRows(sources: readonly CreditSource[]): SourceRow[] {
  const families = new Map<string, CreditSource[]>();
  for (const s of sources) {
    const key = familyOf(s.id);
    const list = families.get(key) ?? [];
    list.push(s);
    families.set(key, list);
  }
  return [...families].map(([key, members]) => {
    if (members.length === 1) {
      const [s] = members;
      return {
        key: s.id,
        label: s.label ?? s.id,
        url: s.url,
        license: s.license,
        retrievedAt: s.retrievedAt
      };
    }
    return {
      key,
      label: familyLabel(key, members),
      url: key === 'census' ? 'https://www.census.gov/' : members[0].url,
      license: [...new Set(members.map((m) => m.license))].join('; '),
      retrievedAt: members.map((m) => m.retrievedAt).reduce((a, b) => (b > a ? b : a))
    };
  });
}

/**
 * Data and licences' car notice, from the sources the dataset has: the Census kinds present
 * (public domain) and the DMV check with its licence as the manifest states it. Null with neither.
 * The parking figures cite their sources in the assumptions (the car model's section).
 */
export function carsNotice(sources: readonly { id: string; license: string }[]): string | null {
  const ids = sources.map((s) => s.id);
  const kinds = CENSUS_KINDS.filter(([re]) => ids.some((id) => re.test(id))).map(([, k]) => k);
  const dmv = sources.find((s) => s.id.startsWith('ca-dmv-'));
  const parts: string[] = [];
  if (kinds.length > 0) {
    parts.push(
      `Households and cars from the U.S. Census Bureau (${listJoin(kinds)}), public domain.`
    );
  }
  if (dmv)
    parts.push(
      `Car totals checked against California DMV vehicle counts, licence: ${dmv.license}.`
    );
  if (parts.length === 0) return null;
  parts.push('The parking figures cite their sources in the assumptions.');
  return parts.join(' ');
}
