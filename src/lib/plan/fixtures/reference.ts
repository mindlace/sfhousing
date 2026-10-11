import type { ParcelId, ParcelRecord } from '../../data/parcel';
import { compareIds, pathCovers, project, projectPath } from '../geometry';
import type { Plan, PlanOp } from '../types';

/** O(n·m) reference: tests every record against the op, no index. */
export function bruteForceCovered(op: PlanOp, records: readonly ParcelRecord[]): ParcelId[] {
  const path = projectPath(op.path);
  const r2 = op.radiusM * op.radiusM;
  return records
    .filter((r) => pathCovers(path, r2, project(r.labelPoint[0], r.labelPoint[1])))
    .map((r) => r.id)
    .sort(compareIds);
}

/** Reference resolve: the I5 semantics written as plainly as possible. */
export function bruteForceResolve(
  plan: Plan,
  records: readonly ParcelRecord[]
): [ParcelId, number][] {
  const state = new Map<ParcelId, number>();
  for (const op of plan.ops) {
    const eligible = new Set(records.filter((r) => r.eligible).map((r) => r.id));
    for (const id of bruteForceCovered(op, records)) {
      if (!eligible.has(id)) continue;
      if (op.kind === 'paint') state.set(id, op.stories);
      else state.delete(id);
    }
  }
  return [...state].sort((a, b) => compareIds(a[0], b[0]));
}
