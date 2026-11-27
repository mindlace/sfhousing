// The saved-game routes against a real migrated database and the real store.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { gameSave } from '$lib/server/db/schema';
import { freshDb, makePlatform, seedUser } from '$lib/server/test/auth-db';
import { FakeRateLimiter } from '$lib/server/test/fake-rate-limiter';
import { MAX_SAVE_BYTES } from '$lib/game/save-api';
import type { GameSave } from '$lib/game/save-shape';
import { MAX_SAVES } from '$lib/game/saves';
import { NEW_GAME } from '$lib/game/state';
import { newId } from '$lib/ids/base58';

const { holder, mint } = vi.hoisted(() => ({
  holder: { db: undefined as unknown },
  mint: vi.fn()
}));
vi.mock('$lib/server/db', () => ({ getDb: () => holder.db }));
vi.mock('$lib/server/onboarding/pseudonymous-mint', () => ({ mintPseudonymousSession: mint }));

import { DELETE, GET, PUT } from './+server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  vi.clearAllMocks();
});

const WON = '2026-01-02T00:00:00.000Z';

function makeSave(id: string, over: Partial<GameSave> = {}, firstWinAt: string | null = WON) {
  return {
    v: 2,
    id,
    name: 'Game',
    nameIsDefault: true,
    state: { ...structuredClone(NEW_GAME), firstWinAt },
    plan: null,
    policy: null,
    savedAt: '2026-01-03T00:00:00.000Z',
    ...over
  } as GameSave;
}

type User = { id: string; handle: string };
const ANA: User = { id: 'ana', handle: 'ana' };

