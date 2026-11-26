// The time-aware score (T8, spec §4.3 and §4.5). Built from one run's Schedules and Masters as
// prefix sums of per-month deltas: every event adds its delta at `idx(day)` (an O(1) table), so
// the cost is O(events + months), never a per-month scan over the schedules. Pure and worker-safe.
import type { Target } from '$lib/scoreboard';
import { M1_TARGETS, RHNA_TIER_TARGETS } from '$lib/scoreboard/targets';
import type { InFlightProject } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type { TierUnits } from '$lib/timelapse/types';
import { addMonths, dayOf, firstOfMonth } from './dates';
import type { TargetProgressAt, TimelineScore } from './types';

type Shown = TimelineScore['shown'];

/**
 * `months[i]` is the 1st of the i-th month, from `asOf`'s month to the horizon's month (§4.3):
 * 483 entries for 2026-10-16 to 2066-12-31.
 */
export function monthsOf(asOf: Day, horizon: Day): Day[] {
  const last = firstOfMonth(horizon);
  const out: Day[] = [];
  for (let m = firstOfMonth(asOf); m <= last; m = addMonths(m, 1)) out.push(m);
  return out;
}

/**
 * `idx(d)`: the `i` with `months[i] ≤ d < T_i`, where `T_i = months[i + 1]` (`horizon + 1` for
 * the last entry), for `months[0] ≤ d ≤ horizon` (§4.3). One table lookup per call; a day outside
 * that range throws a `RangeError`.
 */
