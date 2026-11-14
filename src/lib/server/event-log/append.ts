import { sql, getTableColumns, getTableName, type SQL, type Table, type Column } from 'drizzle-orm';

/**
 * Build the atomic append of one event row with an in-SQL ordering stamp. The
 * (created_at, created_at_counter) pair is computed INSIDE the INSERT…SELECT, so it is atomic
 * on SQLite's serialized writer — correct on a single-threaded sim DO AND on multi-isolate
 * D1. `created_at = max(now, MAX(created_at))` (monotonic, never backward);
 * `created_at_counter = MAX(counter at that created_at) + 1` (0 on a fresh ms). The single owner
 * of this contract.
 *
 * `values` carries the DOMAIN columns ONLY — created_at/created_at_counter are owned here. Each
 * value is encoded through its Drizzle column's `mapToDriverValue` so JSON / timestamp_ms /
 * boolean column modes are preserved. The literal column names `created_at` / `created_at_counter`
 * are identical across all four event tables (that shared name is the contract).
 *
 * Batch callers MUST issue one statement per row so each row sees the prior row's counter.
 */
export function buildAppendEventSql(
  table: Table,
  values: Record<string, unknown>,
  now: number
): SQL {
  const columns = getTableColumns(table) as Record<string, Column>;
  const tableId = sql.identifier(getTableName(table));
  const names: SQL[] = [];
  const vals: SQL[] = [];
  for (const [key, value] of Object.entries(values)) {
    const col = columns[key];
    if (!col)
      throw new Error(`buildAppendEventSql: unknown column "${key}" on ${getTableName(table)}`);
    names.push(sql`${sql.identifier(col.name)}`);
    vals.push(sql`${col.mapToDriverValue(value)}`);
  }
  return sql`
    INSERT INTO ${tableId} (${sql.join(names, sql`, `)}, created_at, created_at_counter)
    SELECT ${sql.join(vals, sql`, `)}, w.ca,
      (SELECT COALESCE(MAX(created_at_counter), -1) + 1 FROM ${tableId} WHERE created_at = w.ca)
    FROM (SELECT max(${now}, COALESCE((SELECT MAX(created_at) FROM ${tableId}), 0)) AS ca) AS w
  `;
}

/** Append one event row on a synchronous (sim DO SQLite) handle. */
export function appendEventSync(
  db: { run(query: SQL): unknown },
  table: Table,
  values: Record<string, unknown>,
  now: number
): void {
  db.run(buildAppendEventSql(table, values, now));
}

/** Append one event row on an asynchronous (D1) handle. */
export async function appendEventAsync(
  db: { run(query: SQL): Promise<unknown> },
  table: Table,
  values: Record<string, unknown>,
  now: number
): Promise<void> {
  await db.run(buildAppendEventSql(table, values, now));
}