async function setup(opts: { allow?: number; seed?: string[] } = {}) {
  const t = freshDb();
  opened.push(t.close);
  holder.db = t.db;
  for (const id of opts.seed ?? ['ana']) {
    await seedUser(t.db, { id, email: `${id}@example.test`, handle: id });
  }
  const limiter = new FakeRateLimiter({ allow: opts.allow ?? 1000 });
  const platform = makePlatform(t.shim, {
    ENVIRONMENT: 'production',
    MUTATION_REGISTERED_RL: limiter
  });
  const store = new Map<string, string>();
  const cookies = {
    get: (k: string) => store.get(k),
    set: (k: string, v: string) => void store.set(k, v),
    delete: (k: string) => void store.delete(k)
  };
  return { ...t, limiter, platform, cookies, store };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

function event(
  c: Ctx,
  id: string,
  init: RequestInit & { user?: User | null; headers?: Record<string, string> } = {}
) {
  const { user = null, headers, ...rest } = init;
  return {
    locals: { user },
    platform: c.platform,
    cookies: c.cookies,
    params: { id },
    url: new URL(`http://localhost/api/game/${id}`),
    request: new Request(`http://localhost/api/game/${id}`, {
      headers: { 'content-type': 'application/json', ...headers },
      ...rest
    })
  } as never;
}

function put(
  c: Ctx,
  id: string,
  body: unknown,
  opts: { user?: User | null; headers?: Record<string, string> } = {}
) {
  return PUT(
    event(c, id, {
      method: 'PUT',
      user: opts.user === undefined ? ANA : opts.user,
      headers: opts.headers,
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })
  );
}

const rows = (c: Ctx) => c.db.select().from(gameSave);

describe('PUT /api/game/[id] refusals before any account', () => {
  it('415 for a body that is not JSON content', async () => {
    const c = await setup();
    const id = newId();
    const res = await PUT(
      event(c, id, {
        method: 'PUT',
        user: ANA,
        headers: { 'content-type': 'text/plain' },
        body: '{}'
      })
    );
    expect(res.status).toBe(415);
  });

  it('403 for a foreign origin, with no mint and no cookie', async () => {
    const c = await setup();
    const id = newId();
    const res = await put(
      c,
      id,
      { baseRev: null, save: makeSave(id) },
      { user: null, headers: { origin: 'http://evil.test' } }
    );
    expect(res.status).toBe(403);
    expect(mint).not.toHaveBeenCalled();
    expect(c.store.size).toBe(0);
  });

  it('413 by content-length header', async () => {
    const c = await setup();
    const id = newId();
    const res = await put(
      c,
      id,
      { baseRev: null, save: makeSave(id) },
      { headers: { 'content-length': String(MAX_SAVE_BYTES + 1) } }
    );
    expect(res.status).toBe(413);
    expect(await res.text()).toBe('');
  });

  it('413 by body when the UTF-8 length is over and the character length under', async () => {
    const c = await setup();
    const id = newId();
    const text = JSON.stringify({ baseRev: null, save: makeSave(id), pad: '€'.repeat(210_000) });
    expect(text.length).toBeLessThan(MAX_SAVE_BYTES);
    expect(new TextEncoder().encode(text).length).toBeGreaterThan(MAX_SAVE_BYTES);
    const res = await put(c, id, text);
    expect(res.status).toBe(413);
    expect(await res.text()).toBe('');
    expect(await rows(c)).toHaveLength(0);
  });

  it('422 invalid for text that is not JSON', async () => {
    const c = await setup();
    const res = await put(c, newId(), '{nope');
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid' });
  });

  it.each([null, 'x', [1]])('422 invalid for a body that is %j', async (body) => {
    const c = await setup();
    const res = await put(c, newId(), body);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid' });
  });

  it.each([0, 1.5, '1', -1])('422 invalid for a baseRev of %j', async (baseRev) => {
    const c = await setup();
    const id = newId();
    const res = await put(c, id, { baseRev, save: makeSave(id) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(await rows(c)).toHaveLength(0);
  });

  it('422 invalid for a save parseGameSave refuses', async () => {
    const c = await setup();
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: { ...makeSave(id), name: '' } });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid' });
  });

  it('422 invalid for a v1 save', async () => {
    const c = await setup();
    const id = newId();
    const res = await put(c, id, {
      baseRev: null,
      save: {
        v: 1,
        id,
        name: 'Game',
        nameIsDefault: true,
        progress: { v: 1, level: 1, banked: {}, firstWinAt: WON },
        plan: null,
        policy: null,
        savedAt: '2026-01-03T00:00:00.000Z'
      }
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(await rows(c)).toHaveLength(0);
  });

  it('422 invalid for a phase parseGameSave refuses', async () => {
    const c = await setup();
    const id = newId();
    const s = makeSave(id);
    const res = await put(c, id, {
      baseRev: null,
      save: { ...s, state: { ...s.state, phase: 'won' } }
    });
    expect(res.status).toBe(422);
    expect(await rows(c)).toHaveLength(0);
  });

  it('422 invalid for an id that differs from the path', async () => {
    const c = await setup();
    const res = await put(c, newId(), { baseRev: null, save: makeSave(newId()) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid' });
    expect(await rows(c)).toHaveLength(0);
  });

  it('an invalid body with no session makes no account', async () => {
    const c = await setup();
    const res = await put(c, newId(), '{nope', { user: null });
    expect(res.status).toBe(422);
    expect(mint).not.toHaveBeenCalled();
    expect(c.store.size).toBe(0);
  });
});

describe('PUT /api/game/[id] with no session', () => {
  it('401 sign_in on a known device; no mint, no cookie, no row', async () => {
    const c = await setup();
    c.store.set('sfh_known', '1');
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id) }, { user: null });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'sign_in' });
    expect(mint).not.toHaveBeenCalled();
    expect([...c.store.keys()]).toEqual(['sfh_known']);
    expect(await rows(c)).toHaveLength(0);
  });

  it('422 no_win when firstWinAt is null; no mint, no cookie, no row', async () => {
    const c = await setup();
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id, {}, null) }, { user: null });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'no_win' });
    expect(mint).not.toHaveBeenCalled();
    expect(c.store.size).toBe(0);
    expect(await rows(c)).toHaveLength(0);
  });

  it('mints once and answers 200 with the new account line at rev 1', async () => {
    const c = await setup({ seed: ['minted'] });
    mint.mockImplementation(async (e: { cookies: Ctx['cookies'] }) => {
      e.cookies.set('better-auth.session_token', 'tok');
      return { ok: true, user: { id: 'minted', handle: 'minted' } };
    });
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id) }, { user: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handle: 'minted', handleClaimed: false, rev: 1 });
    expect(mint).toHaveBeenCalledOnce();
    const [row] = await rows(c);
    expect(row.identityId).toBe('minted');
    expect(c.limiter.calls).toEqual(['game_write:minted']);
  });

  it('a mint refused at 429 answers 429 and stores nothing', async () => {
    const c = await setup();
    mint.mockResolvedValue({ ok: false, status: 429, message: 'slow down' });
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id) }, { user: null });
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('');
    expect(await rows(c)).toHaveLength(0);
  });

  it('a mint refused at 500 answers 500 with its message', async () => {
    const c = await setup();
    mint.mockResolvedValue({ ok: false, status: 500, message: 'no session' });
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id) }, { user: null });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'no session' });
    expect(await rows(c)).toHaveLength(0);
  });

  it('a mint followed by a 429 from the write limit keeps the account cookie', async () => {
    const c = await setup({ seed: ['minted'], allow: 0 });
    mint.mockImplementation(async (e: { cookies: Ctx['cookies'] }) => {
      e.cookies.set('better-auth.session_token', 'tok');
      return { ok: true, user: { id: 'minted', handle: 'minted' } };
    });
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id) }, { user: null });
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('');
    expect(c.store.get('better-auth.session_token')).toBe('tok');
    expect(await rows(c)).toHaveLength(0);
  });
});

