/**
 * T8 `TimelineScore` fixtures for the fzp-mode unit tests. Every value is a formula of the month
 * index `i`, so a test derives its expectation instead of hard-coding it:
 *
 *   months[i]     the 1st of month i from 2026-10-01 (291 entries; months[290] = 2050-12-01)
 *   shown[i]      completedNet 100i, pipeline 60i, new 40i, entitledNew 50i, exitedUnits 5i
 *   band[i]       p10 90i, p50 100i, p90 110i
 *   planEffect[i] completedNetNew 30i - 300, entitledNew 45i - 200
 *   planEffectBand[i]  p10 30i - 350, p50 30i - 300, p90 30i - 250
 *   tiers.completed[i]  veryLow 5i, low 5i, moderate 5i, aboveModerate 80i, unrecorded 5i (sums to
 *                       completedNet 100i)
 *   tiers.baseline      veryLow 1000, low 600, moderate 500, aboveModerate 9500, unrecorded 400
 *                       (sums to BASELINE 12000)
 *   tiers.targets       one per RHNA_TIER_TARGETS row, deadline 2031-01-31,
 *                       fraction[i] = (baseline[t] + completed[i][t]) / units
 *
 * TIMELINE_SCORE_MONEY adds `money` (two pools; every other series is 0):
 *
 *   u-bond (goBond, 'Added bond')  received[i] 12,000,000 x floor(i / 12 + 1), spent[i] 1,000,000i
 *   federal (uncapped)             received 0, spent[i] 1,500,000i
 *   fundedHomes[i] 4i, displacedHomes[i] i, publicSpent[i] 2,500,000i (= sum of spent + lostCredit)
 *   owed       u-bond, principal P = received[290] = 12,000,000 x 25 = 300,000,000,
 *              repayment debtService(P, { rate 0.06, termYears 20 }).total, nominal
 *   limits     limitStatements for that one goBond borrowing of P
 *
 * With committed, out, repaid and lost all 0, identity I2 reduces to C = S and I3 to no loans.
 * received stays at or above spent in every month, so I4 holds for u-bond.
 */
import { M1_TARGETS } from '$lib/scoreboard';
import { debtService, limitStatements } from '$lib/sim/finance';
import type { TimelineScore } from '$lib/sim/protocol';
import { tierTargetsOf } from '$lib/sim/scenario/score';
import type { Provenance, TierUnits } from '$lib/timelapse/types';
import { dayFromUtc } from '../time';

export const FIX_ASOF = dayFromUtc(2026, 10, 16);

/** The fixture runs to this horizon: 291 months, 2026-10 to 2050-12. Pair it with TIMELINE_SCORE, never with the product HORIZON. */
export const FIX_HORIZON = dayFromUtc(2050, 12, 31);

const MONTHS = 291;
const BASELINE = 12000;
const DEADLINE = dayFromUtc(2031, 1, 31);

const baselineProvenance: Provenance = {
  tier: 1,
  label: 'Official published totals',
  sources: [
    { label: 'SF Planning, Housing Inventory', url: 'https://example.org/housing-inventory' }
  ],
  method: 'Net new units completed since the start of the RHNA period.',
  window: ['2022-06-30', '2026-10-16']
};

const planningProvenance: Provenance = {
  tier: 1,
  label: 'Official published estimate',
  sources: [{ label: 'SF Planning, Family Zoning Plan', url: 'https://example.org/fzp-planning' }],
  method: 'Entitlements the plan is expected to add over 20 years.'
};

const controllerProvenance: Provenance = {
  tier: 1,
  label: 'Official published estimate',
  sources: [{ label: 'Controller, Economic Impact', url: 'https://example.org/fzp-controller' }],
  method: 'Completions the plan is expected to add by 2045.'
};

const TIER_BASELINE: TierUnits = {
  veryLow: 1000,
  low: 600,
  moderate: 500,
  aboveModerate: 9500,
  unrecorded: 400
};

