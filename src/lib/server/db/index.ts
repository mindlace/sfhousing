import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function getDb(platform: App.Platform | undefined) {
  const db = platform?.env?.DB;
  if (!db) throw new Error('D1 binding DB unavailable');
  return drizzle(db, { schema });
}
