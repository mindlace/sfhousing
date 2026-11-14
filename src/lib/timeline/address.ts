/**
 * The address bar for `/sim` and `/s/<id>` (rule 25, OD-4): the URL names no future, so a `seed`
 * parameter left from links made before the timeline is dropped. Pure TS but for `addressHref`.
 */

/** The address bar (SvelteKit's stored URL can predate a replaceState). */
export function addressHref(): string {
  return location.href;
}

/** `href`'s path, query and hash without its `seed` parameters; null when it has none. */
export function withoutSeed(href: string): string | null {
  const u = new URL(href);
  if (!u.searchParams.has('seed')) return null;
  u.searchParams.delete('seed');
  return u.pathname + u.search + u.hash;
}
