import type { Commit } from '$lib/sim-log';
import type { Pending } from './types';

export interface SimRecord {
  simId: string;
  createdAt: number;
  /** Set by plan 2 once POST /api/sims answered 200 or 201. */
  registered: boolean;
}
/**
 * A stored pending record. It is a record of work, not a claim that the commit is in force: the
 * store writes held commits too.
 */
export interface PendingRecord {
  simId: string;
  id: string; // draft id
  n: number; // order, unique per sim across tabs
  owner: string; // the tab id that sends it
  pending: Pending;
}
export interface SimRead {
  sim: SimRecord | null;
  confirmed: Commit[]; // seq order
  pending: PendingRecord[]; // n order, every owner
}
export interface PendingPut {
  id: string;
  pending: Pending;
  /**
   * Given: the record must exist with the batch's owner (else lost). Absent: a new record, or one
   * of this owner's moved to the end; a record of another owner is lost.
   */
  n?: number;
}
export interface WriteBatch {
  owner: string; // this tab
  confirmed: readonly Commit[]; // put by [simId, seq]: idempotent
  put: readonly PendingPut[]; // in order; new n follow that order
  remove: readonly string[]; // pending ids; only the owner's are deleted
}
/** A compare-and-set on meta[key]: written only when the stored value equals `expect`. */
export interface Marker {
  key: string;
  value: unknown; // JSON-able
  expect: unknown; // undefined: the row must be absent; compared by JSON.stringify
}
export interface WriteResult {
  applied: boolean; // false: the marker did not match; nothing written
  n: Record<string, number>; // the n of each put written
  lost: string[]; // puts refused because another owner holds the record
}
export interface CreateResult extends WriteResult {
  /** 'current-taken': current was asked for and another sim holds it; nothing written. */
  outcome: 'created' | 'current-taken' | 'marker';
  current: string | null; // meta.current after the call
}
/**
 * Every write is one atomic transaction: it applies wholly or not at all, and its promise settles
 * only when the whole batch is durable (resolved) or refused (rejected, nothing written).
 */
export interface SimDb {
  read(simId: string): Promise<SimRead>;
  /**
   * One transaction, checked in this order: the marker (outcome 'marker'), then when `current`
   * is asked and meta.current is set, 'current-taken'; else puts the sim, sets meta.current when
   * asked, the marker's value, and the batch. `applied` is true only for 'created'.
   */
  createSim(
    sim: SimRecord,
    opts?: { current?: boolean; marker?: Marker; batch?: WriteBatch }
  ): Promise<CreateResult>;
  /**
   * One transaction: the marker first, then the batch: confirmed, then the puts in order, then
   * the removes (an id both put and removed ends removed).
   */
  write(simId: string, batch: WriteBatch, opts?: { marker?: Marker }): Promise<WriteResult>;
  /** One transaction: every pending record of simId whose owner is in `from` gets owner `to`. */
  claimPending(simId: string, from: readonly string[], to: string): Promise<PendingRecord[]>;
  setRegistered(simId: string): Promise<void>;
  getMeta(key: string): Promise<unknown>; // undefined when absent
  setMeta(key: string, value: unknown): Promise<void>;
  close(): void;
}

export const CURRENT_KEY = 'current';
export const nKey = (simId: string): string => `n:${simId}`;

interface SimData {
  sim: SimRecord | null;
  confirmed: Map<number, Commit>;
  pending: Map<string, PendingRecord>;
}
interface State {
  sims: Map<string, SimData>;
  meta: Map<string, unknown>;
}

const markerMatches = (meta: Map<string, unknown>, m: Marker): boolean =>
  JSON.stringify(meta.get(m.key)) === JSON.stringify(m.expect);

function dataOf(state: State, simId: string): SimData {
  let d = state.sims.get(simId);
  if (!d) {
    d = { sim: null, confirmed: new Map(), pending: new Map() };
    state.sims.set(simId, d);
  }
  return d;
}

