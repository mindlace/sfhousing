import KDBush from 'kdbush';
import type { ParcelId, ParcelRecord } from '../data/parcel';
import {
  CANDIDATE_PAD_M,
  boxesIntersect,
  compareIds,
  opPath,
  project,
  segDist2,
  segmentBoxes,
  type XY,
  type XYBox
} from './geometry';
import type { PlanOp } from './types';

export interface ParcelIndex {
  /** Returns the ids it added. A cellId already loaded is a no-op returning []. */
  addChunk(cellId: string, records: ParcelRecord[]): ParcelId[];
  hasChunk(cellId: string): boolean;
  get(id: ParcelId): ParcelRecord | undefined;
  /** Every loaded parcel covered by op, eligible or not, in ascending id order. */
  covered(op: PlanOp): ParcelId[];
  readonly size: number;
}

interface Chunk {
  ids: ParcelId[];
  xs: Float64Array;
  ys: Float64Array;
  tree: KDBush | null;
  box: XYBox | null;
}

function isDev(): boolean {
  return import.meta.env?.DEV === true;
}

export function createParcelIndex(): ParcelIndex {
  const chunks = new Map<string, Chunk>();
  const byId = new Map<ParcelId, ParcelRecord>();

  function addChunk(cellId: string, records: ParcelRecord[]): ParcelId[] {
    if (chunks.has(cellId)) return [];
    const accepted: ParcelRecord[] = [];
    for (const r of records) {
      const prev = byId.get(r.id);
      if (prev) {
        // I12: every parcel is in exactly one chunk. Keep the first; flag real conflicts in dev.
        if (isDev() && JSON.stringify(prev) !== JSON.stringify(r)) {
          throw new Error(`Parcel ${r.id} appears in two chunks with different records`);
        }
        continue;
      }
      byId.set(r.id, r);
      accepted.push(r);
    }
    const n = accepted.length;
    const ids = accepted.map((r) => r.id);
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    let tree: KDBush | null = null;
    let box: XYBox | null = null;
    if (n > 0) {
      tree = new KDBush(n);
      box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let k = 0; k < n; k++) {
        const [x, y] = project(accepted[k].labelPoint[0], accepted[k].labelPoint[1]);
        xs[k] = x;
        ys[k] = y;
        tree.add(x, y);
        if (x < box[0]) box[0] = x;
        if (y < box[1]) box[1] = y;
        if (x > box[2]) box[2] = x;
        if (y > box[3]) box[3] = y;
      }
      tree.finish();
    }
    chunks.set(cellId, { ids, xs, ys, tree, box });
    return ids;
  }

  function covered(op: PlanOp): ParcelId[] {
    const path = opPath(op);
    const r2 = op.radiusM * op.radiusM;
    const boxes = segmentBoxes(path, op.radiusM + CANDIDATE_PAD_M);
    const out = new Set<ParcelId>();
    for (let s = 0; s < boxes.length; s++) {
      const a = path[s];
      const b = path.length === 1 ? path[0] : path[s + 1];
      const q = boxes[s];
      for (const chunk of chunks.values()) {
        if (!chunk.tree || !chunk.box || !boxesIntersect(chunk.box, q)) continue;
        for (const k of chunk.tree.range(q[0], q[1], q[2], q[3])) {
          const id = chunk.ids[k];
          if (out.has(id)) continue;
          const l: XY = [chunk.xs[k], chunk.ys[k]];
          if (segDist2(l, a, b) <= r2) out.add(id);
        }
      }
    }
    return [...out].sort(compareIds);
  }

  return {
    addChunk,
    hasChunk: (cellId) => chunks.has(cellId),
    get: (id) => byId.get(id),
    covered,
    get size() {
      return byId.size;
    }
  };
}
