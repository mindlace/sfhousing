// The ruler's year labels on the timeline's one x scale (rule 3). Browser-safe.
import { dayFromUtc, utcParts } from '$lib/fzp/time';
import type { Day } from '$lib/timelapse/time';

/** The dataset date's year at the left edge, then every fifth year's 1 January in the window. */
export function yearMarks(asOf: Day, windowEnd: Day): { year: number; day: Day; pct: number }[] {
  const span = Math.max(windowEnd - asOf, 1);
  const start = utcParts(asOf).y;
  const out = [{ year: start, day: asOf, pct: 0 }];
  for (let k = 5; k <= 40; k += 5) {
    const day = dayFromUtc(start + k, 1, 1);
    if (day <= windowEnd) out.push({ year: start + k, day, pct: ((day - asOf) / span) * 100 });
  }
  return out;
}
