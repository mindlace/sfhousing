// SB 79 as written (Gov. Code §§65912.155–65912.162), pure: TOD stop tiers from the transit
// network, distance bands, zone classes, the tallest standard within reach and the per-lot row,
// capped at the statute density. Every parameter is in pipeline/sb79-config.ts with its cite.
import type { Sb79Status } from '../../src/lib/data/policy-codec';
import { FILL_LEVELS, fillStories } from '../../src/lib/data/scenario-codec';
import { capScenarioYield } from '../../src/lib/data/scenario-yield';
import type { TransitNetwork } from '../../src/lib/data/transit';
import {
  BAND_MAX_M,
  HF_TPD,
  LIGHT_RAIL_MODES,
  MIN_UNITS,
  MUNI_TIER2_STOP_IDS,
  STANDARDS,
  UNITS_ROUNDING,
  VHF_TPD,
  ZONE_CLASS_RULES,
  type Sb79Tier,
  type TodBand,
  type UnitsRounding,
  type ZoneClass
} from '../sb79-config';
import { storiesFromFt } from './heights';

/** Square metres per acre (international foot, exact). */
const M2_PER_ACRE = 4046.8564224;

/**
 * The SB 79 tier of each stop, keyed by stop index; a stop with no tier is absent. Heavy rail is
 * tier 1. Commuter rail is tier 1 at ≥ VHF_TPD trains a day at the station (Σ `tpd` over the
 * commuter-rail pattern stops sharing the stop's `stationId`, or its own id when null), tier 2 at
 * ≥ HF_TPD. LIGHT_RAIL_MODES and MUNI_TIER2_STOP_IDS are tier 2. The lowest tier wins.
 */
export function stopTiers(net: TransitNetwork): Map<number, Sb79Tier> {
  const stationOf = (i: number) => net.stops[i].stationId ?? net.stops[i].id;
  const trains = new Map<string, number>();
  for (const p of net.patterns)
    if (p.mode === 'commuter-rail')
      for (const s of p.stops)
        trains.set(stationOf(s.stop), (trains.get(stationOf(s.stop)) ?? 0) + s.tpd);
  const tiers = new Map<number, Sb79Tier>();
  const set = (i: number, t: Sb79Tier) => {
    const was = tiers.get(i);
    if (was === undefined || t < was) tiers.set(i, t);
  };
  for (const p of net.patterns)
    for (const s of p.stops) {
      if (p.mode === 'heavy-rail') set(s.stop, 1);
      else if (p.mode === 'commuter-rail') {
        const tpd = trains.get(stationOf(s.stop)) ?? 0;
        if (tpd >= VHF_TPD) set(s.stop, 1);
        else if (tpd >= HF_TPD) set(s.stop, 2);
      } else if (LIGHT_RAIL_MODES.includes(p.mode)) set(s.stop, 2);
    }
  net.stops.forEach((s, i) => {
    if (MUNI_TIER2_STOP_IDS.has(s.id)) set(i, 2);
  });
  return tiers;
}

/** The band of a distance in metres; each band is inclusive at its upper edge. 0 = beyond ½ mile. */
export function bandOf(distanceM: number): TodBand | 0 {
  if (distanceM <= BAND_MAX_M[1]) return 1;
  if (distanceM <= BAND_MAX_M[2]) return 2;
  if (distanceM <= BAND_MAX_M[3]) return 3;
  return 0;
}

/** Most permissive first; 'unlisted' (no ZONE_CLASS_RULES entry) last. */
const ZONE_RANK: readonly (ZoneClass | 'unlisted')[] = [
  'residential',
  'mixed',
  'commercial',
  'excluded',
  'unlisted'
];

/**
 * The SB 79 zone class of a `zoning_code`. A split code ('RH-1|PDR-1-G') takes its most permissive
 * component (a tie prefers a principally residential one); `null`, '' and a code no rule matches
 * are 'unlisted'.
 */
