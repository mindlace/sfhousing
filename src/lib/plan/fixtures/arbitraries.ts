import fc from 'fast-check';
import type { PlanOp } from '../types';

// Micro-degree integers around the grid (±30 m margin), so k / 1e6 is already quantised.
const lng = fc.integer({ min: -122419700, max: -122416900 }).map((k) => k / 1e6);
const lat = fc.integer({ min: 37759600, max: 37761900 }).map((k) => k / 1e6);
const point = fc.tuple(lng, lat);
const path = fc.array(point, { minLength: 1, maxLength: 4 });
const radiusM = fc.integer({ min: 5, max: 60 });

export const arbGridOp: fc.Arbitrary<PlanOp> = fc.oneof(
  fc.record({
    kind: fc.constant('paint' as const),
    stories: fc.integer({ min: 1, max: 80 }),
    radiusM,
    path,
    id: fc.constant('x')
  }),
  fc.record({ kind: fc.constant('erase' as const), radiusM, path, id: fc.constant('x') })
);

export function arbGridOps(maxLength: number): fc.Arbitrary<PlanOp[]> {
  return fc
    .array(arbGridOp, { minLength: 0, maxLength })
    .map((ops) => ops.map((op, k) => ({ ...op, id: `o${k}` })));
}
