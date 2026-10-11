import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const plan = sqliteTable(
  'plan',
  {
    id: text('id').primaryKey(),
    schema: integer('schema').notNull(),
    datasetVersion: text('dataset_version').notNull(),
    body: text('body').notNull(),
    contentHash: text('content_hash').notNull().unique(),
    opCount: integer('op_count').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('plan_created_at_idx').on(t.createdAt)]
);

export type PlanRow = typeof plan.$inferSelect;
