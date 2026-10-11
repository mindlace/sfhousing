// The lazy deck.gl chunk (spec §4.12: deck loads after the map is ready). Its own module so
// tests can make the import fail.
export function loadDeck(): Promise<
  [typeof import('@deck.gl/maplibre'), typeof import('@deck.gl/layers')]
> {
  return Promise.all([import('@deck.gl/maplibre'), import('@deck.gl/layers')]);
}
