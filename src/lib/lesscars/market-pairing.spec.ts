// Deterministic and paired under today's market (Release 1 of sim-financing): the /lesscars arms
// share `market`, and a plan arm that differs only by reservations differs only on reserved rows.
// Kept outside the hashed engine paths on purpose: it pins engine behaviour without moving the
// dataset version.
import { describe, expect, it } from 'vitest';
import { dayOf } from '$lib/sim/scenario/dates';
import { precomputeOf } from '$lib/sim/scenario/input';
import { GOLDEN_HORIZON, goldenInput } from '$lib/sim/scenario/simulate.golden.cases';
import { simulateDetailed } from '$lib/sim/scenario/simulate';
import type { Schedule, SimInput } from '$lib/sim/scenario/types';

const base = goldenInput();
const n = base.parcels.count;
const market = [
  { from: base.asOf, logOdds: -0.693147 },
  { from: dayOf(2031, 1, 1), logOdds: -1.2 }
];
const shifted: SimInput = { ...base, market };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Each schedule as comparable JSON, keyed by its first parcel id. */
function byLot(ss: Schedule[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const s of ss) {
    const k = s.parcelIds[0];
    m.set(k, [...(m.get(k) ?? []), JSON.stringify({ ...s, projectId: undefined })]);
  }
  for (const v of m.values()) v.sort();
  return m;
}

describe('pairing under market steps', () => {
  it('the market moves the run (the checks below are not vacuous)', () => {
    const a = simulateDetailed(base, 1, GOLDEN_HORIZON).schedules.length;
    const b = simulateDetailed(shifted, 1, GOLDEN_HORIZON).schedules.length;
    expect(b).not.toBe(a);
  });

  it('two arms with the same market and no plan difference are identical, seed for seed', () => {
    const twin: SimInput = { ...base, market };
    for (const seed of SEEDS)
      expect(simulateDetailed(shifted, seed, GOLDEN_HORIZON)).toEqual(
        simulateDetailed(twin, seed, GOLDEN_HORIZON)
      );
  });

  it('an arm with reservations differs from its twin only on the reserved rows', () => {
    const rf = new Int32Array(n);
    const reserved = new Set<string>();
    precomputeOf(shifted).candidates.forEach((i, c) => {
      if (c % 2 === 0) {
        rf[i] = dayOf(2030, 1, 1);
        reserved.add(base.parcels.id[i]);
      }
    });
    const plan: SimInput = { ...shifted, reservedFrom: rf };
    let reservedDiffers = 0;
    for (const seed of SEEDS) {
      const p = byLot(simulateDetailed(plan, seed, GOLDEN_HORIZON).schedules);
      const t = byLot(simulateDetailed(shifted, seed, GOLDEN_HORIZON).schedules);
      for (const lot of new Set([...p.keys(), ...t.keys()])) {
        if (reserved.has(lot)) {
          if (JSON.stringify(p.get(lot)) !== JSON.stringify(t.get(lot))) reservedDiffers++;
          continue;
        }
        expect(p.get(lot), `seed ${seed} lot ${lot}`).toEqual(t.get(lot));
      }
    }
    expect(reservedDiffers).toBeGreaterThan(0);
  });
});
