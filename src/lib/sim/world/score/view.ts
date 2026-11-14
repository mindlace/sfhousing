import { debtService } from '$lib/sim/finance';
import { targetsOf, tierTargetsOf } from '$lib/sim/scenario/score';
import type {
  MoneyRow,
  MoneyView,
  PlanRow,
  ScoreStatics,
  SeriesChunk,
  TimelineView
} from './types';

/** z of the 80% central band (10th to 90th percentile), as today's `band`. */
export const BAND_Z = 1.2816;

function bandOf(m: PlanRow, sd: PlanRow): { lo: PlanRow; hi: PlanRow } {
  return {
    lo: {
      entitledNew: m.entitledNew - BAND_Z * sd.entitledNew,
      completedNetNew: m.completedNetNew - BAND_Z * sd.completedNetNew
    },
    hi: {
      entitledNew: m.entitledNew + BAND_Z * sd.entitledNew,
      completedNetNew: m.completedNetNew + BAND_Z * sd.completedNetNew
    }
  };
}

/**
 * World 1's money as of month `rows.length - 1` (rule 12): today's `TimelineScore['money']` with
 * its series cut there, `owed` on each debt pool's `received` that month, and `limits` the
 * statics' (the same in every world, fixed as the forecast fills).
 */
function moneyViewOf(rows: MoneyRow[], statics: ScoreStatics): MoneyView {
  const limits = statics.limits;
  const debts = statics.debts;
  if (limits === null || debts === null) {
    throw new Error('world-score: money in the chunks but no finance in the statics');
  }
  const pools: MoneyView['pools'] = rows[0].pools.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    received: [],
    committed: [],
    out: [],
    spent: [],
    repaid: [],
    lost: [],
    lostCredit: []
  }));
  for (const r of rows) {
    r.pools.forEach((p, q) => {
      const s = pools[q];
      s.received.push(p.received);
      s.committed.push(p.committed);
      s.out.push(p.out);
      s.spent.push(p.spent);
      s.repaid.push(p.repaid);
      s.lost.push(p.lost);
      s.lostCredit.push(p.lostCredit);
    });
  }
  const last = rows.length - 1;
  const owed: MoneyView['owed'] = [];
  const debtOf = new Map(debts.map((d) => [d.pool, d.debt]));
  for (const p of pools) {
    const debt = debtOf.get(p.id);
    if (debt === undefined) continue;
    const principal = p.received[last];
    owed.push({
      pool: p.id,
      principal,
      repayment: debtService(principal, debt).total,
      nominal: true
    });
  }
  return {
    pools,
    fundedHomes: rows.map((r) => r.fundedHomes),
    displacedHomes: rows.map((r) => r.displacedHomes),
    publicSpent: rows.map((r) => r.publicSpent),
    owed,
    limits
  };
}

/** Joins contiguous chunks into what the page reads. Throws on a gap, an overlap or a late start. */
export function viewOf(chunks: SeriesChunk[], statics: ScoreStatics): TimelineView {
  const mean: TimelineView['mean'] = [];
  const band: TimelineView['band'] = [];
  const shown: TimelineView['shown'] = [];
  const planEffect: TimelineView['planEffect'] = [];
  const planEffectBand: TimelineView['planEffectBand'] = [];
  const tiers: NonNullable<TimelineView['tiers']> = [];
  const money: MoneyRow[] = [];
  let hasTiers = chunks.length > 0;
  let hasMoney = chunks.length > 0;
  for (const c of chunks) {
    if (c.from !== mean.length) {
      throw new Error(`chunk from ${c.from} does not follow ${mean.length - 1}`);
    }
    for (let i = 0; i < c.mean.length; i++) {
      const m = c.mean[i].completedNet;
      const sd = c.sd[i].completedNet;
      mean.push(c.mean[i]);
      band.push({ lo: m - BAND_Z * sd, hi: m + BAND_Z * sd });
      shown.push(c.shown[i]);
      planEffect.push(c.planEffect[i].mean);
      planEffectBand.push(bandOf(c.planEffect[i].mean, c.planEffect[i].sd));
    }
    if (c.tiers) tiers.push(...c.tiers);
    else hasTiers = false;
    if (c.money) money.push(...c.money);
    else hasMoney = false;
  }
  const { units, since, provenance } = statics.baseline;
  const tierSeries = hasTiers ? tiers : null;
  return {
    months: statics.months,
    lastIndex: statics.lastIndex,
    filledThrough: mean.length - 1,
    mean,
    band,
    shown,
    planEffect,
    planEffectBand,
    targets: targetsOf(units, mean),
    tierTargets:
      statics.tierBaseline && tierSeries ? tierTargetsOf(statics.tierBaseline, tierSeries) : null,
    money: hasMoney && money.length > 0 ? moneyViewOf(money, statics) : null,
    tiers: tierSeries,
    baseline: { completedNet: units, since, provenance },
    phasing: statics.phasing,
    references: statics.references,
    compare: statics.compare
  };
}

/** The chunks' months before `k`: whole chunks kept, the one straddling `k` trimmed (rule 13). */
export function chunksBefore(chunks: SeriesChunk[], k: number): SeriesChunk[] {
  const out: SeriesChunk[] = [];
  for (const c of chunks) {
    if (c.from >= k) break;
    const n = k - c.from;
    if (n >= c.mean.length) {
      out.push(c);
      continue;
    }
    out.push({
      from: c.from,
      mean: c.mean.slice(0, n),
      sd: c.sd.slice(0, n),
      shown: c.shown.slice(0, n),
      planEffect: c.planEffect.slice(0, n),
      money: c.money && c.money.slice(0, n),
      tiers: c.tiers && c.tiers.slice(0, n)
    });
  }
  return out;
}
