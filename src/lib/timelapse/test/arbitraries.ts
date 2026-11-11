/**
 * fast-check arbitraries for the timelapse model's property tests. Test-only.
 */
import fc from 'fast-check';
import { EXIT_ORDER, type ExitReason, type Provenance, type Transition } from '../types';

const PROVENANCE: Provenance = {
  tier: 4,
  label: 'arbitrary transition',
  sources: [{ label: 'property test', url: 'https://github.com/mindlace/sfhousing' }],
  method: 'fast-check arbitrary'
};

const unit = fc.double({ min: 0, max: 1, noNaN: true });
const hazard = fc.oneof(fc.constant(0), fc.double({ min: 1e-6, max: 0.3, noNaN: true }));

/**
 * A transition that `parseCalibration` accepts: K in 1..48; a random subset of `EXIT_ORDER` in the
 * table and another in the tail (so table-only and tail-only reasons occur); non-decreasing
 * columns with C(K) in [0.05, 1 - 1e-5]; tail hazards each 0 or in [1e-6, 0.3], at least one
 * positive, rho <= 1.
 */
export function arbTransition(): fc.Arbitrary<Transition> {
  return fc
    .record({
      months: fc.integer({ min: 1, max: 48 }),
      table: fc.subarray(EXIT_ORDER),
      tail: fc.subarray(EXIT_ORDER),
      total: fc.double({ min: 0.05, max: 1 - 1e-5, noNaN: true }),
      tailAdvance: hazard,
      tailExit: fc.array(hazard, { minLength: 4, maxLength: 4 })
    })
    .chain((s) =>
      fc
        .array(fc.array(unit, { minLength: s.months, maxLength: s.months }), {
          minLength: 1 + s.table.length,
          maxLength: 1 + s.table.length
        })
        .map((steps) => build(s, steps))
    )
    .filter((t) => {
      let rho = t.tail.advance;
      for (const r of EXIT_ORDER) rho += t.tail.exit[r] ?? 0;
      return rho <= 1;
    });
}

function build(
  s: {
    months: number;
    table: ExitReason[];
    tail: ExitReason[];
    total: number;
    tailAdvance: number;
    tailExit: number[];
  },
  steps: number[][]
): Transition {
  let sum = 0;
  for (const col of steps) for (const x of col) sum += x;
  if (!(sum > 0)) {
    steps[0] = steps[0].map(() => 1);
    sum = s.months;
  }
  const scale = s.total / sum;
  const cols = steps.map((col) => {
    let acc = 0;
    return col.map((x) => {
      acc += x * scale;
      return Math.min(acc, 1);
    });
  });
  const exit: Partial<Record<ExitReason, number[]>> = {};
  s.table.forEach((r, i) => (exit[r] = cols[i + 1]));
  const tailExit: Partial<Record<ExitReason, number>> = {};
  for (const r of EXIT_ORDER) {
    if (s.tail.includes(r)) tailExit[r] = s.tailExit[EXIT_ORDER.indexOf(r)];
  }
  let rho = s.tailAdvance;
  for (const r of EXIT_ORDER) rho += tailExit[r] ?? 0;
  const tailAdvance = rho > 0 ? s.tailAdvance : 0.05;
  return {
    months: s.months,
    advance: cols[0],
    exit,
    tail: { advance: tailAdvance, exit: tailExit },
    provenance: PROVENANCE,
    tailProvenance: PROVENANCE
  };
}
