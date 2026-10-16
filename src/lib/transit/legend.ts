// Access-surface bins (transit spec §6.1), shared by the map layer and the View menu legend.
export const ACCESS_BINS = [200, 1000, 3000, 10000, 30000] as const;
export type AccessBin = 0 | 1 | 2 | 3 | 4 | 5;

export function accessBin(v: number): AccessBin {
  let b = 0;
  for (const t of ACCESS_BINS) if (v >= t) b++;
  return b as AccessBin;
}

export const ACCESS_LEGEND = ['< 1k', '1k–3k', '3k–10k', '10k–30k', '30k+'] as const;
export const ACCESS_CAPTION =
  'Estimated weekday 7–9 am capacity, riders per hour. Existing service only.';
