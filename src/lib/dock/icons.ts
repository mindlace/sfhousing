/**
 * The dock's icons: SVG path data (`d`) on a 24 x 24 grid, drawn as 2 px round-capped strokes in
 * `currentColor`, so a button's text colour (selected, hover, dark) colours its icon. Each entry
 * is the list of paths of one drawing. Decorative: every button that shows one is named by text.
 */
export const DOCK_ICONS: Record<
  'transit' | 'paint' | 'permits' | 'protect' | 'funding' | 'results' | 'policy',
  readonly string[]
> = {
  // A bus: body, windscreen band, two lights, two feet.
  transit: [
    'M6 4h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
    'M4 11h16',
    'M8 14.5h.01',
    'M16 14.5h.01',
    'M7 18v2',
    'M17 18v2'
  ],
  // A brush: handle, ferrule and the loaded tip.
  paint: [
    'M20 4l-8.5 8.5',
    'M13.5 10.5l2 2',
    'M10 11.5c-2.5 0-4 1.5-4 3.5 0 1.2-.7 2.2-2 2.7 2 1.3 5.5 1 7.2-.8 1.2-1.2 1.5-2.7.3-3.9z'
  ],
  // A clock face: the permit's waiting time.
  permits: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'],
  // A shield with a check.
  protect: ['M12 3l7.5 3v6c0 4.2-3.1 7.5-7.5 9-4.4-1.5-7.5-4.8-7.5-9V6z', 'M9 12l2 2 4-4'],
  // A banknote: the note and its central coin.
  funding: ['M3 7h18v10H3z', 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z'],
  // Three bars on a baseline.
  results: ['M3 20h18', 'M6 20v-7', 'M12 20V6', 'M18 20v-10'],
  // Three sliders.
  policy: [
    'M4 7h8',
    'M16 7h4',
    'M14 5v4',
    'M4 12h3',
    'M11 12h9',
    'M9 10v4',
    'M4 17h10',
    'M18 17h2',
    'M16 15v4'
  ]
};
