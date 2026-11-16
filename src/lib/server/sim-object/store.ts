import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { GENESIS_HASH } from '$lib/sim-log';
import { commits, simState } from './schema';
import type * as schema from './schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SimDb = BaseSQLiteDatabase<'sync', any, typeof schema>;

export interface StoredRow {
  seq: number;
  id: string;
  hash: string;
  bytes: number;
  body: string;
}

export interface Totals {
  seq: number;
  hash: string;
  bytes: number;
}

/**
 * The object's rows. Every method is synchronous (no await): in the object, a run of storage
 * calls with no await between them commits atomically.
 */
export class SimStore {
  constructor(private readonly db: SimDb) {
    db.insert(simState).values({ id: 1 }).onConflictDoNothing().run();
  }

  /** The tip: seq 0, GENESIS_HASH and 0 bytes for an empty log. */
  totals(): Totals {
    const tip = this.db
      .select({ seq: commits.seq, hash: commits.hash })
      .from(commits)
      .orderBy(desc(commits.seq))
      .limit(1)
      .get();
    const sum = this.db
      .select({ bytes: sql<number>`coalesce(sum(${commits.bytes}), 0)` })
      .from(commits)
      .get();
    return {
      seq: tip?.seq ?? 0,
      hash: tip?.hash ?? GENESIS_HASH,
      bytes: Number(sum?.bytes ?? 0)
    };
  }

  /** The last position, 0 for an empty log. */
  tipSeq(): number {
    return (
      this.db.select({ seq: commits.seq }).from(commits).orderBy(desc(commits.seq)).limit(1).get()
        ?.seq ?? 0
    );
  }

  hasId(id: string): boolean {
    return (
      this.db.select({ seq: commits.seq }).from(commits).where(eq(commits.id, id)).get() != null
    );
  }

  /** Throws RangeError unless row.seq is the tip's seq + 1 (I1). */
  insert(row: StoredRow): void {
    const tip = this.tipSeq();
    if (row.seq !== tip + 1) {
      throw new RangeError(`commit position ${row.seq} is not ${tip + 1}`);
    }
    this.db.insert(commits).values(row).run();
  }

  /** Up to `limit` rows with seq above `seq`, ascending. */
  rowsAfter(seq: number, limit: number): StoredRow[] {
    return this.db
      .select()
      .from(commits)
      .where(gt(commits.seq, seq))
      .orderBy(asc(commits.seq))
      .limit(limit)
      .all();
  }

  /** Up to `limit` positions above `seq` with their stored sizes (`bytes`, the UTF-8 size of the
   *  body), ascending; no body is read. */
  sizesAfter(seq: number, limit: number): { seq: number; bytes: number }[] {
    return this.db
      .select({ seq: commits.seq, bytes: commits.bytes })
      .from(commits)
      .where(gt(commits.seq, seq))
      .orderBy(asc(commits.seq))
      .limit(limit)
      .all();
  }

  /** The rows with seq above `after` and at most `last`, ascending. */
  rowsThrough(after: number, last: number): StoredRow[] {
    return this.db
      .select()
      .from(commits)
      .where(and(gt(commits.seq, after), lte(commits.seq, last)))
      .orderBy(asc(commits.seq))
      .all();
  }

  goneAt(): number | null {
    return (
      this.db.select({ goneAt: simState.goneAt }).from(simState).where(eq(simState.id, 1)).get()
        ?.goneAt ?? null
    );
  }

  indexedSeq(): number {
    return (
      this.db
        .select({ indexedSeq: simState.indexedSeq })
        .from(simState)
        .where(eq(simState.id, 1))
        .get()?.indexedSeq ?? 0
    );
  }

  setIndexedSeq(seq: number): void {
    this.db.update(simState).set({ indexedSeq: seq }).where(eq(simState.id, 1)).run();
  }

  /** Deletes every commit, sets gone_at to `now` and indexed_seq to 0 (takedown, R43). */
  clear(now: number): void {
    this.db.delete(commits).run();
    this.db.update(simState).set({ goneAt: now, indexedSeq: 0 }).where(eq(simState.id, 1)).run();
  }
}