export function zoneClassOf(code: string | null): {
  zoneClass: ZoneClass | 'unlisted';
  principallyResidential: boolean;
} {
  let best: { zoneClass: ZoneClass | 'unlisted'; principallyResidential: boolean } = {
    zoneClass: 'unlisted',
    principallyResidential: false
  };
  for (const part of (code ?? '').split('|')) {
    const rule = ZONE_CLASS_RULES.find((r) => r.pattern.test(part.trim()));
    if (!rule) continue;
    const r = ZONE_RANK.indexOf(rule.zoneClass);
    const b = ZONE_RANK.indexOf(best.zoneClass);
    if (r < b || (r === b && rule.principallyResidential && !best.principallyResidential))
      best = { zoneClass: rule.zoneClass, principallyResidential: rule.principallyResidential };
  }
  return best;
}

/**
 * The standard a lot gets from its nearest stop of each tier: the highest `heightFt` over the
 * tiers whose distance falls in a band; a tie goes to tier 1. null when no tier is within ½ mile.
 */
export function bestStandard(
  minDist: Partial<Record<Sb79Tier, number>>
): { tier: Sb79Tier; band: TodBand } | null {
  let best: { tier: Sb79Tier; band: TodBand } | null = null;
  for (const tier of [1, 2] as const) {
    const d = minDist[tier];
    if (d === undefined) continue;
    const band = bandOf(d);
    if (band === 0) continue;
    if (best === null || STANDARDS[tier][band].heightFt > STANDARDS[best.tier][best.band].heightFt)
      best = { tier, band };
  }
  return best;
}

const ROUND: Record<UnitsRounding, (x: number) => number> = {
  ceil: Math.ceil,
  floor: Math.floor,
  round: (x) => Math.floor(x + 0.5)
};

/** `rounding(share × duPerAcre × acres)`; SB 79 as written rounds up (UNITS_ROUNDING). */
export function unitsFor(
  duPerAcre: number,
  lotAreaM2: number,
  share = 1,
  rounding: UnitsRounding = UNITS_ROUNDING
): number {
  return ROUND[rounding]((share * duPerAcre * lotAreaM2) / M2_PER_ACRE);
}

/**
 * One lot under SB 79 as written. Statuses in precedence order: `outside` (no stop within ½
 * mile), `not-eligible` (not scenario-eligible), `zone` (excluded or unlisted zoning),
 * `rent-control`, then the statute envelope: `storiesFromFt(heightFt)` stories and a cap of
 * `unitsFor(duPerAcre, lotAreaM2)`, each fill level's yield capped (capScenarioYield) and zeroed
 * below MIN_UNITS; a zero top yield is `min-units`, else `applies`. Every status but `applies`
 * has 0 stories, a null cap and zero yields. `uncappedTop` is the full-fill gross before the cap.
 */
export function sb79Row(a: {
  best: { tier: Sb79Tier; band: TodBand } | null;
  eligible: boolean;
  zone: ZoneClass | 'unlisted';
  rentControlLikely: boolean;
  lotAreaM2: number;
  existingUnits: number;
  grossAt: (stories: number) => number;
}): {
  status: Sb79Status;
  stories: number;
  cap: number | null;
  yield: number[];
  uncappedTop: number;
} {
  const none = (status: Sb79Status, uncappedTop = 0) => ({
    status,
    stories: 0,
    cap: null,
    yield: FILL_LEVELS.map(() => 0),
    uncappedTop
  });
  if (a.best === null) return none('outside');
  if (!a.eligible) return none('not-eligible');
  if (a.zone === 'excluded' || a.zone === 'unlisted') return none('zone');
  if (a.rentControlLikely) return none('rent-control');
  const std = STANDARDS[a.best.tier][a.best.band];
  const stories = storiesFromFt(std.heightFt);
  const cap = unitsFor(std.duPerAcre, a.lotAreaM2);
  const yields = FILL_LEVELS.map((f) => {
    const y = capScenarioYield(a.grossAt(fillStories(f, stories)), cap, a.existingUnits);
    return y < MIN_UNITS ? 0 : y;
  });
  const uncappedTop = a.grossAt(fillStories(FILL_LEVELS[FILL_LEVELS.length - 1], stories));
  if (yields[yields.length - 1] < MIN_UNITS) return none('min-units', uncappedTop);
  return { status: 'applies', stories, cap, yield: yields, uncappedTop };
}