describe('PUT /api/game/[id] signed in', () => {
  it('200 stores at rev 1, then a matching baseRev stores at rev 2', async () => {
    const c = await setup();
    const id = newId();
    const first = await put(c, id, { baseRev: null, save: makeSave(id) });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ handle: 'ana', handleClaimed: false, rev: 1 });
    const second = await put(c, id, { baseRev: 1, save: makeSave(id, { name: 'Two' }) });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ handle: 'ana', handleClaimed: false, rev: 2 });
    expect(mint).not.toHaveBeenCalled();
  });

  it('stores a save whose editable names a key the catalogue lacks, and GET reads it back', async () => {
    const c = await setup();
    const id = newId();
    const s = makeSave(id, {
      state: { ...makeSave(id).state, phase: 'runs', round: 1, editable: ['no-such-key'] }
    });
    expect((await put(c, id, { baseRev: null, save: s })).status).toBe(200);
    const res = await GET(event(c, id, { user: ANA }));
    expect(await res.json()).toEqual({ rev: 1, save: s });
  });

  it('a version 2 save PUT by an old browser is stored upgraded, plan and policy unchanged', async () => {
    const c = await setup();
    const id = newId();
    const old = {
      ...makeSave(id),
      plan: '{"v":1}',
      policy: '{"schema":4}',
      state: {
        v: 2,
        phase: 'runs',
        firstWinAt: WON,
        bought: { 'sb423-clock': 1, 'stop-rail': 1 },
        units: { home: 9 },
        rung: 1,
        met: [{ rung: 0, reachedOn: 33000, datasetVersion: 'v', at: WON }],
        side: {},
        runs: 1,
        last: null
      }
    };
    expect((await put(c, id, { baseRev: null, save: old })).status).toBe(200);
    const res = await GET(event(c, id, { user: ANA }));
    const body = (await res.json()) as { save: GameSave };
    expect(body.save.state).toMatchObject({ v: 3, round: 2, editable: ['sb423-clock'] });
    const [row] = await c.db.select().from(gameSave).where(eq(gameSave.id, id));
    expect(row.rung).toBe(2);
    expect(body.save.plan).toBe('{"v":1}');
    expect(body.save.policy).toBe('{"schema":4}');
  });

  it('a signed-in save with no win is stored', async () => {
    const c = await setup();
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id, {}, null) });
    expect(res.status).toBe(200);
  });

  it('409 with the stored rev and save for a stale baseRev', async () => {
    const c = await setup();
    const id = newId();
    const stored = makeSave(id, { name: 'Stored' });
    await put(c, id, { baseRev: null, save: stored });
    const res = await put(c, id, { baseRev: null, save: makeSave(id, { name: 'Mine' }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ rev: 1, save: stored });
    const [row] = await rows(c);
    expect(row.name).toBe('Stored');
  });

  it('410 for a removed id', async () => {
    const c = await setup();
    const id = newId();
    await put(c, id, { baseRev: null, save: makeSave(id) });
    await DELETE(event(c, id, { method: 'DELETE', user: ANA, body: '{}' }));
    const res = await put(c, id, { baseRev: 1, save: makeSave(id) });
    expect(res.status).toBe(410);
    expect(await res.text()).toBe('');
  });

  it('422 too_many for a new id at the cap', async () => {
    const c = await setup();
    for (let i = 0; i < MAX_SAVES; i++) {
      const id = newId();
      expect((await put(c, id, { baseRev: null, save: makeSave(id) })).status).toBe(200);
    }
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'too_many' });
  });

  it('429 when the limiter refuses, with the key game_write:<identityId>', async () => {
    const c = await setup({ allow: 0 });
    const id = newId();
    const res = await put(c, id, { baseRev: null, save: makeSave(id) });
    expect(res.status).toBe(429);
    expect(await res.text()).toBe('');
    expect(c.limiter.calls).toEqual(['game_write:ana']);
    expect(await rows(c)).toHaveLength(0);
  });
});

