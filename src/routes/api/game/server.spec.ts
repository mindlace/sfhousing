// GET /api/game against a real migrated database and the real store.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freshDb, makePlatform, seedUser } from '$lib/server/test/auth-db';
import { putGame, removeGame } from '$lib/server/game/store';
import type { ListGames } from '$lib/game/save-api';
import type { GameSave } from '$lib/game/save-shape';
import { NEW_GAME } from '$lib/game/state';
import { newId } from '$lib/ids/base58';

const { holder } = vi.hoisted(() => ({ holder: { db: undefined as unknown } }));
vi.mock('$lib/server/db', () => ({ getDb: () => holder.db }));

import { GET } from './+server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
});

function makeSave(id: string, name: string): GameSave {
  return {
    v: 2,
    id,
    name,
    nameIsDefault: false,
    state: { ...structuredClone(NEW_GAME), firstWinAt: null },
    plan: null,
    policy: null,
    savedAt: new Date().toISOString()
  };
}

describe('GET /api/game', () => {
  it('401 with an empty body when signed out', async () => {
    const t = freshDb();
    opened.push(t.close);
    holder.db = t.db;
    const res = await GET({
      locals: { user: null },
      platform: makePlatform(t.shim)
    } as never);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it('200 with the line, the live saves and the removed ids', async () => {
    const t = freshDb();
    opened.push(t.close);
    holder.db = t.db;
    await seedUser(t.db, { id: 'ana', email: 'ana@example.test', handle: 'ana' });
    const live = newId();
    const gone = newId();
    await putGame(t.db, 'ana', makeSave(live, 'Live'), null);
    await putGame(t.db, 'ana', makeSave(gone, 'Gone'), null);
    await removeGame(t.db, 'ana', gone, new Date());

    const res = await GET({
      locals: { user: { id: 'ana', handle: 'ana' } },
      platform: makePlatform(t.shim)
    } as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Extract<ListGames, { status: 200 }>['body'];
    expect(body.handle).toBe('ana');
    expect(body.handleClaimed).toBe(false);
    expect(body.saves).toHaveLength(1);
    expect(body.saves[0]).toMatchObject({
      id: live,
      name: 'Live',
      rev: 1,
      phase: 'opening',
      round: 0
    });
    expect(body.removed).toEqual([gone]);
  });
});
