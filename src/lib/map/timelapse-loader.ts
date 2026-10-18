// The lazy timeline chunks (timelapse-render §4.1 "Mode"): loaded on the first applyTimeline
// only, so the editor never fetches them. Its own module so tests can make the import fail, as
// deck-loader.ts does for deck. `@deck.gl/core` is already in deck's chunk; SimMap takes its `log`
// for the default onError of non-timeline layers.
export function loadTimelapse(): Promise<
  [
    typeof import('./timelapse/deck'),
    typeof import('./timeline-controller'),
    typeof import('@deck.gl/core')
  ]
> {
  return Promise.all([
    import('./timelapse/deck'),
    import('./timeline-controller'),
    import('@deck.gl/core')
  ]);
}
