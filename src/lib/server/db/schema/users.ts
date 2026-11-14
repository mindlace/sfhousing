import { sqliteTable, text, integer, type AnySQLiteColumn } from '../columns';
import { principal } from './principal';

// Stable canonical identity. The id the whole app keys off. Never deleted —
// access rights and the lazy-migration survivor graph depend on the row surviving.
export const userIdentity = sqliteTable('user_identity', {
  id: text('id')
    .primaryKey()
    .references(() => principal.id), // supertype: every identity is a principal
  // Survivor pointer set when this identity is fused into another. null = live.
  // Writers keep a depth-1 star: every superseded row points DIRECTLY at the survivor.
  supersededById: text('superseded_by_id').references((): AnySQLiteColumn => userIdentity.id),
  // When supersededById was set (fuse timestamp) — itself an anti-abuse signal. null = live.
  supersededAt: integer('superseded_at', { mode: 'timestamp_ms' }),
  // Account-deletion tombstone + idempotency fuse. null = live; set = deleted.
  // The row itself is NEVER deleted (survivor graph + anti-abuse trail depend on it).
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});
