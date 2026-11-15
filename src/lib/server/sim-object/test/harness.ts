import type BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { freshBundleSqlite } from '@planafoot/drizzle-cf-migrations/testing';
import { GENESIS_HASH, chainHash, type CommitDraft } from '$lib/sim-log';
import { utf8Bytes } from '../limits';
import { simMigrations } from '../migrations.generated';
import * as schema from '../schema';
import { SimStore, type SimDb } from '../store';
import { nameDraft } from './drafts';

/** An in-memory object database with the very migration bundle the object applies. */
export function freshSimDb(): { db: SimDb; sqlite: BetterSqlite3.Database } {
  const sqlite = freshBundleSqlite(simMigrations);
  const db = drizzle({ client: sqlite, schema }) as unknown as SimDb;
  return { db, sqlite };
}

/**
 * A store holding one stamped, chained row made from nameDraft(0, ...) with `over`: for example
 * `{ shapes: 2 }` (a row a newer build wrote) or a change that does not apply. Rows a host may be
 * unable to fold.
 */
export async function storeWithRow(over: Partial<CommitDraft>, at = 1): Promise<SimStore> {
  const store = new SimStore(freshSimDb().db);
  const stamped = { ...nameDraft(0, 'Later', over), seq: 1, actor: 'u1', at };
  const hash = await chainHash(GENESIS_HASH, stamped);
  const body = JSON.stringify({ ...stamped, hash });
  store.insert({ seq: 1, id: stamped.id, hash, bytes: utf8Bytes(body), body });
  return store;
}
