import { describe, it, expect } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { gameSave } from '$lib/server/db/schema';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { updateProfile } from '$lib/server/user-store/profile';
import { newId } from '$lib/ids/base58';
import { parseGameSave, type GameSave } from '$lib/game/save-shape';
import { NEW_GAME } from '$lib/game/state';
import {
  REMOVED_LIST_DAYS,
  accountLine,
  deleteGamesOf,
  listGames,
  moveGames,
  putGame,
  readGame,
  removeGame
} from './store';

const DAY_MS = 24 * 60 * 60 * 1000;

function save(id: string = newId(), over: Partial<GameSave> = {}): GameSave {
  const s: GameSave = {
    v: 2,
    id,
    name: 'Game, 22 Nov',
    nameIsDefault: true,
    state: {
      ...structuredClone(NEW_GAME),
      phase: 'runs',
      round: 1,
      firstWinAt: '2026-11-22T10:00:00.000Z'
    },
    plan: null,
    policy: null,
    savedAt: '2026-11-22T12:00:00.000Z',
    ...over
  };
  if (!parseGameSave(s)) throw new Error('test save is not valid');
  return s;
}

async function setup(): Promise<Database> {
  const { db } = freshDb();
  await seedUser(db, { id: 'u1', email: 'one@test.com', handle: 'one' });
  await seedUser(db, { id: 'u2', email: 'two@test.com', handle: 'two' });
  return db;
}

async function row(db: Database, identityId: string, id: string) {
  const [r] = await db
    .select()
    .from(gameSave)
    .where(and(eq(gameSave.identityId, identityId), eq(gameSave.id, id)));
  return r;
}

async function rows(db: Database, identityId: string) {
  return db.select().from(gameSave).where(eq(gameSave.identityId, identityId));
}

describe('the game_save table', () => {
  it('has the v2 columns and no level', async () => {
    const db = await setup();
    const cols = await db.all<{ name: string }>(sql`PRAGMA table_info(game_save)`);
    expect(cols.map((c) => c.name)).toEqual([
      'identity_id',
      'id',
      'rev',
      'name',
      'phase',
      'rung',
      'body',
      'saved_at',
      'removed_at'
    ]);
  });
});

