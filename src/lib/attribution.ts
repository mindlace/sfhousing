export const SOFTWARE: { name: string; license: string; url: string }[] = [
  { name: 'MapLibre GL JS', license: 'BSD-3-Clause', url: 'https://maplibre.org' },
  { name: 'deck.gl', license: 'MIT', url: 'https://deck.gl' },
  { name: 'PMTiles', license: 'BSD-3-Clause', url: 'https://protomaps.com/docs/pmtiles' },
  { name: 'SvelteKit / Svelte', license: 'MIT', url: 'https://svelte.dev' },
  { name: 'kdbush', license: 'ISC', url: 'https://github.com/mourner/kdbush' }
];

/** First 10 chars of a valid ISO date/datetime, else the input unchanged. */
export function isoDate(s: string): string {
  return /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(s) ? s.slice(0, 10) : s;
}
