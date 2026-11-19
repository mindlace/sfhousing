/**
 * A shared plan's one line in the read-only Paint tab (`/p/:id`): the heights it paints and the
 * lots it rebuilds ('6 and 8 stories · 1,204 lots rebuilt'). The count is the score's
 * `parcelsChanged`, the lots with a generated building, each once.
 */

import type { PlanOp } from '$lib/plan';
import { formatCount } from '$lib/scoreboard';

/** Distinct `stories` of the paint ops, ascending. */
export function storiesUsed(ops: readonly PlanOp[]): number[] {
  const seen = new Set<number>();
  for (const op of ops) if (op.kind === 'paint') seen.add(op.stories);
  return [...seen].sort((a, b) => a - b);
}

/** '6 stories', '6 and 8 stories', '4, 6 and 8 stories'. */
function heights(stories: readonly number[]): string {
  const s = stories.map(formatCount);
  const list = s.length === 1 ? s[0] : `${s.slice(0, -1).join(', ')} and ${s.at(-1)}`;
  return `${list} ${stories.length === 1 && stories[0] === 1 ? 'story' : 'stories'}`;
}

/**
 * '6 stories · 1 lot rebuilt' | '6 and 8 stories · 1,204 lots rebuilt' |
 * '4, 6 and 8 stories · 12 lots rebuilt' | 'Nothing painted' (stories empty). With no count yet
 * (`rebuilt` null, before the score's first diff) only the heights: '6 and 8 stories'.
 */
export function paintedSummary(stories: readonly number[], rebuilt: number | null): string {
  if (stories.length === 0) return 'Nothing painted';
  if (rebuilt === null) return heights(stories);
  return `${heights(stories)} · ${formatCount(rebuilt)} ${rebuilt === 1 ? 'lot' : 'lots'} rebuilt`;
}
