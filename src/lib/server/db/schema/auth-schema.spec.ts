import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestD1 } from '$lib/server/test/d1';
import { freshDb, grantEvent, seedUser } from '$lib/server/test/auth-db';
import { capabilityEvent } from './capabilityEvent';
import { principal } from './principal';

const t = createTestD1();
afterAll(() => t.close());

type FkRow = { table: string; from: string; to: string; on_delete: string };

function fk(table: string, column: string): { table: string; onDelete: string } {
  const rows = t.sqlite.prepare(`PRAGMA foreign_key_list(${table})`).all() as FkRow[];
  const row = rows.find((r) => r.from === column);
  if (!row) throw new Error(`no foreign key on ${table}.${column}`);
  return { table: row.table, onDelete: row.on_delete };
}

describe('auth schema', () => {
  it('freezes the foreign-key actions planafoot uses', () => {
    expect(fk('capability_event', 'principal_id')).toEqual({
      table: 'principal',
      onDelete: 'CASCADE'
    });
    expect(fk('user', 'user_identity').onDelete).toBe('CASCADE');
    for (const table of ['session', 'account', 'passkey']) {
      expect(fk(table, 'user_id').onDelete).toBe('CASCADE');
    }
    expect(fk('user_version', 'user_identity').onDelete).toBe('CASCADE');
    expect(fk('sim_invite', 'invited_user_id').onDelete).toBe('CASCADE');
    expect(fk('sim_invite', 'invited_by_user_id').onDelete).toBe('CASCADE');
    expect(fk('sim_invite', 'accepted_by_user_id').onDelete).toBe('SET NULL');
    expect(fk('user_identity', 'id').onDelete).toBe('NO ACTION');
    expect(fk('user_identity', 'superseded_by_id').onDelete).toBe('NO ACTION');
    expect(fk('handle_tombstone', 'released_by').onDelete).toBe('NO ACTION');
  });

  it('keeps sim_invite.sim_id NOT NULL with no foreign key', () => {
    const cols = t.sqlite.prepare('PRAGMA table_info(sim_invite)').all() as {
      name: string;
      notnull: number;
    }[];
    expect(cols.find((c) => c.name === 'sim_id')?.notnull).toBe(1);
    expect(cols.some((c) => c.name === 'body_md')).toBe(false);
    const fks = t.sqlite.prepare('PRAGMA foreign_key_list(sim_invite)').all() as FkRow[];
    expect(fks.some((r) => r.from === 'sim_id')).toBe(false);
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
    expect(names).toEqual(expect.arrayContaining(['sim_index', 'sim_invite', 'principal']));
  });

  it('removes ledger rows when their principal is deleted', async () => {
    const { db, close } = freshDb();
    try {
      await db.insert(principal).values({ id: 'svc-1', kind: 'service' });
      await seedUser(db, { id: 'u1', email: 'a@example.com' });
      await grantEvent(db, { identityId: 'svc-1', capability: 'operator.access' });
      await grantEvent(db, { identityId: 'u1', capability: 'operator.access' });
      const count = async () => (await db.select().from(capabilityEvent)).length;
      expect(await count()).toBe(2);
      await db.delete(principal).where(eq(principal.id, 'svc-1'));
      expect(await count()).toBe(1);
    } finally {
      close();
    }
  });
});
