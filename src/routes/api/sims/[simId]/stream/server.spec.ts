import { afterEach, describe, expect, it, vi } from 'vitest';

const flags = vi.hoisted(() => ({ dev: false, roleThrows: false }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({
  get dev() {
    return flags.dev;
  }
}));
vi.mock('$lib/server/sims/sim-index', async (orig) => {
  const m = await orig<typeof import('$lib/server/sims/sim-index')>();
  return {
    ...m,
    getRole: async (args: Parameters<typeof m.getRole>[0]) => {
      if (flags.roleThrows) throw new Error('D1 busy');
      return m.getRole(args);
    }
  };
});

import { freshDb, makePlatform, seedSim, seedUser } from '$lib/server/test/auth-db';
import { addMemberById, updateSimIndexTitle } from '$lib/server/sims/sim-index';
import { DEFAULT_SIM_NAME } from '$lib/sim-log';
import { newId } from '$lib/ids/base58';
import { OPEN_HEADER, parseOpenParams } from '$lib/server/sim-object/open-params';
import { SIMS_COPY } from '$lib/members/copy';
import { GET } from './+server';

const ENV = {
  ENVIRONMENT: 'development',
  PUBLIC_DATASET_VERSION: 'fixture-0',
  PUBLIC_APP_RELEASE: 'test-build'
};

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  flags.dev = false;
  flags.roleThrows = false;
});

async function setup() {
  const t = freshDb();
  opened.push(t.close);
  await seedUser(t.db, { id: 'm1', email: 'm1@test.com' });
  await seedUser(t.db, { id: 'v1', email: 'v1@test.com' });
  await seedUser(t.db, { id: 'o1', email: 'o1@test.com' });
  const simId = newId();
  await seedSim(t.db, { simId, title: 'Garden', managerId: 'm1' });
  await addMemberById({ db: t.db, simId, userId: 'v1', role: 'viewer' });
  const forwarded: Request[] = [];
  // Node cannot build a 101 Response; the stand-in object answers 200 and records the request.
  const SIM = {
    getByName: (name: string) => ({
      fetch: async (req: Request) => {
        expect(name).toBe(simId);
        forwarded.push(req);
        return new Response('upgraded', { status: 200 });
      }
    })
  };
  const call = (
    opts: {
      user?: string | null;
      headers?: Array<[string, string]>;
      id?: string;
      env?: Record<string, unknown>;
    } = {}
  ) => {
    const headers = new Headers({ upgrade: 'websocket', origin: 'http://localhost' });
    for (const [k, v] of opts.headers ?? []) {
      if (k === 'origin' || k === 'upgrade') headers.set(k, v);
      else headers.append(k, v);
    }
    const id = opts.id ?? simId;
    return GET({
      params: { simId: id },
      platform: makePlatform(t.shim, opts.env ?? { ...ENV, SIM }),
      locals: { user: opts.user ? { id: opts.user } : null },
      request: new Request(`http://localhost/api/sims/${id}/stream`, { headers }),
      url: new URL(`http://localhost/api/sims/${id}/stream`)
    } as never);
  };
  return { simId, forwarded, call, db: t.db };
}

