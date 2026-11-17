import { moneyRowsOf } from './money';
import { extrasOf } from './series';
import type { MoneyFeed, PlanRow, SeriesChunk, WorldSeries } from './types';

/**
 * The score numbers for final months `from..through`: the plan world's own rows, and its effect
 * over its twin (plan minus twin, month by month). Each world's rows are computed once.
 */
export function chunkOf(
  plan: WorldSeries,
  twin: WorldSeries,
  money: MoneyFeed | null,
  from: number,
  through: number
): SeriesChunk {
  for (const s of [plan, twin]) {
    if (s.finalThrough() < through) {
      throw new Error(`world-score: month ${through} is not final (${s.finalThrough()})`);
    }
  }
  // The plan world's money and tiers (rule 9); read first, so a series without extras throws
  // before any work.
  const extras = money === null ? null : extrasOf(plan);
  const moneyRows = extras === null ? null : moneyRowsOf(money!, extras, from, through);
  const tiers = extras === null ? null : extras.tiers(from, through);

  const rows = plan.rows(from, through);
  const twinRows = twin.rows(from, through);
  const planEffect: PlanRow[] = rows.map((r, i) => ({
    entitledNew: r.entitledNew - twinRows[i].entitledNew,
    completedNetNew: r.completedNetNew - twinRows[i].completedNetNew
  }));
  return { from, rows, planEffect, money: moneyRows, tiers };
}
