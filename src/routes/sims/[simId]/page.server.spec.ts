import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { simInvite } from '$lib/server/db/schema';
import { freshDb, makePlatform, seedSim, seedUser } from '$lib/server/test/auth-db';

const flags = vi.hoisted(() => ({ dev: false }));
vi.mock('$app/environment', () => ({
  get dev() {
    return flags.dev;
  }
}));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$lib/server/authz/require-sim-role', () => ({ requireSimRole: vi.fn() }));
vi.mock('$lib/server/sims/roster-hook', () => ({ onSimRosterChanged: vi.fn(async () => {}) }));

import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { SIMS_COPY, SIM_TITLE_MAX, titleTooLong } from '$lib/members/copy';
import type { ServerAppend } from '$lib/server/sim-object/log-host';
import type { ServerAppendResult } from '$lib/server/sim-object/object-rules';
import { mockConsole } from '$lib/server/test/mock-console';
import { onSimRosterChanged } from '$lib/server/sims/roster-hook';
import { createInvite } from '$lib/server/invites/control-plane';
import { addMemberById, getRole, getSimTitle } from '$lib/server/sims/sim-index';
import { actions, load } from './+page.server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  flags.dev = false;
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.mocked(requireSimRole).mockReset();
});

async function seed() {
  const t = freshDb();
  opened.push(t.close);
  const { db, shim } = t;
  await seedUser(db, { id: 'u-mia', email: 'mia@test.com', handle: 'mia' });
  await seedUser(db, { id: 'u-eddie', email: 'eddie@test.com', handle: 'eddie' });
  await seedUser(db, { id: 'u-nora', email: 'nora@test.com', handle: 'nora' });
  const simId = await seedSim(db, { title: 'Garden', managerId: 'u-mia' });
  return { db, shim, simId };
}

function leaveEvent(
  env: { shim: D1Database; simId: string },
  userId: string | null,
  fields: Record<string, string> = {}
) {
  vi.mocked(requireSimRole).mockResolvedValue({
    role: 'viewer',
    actor: { actorId: userId ?? 'nobody', actorKind: 'human' }
  } as never);
  return {
    params: { simId: env.simId },
    platform: makePlatform(env.shim),
    locals: { user: userId ? { id: userId } : null, capabilities: [] },
    request: new Request('http://localhost/sims/x?/leaveSim', {
      method: 'POST',
      body: new URLSearchParams(fields)
    })
  } as never;
}

async function redirectOf(fn: () => unknown): Promise<{ status: number; location: string }> {
  try {
    await fn();
  } catch (e) {
    return e as { status: number; location: string };
  }
  throw new Error('expected a redirect');
}

describe('/sims/[simId] page load', () => {
  it('gates on the viewer role and returns no data of its own', async () => {
    const env = await seed();
    vi.mocked(requireSimRole).mockResolvedValue({ role: 'viewer', actor: {} } as never);
    const out = await load({ params: { simId: env.simId } } as never);
    expect(requireSimRole).toHaveBeenCalledWith(expect.anything(), env.simId, 'viewer');
    expect(out).toEqual({});
  });
});

