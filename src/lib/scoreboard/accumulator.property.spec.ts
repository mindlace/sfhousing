import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';
import { createScoreAccumulator, score } from './accumulator';
import { M1_TARGETS } from './targets';
import { building, parcel } from './score-fixtures';

const N = 500;
const HOODS = ['Mission', 'Sunset', 'Bayview', '', 'Richmond', 'Noe Valley', '__proto__'];
const PARCELS: ParcelRecord[] = Array.from({ length: N }, (_, i) =>
  parcel(String(5_000_000 + i), i % 7, HOODS[i % HOODS.length])
);

// An op sets parcel `idx` to a building (units, replacesExisting) or to null.
const opArb = fc.record({
  idx: fc.integer({ min: 0, max: N - 1 }),
  b: fc.option(fc.record({ units: fc.integer({ min: 1, max: 400 }), repl: fc.boolean() }), {
    nil: null
  })
});

function toBuilding(p: ParcelRecord, b: { units: number; repl: boolean } | null) {
  return b ? building(p, b.units, b.repl) : null;
}

describe('accumulator property (spec §6)', () => {
  it('generator reaches scale (sequences routinely in the hundreds)', () => {
    const lengths = fc
      .sample(fc.array(opArb, { maxLength: 1500, size: 'max' }), { seed: 1, numRuns: 20 })
      .map((a) => a.length);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(200);
  });

  it('incremental snapshot deep-equals a from-scratch recompute', () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 1500, size: 'max' }), (ops) => {
        const acc = createScoreAccumulator(M1_TARGETS);
        const state = new Map<string, [ParcelRecord, GeneratedBuilding]>();
        for (const { idx, b } of ops) {
          const p = PARCELS[idx];
          const g = toBuilding(p, b);
          acc.set(p, g);
          if (g) state.set(p.id, [p, g]);
          else state.delete(p.id);
        }
        const full = score(state.values(), M1_TARGETS);
        expect(acc.snapshot()).toEqual(full);
        expect(JSON.stringify(acc.snapshot())).toBe(JSON.stringify(full));
      }),
      { numRuns: 100 }
    );
  });

  it('is invariant to the order of updates', () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(opArb, { selector: (o) => o.idx, maxLength: N, size: 'max' })
          .chain((ops) =>
            fc.tuple(
              fc.constant(ops),
              fc.shuffledSubarray(ops, { minLength: ops.length, maxLength: ops.length })
            )
          ),
        ([ops, shuffled]) => {
          const forward = createScoreAccumulator(M1_TARGETS);
          for (const { idx, b } of ops) forward.set(PARCELS[idx], toBuilding(PARCELS[idx], b));
          const other = createScoreAccumulator(M1_TARGETS);
          for (const { idx, b } of shuffled) other.set(PARCELS[idx], toBuilding(PARCELS[idx], b));
          expect(JSON.stringify(other.snapshot())).toBe(JSON.stringify(forward.snapshot()));
        }
      ),
      { numRuns: 100 }
    );
  });
});
