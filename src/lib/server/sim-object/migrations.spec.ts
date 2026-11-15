import { describe, expect, it } from 'vitest';
import {
  describeAppendOnlyBundle,
  freshBundleSqlite
} from '@planafoot/drizzle-cf-migrations/testing';
import { simMigrations } from './migrations.generated';

/** The first migration ever shipped. Never change it: objects in production applied it. */
const FROZEN = '20261115062714_fat_scorpion';

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
