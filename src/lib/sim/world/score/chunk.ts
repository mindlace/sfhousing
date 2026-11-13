import { moneyRowsOf } from './money';
import { extrasOf } from './series';
import type { MoneyFeed, MonthRow, PlanRow, SeriesChunk, WorldSeries } from './types';

/** Mean and sample sd (W - 1) of `values`; sd is 0 for one world. */
function meanSd(values: number[]): { mean: number; sd: number } {
  const w = values.length;
  let sum = 0;
  for (let i = 0; i < w; i++) sum += values[i];
  const mean = sum / w;
  if (w < 2) return { mean, sd: 0 };
  let ss = 0;
  for (let i = 0; i < w; i++) {
    const d = values[i] - mean;
    ss += d * d;
  }
  return { mean, sd: Math.sqrt(ss / (w - 1)) };
}

/** Reduce one month's rows across worlds, field by field, `inProgress` stages included. */
function reduceRows(rows: MonthRow[]): { mean: MonthRow; sd: MonthRow } {
  const first = rows[0];
  const mean = { inProgress: {} } as MonthRow;
  const sd = { inProgress: {} } as MonthRow;
  const w = rows.length;
  const col = new Array<number>(w);
  const scalar = (get: (r: MonthRow) => number): { mean: number; sd: number } => {
    for (let i = 0; i < w; i++) col[i] = get(rows[i]);
    return meanSd(col);
  };
  const fields = [
    'completedNet',
    'completedNetPipeline',
    'completedNetNew',
    'entitledNew',
    'exitedUnits'
  ] as const;
  for (const f of fields) {
    const r = scalar((x) => x[f]);
    mean[f] = r.mean;
    sd[f] = r.sd;
  }
  for (const stage of Object.keys(first.inProgress) as (keyof MonthRow['inProgress'])[]) {
    const r = scalar((x) => x.inProgress[stage]);
    mean.inProgress[stage] = r.mean;
    sd.inProgress[stage] = r.sd;
  }
  return { mean, sd };
}

/**
 * The score numbers for final months `from..through`: across-world mean and sample sd of every
 * count, world 1's own rows, and the plan's effect over its paired twin. Each world's rows are
 * computed once.
 */
export function chunkOf(
  plan: WorldSeries[],
  twin: WorldSeries[],
  money: MoneyFeed | null,
  from: number,
  through: number
): SeriesChunk {
  if (plan.length === 0) throw new Error('world-score: chunkOf needs at least one world');
  if (plan.length !== twin.length) {
    throw new Error(`world-score: ${plan.length} plan worlds but ${twin.length} twin worlds`);
  }
  for (const set of [plan, twin]) {
    for (const s of set) {
      if (s.finalThrough() < through) {
        throw new Error(`world-score: month ${through} is not final (${s.finalThrough()})`);
      }
    }
  }
  // World 1's money (rule 9); read first, so a series without extras throws before any work.
  const moneyRows = money === null ? null : moneyRowsOf(money, extrasOf(plan[0]), from, through);

  const w = plan.length;
  const planRows = plan.map((s) => s.rows(from, through));
  const twinRows = twin.map((s) => s.rows(from, through));
  const n = through - from + 1;
  const mean: MonthRow[] = [];
  const sd: MonthRow[] = [];
  const planEffect: { mean: PlanRow; sd: PlanRow }[] = [];
  const month = new Array<MonthRow>(w);
  const ent = new Array<number>(w);
  const comp = new Array<number>(w);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < w; k++) {
      month[k] = planRows[k][i];
      ent[k] = planRows[k][i].entitledNew - twinRows[k][i].entitledNew;
      comp[k] = planRows[k][i].completedNetNew - twinRows[k][i].completedNetNew;
    }
    const r = reduceRows(month);
    mean.push(r.mean);
    sd.push(r.sd);
    const e = meanSd(ent);
    const c = meanSd(comp);
    planEffect.push({
      mean: { entitledNew: e.mean, completedNetNew: c.mean },
      sd: { entitledNew: e.sd, completedNetNew: c.sd }
    });
  }
  return { from, mean, sd, shown: planRows[0], planEffect, money: moneyRows, tiers: null };
}
