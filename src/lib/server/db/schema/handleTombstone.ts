import { sqliteTable, text, integer, index } from '../columns';
import { userIdentity } from './users';

// A handle that was vacated by a rename. Blocks reuse (by anyone, including the
// original owner) until expiresAt. Doubles as the per-identity change-cooldown
// source. releasedBy is the STABLE user_identity id (survives the fuse/survivor
// graph and anon-row deletion) — the exact version snapshot is recoverable via
// getUserHistory(releasedBy) if ever needed.
export const handleTombstone = sqliteTable(
  'handle_tombstone',
  {
    handle: text('handle').primaryKey(), // normalized, lowercase
    releasedBy: text('released_by')
      .notNull()
      .references(() => userIdentity.id),
    releasedAt: integer('released_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    skeleton: text('skeleton')
  },
  (t) => [index('handle_tombstone_skeleton_idx').on(t.skeleton)]
);
