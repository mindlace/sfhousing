import { sqliteTable, normText, text, integer } from '../columns';

export type SimMemberRole = 'manager' | 'editor' | 'viewer';

/**
 * Rebuildable projection of each sim's identity. `simId` is the base58 uuidv7 that
 * also addresses the sim.
 */
export const simIndex = sqliteTable('sim_index', {
  simId: text('sim_id').primaryKey(),
  title: normText('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
