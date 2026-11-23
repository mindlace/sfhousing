import { afterAll, describe, expect, it } from 'vitest';
import { createTestD1 } from '$lib/server/test/d1';

const t = createTestD1();
afterAll(() => t.close());

type FkRow = { table: string; from: string; to: string; on_delete: string };

function fk(table: string, column: string): { table: string; onDelete: string } {
  const rows = t.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as FkRow[];
  const row = rows.find((r) => r.from === column);
  if (!row) throw new Error(`no foreign key on ${table}.${column}`);
  return { table: row.table, onDelete: row.on_delete };
}

/** Every foreign key in the migrated database, walked from sqlite_master, sorted. */
function allForeignKeys(): string[] {
  const tables = t.sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  const out: string[] = [];
  for (const { name } of tables) {
    const rows = t.sqlite.prepare(`PRAGMA foreign_key_list("${name}")`).all() as FkRow[];
    for (const r of rows)
      out.push(`${name}.${r.from} -> ${r.table}.${r.to} ON DELETE ${r.on_delete}`);
  }
  return out.sort();
}

describe('auth schema', () => {
  it('a freshly migrated database has exactly the nine identity tables and plan, and none of the five dropped', () => {
    const names = (
      t.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    )
      .map((r) => r.name)
      .filter((n) => !/^(sqlite_|_cf_|d1_)/.test(n));
    expect(names.sort()).toEqual([
      'account',
      'handle_tombstone',
      'passkey',
      'plan',
      'principal',
      'session',
      'user',
      'user_identity',
      'user_version',
      'verification'
    ]);
    for (const gone of [
      'sim_index',
      'sim_commit',
      'sim_takedown',
      'sim_invite',
      'capability_event'
    ])
      expect(names).not.toContain(gone);
  });

  // A later migration that rebuilds a table (drizzle's SQLite table-recreate) could drop or
  // change an action silently; this pins the whole list, so any change shows up here.
  it('has exactly these foreign keys, targets and ON DELETE actions', () => {
    expect(allForeignKeys()).toEqual([
      'account.user_id -> user.id ON DELETE CASCADE',
      'handle_tombstone.released_by -> user_identity.id ON DELETE NO ACTION',
      'passkey.user_id -> user.id ON DELETE CASCADE',
      'session.user_id -> user.id ON DELETE CASCADE',
      'user.user_identity -> user_identity.id ON DELETE CASCADE',
      'user_identity.id -> principal.id ON DELETE NO ACTION',
      'user_identity.superseded_by_id -> user_identity.id ON DELETE NO ACTION',
      'user_version.user_identity -> user_identity.id ON DELETE CASCADE'
    ]);
  });

  it('freezes the foreign-key actions planafoot uses', () => {
    expect(fk('user', 'user_identity').onDelete).toBe('CASCADE');
    for (const table of ['session', 'account', 'passkey']) {
      expect(fk(table, 'user_id').onDelete).toBe('CASCADE');
    }
    expect(fk('user_version', 'user_identity').onDelete).toBe('CASCADE');
    expect(fk('user_identity', 'id').onDelete).toBe('NO ACTION');
    expect(fk('user_identity', 'superseded_by_id').onDelete).toBe('NO ACTION');
    expect(fk('handle_tombstone', 'released_by').onDelete).toBe('NO ACTION');
  });

  it('has no group, user_settings or subscription table', () => {
    const names = (
      t.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    for (const gone of ['group', 'user_settings', 'subscription', 'quest_index', 'quest_invite']) {
      expect(names).not.toContain(gone);
    }
    expect(names).toContain('principal');
  });
});