export function makeTimelineScore(): TimelineScore {
  const idx = Array.from({ length: MONTHS }, (_, i) => i);
  const rhna = M1_TARGETS.find((t) => t.id === 'rhna')!;
  const buffer = M1_TARGETS.find((t) => t.id === 'rhna-buffer')!;
  const completed: TierUnits[] = idx.map((i) => ({
    veryLow: 5 * i,
    low: 5 * i,
    moderate: 5 * i,
    aboveModerate: 80 * i,
    unrecorded: 5 * i
  }));
  return {
    months: idx.map((i) => dayFromUtc(2026, 10 + i, 1)),
    shown: idx.map((i) => ({
      completedNet: 100 * i,
      completedNetPipeline: 60 * i,
      completedNetNew: 40 * i,
      entitledNew: 50 * i,
      inProgress: {
        preApplication: 10,
        filed: 20,
        entitled: 30,
        permitFiled: 40,
        permitIssued: 50,
        construction: 60
      },
      exitedUnits: 5 * i
    })),
    planEffect: idx.map((i) => ({ completedNetNew: 30 * i - 300, entitledNew: 45 * i - 200 })),
    planEffectBand: idx.map((i) => ({ p10: 30 * i - 350, p50: 30 * i - 300, p90: 30 * i - 250 })),
    band: idx.map((i) => ({ p10: 90 * i, p50: 100 * i, p90: 110 * i })),
    baseline: {
      completedNet: BASELINE,
      since: dayFromUtc(2022, 6, 30),
      provenance: baselineProvenance
    },
    phasing: {
      masters: 2,
      enrichedMasters: 1,
      phasesScheduled: 5,
      phasesEstimated: 3,
      unenriched: [
        { projectId: 'CASE:2012-000020PRX', label: null, units: 120, drawn: true },
        { projectId: 'CASE:2013-000001PRX', label: 'Score Only Yards', units: 80, drawn: false }
      ]
    },
    targets: [rhna, buffer].map((target) => ({
      target,
      deadline: DEADLINE,
      fraction: idx.map((i) => (BASELINE + 100 * i) / target.units)
    })),
    tiers: { completed, baseline: TIER_BASELINE, targets: tierTargetsOf(TIER_BASELINE, completed) },
    references: [
      {
        id: 'planning-entitlements',
        label: 'Planning: about 39,000 homes approved',
        units: 39000,
        from: dayFromUtc(2026, 1, 12),
        by: dayFromUtc(2045, 12, 31),
        measure: 'planEffect.entitledNew',
        provenance: planningProvenance
      },
      {
        id: 'controller-2045',
        label: 'Controller: 14,646 homes built',
        units: 14646,
        from: dayFromUtc(2026, 1, 12),
        by: dayFromUtc(2045, 6, 30),
        measure: 'planEffect.completedNetNew',
        provenance: controllerProvenance
      }
    ]
  };
}

export const TIMELINE_SCORE: TimelineScore = makeTimelineScore();

/** Revision 0: the plan effect is not computed yet (T8, IA-9). */
export const TIMELINE_SCORE_R0: TimelineScore = {
  ...makeTimelineScore(),
  planEffect: [],
  planEffectBand: []
};

export const TIMELINE_SCORE_NO_PHASING: TimelineScore = {
  ...makeTimelineScore(),
  phasing: {
    masters: 0,
    enrichedMasters: 0,
    phasesScheduled: 0,
    phasesEstimated: 0,
    unenriched: []
  }
};

const BOND_DEBT = { rate: 0.06, termYears: 20 };

function makeMoney(): NonNullable<TimelineScore['money']> {
  const idx = Array.from({ length: MONTHS }, (_, i) => i);
  const zeros = () => idx.map(() => 0);
  const principal = 12_000_000 * Math.floor((MONTHS - 1) / 12 + 1);
  return {
    pools: [
      {
        id: 'u-bond',
        label: 'Added bond',
        kind: 'goBond',
        received: idx.map((i) => 12_000_000 * Math.floor(i / 12 + 1)),
        committed: zeros(),
        out: zeros(),
        spent: idx.map((i) => 1_000_000 * i),
        repaid: zeros(),
        lost: zeros(),
        lostCredit: zeros()
      },
      {
        id: 'federal',
        label: 'Federal tax credits',
        kind: 'federal',
        received: zeros(),
        committed: zeros(),
        out: zeros(),
        spent: idx.map((i) => 1_500_000 * i),
        repaid: zeros(),
        lost: zeros(),
        lostCredit: zeros()
      }
    ],
    fundedHomes: idx.map((i) => 4 * i),
    displacedHomes: idx,
    publicSpent: idx.map((i) => 2_500_000 * i),
    owed: [
      {
        pool: 'u-bond',
        principal,
        repayment: debtService(principal, BOND_DEBT).total,
        nominal: true
      }
    ],
    limits: limitStatements([{ pool: 'u-bond', kind: 'goBond', principal, debt: BOND_DEBT }])
  };
}

export const TIMELINE_SCORE_MONEY: TimelineScore = { ...makeTimelineScore(), money: makeMoney() };