describe('GET /api/game/[id]', () => {
  it('401 with no session', async () => {
    const c = await setup();
    const res = await GET(event(c, newId(), { method: 'GET', user: null }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it('404 for no row', async () => {
    const c = await setup();
    const res = await GET(event(c, newId(), { method: 'GET', user: ANA }));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  it('410 for a removed row', async () => {
    const c = await setup();
    const id = newId();
    await put(c, id, { baseRev: null, save: makeSave(id) });
    await DELETE(event(c, id, { method: 'DELETE', user: ANA, body: '{}' }));
    const res = await GET(event(c, id, { method: 'GET', user: ANA }));
    expect(res.status).toBe(410);
    expect(await res.text()).toBe('');
  });

  it('200 with rev and save', async () => {
    const c = await setup();
    const id = newId();
    const save = makeSave(id);
    await put(c, id, { baseRev: null, save });
    const res = await GET(event(c, id, { method: 'GET', user: ANA }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rev: 1, save });
  });

  it('does not read another account', async () => {
    const c = await setup({ seed: ['ana', 'bo'] });
    const id = newId();
    await put(c, id, { baseRev: null, save: makeSave(id) });
    const res = await GET(event(c, id, { method: 'GET', user: { id: 'bo', handle: 'bo' } }));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/game/[id]', () => {
  it('415 without a JSON content type', async () => {
    const c = await setup();
    const res = await DELETE(
      event(c, newId(), {
        method: 'DELETE',
        user: ANA,
        headers: { 'content-type': 'text/plain' },
        body: '{}'
      })
    );
    expect(res.status).toBe(415);
  });

  it('401 with no session', async () => {
    const c = await setup();
    const res = await DELETE(event(c, newId(), { method: 'DELETE', user: null, body: '{}' }));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
  });

  it('429 when the limiter refuses, and the row stays', async () => {
    const c = await setup({ allow: 1 });
    const id = newId();
    await put(c, id, { baseRev: null, save: makeSave(id) });
    const res = await DELETE(event(c, id, { method: 'DELETE', user: ANA, body: '{}' }));
    expect(res.status).toBe(429);
    expect(c.limiter.calls).toEqual(['game_write:ana', 'game_write:ana']);
    const [row] = await rows(c);
    expect(row.removedAt).toBeNull();
  });

  it('204 for a live id, which stays as a removed row', async () => {
    const c = await setup();
    const id = newId();
    await put(c, id, { baseRev: null, save: makeSave(id) });
    const res = await DELETE(event(c, id, { method: 'DELETE', user: ANA, body: '{}' }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    const [row] = await c.db.select().from(gameSave).where(eq(gameSave.id, id));
    expect(row.removedAt).not.toBeNull();
    expect(row.body).toBe('');
  });

  it('204 for a removed id and for an unknown id', async () => {
    const c = await setup();
    const id = newId();
    await put(c, id, { baseRev: null, save: makeSave(id) });
    await DELETE(event(c, id, { method: 'DELETE', user: ANA, body: '{}' }));
    expect((await DELETE(event(c, id, { method: 'DELETE', user: ANA, body: '{}' }))).status).toBe(
      204
    );
    expect(
      (await DELETE(event(c, newId(), { method: 'DELETE', user: ANA, body: '{}' }))).status
    ).toBe(204);
  });
});
