import { defineRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

// drizzle 1.0 rc replaced the `schema` option with `relations`; plan-sharing extends
// this with real relations once tables exist.
const relations = defineRelations(schema);

export function getDb(platform: App.Platform | undefined) {
  const db = platform?.env?.DB;
  if (!db) throw new Error('D1 binding DB unavailable');
  return drizzle(db, { relations });
}
