// finance-score, spec 6 test 9: every `tiersOf` result is non-negative and sums to the final
// units, over random units, programme sets (the hand-built ones and random ones), weights and tiers.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INCOME_TIERS, type IncomeTier, type PoolKind } from '$lib/timelapse/types';
import {
  CASE_PROGRAMMES,
  TEST_TERMS,
  affordable,
  caseCtx,
  pipeline,
  schedule
} from './fixtures/finance-score-cases';
import { TIER_FIELDS, tierContext, tierSeries, tiersOf, type TierCtx } from './finance-score';
import { MINI_AS_OF, MINI_HORIZON } from './fixtures/mini-projects';
import { monthsOf, shownSeries } from './score';
import { simulateDetailed } from './simulate';
import { financeGoldenInput } from './simulate.finance.golden.cases';
import { GOLDEN_HORIZON, goldenInput } from './simulate.golden.cases';
import type { Schedule } from './types';

const unitsArb = fc.integer({ min: 0, max: 2000 });

const tiersArb: fc.Arbitrary<Record<IncomeTier, number> | null> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(null) },
  {
    weight: 6,
    arbitrary: fc
      .array(fc.integer({ min: 0, max: 100 }), { minLength: 4, maxLength: 4 })
      .filter((w) => w.some((x) => x > 0))
      .map((w) => {
        const t = w.reduce((s, x) => s + x, 0);
        return Object.fromEntries(INCOME_TIERS.map((k, i) => [k, w[i] / t])) as Record<
          IncomeTier,
          number
        >;
      })
  }
);

const poolKindArb = fc.constantFrom<PoolKind>('federal', 'state', 'generalRevenue', 'goBond');

const instrumentArb = fc.oneof(
  fc.record({
    kind: fc.constant('grant' as const),
    share: fc.double({ min: 1e-6, max: 1, noNaN: true })
  }),
  fc.record({
    kind: fc.constant('loan' as const),
    costShare: fc.double({ min: 0.01, max: 1, noNaN: true }),
    rate: fc.double({ min: 0, max: 0.25, noNaN: true }),
    requiredReturn: fc.constant(null)
  }),
  fc.record({
    kind: fc.constant('guarantee' as const),
    costShare: fc.double({ min: 0.01, max: 1, noNaN: true }),
    reserve: fc.double({ min: 0, max: 1, noNaN: true })
  })
);

/** A random context of 1-4 programmes and an affordable schedule paid by a subset of them. */
const randomCase: fc.Arbitrary<{ sc: Schedule; ctx: TierCtx }> = fc
  .array(fc.record({ instrument: instrumentArb, poolKind: poolKindArb, tiers: tiersArb }), {
    minLength: 1,
    maxLength: 4
  })
  .chain((progs) =>
    fc
      .record({
        units: unitsArb,
        paying: fc.subarray(
          progs.map((_, i) => `r${i}`),
          { minLength: 0 }
        )
      })
      .map(({ units, paying }) => ({
        sc: affordable(paying, units),
        ctx: {
          affordable: new Map(),
          programmes: new Map(
            progs.map((p, i) => [
              `r${i}`,
              { item: { instrument: p.instrument, poolKind: p.poolKind }, tiers: p.tiers }
            ])
          ),
          terms: TEST_TERMS,
          weights: new Map()
        }
      }))
  );

const handCase: fc.Arbitrary<{ sc: Schedule; ctx: TierCtx }> = fc.oneof(
  fc
    .record({ units: unitsArb, ids: fc.subarray([...CASE_PROGRAMMES]) })
    .map(({ units, ids }) => ({ sc: affordable(ids, units), ctx: caseCtx() })),
  fc
    .array(unitsArb, { minLength: 1, maxLength: 3 })
    .map((units) => ({ sc: schedule({ units }), ctx: caseCtx() })),
  fc
    .record({
      units: fc.array(unitsArb, { minLength: 1, maxLength: 3 }),
      recorded: fc.integer({ min: 0, max: 3000 })
    })
    .map(({ units, recorded }) => ({
      sc: pipeline('PRJ:p', units),
      ctx: caseCtx([['PRJ:p', recorded]])
    }))
);

describe('tiersOf sums to the final units (spec 6 test 9)', () => {
  it('holds over random schedules, programme sets, weights and tiers', () => {
    fc.assert(
      fc.property(fc.oneof(handCase, randomCase), ({ sc, ctx }) => {
        const r = tiersOf(sc, ctx);
        const u = sc.revisions[sc.revisions.length - 1].units;
        expect(TIER_FIELDS.every((f) => Number.isInteger(r[f]) && r[f] >= 0)).toBe(true);
        expect(TIER_FIELDS.reduce((s, f) => s + r[f], 0)).toBe(u);
      }),
      { seed: 9, numRuns: 500 }
    );
  });
});

describe('tierSeries sums to completedNet (spec 6 test 11)', () => {
  it('holds on the golden inputs, seeds 1-5', () => {
    for (const input of [goldenInput(), financeGoldenInput()]) {
      const months = monthsOf(input.asOf, GOLDEN_HORIZON);
      const ctx = tierContext(input);
      for (const seed of [1, 2, 3, 4, 5]) {
        const run = simulateDetailed(input, seed, GOLDEN_HORIZON);
        const tiers = tierSeries(run.schedules, ctx, input.asOf, GOLDEN_HORIZON, months);
        const shown = shownSeries(run, input.asOf, GOLDEN_HORIZON, months);
        const ok = tiers.every(
          (t, i) => TIER_FIELDS.reduce((a, f) => a + t[f], 0) === shown[i].completedNet
        );
        expect(ok).toBe(true);
      }
    }
  });

  const months = monthsOf(MINI_AS_OF, MINI_HORIZON);
  const dayArb = fc.integer({ min: MINI_AS_OF - 200, max: MINI_HORIZON - 1 });
  const schedArb: fc.Arbitrary<Schedule> = fc
    .record({
      origin: fc.constantFrom('simulated' as const, 'pipeline' as const),
      existing: fc.integer({ min: 0, max: 30 }),
      construction: fc.option(dayArb, { nil: undefined }),
      completion: fc.integer({ min: MINI_AS_OF, max: MINI_HORIZON }),
      endKind: fc.constantFrom('complete', 'exit', 'open'),
      units: fc.array(unitsArb, { minLength: 1, maxLength: 3 })
    })
    .map((r) =>
      schedule({
        projectId: `sim:prop:${r.existing}`,
        origin: r.origin,
        units: r.units,
        existingUnits: r.existing,
        entered: r.construction === undefined ? {} : { construction: r.construction },
        end:
          r.endKind === 'complete'
            ? { kind: 'complete', day: r.completion }
            : r.endKind === 'exit'
              ? { kind: 'exit', stage: 'construction', reason: 'withdrawn', day: r.completion }
              : { kind: 'open' }
      })
    );

  it('holds on random sets of hand-built schedules', () => {
    fc.assert(
      fc.property(fc.array(schedArb, { minLength: 0, maxLength: 8 }), (scs) => {
        const ctx = caseCtx();
        const tiers = tierSeries(scs, ctx, MINI_AS_OF, MINI_HORIZON, months);
        const shown = shownSeries(
          { schedules: scs, masters: [] },
          MINI_AS_OF,
          MINI_HORIZON,
          months
        );
        const ok = tiers.every(
          (t, i) => TIER_FIELDS.reduce((a, f) => a + t[f], 0) === shown[i].completedNet
        );
        expect(ok).toBe(true);
      }),
      { seed: 11, numRuns: 200 }
    );
  });
});
