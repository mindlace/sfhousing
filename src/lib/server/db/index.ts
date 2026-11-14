import { drizzle } from 'drizzle-orm/d1';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Database = DrizzleD1Database<typeof schema>;

export function getDb(platform: App.Platform | undefined): Database {
  const db = platform?.env?.DB;
  if (!db) throw new Error('D1 binding DB unavailable');
  return drizzle(db, { schema });
}