describe('GET /api/sims/[simId]/stream', () => {
  it('answers 426 without a websocket upgrade', async () => {
    const { call } = await setup();
    expect((await call({ headers: [['upgrade', 'h2c']] })).status).toBe(426);
  });

  it('refuses a foreign Origin with 403', async () => {
    const { call, forwarded } = await setup();
    const res = await call({ headers: [['origin', 'https://evil.example']] });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: SIMS_COPY.crossOrigin });
    expect(forwarded).toHaveLength(0);
  });

  it('refuses an empty Origin, as the JSON routes do', async () => {
    const { call, forwarded } = await setup();
    const res = await call({ user: 'm1', headers: [['origin', '']] });
    expect(res.status).toBe(403);
    expect(forwarded).toHaveLength(0);
  });

  it('answers 404 for a malformed id and for a sim with no index row', async () => {
    const { call } = await setup();
    expect((await call({ id: 'not-an-id' })).status).toBe(404);
    expect((await call({ id: newId() })).status).toBe(404);
  });

  it('answers 503 where the object is not bound', async () => {
    const { call } = await setup();
    expect((await call({ env: ENV })).status).toBe(503);
  });

  it('answers 503 under npm run dev even where the object is bound', async () => {
    const { call, forwarded } = await setup();
    flags.dev = true;
    const res = await call({ user: 'm1' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.stringContaining('npm run preview') });
    expect(forwarded).toHaveLength(0);
  });

  it('forwards nothing when the role read throws', async () => {
    const { call, forwarded } = await setup();
    flags.roleThrows = true;
    await expect(call({ user: 'm1' })).rejects.toThrow('D1 busy');
    expect(forwarded).toHaveLength(0);
  });

  it.each<[string, string, string]>([
    ['padded', '  Garden  ', 'Garden'],
    ['too long', ' ' + 'x'.repeat(70), 'x'.repeat(63)],
    ['cut before a trailing space', 'y'.repeat(62) + ' z', 'y'.repeat(62)],
    ['cut inside an astral character', 'w'.repeat(62) + '😀', 'w'.repeat(62)],
    ['blank', '   ', DEFAULT_SIM_NAME]
  ])('sends a stored title that is %s as one the object accepts', async (_, stored, sent) => {
    const { call, forwarded, db, simId } = await setup();
    await updateSimIndexTitle({ db, simId, title: stored });
    await call({ user: 'm1' });
    expect(parseOpenParams(forwarded[0].headers.get(OPEN_HEADER))?.title).toBe(sent);
  });

  it('forwards a manager as a writer, stamping the open header', async () => {
    const { call, forwarded } = await setup();
    const res = await call({
      user: 'm1',
      headers: [[OPEN_HEADER, '{"identity":"x","write":true}']]
    });
    expect(res.status).toBe(200);
    expect(parseOpenParams(forwarded[0].headers.get(OPEN_HEADER))).toEqual({
      identity: 'm1',
      write: true,
      title: 'Garden',
      datasetVersion: 'fixture-0',
      build: 'test-build'
    });
    expect(forwarded[0].headers.get('upgrade')).toBe('websocket');
  });

  it('opens a viewer, a non-member and a signed-out visitor as readers', async () => {
    const { call, forwarded } = await setup();
    await call({ user: 'v1' });
    await call({ user: 'o1' });
    await call({ user: null });
    expect(forwarded.map((r) => parseOpenParams(r.headers.get(OPEN_HEADER)))).toEqual([
      expect.objectContaining({ identity: 'v1', write: false }),
      expect.objectContaining({ identity: 'o1', write: false }),
      expect.objectContaining({ identity: null, write: false })
    ]);
  });

  it('replaces a forged open header from a signed-out caller, in any casing and count', async () => {
    const { call, forwarded } = await setup();
    const forged =
      '{"identity":"m1","write":true,"title":"x","datasetVersion":"fixture-0","build":"b"}';
    await call({
      user: null,
      headers: [
        [OPEN_HEADER, forged],
        ['X-SFH-Sim-Open', forged],
        [OPEN_HEADER, forged]
      ]
    });
    const value = forwarded[0].headers.get(OPEN_HEADER)!;
    expect(value).not.toContain('m1');
    expect(parseOpenParams(value)).toEqual({
      identity: null,
      write: false,
      title: 'Garden',
      datasetVersion: 'fixture-0',
      build: 'test-build'
    });
  });

  it('gives a viewer who forges write no right to write', async () => {
    const { call, forwarded } = await setup();
    await call({ user: 'v1', headers: [[OPEN_HEADER, '{"identity":"v1","write":true}']] });
    expect(parseOpenParams(forwarded[0].headers.get(OPEN_HEADER))).toEqual(
      expect.objectContaining({ identity: 'v1', write: false })
    );
  });
});