describe('putGame', () => {
  it('stores phase and the round, in the rung column, on insert and on update; lists the round', async () => {
    const db = await setup();
    const a = save(undefined, { state: { ...save().state, phase: 'opening', round: 0 } });
    await putGame(db, 'u1', a, null);
    expect(await row(db, 'u1', a.id)).toMatchObject({ phase: 'opening', rung: 0, rev: 1 });
    await putGame(db, 'u1', { ...a, state: { ...a.state, phase: 'runs', round: 2 } }, 1);
    expect(await row(db, 'u1', a.id)).toMatchObject({ phase: 'runs', rung: 2, rev: 2 });
    const { saves } = await listGames(db, 'u1', new Date('2026-11-23T00:00:00.000Z'));
    expect(saves[0]).toMatchObject({ id: a.id, round: 2 });
    expect(saves[0]).not.toHaveProperty('rung');
  });

  it('keeps an editable key the catalogue lacks', async () => {
    const db = await setup();
    const a = save(undefined, { state: { ...save().state, editable: ['no-such-key'] } });
    await putGame(db, 'u1', a, null);
    expect(await readGame(db, 'u1', a.id)).toEqual({ kind: 'live', rev: 1, save: a });
  });

  it('a stored version 2 body reads back as version 3', async () => {
    const db = await setup();
    const id = newId();
    const v2 = {
      ...save(id),
      state: {
        v: 2,
        phase: 'runs',
        firstWinAt: '2026-11-22T10:00:00.000Z',
        bought: { 'housing-bond': 1 },
        units: { home: 3 },
        rung: 1,
        met: [{ rung: 0, reachedOn: 33000, datasetVersion: 'v', at: '2026-11-22T10:00:00.000Z' }],
        side: {},
        runs: 1,
        last: null
      }
    };
    await db.insert(gameSave).values({
      identityId: 'u1',
      id,
      rev: 1,
      name: v2.name,
      phase: 'runs',
      rung: 1,
      body: JSON.stringify(v2),
      savedAt: new Date(v2.savedAt),
      removedAt: null
    });
    const r = await readGame(db, 'u1', id);
    expect(r?.kind === 'live' && r.save.state).toMatchObject({
      v: 3,
      round: 2,
      editable: ['housing-bond'],
      own: true
    });
  });

  it('a conflict carries the v2 save stored', async () => {
    const db = await setup();
    const a = save();
    await putGame(db, 'u1', a, null);
    const answer = await putGame(db, 'u1', save(a.id, { name: 'Lost' }), null);
    expect(answer).toEqual({ kind: 'conflict', rev: 1, save: a });
    expect(answer.kind === 'conflict' && answer.save.v).toBe(2);
  });

  it('stores a new id at rev 1 with baseRev null, and with a rev too', async () => {
    const db = await setup();
    const a = save();
    const b = save();
    expect(await putGame(db, 'u1', a, null)).toEqual({ kind: 'stored', rev: 1 });
    expect(await putGame(db, 'u1', b, 7)).toEqual({ kind: 'stored', rev: 1 });
    const r = await row(db, 'u1', a.id);
    expect(r.rev).toBe(1);
    expect(r.name).toBe(a.name);
    expect(r.phase).toBe('runs');
    expect(r.rung).toBe(1);
    expect(r.savedAt.toISOString()).toBe(a.savedAt);
    expect(r.removedAt).toBeNull();
    expect(JSON.parse(r.body)).toEqual(a);
  });

  it('stores on a matching baseRev and answers rev + 1', async () => {
    const db = await setup();
    const a = save();
    await putGame(db, 'u1', a, null);
    const next = save(a.id, {
      name: 'Mine',
      nameIsDefault: false,
      savedAt: '2026-11-22T13:00:00.000Z'
    });
    expect(await putGame(db, 'u1', next, 1)).toEqual({ kind: 'stored', rev: 2 });
    const r = await row(db, 'u1', a.id);
    expect(r.rev).toBe(2);
    expect(r.name).toBe('Mine');
    expect(r.savedAt.toISOString()).toBe(next.savedAt);
    expect(JSON.parse(r.body)).toEqual(next);
  });

  it('answers conflict with the stored save on a stale or null baseRev and changes nothing', async () => {
    const db = await setup();
    const a = save();
    await putGame(db, 'u1', a, null);
    await putGame(db, 'u1', save(a.id, { name: 'Second' }), 1);
    const before = await row(db, 'u1', a.id);
    const stored = JSON.parse(before.body);

    for (const baseRev of [1, null, 9]) {
      const answer = await putGame(db, 'u1', save(a.id, { name: 'Lost' }), baseRev);
      expect(answer).toEqual({ kind: 'conflict', rev: 2, save: stored });
    }
    const after = await row(db, 'u1', a.id);
    expect(after).toEqual(before);
  });

  it('answers removed for a removed id', async () => {
    const db = await setup();
    const a = save();
    await putGame(db, 'u1', a, null);
    await removeGame(db, 'u1', a.id, new Date());
    expect(await putGame(db, 'u1', a, 1)).toEqual({ kind: 'removed' });
    expect(await putGame(db, 'u1', a, null)).toEqual({ kind: 'removed' });
  });

  it('answers too_many for a 13th new id, and still stores an existing id at 12', async () => {
    const db = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const s = save();
      ids.push(s.id);
      expect(await putGame(db, 'u1', s, null)).toEqual({ kind: 'stored', rev: 1 });
    }
    expect(await putGame(db, 'u1', save(), null)).toEqual({ kind: 'too_many' });
    expect(await rows(db, 'u1')).toHaveLength(12);
    expect(await putGame(db, 'u1', save(ids[0], { name: 'Again' }), 1)).toEqual({
      kind: 'stored',
      rev: 2
    });
    // The cap is per identity.
    expect(await putGame(db, 'u2', save(), null)).toEqual({ kind: 'stored', rev: 1 });
  });
});

