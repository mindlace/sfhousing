// Test support: hand-built score statics and series chunks (test values, not data). Browser-safe.
import type {
  MonthRow,
  MoneyRow,
  ScoreStatics,
  SeriesChunk,
  TimelineView
} from '$lib/sim/world/score/types';
import type { PoolKind } from '$lib/timelapse/types';

/** Score statics with `lastIndex + 1` months (default 23); with `finance`, empty limits and debts. */
export function statics(opts: { finance?: boolean; lastIndex?: number } = {}): ScoreStatics {
  const lastIndex = opts.lastIndex ?? 23;
  return {
    asOf: 0,
    months: Array.from({ length: lastIndex + 1 }, (_, i) => i * 30),
    lastIndex,
    baseline: {
      units: 1000,
      since: 0,
      provenance: { tier: 0, label: 'test', sources: [], method: 'test' }
    },
    tierBaseline: null,
    phasing: {
      masters: 0,
      enrichedMasters: 0,
      phasesScheduled: 0,
      phasesEstimated: 0,
      unenriched: []
    },
    references: [],
    compare: 'plan',
    limits: opts.finance ? [] : null,
    debts: opts.finance ? [] : null
  };
}

function row(v: number): MonthRow {
  return {
    completedNet: v,
    completedNetPipeline: v / 2,
    completedNetNew: v / 2,
    entitledNew: v + 1,
    inProgress: {
      preApplication: 1,
      filed: 1,
      entitled: 2,
      permitFiled: 1,
      permitIssued: 1,
      construction: 3
    },
    exitedUnits: 1
  };
}

const KINDS: PoolKind[] = ['goBond', 'generalRevenue', 'state', 'bank'];

/** A pool row for `id` at calendar month `k` (values grow with the month). */
export function poolRow(id: string, k: number, base = 0): MoneyRow['pools'][number] {
  const v = base + 10 * (k + 1);
  return {
    id,
    label: `Pool ${id}`,
    kind: KINDS[id.length % KINDS.length],
    received: v,
    committed: v,
    out: v / 2,
    spent: v / 2,
    repaid: 0,
    lost: 0,
    lostCredit: 0
  };
}

/**
 * Months `from` to `from + n - 1`. `base` shifts every value; with `pools`, world 1's money with
 * one row per pool (funded homes above displaced ones, so per added home is a number).
 */
export function chunk(
  from: number,
  n: number,
  opts: { pools?: string[]; base?: number } = {}
): SeriesChunk {
  const base = opts.base ?? 0;
  const ks = Array.from({ length: n }, (_, i) => from + i);
  const pools = opts.pools;
  return {
    from,
    mean: ks.map((k) => row(base + 3 * k)),
    sd: ks.map((k) => row(k / 4)),
    shown: ks.map((k) => row(base + 3 * k + 1)),
    planEffect: ks.map((k) => ({
      mean: { entitledNew: base + k, completedNetNew: base + k / 2 },
      sd: { entitledNew: 1, completedNetNew: 0.5 }
    })),
    money: pools
      ? ks.map((k) => ({
          pools: pools.map((id) => poolRow(id, k, base)),
          fundedHomes: 2 * (k + 1),
          displacedHomes: 0,
          displacedHomesCompleted: k > 2 ? 1 : 0,
          publicSpent: base + 100 * (k + 1)
        }))
      : null,
    tiers: null
  };
}

/** The view trimmed to months 0 to `n` (`filledThrough` n): a forecast still filling. */
export function cut(view: TimelineView, n: number): TimelineView {
  const k = n + 1;
  return {
    ...view,
    filledThrough: n,
    mean: view.mean.slice(0, k),
    band: view.band.slice(0, k),
    shown: view.shown.slice(0, k),
    planEffect: view.planEffect.slice(0, k),
    planEffectBand: view.planEffectBand.slice(0, k),
    targets: view.targets.slice(0, k),
    tierTargets: view.tierTargets?.slice(0, k) ?? null,
    tiers: view.tiers?.slice(0, k) ?? null
  };
}