export function monthIndexer(months: Day[], horizon: Day): (d: Day) => number {
  const m0 = months[0];
  const table = new Uint16Array(horizon - m0 + 1);
  for (let i = 0; i < months.length; i++) {
    const to = i + 1 < months.length ? months[i + 1] : horizon + 1;
    table.fill(i, months[i] - m0, to - m0);
  }
  return (d) => {
    const k = d - m0;
    if (!(k >= 0 && k < table.length)) throw new RangeError(`idx: day ${d} outside the months`);
    return table[k];
  };
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `phasing` (§4.5): seed-independent counts over the `multiPhase` rows. A phase is scheduled when
 * it has a published source and a plan date after `asOf`; every other phase is estimated.
 */
export function phasingOf(projects: InFlightProject[], asOf: Day): TimelineScore['phasing'] {
  const out: TimelineScore['phasing'] = {
    masters: 0,
    enrichedMasters: 0,
    phasesScheduled: 0,
    phasesEstimated: 0,
    unenriched: []
  };
  for (const p of projects) {
    if (!p.multiPhase) continue;
    out.masters++;
    if (p.phases === null) {
      out.unenriched.push({
        projectId: p.id,
        label: p.label,
        units: p.units,
        drawn: p.parcelIds.length > 0
      });
      continue;
    }
    out.enrichedMasters++;
    for (const ph of p.phases) {
      const plan = ph.plannedPermitFiled;
      if (ph.source !== null && plan !== null && plan > asOf) out.phasesScheduled++;
      else out.phasesEstimated++;
    }
  }
  out.unenriched.sort((a, b) => b.units - a.units || cmp(a.projectId, b.projectId));
  return out;
}

/** The RHNA deadline (partner ruling OD-T4; tier 1, the RHNA Primer). */
export const RHNA_DEADLINE: Day = dayOf(2031, 1, 31);

/** One entry per target: `(baseline + completedNet[i]) / units`, uncapped. */
export function targetsOf(
  baselineUnits: number,
  shown: Shown,
  targets: readonly Target[] = M1_TARGETS
): TargetProgressAt[] {
  return targets.map((target) => ({
    target,
    deadline: RHNA_DEADLINE,
    fraction: shown.map((r) => (baselineUnits + r.completedNet) / target.units)
  }));
}

/**
 * One entry per `RHNA_TIER_TARGETS` row (spec 4.3): `(baseline[t] + completed[i][t]) / units`,
 * uncapped; `unrecorded` homes belong to no tier's fraction.
 */
export function tierTargetsOf(baseline: TierUnits, completed: TierUnits[]): TargetProgressAt[] {
  return RHNA_TIER_TARGETS.map((target) => {
    const t = target.tier!;
    return {
      target,
      deadline: RHNA_DEADLINE,
      fraction: completed.map((c) => (baseline[t] + c[t]) / target.units)
    };
  });
}

const FZP_EFFECTIVE = dayOf(2026, 1, 12);
// A literal copy of pipeline/enrichment/market.json `source` (src must not read pipeline files);
// pipeline/test/enrichment/market-json.test.ts pins the equality.
const CONTROLLER_EIR = {
  label:
    'SF Controller, Office of Economic Analysis: Family Zoning Plan: Economic Impact Report (Items 250700 and 250701), 2025-10-29, slide 18',
  url: 'https://newspack-missionlocal.s3.amazonaws.com/mission/wp-content/uploads/2025/10/250700_economic_impact_final.pdf'
};
const controllerMethod = (scenario: string) =>
  "The Controller's Office of Economic Analysis, *Family Zoning Plan: Economic Impact Report*, " +
  '2025-10-29, slide 18: net additional units from the rezoning beyond existing zoning over 20 ' +
  `years, ${scenario} scenario. From is the plan's effective date (2026-01-12), by is the end of ` +
  "2045 (inferred: the report forecasts 2026-2045). Both of the Controller's scenarios assume " +
  "housing prices grow from 2025 (slides 12 and 15). This simulation holds today's market to the " +
  'end of the timeline, so its plan effect is expected to fall below both. Compared with ' +
  'planEffect.completedNetNew (completions, net units).';

/** The published estimates the score compares with (§4.5 "References"). */
export const REFERENCES: TimelineScore['references'] = [
  {
    id: 'planning-citywide',
    label:
      'SF Planning: ~39,000 net units approved because of the rezoning within 5 years (citywide method)',
    units: 39000,
    from: FZP_EFFECTIVE,
    by: dayOf(2031, 1, 12),
    measure: 'planEffect.entitledNew',
    provenance: {
      tier: 1,
      label: 'SF Planning, Family Zoning Plan Land Use Committee presentation, 2025-11-17, slide 6',
      sources: [
        {
          label: 'SF Planning, Land Use Committee presentation, 2025-11-17 (verified by fetch)',
          url: 'https://sfplanning.org/sites/default/files/documents/citywide/fzp_land_use_committee_presentation-111725.pdf'
        }
      ],
      method:
        "SF Planning's citywide method: entitlements from 2005 to 2023 were 22% of zoned " +
        'capacity in 19 years (about 1% a year), so 5% of the added capacity in 5 years is about ' +
        '39,000 net units approved, from the effective date 2026-01-12. Compared with ' +
        'planEffect.entitledNew (entitlements, net units).'
    }
  },
  {
    id: 'controller-high',
    label:
      "Controller's Office of Economic Analysis: 14,646 net additional units from the rezoning by 2045, high growth",
    units: 14646,
    from: FZP_EFFECTIVE,
    by: dayOf(2045, 12, 31),
    measure: 'planEffect.completedNetNew',
    provenance: {
      tier: 1,
      label: "Controller's Office of Economic Analysis, high growth",
      sources: [CONTROLLER_EIR],
      method: controllerMethod('high growth')
    }
  },
  {
    id: 'controller-low',
    label:
      "Controller's Office of Economic Analysis: 8,504 net additional units from the rezoning by 2045, conservative",
    units: 8504,
    from: FZP_EFFECTIVE,
    by: dayOf(2045, 12, 31),
    measure: 'planEffect.completedNetNew',
    provenance: {
      tier: 1,
      label: "Controller's Office of Economic Analysis, conservative",
      sources: [CONTROLLER_EIR],
      method: controllerMethod('conservative')
    }
  }
];
