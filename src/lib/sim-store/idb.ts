/**
 * The store's database on IndexedDB. Every method is one transaction and settles only on that
 * transaction's `complete` (resolve), `abort` or `error` (reject): a request's `success` is not the
 * end, since a quota error aborts a transaction after its requests succeeded. Logs nothing: a
 * failure is returned or rejected, and the store decides what to say.
 */
import type { Commit } from '$lib/sim-log';
import {
  CURRENT_KEY,
  isReservedKey,
  nKey,
  type CreateResult,
  type Marker,
  type PendingRecord,
  type SimDb,
  type SimRead,
  type SimRecord,
  type WriteBatch,
  type WriteResult
} from './sim-db';

export const SIM_DB_NAME = 'sfhousing-sim-log';
export const SIM_DB_VERSION = 1;

const SIMS = 'sims';
const COMMITS = 'commits';
const PENDING = 'pending';
const META = 'meta';
const ORDER = 'order';

interface CommitRow {
  simId: string;
  seq: number;
  commit: Commit;
}
interface MetaRow {
  key: string;
  value: unknown;
}

/** Creates or upgrades the stores. Step 1 (oldVersion < 1) is never edited. */
export function upgradeSimDb(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore(SIMS, { keyPath: 'simId' });
    db.createObjectStore(COMMITS, { keyPath: ['simId', 'seq'] });
    const pending = db.createObjectStore(PENDING, { keyPath: ['simId', 'id'] });
    pending.createIndex(ORDER, ['simId', 'n'], { unique: true });
    db.createObjectStore(META, { keyPath: 'key' });
  }
}

const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('request failed'));
  });

const simRange = (simId: string): IDBKeyRange =>
  IDBKeyRange.bound([simId, -Infinity], [simId, Infinity]);

const markerMatches = (stored: unknown, m: Marker): boolean =>
  JSON.stringify(stored) === JSON.stringify(m.expect);

/**
 * The database, or null when IndexedDB is missing, the open fails or is blocked. A newer
 * version opened elsewhere closes this connection and calls onVersionChange. `abortWrites` (tests)
 * aborts a write transaction after its requests are issued when it returns true.
 */
export function openSimDb(
  opts: {
    name?: string;
    onVersionChange?: () => void;
    abortWrites?: () => boolean;
  } = {}
): Promise<SimDb | null> {
  return new Promise((resolve) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      // reading the factory can throw (blocked storage): the same answer as a missing one
      if (typeof indexedDB === 'undefined') return resolve(null);
      request = indexedDB.open(opts.name ?? SIM_DB_NAME, SIM_DB_VERSION);
    } catch {
      return resolve(null);
    }
    const finish = (db: SimDb | null): void => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    request.onupgradeneeded = (e) => upgradeSimDb(request.result, e.oldVersion);
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
    request.onsuccess = () => {
      const idb = request.result;
      // opened after a blocked report already answered null
      if (settled) return idb.close();
      finish(wrap(idb, opts));
    };
  });
}

