import { readFile } from 'node:fs/promises';
import { DuckDBInstance } from '@duckdb/node-api';
import { SQL_VARS } from '../config';

export interface Duck {
  run(sql: string): Promise<void>;
  all<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  close(): void;
}

/** Convert DuckDB JS values to plain JS: bigint -> number (checked), decimals -> number. */
function plain(v: unknown): unknown {
  if (typeof v === 'bigint') {
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new Error(`BIGINT ${v} exceeds Number.MAX_SAFE_INTEGER`);
    }
    return Number(v);
  }
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const o = v as { constructor?: { name?: string }; toDouble?: () => number };
    if (typeof o.toDouble === 'function') return o.toDouble();
    if (v instanceof Date || v instanceof Uint8Array) return v;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

export async function openDuck(opts: { httpfs?: boolean; path?: string } = {}): Promise<Duck> {
  const instance = await DuckDBInstance.create(opts.path ?? ':memory:');
  const conn = await instance.connect();
  const db: Duck = {
    async run(sql) {
      await conn.run(sql);
    },
    async all<T = Record<string, unknown>>(sql: string) {
      const reader = await conn.runAndReadAll(sql);
      return reader.getRowObjectsJS().map((r) => plain(r) as T);
    },
    close() {
      conn.closeSync();
      instance.closeSync();
    }
  };
  try {
    await db.run('INSTALL spatial');
    await db.run('LOAD spatial');
    if (opts.httpfs) {
      await db.run('INSTALL httpfs');
      await db.run('LOAD httpfs');
    }
    for (const [name, value] of Object.entries(SQL_VARS)) {
      await db.run(`SET VARIABLE ${name} = ${value.toFixed(1)}::DOUBLE`);
    }
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}

/** Read a SQL file and run it whole (multi-statement). */
export async function runSqlFile(db: Duck, file: string): Promise<void> {
  await db.run(await readFile(file, 'utf8'));
}
