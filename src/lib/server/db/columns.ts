/**
 * Drizzle column/table constructors. Human-authored text uses `normText` (NFC on
 * write); opaque byte-exact values (hashes, tokens, signatures) use `privateText`;
 * ids/enums/hex use plain `text`. No `mode: 'json'` widening — make a typed table.
 */
import {
  customType,
  sqliteTable,
  SQLiteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check
} from 'drizzle-orm/sqlite-core';

/** Unicode NFC — visually lossless, idempotent, ASCII no-op. */
export const toNfc = (value: string): string => value.normalize('NFC');

/** toDriver for normText: NFC-normalize non-null strings; pass null/undefined through. */
export const normTextToDriver = (value: string | null | undefined): string | null | undefined =>
  value == null ? value : toNfc(value);

/** Human-authored text. Normalizes to NFC on every write (toDriver). */
export const normText = customType<{ data: string; driverData: string }>({
  dataType: () => 'text',
  toDriver: (value) => normTextToDriver(value as string | null | undefined) as string
});

/**
 * Opaque byte-exact values (content-addressed hashes, signatures, crypto tokens).
 * Identity alias of `text` — an intent marker, snapshot-identical, NO transform.
 */
export const privateText = text;

/** `check` — for generated CHECK constraints (generated constraints). */
export { sqliteTable, SQLiteTable, text, integer, real, index, uniqueIndex, primaryKey, check };
export type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core';