function wrap(
  idb: IDBDatabase,
  opts: { onVersionChange?: () => void; abortWrites?: () => boolean }
): SimDb {
  let closed = false;
  idb.onversionchange = () => {
    closed = true;
    idb.close();
    opts.onVersionChange?.();
  };
  idb.onclose = () => {
    closed = true;
  };

  /**
   * Runs `body` in one transaction. Inside `body` await only requests (through `req`): any other
   * await lets the transaction commit early. Settles on complete, abort or error.
   */
  function run<T>(
    stores: string[],
    mode: IDBTransactionMode,
    body: (tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (closed) return reject(new Error('closed'));
      let tx: IDBTransaction;
      let seamAbort = false;
      let bodyError: unknown;
      let value: T;
      const abort = (): void => {
        try {
          tx.abort();
        } catch {
          // already finished
        }
      };
      try {
        tx =
          mode === 'readwrite'
            ? idb.transaction(stores, mode, { durability: 'strict' })
            : idb.transaction(stores, mode);
      } catch (e) {
        return reject(e);
      }
      const abortAsked = mode === 'readwrite' && opts.abortWrites?.() === true;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () =>
        reject(
          seamAbort
            ? new Error('aborted')
            : (bodyError ?? tx.error ?? new Error('transaction aborted'))
        );
      tx.onerror = () => {
        // the abort event follows and rejects; this one only keeps an error from bubbling
      };
      body(tx).then(
        (v) => {
          value = v;
          if (abortAsked) {
            seamAbort = true;
            abort();
          }
        },
        (e: unknown) => {
          bodyError = e;
          abort();
        }
      );
    });
  }

  async function putBatch(
    tx: IDBTransaction,
    simId: string,
    batch: WriteBatch
  ): Promise<WriteResult> {
    const commits = tx.objectStore(COMMITS);
    const pending = tx.objectStore(PENDING);
    const meta = tx.objectStore(META);
    const result: WriteResult = { applied: true, n: {}, lost: [] };
    for (const commit of batch.confirmed) {
      const row: CommitRow = { simId, seq: commit.seq, commit };
      await req(commits.put(row));
    }
    const counter = (await req(meta.get(nKey(simId)))) as MetaRow | undefined;
    let last = (counter?.value as number | undefined) ?? 0;
    let spent = false;
    for (const p of batch.put) {
      const held = (await req(pending.get([simId, p.id]))) as PendingRecord | undefined;
      if (held && held.owner !== batch.owner) {
        result.lost.push(p.id);
        continue;
      }
      // a put with n, or a move, never creates a record
      if ((p.n !== undefined || p.move) && !held) {
        result.lost.push(p.id);
        continue;
      }
      let n: number;
      // a put with n updates in place: the stored n stays, the given one is ignored
      if (p.n !== undefined && !p.move && held) n = held.n;
      else {
        n = ++last;
        spent = true;
      }
      const record: PendingRecord = {
        simId,
        id: p.id,
        n,
        owner: batch.owner,
        pending: p.pending
      };
      await req(pending.put(record));
      result.n[p.id] = n;
    }
    if (spent) await req(meta.put({ key: nKey(simId), value: last } satisfies MetaRow));
    for (const id of batch.remove) {
      const held = (await req(pending.get([simId, id]))) as PendingRecord | undefined;
      if (held?.owner === batch.owner) await req(pending.delete([simId, id]));
    }
    return result;
  }

  const metaValue = async (tx: IDBTransaction, key: string): Promise<unknown> =>
    ((await req(tx.objectStore(META).get(key))) as MetaRow | undefined)?.value;

  return {
    read(simId: string): Promise<SimRead> {
      return run([SIMS, COMMITS, PENDING], 'readonly', async (tx) => {
        const sim = (await req(tx.objectStore(SIMS).get(simId))) as SimRecord | undefined;
        const commits = (await req(tx.objectStore(COMMITS).getAll(simRange(simId)))) as CommitRow[];
        const pending = (await req(
          tx.objectStore(PENDING).index(ORDER).getAll(simRange(simId))
        )) as PendingRecord[];
        return { sim: sim ?? null, confirmed: commits.map((r) => r.commit), pending };
      });
    },

    createSim(
      sim: SimRecord,
      o: { current?: boolean; marker?: Marker; batch?: WriteBatch } = {}
    ): Promise<CreateResult> {
      return run([SIMS, COMMITS, PENDING, META], 'readwrite', async (tx) => {
        if (o.marker && isReservedKey(o.marker.key)) throw new Error('reserved key');
        const meta = tx.objectStore(META);
        const current = ((await metaValue(tx, CURRENT_KEY)) as string | undefined) ?? null;
        const none = { n: {}, lost: [] };
        if (o.marker && !markerMatches(await metaValue(tx, o.marker.key), o.marker)) {
          return { ...none, applied: false, outcome: 'marker' as const, current };
        }
        if (o.current && current !== null) {
          return { ...none, applied: false, outcome: 'current-taken' as const, current };
        }
        const store = tx.objectStore(SIMS);
        // a sim that exists keeps its record
        if (!(await req(store.get(sim.simId)))) await req(store.put(sim));
        if (o.current)
          await req(meta.put({ key: CURRENT_KEY, value: sim.simId } satisfies MetaRow));
        if (o.marker) await req(meta.put({ key: o.marker.key, value: o.marker.value }));
        const r = o.batch ? await putBatch(tx, sim.simId, o.batch) : { ...none, applied: true };
        return {
          ...r,
          outcome: 'created' as const,
          current: o.current ? sim.simId : current
        };
      });
    },

    write(simId: string, batch: WriteBatch, o: { marker?: Marker } = {}): Promise<WriteResult> {
      return run([COMMITS, PENDING, META], 'readwrite', async (tx) => {
        if (o.marker && isReservedKey(o.marker.key)) throw new Error('reserved key');
        if (o.marker) {
          if (!markerMatches(await metaValue(tx, o.marker.key), o.marker)) {
            return { applied: false, n: {}, lost: [] };
          }
          await req(tx.objectStore(META).put({ key: o.marker.key, value: o.marker.value }));
        }
        return putBatch(tx, simId, batch);
      });
    },

    pendingOwners(simId: string): Promise<string[]> {
      return run([PENDING], 'readonly', async (tx) => {
        const all = (await req(
          tx.objectStore(PENDING).index(ORDER).getAll(simRange(simId))
        )) as PendingRecord[];
        return [...new Set(all.map((r) => r.owner))];
      });
    },

    claimPending(simId: string, from: readonly string[], to: string): Promise<PendingRecord[]> {
      return run([PENDING], 'readwrite', async (tx) => {
        const store = tx.objectStore(PENDING);
        const all = (await req(store.index(ORDER).getAll(simRange(simId)))) as PendingRecord[];
        const claimed: PendingRecord[] = [];
        for (const r of all) {
          if (!from.includes(r.owner)) continue;
          const next: PendingRecord = { ...r, owner: to };
          await req(store.put(next));
          claimed.push(next);
        }
        return claimed;
      });
    },

    setRegistered(simId: string): Promise<void> {
      return run([SIMS], 'readwrite', async (tx) => {
        const store = tx.objectStore(SIMS);
        const sim = (await req(store.get(simId))) as SimRecord | undefined;
        if (sim) await req(store.put({ ...sim, registered: true }));
      });
    },

    getMeta(key: string): Promise<unknown> {
      return run([META], 'readonly', (tx) => metaValue(tx, key));
    },

    setMeta(key: string, value: unknown): Promise<void> {
      return run([META], 'readwrite', async (tx) => {
        if (isReservedKey(key)) throw new Error('reserved key');
        await req(tx.objectStore(META).put({ key, value } satisfies MetaRow));
      });
    },

    close(): void {
      closed = true;
      idb.close();
    }
  };
}
