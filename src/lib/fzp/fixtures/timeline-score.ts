/**
 * T8 `TimelineScore` fixtures for the fzp-mode unit tests. Every value is a formula of the month
 * index `i`, so a test derives its expectation instead of hard-coding it:
 *
 *   months[i]     the 1st of month i from 2026-10-01 (291 entries; months[290] = 2050-12-01)
 *   shown[i]      completedNet 100i, pipeline 60i, new 40i, entitledNew 50i, exitedUnits 5i
 *   band[i]       p10 90i, p50 100i, p90 110i
 *   planEffect[i] completedNetNew 30i - 300, entitledNew 45i - 200
 *   planEffectBand[i]  p10 30i - 350, p50 30i - 300, p90 30i - 250
 */
import { M1_TARGETS } from '$lib/scoreboard';
import type { TimelineScore } from '$lib/sim/protocol';
import type { Provenance } from '$lib/timelapse/types';
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

export function makeTimelineScore(): TimelineScore {
  const idx = Array.from({ length: MONTHS }, (_, i) => i);
  const rhna = M1_TARGETS.find((t) => t.id === 'rhna')!;
  const buffer = M1_TARGETS.find((t) => t.id === 'rhna-buffer')!;
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
