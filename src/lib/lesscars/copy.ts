// The /lesscars headline and details copy, in one place. Counts go through `formatCount`
// (en-US grouping, U+2212 for negatives).
import { formatCount } from '$lib/scoreboard/format';

/** `n` is the rounded mean number of extra homes at the last year; `year` its year. */
export function headlineCopy(n: number, year: number): string {
  if (n > 0) return `+${formatCount(n)} homes by ${year}`;
  if (n < 0) return `${formatCount(n)} homes by ${year}`;
  return `No extra homes by ${year}`;
}

/** The button's accessible name: starts with the visible text (WCAG 2.5.3 Label in Name). */
export function headlineNameCopy(n: number, year: number): string {
  return `${headlineCopy(n, year)} compared with no plan. Show details`;
}

/** The headline as a sentence, for the details panel. */
export function headlineSentence(n: number, year: number): string {
  if (n > 0) return `The plan adds ${formatCount(n)} homes by ${year} compared with no plan.`;
  if (n < 0) return `The plan has ${formatCount(-n)} fewer homes by ${year} than no plan.`;
  return `The plan adds no homes by ${year} compared with no plan.`;
}

export function bandCopy(seeds: number, p10: string, p90: string): string {
  return `Middle 80% of ${seeds} paired futures: ${p10} to ${p90}`;
}

export const AMENITIES_COPY =
  'Wider sidewalks, bike lanes, pedestrian streets and the car shuttle are on the map but add no homes, so they are not counted here.';

export const breakdownCaption = (year: number): string =>
  `Where the extra homes come from, ${year}`;

export const BUILDING_NOTE = 'Thinner and faded while being built';
