// In-memory D1Database subset over better-sqlite3, so server tests exercise the real
// getDb() / drizzle-orm/d1 path. Implements what drizzle-orm/d1/session.js calls:
// prepare → bind → all/run/raw/first, and batch. Not a general D1 emulator.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

export interface TestD1 {
  d1: D1Database;
  sqlite: import('better-sqlite3').Database;
  close(): void;
}

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../migrations/d1', import.meta.url));

// Wrangler applies only the flattened top-level `<stamp>_<name>.sql` files in migrations_dir;
// the dated `<stamp>_<name>/migration.sql` directories are drizzle-kit's source copies of the
// same SQL, so applying them too would create every table twice.
function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
}

type Row = Record<string, unknown>;

function toSqlite(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return v;
}

function meta(changes = 0, lastRowId = 0) {
  return {
    duration: 0,
    changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes
  };
}

class TestD1PreparedStatement {
  constructor(
    private readonly sqlite: import('better-sqlite3').Database,
    private readonly sql: string,
    private readonly params: unknown[] = []
  ) {}

  bind(...values: unknown[]): TestD1PreparedStatement {
    return new TestD1PreparedStatement(this.sqlite, this.sql, values.map(toSqlite));
  }

  /** Synchronous core shared by all() and batch(). */
  exec(): { results: Row[]; success: true; meta: ReturnType<typeof meta> } {
    const stmt = this.sqlite.prepare(this.sql);
    if (stmt.reader) {
      return { results: stmt.all(...this.params) as Row[], success: true, meta: meta() };
    }
    const info = stmt.run(...this.params);
    return { results: [], success: true, meta: meta(info.changes, Number(info.lastInsertRowid)) };
  }

  async all() {
    return this.exec();
  }

  async run() {
    return this.exec();
  }

  async raw(opts?: { columnNames?: boolean }): Promise<unknown[][]> {
    const stmt = this.sqlite.prepare(this.sql);
    if (!stmt.reader) {
      stmt.run(...this.params);
      return [];
    }
    const rows = stmt.raw(true).all(...this.params) as unknown[][];
    if (!opts?.columnNames) return rows;
    return [stmt.columns().map((c) => c.name), ...rows];
  }

  async first(column?: string): Promise<unknown> {
    const row = this.exec().results[0];
    if (row === undefined) return null;
    return column === undefined ? row : row[column];
  }
}

export function createTestD1(): TestD1 {
  const sqlite = new Database(':memory:');
  for (const sql of migrationSql()) sqlite.exec(sql);

  const d1 = {
    prepare: (sql: string) => new TestD1PreparedStatement(sqlite, sql),
    batch: async (stmts: TestD1PreparedStatement[]) =>
      sqlite.transaction(() => stmts.map((s) => s.exec()))(),
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    }
  };

  return {
    d1: d1 as unknown as D1Database,
    sqlite,
    close: () => sqlite.close()
  };
}

/**
 * An App.Platform for calling route handlers in tests. `env.DB` is `d1` when given; every
 * other key passes through as-is (an explicit `undefined` yields an env without that binding).
 */
export function testPlatform(over: Partial<Env> & { d1?: D1Database }): App.Platform {
  const { d1, ...rest } = over;
  const env = { ...rest, ...(d1 ? { DB: d1 } : {}) } as Env;
  const ctx = {
    waitUntil() {},
    passThroughOnException() {}
  } as unknown as ExecutionContext;
  const caches = {
    default: { match: async () => undefined, put: async () => {}, delete: async () => false },
    open: async () => caches.default
  };
  return { env, ctx, caches: caches as unknown as CacheStorage };
}
