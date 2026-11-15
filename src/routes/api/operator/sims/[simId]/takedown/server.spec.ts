import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrizzleQueryError, eq } from 'drizzle-orm';

const flags = vi.hoisted(() => ({ dev: false }));
vi.mock('$app/environment', () => ({
  get dev() {
    return flags.dev;
  }
}));

import { simTakedown } from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/factory';
import { SIMS_COPY } from '$lib/members/copy';
import { createSim } from '$lib/server/sims/sims';
import { getSimTitle } from '$lib/server/sims/sim-index';
import { freshDb, makePlatform, seedSim, seedUser } from '$lib/server/test/auth-db';
import { mockConsole } from '$lib/server/test/mock-console';
import { POST } from './+server';

/** Obviously fake, and at least TOKEN_MIN characters. */
const TOKEN = 'test-takedown-token-0000000000000000';
const TITLE = 'Secret Garden';
const notFound = { error: 'Not found.' };

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  flags.dev = false;
  vi.restoreAllMocks();
});

async function setup(opts: { takeDown?: () => Promise<void> } = {}) {
  const t = freshDb();
  opened.push(t.close);
  await seedUser(t.db, { id: 'm1', email: 'm1@test.com' });
  const simId = await seedSim(t.db, { title: TITLE, managerId: 'm1' });
  const takeDowns: string[] = [];
  const SIM = {
    getByName: (name: string) => ({
      takeDown: async () => {
        takeDowns.push(name);
        await opts.takeDown?.();
      }
    })
  };
  const call = (
    args: {
      id?: string;
      headers?: Record<string, string | null>;
      env?: Record<string, unknown>;
      user?: { id: string } | null;
    } = {}
  ) => {
    const id = args.id ?? simId;
    const url = new URL(`http://localhost/api/operator/sims/${id}/takedown`);
    const headers = Object.fromEntries(
      Object.entries({
        'content-type': 'application/json',
        origin: 'http://localhost',
        authorization: `Bearer ${TOKEN}`,
        ...args.headers
      }).filter((e): e is [string, string] => e[1] !== null)
    );
    return POST({
      params: { simId: id },
      platform: makePlatform(t.shim, args.env ?? { SIM, SIM_TAKEDOWN_TOKEN: TOKEN }),
      locals: { user: args.user ?? null },
      request: new Request(url, { method: 'POST', headers, body: '{}' }),
      url
    } as never);
  };
  const marks = async () => (await t.db.select().from(simTakedown)).map((r) => r.simId);
  return { ...t, simId, SIM, takeDowns, call, marks };
}

describe('POST /api/operator/sims/[simId]/takedown', () => {
  it('415 without JSON, before the token is read', async () => {
    const { call, takeDowns, marks } = await setup();
    const res = await call({ headers: { 'content-type': 'text/plain' } });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: SIMS_COPY.jsonRequired });
    expect(takeDowns).toEqual([]);
    expect(await marks()).toEqual([]);
  });

  it('403 for a foreign Origin, even with the right token', async () => {
    const { call, takeDowns, marks } = await setup();
    const res = await call({ headers: { origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: SIMS_COPY.crossOrigin });
    expect(takeDowns).toEqual([]);
    expect(await marks()).toEqual([]);
  });

  it('404, with the same body, for every refused token and for an invalid id', async () => {
    const { db, simId, SIM, call, takeDowns, marks } = await setup();
    const cases = [
      call({ env: { SIM } }),
      call({ env: { SIM, SIM_TAKEDOWN_TOKEN: '' }, headers: { authorization: 'Bearer ' } }),
      call({
        env: { SIM, SIM_TAKEDOWN_TOKEN: TOKEN.slice(0, 31) },
        headers: { authorization: `Bearer ${TOKEN.slice(0, 31)}` }
      }),
      call({ headers: { authorization: 'Bearer wrong' } }),
      call({ headers: { authorization: `Bearer ${TOKEN}x` } }),
      call({ headers: { authorization: null } }),
      call({ headers: { authorization: `Basic ${TOKEN}` } }),
      call({ id: 'not-an-id' })
    ];
    for (const res of await Promise.all(cases)) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(notFound);
    }
    expect(takeDowns).toEqual([]);
    expect(await marks()).toEqual([]);
    expect(await getSimTitle({ db, simId })).toBe(TITLE);
  });

  it('a session never stands in for the token', async () => {
    const { db, simId, call, takeDowns } = await setup();
    const res = await call({ user: { id: 'm1' }, headers: { authorization: null } });
    expect(res.status).toBe(404);
    expect(takeDowns).toEqual([]);
    expect(await getSimTitle({ db, simId })).toBe(TITLE);
  });

  it('503 with no SIM binding, before anything is written', async () => {
    const { db, simId, call, marks } = await setup();
    const res = await call({ env: { SIM_TAKEDOWN_TOKEN: TOKEN } });
    expect(res.status).toBe(503);
    expect(await marks()).toEqual([]);
    expect(await getSimTitle({ db, simId })).toBe(TITLE);
  });

  it('503 under dev, before anything is written', async () => {
    const { db, simId, call, takeDowns, marks } = await setup();
    flags.dev = true;
    const res = await call();
    expect(res.status).toBe(503);
    expect(takeDowns).toEqual([]);
    expect(await marks()).toEqual([]);
    expect(await getSimTitle({ db, simId })).toBe(TITLE);
  });

  it('200 { simId } with the right token: the sim is gone and its id never registers', async () => {
    const { db, simId, call, takeDowns, marks } = await setup();
    const { error, log, warn } = mockConsole();
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ simId });
    expect(takeDowns).toEqual([simId]);
    expect(await marks()).toEqual([simId]);
    expect(await getSimTitle({ db, simId })).toBeNull();
    expect(await createSim({ db, env: {}, simId, title: 'Again', managerId: 'm1' })).toEqual({
      simId,
      created: false
    });
    // A takedown logs nothing.
    expect([error, log, warn].map((s) => s.mock.calls)).toEqual([[], [], []]);
  });

  it('200 for a valid id with no index row: the id is marked and its object cleared', async () => {
    const { call, takeDowns, marks } = await setup();
    const other = newId();
    const res = await call({ id: other });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ simId: other });
    expect(takeDowns).toEqual([other]);
    expect(await marks()).toEqual([other]);
  });

  it('a retry after a failure finishes the job', async () => {
    let fail = true;
    const { db, simId, call, takeDowns } = await setup({
      takeDown: async () => {
        if (fail) throw new Error('object busy');
      }
    });
    mockConsole('error');
    expect((await call()).status).toBe(500);
    expect(await getSimTitle({ db, simId })).toBe(TITLE);
    fail = false;
    const res = await call();
    expect(res.status).toBe(200);
    expect(takeDowns).toEqual([simId, simId]);
    expect(await getSimTitle({ db, simId })).toBeNull();
    expect(await db.select().from(simTakedown).where(eq(simTakedown.simId, simId))).toHaveLength(1);
  });

  it('500 when the takedown throws, logged with the sim id and loggable text only', async () => {
    const { simId, call } = await setup({
      takeDown: async () => {
        throw new DrizzleQueryError(`update sim_index set title = '${TITLE}'`, [TITLE]);
      }
    });
    const { error } = mockConsole('error');
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Takedown failed.' });
    expect(error.mock.calls).toEqual([['[takedown] failed', simId, '(query failed)']]);
    expect(JSON.stringify(error.mock.calls)).not.toContain(TITLE);
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain(TITLE);
  });
});