function applyBatch(state: State, simId: string, batch: WriteBatch): WriteResult {
  const d = dataOf(state, simId);
  const result: WriteResult = { applied: true, n: {}, lost: [] };
  for (const c of batch.confirmed) d.confirmed.set(c.seq, structuredClone(c));
  let last = (state.meta.get(nKey(simId)) as number | undefined) ?? 0;
  for (const p of batch.put) {
    const held = d.pending.get(p.id);
    if (held && held.owner !== batch.owner) {
      result.lost.push(p.id);
      continue;
    }
    if (p.n !== undefined && !held) {
      result.lost.push(p.id);
      continue;
    }
    const n = p.n !== undefined ? p.n : ++last;
    d.pending.set(p.id, {
      simId,
      id: p.id,
      n,
      owner: batch.owner,
      pending: structuredClone(p.pending)
    });
    result.n[p.id] = n;
  }
  if (Object.keys(result.n).length > 0) state.meta.set(nKey(simId), last);
  for (const id of batch.remove) {
    if (d.pending.get(id)?.owner === batch.owner) d.pending.delete(id);
  }
  return result;
}

/** Same semantics in memory. `abortWrites`: a write whose call returns true rejects, unwritten. */
export function memorySimDb(opts: { abortWrites?: () => boolean } = {}): SimDb {
  let state: State = { sims: new Map(), meta: new Map() };

  /** Runs `fn` on a copy of the state, swapped in only when the transaction does not abort. */
  async function transact<T>(fn: (draft: State) => T): Promise<T> {
    if (opts.abortWrites?.()) throw new Error('aborted');
    const draft = structuredClone(state);
    const out = fn(draft);
    state = draft;
    return structuredClone(out);
  }

  const sorted = (d: SimData): PendingRecord[] => [...d.pending.values()].sort((a, b) => a.n - b.n);

  return {
    async read(simId) {
      const d = state.sims.get(simId);
      if (!d) return { sim: null, confirmed: [], pending: [] };
      return structuredClone({
        sim: d.sim,
        confirmed: [...d.confirmed.values()].sort((a, b) => a.seq - b.seq),
        pending: sorted(d)
      });
    },
    createSim(sim, o = {}) {
      return transact((s) => {
        const current = (s.meta.get(CURRENT_KEY) as string | undefined) ?? null;
        const none = { n: {}, lost: [] };
        if (o.marker && !markerMatches(s.meta, o.marker)) {
          return { ...none, applied: false, outcome: 'marker' as const, current };
        }
        if (o.current && current !== null) {
          return { ...none, applied: false, outcome: 'current-taken' as const, current };
        }
        dataOf(s, sim.simId).sim = structuredClone(sim);
        if (o.current) s.meta.set(CURRENT_KEY, sim.simId);
        if (o.marker) s.meta.set(o.marker.key, structuredClone(o.marker.value));
        const r = o.batch ? applyBatch(s, sim.simId, o.batch) : { ...none, applied: true };
        return {
          ...r,
          outcome: 'created' as const,
          current: (s.meta.get(CURRENT_KEY) as string | undefined) ?? null
        };
      });
    },
    write(simId, batch, o = {}) {
      return transact((s) => {
        if (o.marker) {
          if (!markerMatches(s.meta, o.marker)) return { applied: false, n: {}, lost: [] };
          s.meta.set(o.marker.key, structuredClone(o.marker.value));
        }
        return applyBatch(s, simId, batch);
      });
    },
    claimPending(simId, from, to) {
      return transact((s) => {
        const claimed: PendingRecord[] = [];
        for (const r of sorted(dataOf(s, simId))) {
          if (!from.includes(r.owner)) continue;
          r.owner = to;
          claimed.push(r);
        }
        return claimed;
      });
    },
    setRegistered(simId) {
      return transact((s) => {
        const d = s.sims.get(simId);
        if (d?.sim) d.sim.registered = true;
      });
    },
    async getMeta(key) {
      return structuredClone(state.meta.get(key));
    },
    setMeta(key, value) {
      return transact((s) => {
        s.meta.set(key, structuredClone(value));
      });
    },
    close() {}
  };
}
