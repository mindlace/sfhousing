/**
 * Paint's Details: the words under the goal rows. Room for homes has no clock, so nothing here is
 * dated.
 */
import { formatCount, type Score } from '$lib/scoreboard';

/** '1,204 built · 310 replaced · 42 lots changed' ('1 lot changed'). */
export function paintCounts(score: Score): string {
  const lots = score.parcelsChanged === 1 ? 'lot' : 'lots';
  return (
    `${formatCount(score.grossUnits)} built · ${formatCount(score.demolishedUnits)} replaced · ` +
    `${formatCount(score.parcelsChanged)} ${lots} changed`
  );
}

/** "What room for homes means", in two lines. */
export const ROOM_MEANS: readonly [string, string] = [
  'Every eligible lot you painted, rebuilt to its height at once.',
  'Homes in replaced buildings are subtracted.'
];
