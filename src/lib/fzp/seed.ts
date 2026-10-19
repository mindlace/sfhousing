/** The `?seed=N` contract (spec §4.7): a decimal Uint32, at most 10 digits. */
export const MAX_SEED = 4_294_967_295;

/** `seed` is null when the parameter is absent or invalid; `invalid` asks for a URL clean-up. */
export function parseSeed(params: URLSearchParams): { seed: number | null; invalid: boolean } {
  const raw = params.get('seed');
  if (raw === null) return { seed: null, invalid: false };
  if (/^\d{1,10}$/.test(raw)) {
    const seed = Number(raw);
    if (seed <= MAX_SEED) return { seed, invalid: false };
  }
  return { seed: null, invalid: true };
}

/**
 * The address bar's seed. After `replaceState`, SvelteKit's own URLs (`page.url`, a navigation's
 * `to.url`, the URL a popstate navigates to) still name the last load's seed; only `location`
 * holds the one on screen.
 */
export function addressSeed(): { seed: number | null; invalid: boolean } {
  return parseSeed(new URLSearchParams(location.search));
}

/** Sets or removes `seed`, keeping other parameters and their order. */
export function searchWithSeed(search: string, seed: number | null): string {
  const params = new URLSearchParams(search);
  if (seed === null) params.delete('seed');
  else params.set('seed', String(seed));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}
