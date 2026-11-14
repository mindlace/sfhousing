export const SOFTWARE: { name: string; license: string; url: string }[] = [
  {
    name: 'unique-names-generator',
    license: 'MIT',
    url: 'https://github.com/andreasonny83/unique-names-generator'
  },
  {
    name: 'Unicode confusables data (UTS #39)',
    license: 'Unicode License v3',
    url: 'https://www.unicode.org/license.txt'
  },
  { name: 'MapLibre GL JS', license: 'BSD-3-Clause', url: 'https://maplibre.org' },
  { name: 'deck.gl', license: 'MIT', url: 'https://deck.gl' },
  { name: 'luma.gl', license: 'MIT', url: 'https://luma.gl' },
  { name: 'PMTiles', license: 'BSD-3-Clause', url: 'https://protomaps.com/docs/pmtiles' },
  {
    name: 'Protomaps Basemaps',
    license: 'BSD-3-Clause',
    url: 'https://github.com/protomaps/basemaps'
  },
  { name: 'SvelteKit / Svelte', license: 'MIT', url: 'https://svelte.dev' },
  { name: 'kdbush', license: 'ISC', url: 'https://github.com/mourner/kdbush' },
  {
    name: 'Clipper2 (clipper2-ts)',
    license: 'BSL-1.0',
    url: 'https://github.com/countertype/clipper2-ts'
  },
  {
    name: 'fdlibm (exp, log)',
    license: 'Sun Microsystems permissive notice',
    url: 'https://www.netlib.org/fdlibm/'
  },
  { name: 'bs58', license: 'MIT', url: 'https://github.com/cryptocoinjs/bs58' },
  { name: 'uuid', license: 'MIT', url: 'https://github.com/uuidjs/uuid' },
  {
    name: 'better-svelte-email',
    license: 'MIT',
    url: 'https://github.com/Konixy/better-svelte-email'
  },
  { name: 'aws4fetch', license: 'MIT', url: 'https://github.com/mhart/aws4fetch' },
  { name: 'Better Auth', license: 'MIT', url: 'https://better-auth.com' },
  { name: 'better-call', license: 'MIT', url: 'https://github.com/Bekacru/better-call' },
  { name: 'Kysely', license: 'MIT', url: 'https://kysely.dev' },
  { name: 'SimpleWebAuthn', license: 'MIT', url: 'https://simplewebauthn.dev' }
];

/** First 10 chars of a valid ISO date/datetime, else the input unchanged. */
export function isoDate(s: string): string {
  return /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(s) ? s.slice(0, 10) : s;
}
