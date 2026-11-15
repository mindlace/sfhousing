import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// The sim object's own SQLite, one database per sim (R21). Append-only: generate migrations with
// `npm run db:generate:sim` only. No CHECK constraints (the migrations package forbids them in a
// Durable Object track).

export const commits = sqliteTable('commits', {
  seq: integer('seq').primaryKey(),
  id: text('id').notNull().unique(),
  hash: text('hash').notNull(),
  bytes: integer('bytes').notNull(),
  body: text('body').notNull()
});

export const simState = sqliteTable('sim_state', {
  id: integer('id').primaryKey(),
  indexedSeq: integer('indexed_seq').notNull().default(0),
  goneAt: integer('gone_at')
});
