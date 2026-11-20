// Paint's map key: the words of a painted height's row, and the heights a plan holds. Pure.
import type { PlanOp } from '$lib/plan';
import { formatCount } from '$lib/scoreboard/format';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * '6 stories · 42 lots · 30 rebuilt'; '1 story · 1 lot · 0 rebuilt'. While a cell of the plan is
 * still loading (`missing` > 0) both counts carry a plus, '6 stories · 40+ lots · 12+ rebuilt';
 * a count still at 0 then waits as '…' ('6 stories · 1+ lots · …', or '6 stories · …' with no
 * lots yet), never '0+'. With no answer yet (`lots` null), '6 stories · …', never a false zero.
 */
export function heightRowText(
  stories: number,
  lots: number | null,
  rebuilt: number,
  missing: number
): string {
  const height = `${stories} ${plural(stories, 'story', 'stories')}`;
  if (lots === null || (missing > 0 && lots === 0)) return `${height} · …`;
  if (missing > 0) {
    const built = rebuilt > 0 ? `${formatCount(rebuilt)}+ rebuilt` : '…';
    return `${height} · ${formatCount(lots)}+ lots · ${built}`;
  }
  return `${height} · ${formatCount(lots)} ${plural(lots, 'lot', 'lots')} · ${formatCount(rebuilt)} rebuilt`;
}

/** Distinct paint `stories` of the ops, ascending (the rows before the first answer). */
export function heightsOf(ops: readonly PlanOp[]): number[] {
  const out = new Set<number>();
  for (const op of ops) if (op.kind === 'paint') out.add(op.stories);
  return [...out].sort((a, b) => a - b);
}
