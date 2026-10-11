// Spec §4.1 / §4.3. Pure TS, no DOM. Called by brush-tool's worker host (I15).
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';
import type { Score, Target } from './types';

export const UNASSIGNED = 'Unassigned';

export interface Contribution {
  gross: number;
  demolished: number;
  neighborhood: string;
}

export interface ScoreAccumulator {
  /** Replaces the parcel's prior contribution. `null` removes it. O(1). */
  set(parcel: ParcelRecord, building: GeneratedBuilding | null): void;
  clear(): void;
  /** A fresh I11 `Score`; later `set` calls do not affect it. */
  snapshot(): Score;
}

function contributionOf(p: ParcelRecord, b: GeneratedBuilding | null): Contribution | null {
  if (!b) return null;
  return {
    gross: b.units,
    demolished: b.replacesExisting ? p.existingUnits : 0,
    neighborhood: p.neighborhood.trim() || UNASSIGNED
  };
}

interface Hood {
  net: number;
  count: number;
}

function buildScore(
  grossUnits: number,
  demolishedUnits: number,
  parcelsChanged: number,
  hoods: ReadonlyMap<string, Hood>,
  targets: readonly Target[]
): Score {
  const netUnits = grossUnits - demolishedUnits;
  const names = [...hoods.keys()].sort();
  return {
    grossUnits,
    demolishedUnits,
    netUnits,
    targets: targets.map((target) => ({ target, fraction: netUnits / target.units })),
    parcelsChanged,
    byNeighborhood: Object.fromEntries(names.map((n) => [n, hoods.get(n)!.net]))
  };
}

export function createScoreAccumulator(targets: readonly Target[]): ScoreAccumulator {
  const byParcel = new Map<ParcelId, Contribution>();
  const hoods = new Map<string, Hood>();
  let gross = 0;
  let demolished = 0;

  function apply(c: Contribution, sign: 1 | -1): void {
    gross += sign * c.gross;
    demolished += sign * c.demolished;
    const h = hoods.get(c.neighborhood) ?? { net: 0, count: 0 };
    h.net += sign * (c.gross - c.demolished);
    h.count += sign;
    if (h.count === 0) hoods.delete(c.neighborhood);
    else hoods.set(c.neighborhood, h);
  }

  return {
    set(parcel, building) {
      const prev = byParcel.get(parcel.id);
      if (prev) apply(prev, -1);
      const next = contributionOf(parcel, building);
      if (next) {
        apply(next, 1);
        byParcel.set(parcel.id, next);
      } else {
        byParcel.delete(parcel.id);
      }
    },
    clear() {
      byParcel.clear();
      hoods.clear();
      gross = 0;
      demolished = 0;
    },
    snapshot() {
      return buildScore(gross, demolished, byParcel.size, hoods, targets);
    }
  };
}

/**
 * Pure, non-incremental score (the `score()` I15's worker host calls). Must equal an
 * accumulator's snapshot after the same `set` sequence. A parcel id that repeats takes
 * its last entry.
 */
export function score(
  entries: Iterable<[ParcelRecord, GeneratedBuilding]>,
  targets: readonly Target[]
): Score {
  const byParcel = new Map<ParcelId, Contribution>();
  for (const [p, b] of entries) {
    const c = contributionOf(p, b);
    if (c) byParcel.set(p.id, c);
    else byParcel.delete(p.id);
  }
  let gross = 0;
  let demolished = 0;
  const hoods = new Map<string, Hood>();
  for (const c of byParcel.values()) {
    gross += c.gross;
    demolished += c.demolished;
    const h = hoods.get(c.neighborhood);
    if (h) {
      h.net += c.gross - c.demolished;
      h.count += 1;
    } else {
      hoods.set(c.neighborhood, { net: c.gross - c.demolished, count: 1 });
    }
  }
  return buildScore(gross, demolished, byParcel.size, hoods, targets);
}
