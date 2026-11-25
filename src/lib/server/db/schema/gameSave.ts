import { sqliteTable, text, integer, primaryKey } from '../columns';
import { userIdentity } from './users';

export const gameSave = sqliteTable(
  'game_save',
  {
    identityId: text('identity_id')
      .notNull()
      .references(() => userIdentity.id),
    id: text('id').notNull(),
    rev: integer('rev').notNull(),
    name: text('name').notNull(),
    phase: text('phase').notNull(),
    rung: integer('rung').notNull(),
    /** The GameSave as JSON; empty once removed. */
    body: text('body').notNull(),
    savedAt: integer('saved_at', { mode: 'timestamp_ms' }).notNull(),
    removedAt: integer('removed_at', { mode: 'timestamp_ms' })
  },
  (t) => [primaryKey({ columns: [t.identityId, t.id] })]
);
