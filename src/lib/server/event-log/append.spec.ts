import { describe, it, expect } from 'vitest';
import { asc, sql } from 'drizzle-orm';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { drizzle as drizzleD1 } from 'drizzle-orm/d1';
import Database from 'better-sqlite3';
import { sqliteTable, text, integer } from '$lib/server/db/columns';
import { createTestD1 } from '$lib/server/test/d1';
import { newId } from '$lib/server/ids/base58';
import { appendEventSync, appendEventAsync, buildAppendEventSql } from './append';

const testEvents = sqliteTable('test_events', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name'),
  createdAt: integer('created_at').notNull(),
  createdAtCounter: integer('created_at_counter').notNull()
});

const DDL = `CREATE TABLE test_events (
  id text PRIMARY KEY NOT NULL,
  kind text NOT NULL,
  name text,
  created_at integer NOT NULL,
  created_at_counter integer NOT NULL
)`;

function freshSyncDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec(DDL);
  return drizzleSqlite({ client: sqlite });
}

function values() {
  return { id: newId(), kind: 'move' };
}

describe('appendEventSync stamping (DO SQLite)', () => {
  it('counter 0 when created_at advances past the table max', () => {
    const db = freshSyncDb();
    appendEventSync(db, testEvents, values(), 1000);
    appendEventSync(db, testEvents, values(), 2000);
    const rows = db
      .select()
      .from(testEvents)
      .orderBy(asc(testEvents.createdAt), asc(testEvents.createdAtCounter))
      .all();
    expect(rows.map((r) => [r.createdAt, r.createdAtCounter])).toEqual([
      [1000, 0],
      [2000, 0]
    ]);
  });

  it('same-ms collision increments the counter, created_at unchanged', () => {
    const db = freshSyncDb();
    appendEventSync(db, testEvents, values(), 5000);
    appendEventSync(db, testEvents, values(), 5000);
    const rows = db
      .select()
      .from(testEvents)
      .orderBy(asc(testEvents.createdAt), asc(testEvents.createdAtCounter))
      .all();
    expect(rows.map((r) => [r.createdAt, r.createdAtCounter])).toEqual([
      [5000, 0],
      [5000, 1]
    ]);
  });

  it('clock-behind write does not go backward (pinned to table max, counter bumps)', () => {
    const db = freshSyncDb();
    appendEventSync(db, testEvents, values(), 9000);
    appendEventSync(db, testEvents, values(), 1000);
    const rows = db
      .select()
      .from(testEvents)
      .orderBy(asc(testEvents.createdAt), asc(testEvents.createdAtCounter))
      .all();
    expect(rows.map((r) => [r.createdAt, r.createdAtCounter])).toEqual([
      [9000, 0],
      [9000, 1]
    ]);
  });

  it('empty table stamps the raw now at counter 0', () => {
    const db = freshSyncDb();
    appendEventSync(db, testEvents, values(), 4242);
    const [row] = db.select().from(testEvents).all();
    expect([row.createdAt, row.createdAtCounter]).toEqual([4242, 0]);
  });

  it('typed columns are stored (name round-trips)', () => {
    const db = freshSyncDb();
    appendEventSync(db, testEvents, { ...values(), kind: 'rename', name: 'Renamed' }, 1000);
    const [row] = db.select().from(testEvents).all();
    expect(row.name).toBe('Renamed');
  });

  it('throws on an unknown column', () => {
    const db = freshSyncDb();
    expect(() => appendEventSync(db, testEvents, { nope: 1 }, 1000)).toThrow(/unknown column/);
  });
});

describe('buildAppendEventSql onlyIf', () => {
  it('appends when the gate holds and writes nothing when it does not', () => {
    const db = freshSyncDb();
    db.run(buildAppendEventSql(testEvents, values(), 1000, { onlyIf: sql`1 = 1` }));
    db.run(buildAppendEventSql(testEvents, values(), 2000, { onlyIf: sql`1 = 0` }));
    const rows = db.select().from(testEvents).all();
    expect(rows.map((r) => r.createdAt)).toEqual([1000]);
  });

  it('without a gate builds the same statement as before, with no WHERE', () => {
    const v = values();
    const dialect = new SQLiteSyncDialect();
    const plain = dialect.sqlToQuery(buildAppendEventSql(testEvents, v, 1000));
    expect(plain).toEqual(dialect.sqlToQuery(buildAppendEventSql(testEvents, v, 1000, {})));
    // The statement still ends at the stamp's derived table: no gate is added.
    expect(plain.sql.trim()).toMatch(/AS w$/);
  });
});

describe('appendEventAsync stamping (D1)', () => {
  it('same-ms inserts get distinct, increasing counters', async () => {
    const { d1, sqlite, close } = createTestD1();
    try {
      sqlite.exec(DDL);
      const db = drizzleD1(d1);
      const now = 1_700_000_000_000;
      await appendEventAsync(db, testEvents, values(), now);
      await appendEventAsync(db, testEvents, values(), now);
      const rows = await db
        .select()
        .from(testEvents)
        .orderBy(asc(testEvents.createdAt), asc(testEvents.createdAtCounter));
      expect(rows.map((r) => r.createdAtCounter)).toEqual([0, 1]);
      expect(rows.every((r) => r.createdAt === now)).toBe(true);
    } finally {
      close();
    }
  });
});
