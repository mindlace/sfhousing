// Parsing helpers for the owner-approved plan document (docs/lesscars/plan-v1.md), shared by the
// tests that hold a committed file to one of its sections.

/** The text under a heading, to the next heading of the same or a higher level. */
export function under(text: string, heading: string): string {
  const level = heading.match(/^#+/)![0].length;
  const start = text.indexOf(`\n${heading}\n`);
  if (start < 0) throw new Error(`no heading ${heading}`);
  const rest = text.slice(start + heading.length + 2);
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

export const unTick = (s: string) => s.trim().replace(/^`|`$/g, '');

/** The first pipe table in `text`, one record per row keyed by the header cells. */
export function table(text: string): Record<string, string>[] {
  const all = text.split('\n');
  const first = all.findIndex((l) => l.startsWith('|'));
  if (first < 0) return [];
  const lines = all
    .slice(first)
    .filter((l, i, a) => a.slice(0, i).every((x) => x.startsWith('|')) && l.startsWith('|'));
  const cells = (l: string) =>
    l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  if (lines.length === 0) return [];
  const head = cells(lines[0]);
  return lines.slice(2).map((l) => {
    const c = cells(l);
    return Object.fromEntries(head.map((h, i) => [h, c[i] ?? '']));
  });
}
