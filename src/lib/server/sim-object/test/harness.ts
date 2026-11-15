import type BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { freshBundleSqlite } from '@planafoot/drizzle-cf-migrations/testing';
import { simMigrations } from '../migrations.generated';
import * as schema from '../schema';
import type { SimDb } from '../store';

/** An in-memory object database with the very migration bundle the object applies. */
export function freshSimDb(): { db: SimDb; sqlite: BetterSqlite3.Database } {
  const sqlite = freshBundleSqlite(simMigrations);
  const db = drizzle({ client: sqlite, schema }) as unknown as SimDb;
  return { db, sqlite };
}
