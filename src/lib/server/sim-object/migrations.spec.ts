import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  describeAppendOnlyBundle,
  freshBundleSqlite
} from '@planafoot/drizzle-cf-migrations/testing';
import { simMigrations } from './migrations.generated';

/** The first migration ever shipped. Never change it: objects in production applied it. */
const FROZEN = '20261115062714_fat_scorpion';

/**
 * Every migration ever shipped, with the SHA-256 of its SQL. Objects in production applied
 * these, so none may be edited or removed. A new migration adds its line here when it ships:
 * `shasum -a 256 migrations/sim/<name>/migration.sql`.
 */
const SHIPPED: Record<string, string> = {
  '20261115062714_fat_scorpion': 'f1859d21516308612f2abb0d703f235703db2c0621a202250961ff42a03cb871'
};

const sha256 = (sql: string): string => createHash('sha256').update(sql, 'utf8').digest('hex');

/** The names of shipped migrations missing from `bundle` or whose SQL differs. */
function shippedMismatches(
  bundle: Record<string, string>,
  shipped: Record<string, string>
): string[] {
  return Object.entries(shipped)
    .filter(([name, hash]) => !Object.hasOwn(bundle, name) || sha256(bundle[name]) !== hash)
    .map(([name]) => name);
}

describeAppendOnlyBundle({
  label: 'sim',
  bundle: simMigrations,
  frozenBaseline: FROZEN,
  baselineContains: ['CREATE TABLE `commits`', 'CREATE TABLE `sim_state`'],
  harness: {
    fresh: () => ({ sqlite: freshBundleSqlite(simMigrations) }),
    tables: ['commits', 'sim_state']
  }
});

describe('shipped sim migrations', () => {
  it('are each in the bundle with their SQL unchanged', () => {
    expect(shippedMismatches(simMigrations, SHIPPED)).toEqual([]);
    expect(Object.keys(SHIPPED)).toContain(FROZEN);
  });

  it('the check names a removed or an edited migration', () => {
    const edited = { ...simMigrations, [FROZEN]: simMigrations[FROZEN] + '\n' };
    expect(shippedMismatches(edited, SHIPPED)).toEqual([FROZEN]);
    const removed: Record<string, string> = { ...simMigrations };
    delete removed[FROZEN];
    expect(shippedMismatches(removed, SHIPPED)).toEqual([FROZEN]);
  });
});

describe('sim schema', () => {
  it('refuses a second row with one commit id', () => {
    const sqlite = freshBundleSqlite(simMigrations);
    const put = sqlite.prepare(
      'INSERT INTO commits (seq, id, hash, bytes, body) VALUES (?, ?, ?, ?, ?)'
    );
    put.run(1, 'a', 'h', 2, '{}');
    expect(() => put.run(2, 'a', 'h', 2, '{}')).toThrow(/UNIQUE/);
  });
});