describe('leaveSim action', () => {
  it('sends a signed-out visitor to /sims without touching the sim', async () => {
    const env = await seed();
    const r = await redirectOf(() => actions.leaveSim(leaveEvent(env, null)));
    expect(r).toMatchObject({ status: 303, location: '/sims' });
    expect(requireSimRole).not.toHaveBeenCalled();
  });

  it('gates on the viewer role: a refusal stops the leave', async () => {
    const env = await seed();
    vi.mocked(requireSimRole).mockRejectedValue({ status: 404 });
    const event = {
      params: { simId: env.simId },
      platform: makePlatform(env.shim),
      locals: { user: { id: 'u-nora' } },
      request: new Request('http://localhost/x', { method: 'POST', body: new URLSearchParams() })
    } as never;
    await expect(actions.leaveSim(event)).rejects.toMatchObject({ status: 404 });
  });

  it('answers 404 when the sim has no index row', async () => {
    const env = await seed();
    const res = await actions.leaveSim(leaveEvent({ ...env, simId: 'gone' }, 'u-mia'));
    expect(res).toMatchObject({ status: 404, data: { code: 'sim_not_found' } });
  });

  it('a plain member leaves and lands on /sims; the sim and the others stay', async () => {
    const env = await seed();
    await addMemberById({ db: env.db, simId: env.simId, userId: 'u-eddie', role: 'editor' });
    vi.mocked(onSimRosterChanged).mockClear();
    const event = leaveEvent(env, 'u-eddie');
    const r = await redirectOf(() => actions.leaveSim(event));
    expect(r).toMatchObject({ status: 303, location: '/sims' });
    // The request's env reaches the hook: without it the hook is a silent no-op.
    expect(onSimRosterChanged).toHaveBeenCalledWith(
      (event as { platform: App.Platform }).platform.env,
      env.simId
    );
    expect(await getRole({ db: env.db, simId: env.simId, userId: 'u-eddie' })).toBeNull();
    expect(await getRole({ db: env.db, simId: env.simId, userId: 'u-mia' })).toBe('manager');
    expect(await getSimTitle({ db: env.db, simId: env.simId })).toBe('Garden');
  });

  it('a manager leaving beside another manager must type the title, else 400', async () => {
    const env = await seed();
    await addMemberById({ db: env.db, simId: env.simId, userId: 'u-eddie', role: 'manager' });
    const bad = await actions.leaveSim(leaveEvent(env, 'u-mia', { confirmTitle: 'nope' }));
    expect(bad).toMatchObject({ status: 400, data: { code: 'title_mismatch' } });
    expect(bad).not.toHaveProperty('data.error');
    expect(await getRole({ db: env.db, simId: env.simId, userId: 'u-mia' })).toBe('manager');
    const ok = await redirectOf(() =>
      actions.leaveSim(leaveEvent(env, 'u-mia', { confirmTitle: 'Garden' }))
    );
    expect(ok.location).toBe('/sims');
    expect(await getRole({ db: env.db, simId: env.simId, userId: 'u-mia' })).toBeNull();
  });

  it('the last manager hands off to the chosen successor', async () => {
    const env = await seed();
    await addMemberById({ db: env.db, simId: env.simId, userId: 'u-eddie', role: 'editor' });
    await addMemberById({ db: env.db, simId: env.simId, userId: 'u-nora', role: 'viewer' });
    await redirectOf(() =>
      actions.leaveSim(leaveEvent(env, 'u-mia', { successorUserId: 'u-nora' }))
    );
    expect(await getRole({ db: env.db, simId: env.simId, userId: 'u-nora' })).toBe('manager');
    expect(await getRole({ db: env.db, simId: env.simId, userId: 'u-mia' })).toBeNull();
  });

  it('the only member leaving keeps the sim with no members and ends its pending invitations', async () => {
    const env = await seed();
    await createInvite({
      db: env.db,
      simId: env.simId,
      invitedByUserId: 'u-mia',
      target: { kind: 'handle', handle: 'nora' },
      canInviteByEmail: true
    });
    const pendingBefore = await env.db
      .select()
      .from(simInvite)
      .where(and(eq(simInvite.simId, env.simId), eq(simInvite.status, 'pending')));
    expect(pendingBefore).toHaveLength(1);

    const r = await redirectOf(() => actions.leaveSim(leaveEvent(env, 'u-mia')));
    expect(r).toMatchObject({ status: 303, location: '/sims' });

    expect(await getSimTitle({ db: env.db, simId: env.simId })).not.toBeNull();
    expect(await getRole({ db: env.db, simId: env.simId, userId: 'u-mia' })).toBeNull();
    const pendingAfter = await env.db
      .select()
      .from(simInvite)
      .where(and(eq(simInvite.simId, env.simId), eq(simInvite.status, 'pending')));
    expect(pendingAfter).toEqual([]);
  });
});

/** The real role check: the rename tests show the action's own gate, not a stand-in. */
const { requireSimRole: realRequireSimRole } = await vi.importActual<
  typeof import('$lib/server/authz/require-sim-role')
>('$lib/server/authz/require-sim-role');

const RENAME_ENV = {
  ENVIRONMENT: 'development',
  PUBLIC_DATASET_VERSION: 'fixture-0',
  PUBLIC_APP_RELEASE: 'test-build'
};

/** A stand-in `SIM` binding whose appendAs records its calls and answers `answer`. */
function fakeSim(answer: ServerAppendResult = { kind: 'accepted', seq: 2 }) {
  const calls: Array<{ name: string; input: Omit<ServerAppend, 'now'> }> = [];
  const SIM = {
    getByName: (name: string) => ({
      appendAs: async (input: Omit<ServerAppend, 'now'>) => {
        calls.push({ name, input });
        return answer;
      }
    })
  };
  return { SIM, calls };
}

function renameEvent(
  env: { shim: D1Database; simId: string },
  userId: string | null,
  fields: Record<string, string>,
  platformEnv: Record<string, unknown> = {}
) {
  vi.mocked(requireSimRole).mockImplementation(realRequireSimRole);
  return {
    params: { simId: env.simId },
    platform: makePlatform(env.shim, { ...RENAME_ENV, ...platformEnv }),
    locals: { user: userId ? { id: userId } : null, capabilities: [] },
    request: new Request(`http://localhost/sims/${env.simId}?/rename`, {
      method: 'POST',
      body: new URLSearchParams(fields)
    })
  } as never;
}

