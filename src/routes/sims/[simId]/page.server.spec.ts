import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { simInvite } from '$lib/server/db/schema';
import { freshDb, makePlatform, seedUser } from '$lib/server/test/auth-db';

vi.mock('$lib/server/authz/require-sim-role', () => ({ requireSimRole: vi.fn() }));
vi.mock('$lib/server/sims/roster-hook', () => ({ onSimRosterChanged: vi.fn(async () => {}) }));

import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { createInvite } from '$lib/server/invites/control-plane';
import { addMemberById, getRole, getSimTitle } from '$lib/server/sims/sim-index';
import { createSim } from '$lib/server/sims/sims';
import { actions, load } from './+page.server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
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
  const { simId } = await createSim({ db, title: 'Garden', managerId: 'u-mia' });
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
    const r = await redirectOf(() => actions.leaveSim(leaveEvent(env, 'u-eddie')));
    expect(r).toMatchObject({ status: 303, location: '/sims' });
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

  it('the only member leaving deletes the sim and its pending invitations', async () => {
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

    expect(await getSimTitle({ db: env.db, simId: env.simId })).toBeNull();
    const pendingAfter = await env.db
      .select()
      .from(simInvite)
      .where(and(eq(simInvite.simId, env.simId), eq(simInvite.status, 'pending')));
    expect(pendingAfter).toEqual([]);
  });
});
