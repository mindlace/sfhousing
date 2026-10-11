import type { ParcelId } from '../data/parcel';
import {
  assertNever,
  boxesIntersect,
  compareIds,
  opPath,
  opXYBox,
  pathCovers,
  pointInBox,
  project,
  type XY,
  type XYBox
} from './geometry';
import type { ParcelIndex } from './parcel-index';
import type { Envelope, Plan, PlanOp } from './types';

export type EnvelopeMap = Map<ParcelId, Envelope>;
export interface EnvelopeChange {
  id: ParcelId;
  before: Envelope | null;
  after: Envelope | null;
}
export interface OpCoverage {
  eligible: ParcelId[];
  ineligible: ParcelId[];
}

function envelope(maxStories: number): Envelope {
  return Object.freeze({ maxStories });
}

function sortedMap<V>(m: Map<ParcelId, V>): Map<ParcelId, V> {
  return new Map([...m].sort((a, b) => compareIds(a[0], b[0])));
}

/** The value an op writes to a covered eligible parcel (null = delete). Exhaustive (spec §5). */
function written(op: PlanOp): Envelope | null {
  switch (op.kind) {
    case 'paint':
      return envelope(op.stories);
    case 'erase':
      return null;
    default:
      return assertNever(op);
  }
}

export function applyOp(
  state: EnvelopeMap,
  op: PlanOp,
  index: ParcelIndex
): { changes: EnvelopeChange[]; coverage: OpCoverage } {
  const eligible: ParcelId[] = [];
  const ineligible: ParcelId[] = [];
  const changes: EnvelopeChange[] = [];
  const value = written(op);
  for (const id of index.covered(op)) {
    if (!index.get(id)!.eligible) {
      ineligible.push(id);
      continue;
    }
    eligible.push(id);
    const before = state.get(id) ?? null;
    if ((before?.maxStories ?? null) === (value?.maxStories ?? null)) continue;
    if (value) state.set(id, envelope(value.maxStories));
    else state.delete(id);
    changes.push({ id, before, after: value ? state.get(id)! : null });
  }
  return { changes, coverage: { eligible, ineligible } };
}

export function resolveEnvelopes(plan: Plan, index: ParcelIndex): EnvelopeMap {
  const state: EnvelopeMap = new Map();
  for (const op of plan.ops) {
    const value = written(op);
    for (const id of index.covered(op)) {
      if (!index.get(id)!.eligible) continue;
      if (value) state.set(id, envelope(value.maxStories));
      else state.delete(id);
    }
  }
  return sortedMap(state);
}

interface PreparedOp {
  op: PlanOp;
  box: XYBox;
  path: XY[];
  r2: number;
}

export function resolveParcels(
  ops: readonly PlanOp[],
  index: ParcelIndex,
  ids: Iterable<ParcelId>
): Map<ParcelId, Envelope | null> {
  const prepared: PreparedOp[] = ops.map((op) => ({
    op,
    box: opXYBox(op),
    path: opPath(op),
    r2: op.radiusM * op.radiusM
  }));
  const out = new Map<ParcelId, Envelope | null>();
  for (const id of [...new Set(ids)].sort(compareIds)) {
    const rec = index.get(id);
    if (!rec || !rec.eligible) {
      out.set(id, null);
      continue;
    }
    const l = project(rec.labelPoint[0], rec.labelPoint[1]);
    let value: Envelope | null = null;
    for (let i = prepared.length - 1; i >= 0; i--) {
      const p = prepared[i];
      if (!pointInBox(l, p.box) || !pathCovers(p.path, p.r2, l)) continue;
      value = written(p.op);
      break;
    }
    out.set(id, value);
  }
  return out;
}

export function resolveChunk(
  plan: Plan,
  index: ParcelIndex,
  addedIds: ParcelId[]
): Map<ParcelId, Envelope | null> {
  const box: XYBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const id of addedIds) {
    const rec = index.get(id);
    if (!rec) continue;
    const [x, y] = project(rec.labelPoint[0], rec.labelPoint[1]);
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  }
  const ops = box[0] <= box[2] ? plan.ops.filter((op) => boxesIntersect(opXYBox(op), box)) : [];
  return resolveParcels(ops, index, addedIds);
}