describe('removeGame', () => {
  it('clears the body, keeps the row and its rev', async () => {
    const db = await setup();
    const a = save();
    await putGame(db, 'u1', a, null);
    await putGame(db, 'u1', save(a.id, { name: 'Two' }), 1);
    const now = new Date('2026-11-22T15:00:00.000Z');
    await removeGame(db, 'u1', a.id, now);
    const r = await row(db, 'u1', a.id);
    expect(r.body).toBe('');
    expect(r.rev).toBe(2);
    expect(r.removedAt?.getTime()).toBe(now.getTime());
  });

  it('leaves a removed or unknown id as it is', async () => {
    const db = await setup();
    const a = save();
    await putGame(db, 'u1', a, null);
    const first = new Date('2026-11-22T15:00:00.000Z');
    await removeGame(db, 'u1', a.id, first);
    const before = await row(db, 'u1', a.id);
    await removeGame(db, 'u1', a.id, new Date('2026-11-23T15:00:00.000Z'));
    expect(await row(db, 'u1', a.id)).toEqual(before);

    await removeGame(db, 'u1', newId(), first);
    expect(await rows(db, 'u1')).toHaveLength(1);
  });
});

describe('readGame', () => {
  it('answers live with the parsed save, removed, and null', async () => {
    const db = await setup();
    const a = save();
    const b = save();
    await putGame(db, 'u1', a, null);
    await putGame(db, 'u1', b, null);
    await removeGame(db, 'u1', b.id, new Date());
    expect(await readGame(db, 'u1', a.id)).toEqual({ kind: 'live', rev: 1, save: a });
    expect(await readGame(db, 'u1', b.id)).toEqual({ kind: 'removed' });
    expect(await readGame(db, 'u1', newId())).toBeNull();
    expect(await readGame(db, 'u2', a.id)).toBeNull();
  });
});

describe('listGames', () => {
  it('lists live saves newest first with their fields', async () => {
    const db = await setup();
    const old = save(newId(), { savedAt: '2026-11-20T12:00:00.000Z' });
    const mid = save(newId(), {
      name: 'Named',
      nameIsDefault: false,
      savedAt: '2026-11-21T12:00:00.000Z',
      state: { ...save().state, phase: 'opening', round: 0, firstWinAt: null }
    });
    const recent = save(newId(), { savedAt: '2026-11-22T12:00:00.000Z' });
    await putGame(db, 'u1', mid, null);
    await putGame(db, 'u1', old, null);
    await putGame(db, 'u1', recent, null);
    await putGame(db, 'u1', save(recent.id, { savedAt: '2026-11-22T12:30:00.000Z' }), 1);
    await putGame(db, 'u2', save(), null);

    const { saves, removed } = await listGames(db, 'u1', new Date('2026-11-23T00:00:00.000Z'));
    expect(removed).toEqual([]);
    expect(saves.map((s) => s.id)).toEqual([recent.id, mid.id, old.id]);
    expect(saves[0]).toEqual({
      id: recent.id,
      name: recent.name,
      nameIsDefault: true,
      savedAt: '2026-11-22T12:30:00.000Z',
      phase: 'runs',
      round: 1,
      rev: 2
    });
    expect(saves[0].nameIsDefault).toBe(true);
    expect(saves[1].nameIsDefault).toBe(false);
    expect(saves[1]).toEqual({
      id: mid.id,
      name: 'Named',
      nameIsDefault: false,
      savedAt: mid.savedAt,
      phase: 'opening',
      round: 0,
      rev: 1
    });
  });

  it('lists removed ids for 90 days and not after, never among saves', async () => {
    const db = await setup();
    const now = new Date('2026-11-22T12:00:00.000Z');
    const recent = save();
    const old = save();
    const live = save();
    await putGame(db, 'u1', recent, null);
    await putGame(db, 'u1', old, null);
    await putGame(db, 'u1', live, null);
    await removeGame(db, 'u1', recent.id, new Date(now.getTime() - 89 * DAY_MS));
    await removeGame(db, 'u1', old.id, new Date(now.getTime() - 91 * DAY_MS));
    expect(REMOVED_LIST_DAYS).toBe(90);

    const { saves, removed } = await listGames(db, 'u1', now);
    expect(saves.map((s) => s.id)).toEqual([live.id]);
    expect(removed).toEqual([recent.id]);
  });
});

