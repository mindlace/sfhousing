// Mandatory lazy deck.gl modules for the overlay and generated editing. Kept separate so
// tests can make core startup fail independently of the optional roof display path.
export function loadDeck(): Promise<
  [typeof import('@deck.gl/maplibre'), typeof import('@deck.gl/layers')]
> {
  return Promise.all([import('@deck.gl/maplibre'), import('@deck.gl/layers')]);
}

// Only supported roof descriptors request these modules; neither gates core map readiness.
export function loadRoofs(): Promise<
  [typeof import('./roof-layer'), typeof import('./roof-controller')]
> {
  return Promise.all([import('./roof-layer'), import('./roof-controller')]);
}