describe('rename action', () => {
  it('a manager appends a name commit as themself and is sent back to the page', async () => {
    const env = await seed();
    const { SIM, calls } = fakeSim();
    // An `actor` field in the form is ignored: the actor is the session's identity.
    const event = renameEvent(env, 'u-mia', { name: '  After  ', actor: 'u-eddie' }, { SIM });
    const r = await redirectOf(() => actions.rename(event));
    expect(r).toMatchObject({ status: 303, location: `/sims/${env.simId}` });
    expect(requireSimRole).toHaveBeenCalledWith(event, env.simId, 'editor');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe(env.simId);
    expect(calls[0].input.actor).toBe('u-mia');
    expect(calls[0].input.draft).toMatchObject({
      source: 'sim.name',
      build: 'test-build',
      changes: [{ op: 'set', key: 'sim', field: 'name', value: 'After' }]
    });
    expect(calls[0].input.start).toMatchObject({
      title: 'Garden',
      datasetVersion: 'fixture-0',
      build: 'test-build'
    });
    // The action writes no D1 row: the object's index pass copies the name.
    expect(await getSimTitle({ db: env.db, simId: env.simId })).toBe('Garden');
  });

  it('an editor may rename', async () => {
    const env = await seed();
    await addMemberById({ db: env.db, simId: env.simId, userId: 'u-eddie', role: 'editor' });
    const { SIM, calls } = fakeSim();
    const r = await redirectOf(() =>
      actions.rename(renameEvent(env, 'u-eddie', { name: 'After' }, { SIM }))
    );
    expect(r.status).toBe(303);
    expect(calls.map((c) => c.input.actor)).toEqual(['u-eddie']);
  });

  it('the role check refuses a viewer 403, a non-member 404, a visitor 401', async () => {
    const env = await seed();
    await addMemberById({ db: env.db, simId: env.simId, userId: 'u-nora', role: 'viewer' });
    const { SIM, calls } = fakeSim();
    await expect(
      actions.rename(renameEvent(env, 'u-nora', { name: 'After' }, { SIM }))
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      actions.rename(renameEvent(env, 'u-eddie', { name: 'After' }, { SIM }))
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      actions.rename(renameEvent(env, null, { name: 'After' }, { SIM }))
    ).rejects.toMatchObject({ status: 401 });
    expect(calls).toEqual([]);
  });

  // The one failure shape is `{ renameError }`, the key the page reads; a bad name re-wraps
  // checkSimTitle's line under it.
  it('a bad name is 400 with the title line under renameError, and nothing is sent', async () => {
    const env = await seed();
    const { SIM, calls } = fakeSim();
    const empty = await actions.rename(renameEvent(env, 'u-mia', { name: '   ' }, { SIM }));
    expect(empty).toMatchObject({ status: 400, data: { renameError: SIMS_COPY.titleRequired } });
    expect(Object.keys((empty as { data: object }).data)).toEqual(['renameError']);
    const long = await actions.rename(
      renameEvent(env, 'u-mia', { name: 'x'.repeat(SIM_TITLE_MAX + 1) }, { SIM })
    );
    expect(long).toMatchObject({
      status: 400,
      data: { renameError: titleTooLong(SIM_TITLE_MAX) }
    });
    const missing = await actions.rename(renameEvent(env, 'u-mia', {}, { SIM }));
    expect(missing).toMatchObject({ status: 400, data: { renameError: SIMS_COPY.titleRequired } });
    expect(calls).toEqual([]);
  });

  it('under dev, or without the object binding, renaming is unavailable: 503', async () => {
    const env = await seed();
    const { SIM, calls } = fakeSim();
    flags.dev = true;
    const inDev = await actions.rename(renameEvent(env, 'u-mia', { name: 'After' }, { SIM }));
    expect(inDev).toMatchObject({
      status: 503,
      data: { renameError: SIMS_COPY.renameUnavailable }
    });
    flags.dev = false;
    const unbound = await actions.rename(renameEvent(env, 'u-mia', { name: 'After' }));
    expect(unbound).toMatchObject({
      status: 503,
      data: { renameError: SIMS_COPY.renameUnavailable }
    });
    expect(calls).toEqual([]);
    expect(await getSimTitle({ db: env.db, simId: env.simId })).toBe('Garden');
  });

  it.each([
    ['limit', 429, SIMS_COPY.renameBusy],
    ['full', 409, SIMS_COPY.renameFull],
    ['gone', 404, SIMS_COPY.renameFailed],
    ['invalid', 500, SIMS_COPY.renameFailed],
    ['not-writer', 500, SIMS_COPY.renameFailed]
  ] as const)('a %s refusal is %i with its line, never the reason', async (why, status, line) => {
    const env = await seed();
    mockConsole('error');
    const { SIM } = fakeSim({ kind: 'refused', why });
    const out = await actions.rename(renameEvent(env, 'u-mia', { name: 'After' }, { SIM }));
    expect(out).toEqual(expect.objectContaining({ status, data: { renameError: line } }));
    expect(JSON.stringify(out)).not.toContain(`"${why}"`);
  });
});