describe('accountLine', () => {
  it('is unclaimed for a fresh user and claimed after the handle changes', async () => {
    const db = await setup();
    expect(await accountLine(db, { id: 'u1', handle: 'one' })).toEqual({
      handle: 'one',
      handleClaimed: false
    });
    const changed = await updateProfile(db, 'u1', { handle: 'uno' }, new Date());
    expect(changed.ok).toBe(true);
    expect(await accountLine(db, { id: 'u1', handle: 'uno' })).toEqual({
      handle: 'uno',
      handleClaimed: true
    });
    expect((await accountLine(db, { id: 'u2', handle: 'two' })).handleClaimed).toBe(false);
  });
});

describe('moveGames', () => {
  it('moves live and removed rows to the survivor', async () => {
    const db = await setup();
    const live = save();
    const gone = save();
    await putGame(db, 'u2', live, null);
    await putGame(db, 'u2', save(live.id, { name: 'Two' }), 1);
    await putGame(db, 'u2', gone, null);
    await removeGame(db, 'u2', gone.id, new Date());

    await moveGames(db, 'u1', 'u2');
    expect(await rows(db, 'u2')).toEqual([]);
    expect(await readGame(db, 'u1', live.id)).toEqual({
      kind: 'live',
      rev: 2,
      save: save(live.id, { name: 'Two' })
    });
    expect(await readGame(db, 'u1', gone.id)).toEqual({ kind: 'removed' });
  });

  it('moves a clashing live row under a new id with its body id rewritten', async () => {
    const db = await setup();
    const id = newId();
    await putGame(db, 'u1', save(id, { name: 'Survivor' }), null);
    await putGame(db, 'u2', save(id, { name: 'Absorbed' }), null);
    await putGame(db, 'u2', save(id, { name: 'Absorbed' }), 1);

    await moveGames(db, 'u1', 'u2');
    expect(await rows(db, 'u2')).toEqual([]);
    const all = await rows(db, 'u1');
    expect(all).toHaveLength(2);
    expect(await readGame(db, 'u1', id)).toEqual({
      kind: 'live',
      rev: 1,
      save: save(id, { name: 'Survivor' })
    });
    const moved = all.find((r) => r.id !== id);
    expect(moved).toBeDefined();
    const newIdOf = moved!.id;
    expect(newIdOf).not.toBe(id);
    const read = await readGame(db, 'u1', newIdOf);
    expect(read).toEqual({
      kind: 'live',
      rev: 2,
      save: save(newIdOf, { name: 'Absorbed' })
    });
    expect(read?.kind === 'live' && read.save.id).toBe(newIdOf);
  });

  it('deletes a clashing removed row', async () => {
    const db = await setup();
    const id = newId();
    await putGame(db, 'u1', save(id, { name: 'Survivor' }), null);
    await putGame(db, 'u2', save(id, { name: 'Absorbed' }), null);
    await removeGame(db, 'u2', id, new Date());

    await moveGames(db, 'u1', 'u2');
    expect(await rows(db, 'u2')).toEqual([]);
    expect(await rows(db, 'u1')).toHaveLength(1);
    expect(await readGame(db, 'u1', id)).toEqual({
      kind: 'live',
      rev: 1,
      save: save(id, { name: 'Survivor' })
    });
  });

  it('lets the survivor end above 12', async () => {
    const db = await setup();
    for (let i = 0; i < 12; i++) await putGame(db, 'u1', save(), null);
    for (let i = 0; i < 3; i++) await putGame(db, 'u2', save(), null);
    await moveGames(db, 'u1', 'u2');
    const { saves } = await listGames(db, 'u1', new Date());
    expect(saves).toHaveLength(15);
  });
});

describe('deleteGamesOf', () => {
  it('deletes the rows of every id given and no other', async () => {
    const db = await setup();
    await seedUser(db, { id: 'u3', email: 'three@test.com', handle: 'three' });
    const gone = save();
    await putGame(db, 'u1', save(), null);
    await putGame(db, 'u1', gone, null);
    await removeGame(db, 'u1', gone.id, new Date());
    await putGame(db, 'u2', save(), null);
    await putGame(db, 'u3', save(), null);

    await deleteGamesOf(db, ['u1', 'u2']);
    expect(await rows(db, 'u1')).toEqual([]);
    expect(await rows(db, 'u2')).toEqual([]);
    expect(await rows(db, 'u3')).toHaveLength(1);
    await deleteGamesOf(db, []);
    expect(await rows(db, 'u3')).toHaveLength(1);
  });
});
