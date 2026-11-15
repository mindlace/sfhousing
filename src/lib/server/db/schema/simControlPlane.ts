import { sqliteTable, normText, text, integer, index, primaryKey } from '../columns';
import type { CommitKind, Restores } from '$lib/sim-log';

export type SimMemberRole = 'manager' | 'editor' | 'viewer';

/**
 * `sim_index` and `sim_commit` are copies of each sim's log, rebuildable from the sim
 * objects and never read to serve a sim's rules (R24). `simId` is the base58 uuidv7
 * that also addresses the sim.
 */
export const simIndex = sqliteTable('sim_index', {
  simId: text('sim_id').primaryKey(),
  title: normText('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  remixedFrom: text('remixed_from'),
  remixedFromPosition: integer('remixed_from_position'),
  positions: integer('positions').notNull().default(0),
  lastChangeAt: integer('last_change_at', { mode: 'timestamp_ms' }),
  datasetVersion: text('dataset_version')
});

/** Ids taken down by an operator (R43): never registered again. */
export const simTakedown = sqliteTable('sim_takedown', {
  simId: text('sim_id').primaryKey(),
  takenDownAt: integer('taken_down_at', { mode: 'timestamp_ms' }).notNull()
});

/** One commit's envelope: everything but its changes. */
export const simCommit = sqliteTable(
  'sim_commit',
  {
    simId: text('sim_id').notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').$type<CommitKind>().notNull(),
    source: text('source').notNull(),
    actor: text('actor').notNull(),
    at: integer('at', { mode: 'timestamp_ms' }).notNull(),
    build: text('build').notNull(),
    datasetVersion: text('dataset_version').notNull(),
    bytes: integer('bytes').notNull(),
    restoresPosition: integer('restores_position'),
    restoresAs: text('restores_as').$type<Restores['as']>()
  },
  (t) => [
    primaryKey({ columns: [t.simId, t.seq] }),
    index('sim_commit_actor_idx').on(t.actor),
    index('sim_commit_dataset_version_idx').on(t.datasetVersion)
  ]
);
export type SimCommitRow = typeof simCommit.$inferSelect;
