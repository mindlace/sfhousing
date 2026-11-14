import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb, makePlatform, seedUser } from '$lib/server/test/auth-db';

vi.mock('$lib/server/authz/require-sim-role', () => ({ requireSimRole: vi.fn() }));
vi.mock('$lib/server/sims/roster-hook', () => ({ onSimRosterChanged: vi.fn(async () => {}) }));

import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { createInvite } from '$lib/server/invites/control-plane';
import { addMemberById } from '$lib/server/sims/sim-index';
import { createSim } from '$lib/server/sims/sims';
import { PSEUDONYMOUS_EMAIL_DOMAIN } from '$lib/server/auth/brand';
import { load } from './+layout.server';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
});
beforeEach(() => {
  vi.mocked(requireSimRole).mockReset();
});

type Wire = {
  simId: string;
  title: string;
  role: string;
  currentUserId: string | null;
  members: Record<string, unknown>[];
  pendingInvites: Record<string, unknown>[];
};

/** A sim with a manager (Mia), an editor (Eddie) and a viewer (Vera), all with real emails. */
async function seed() {
  const t = freshDb();
  opened.push(t.close);
  const { db, shim } = t;
  await seedUser(db, { id: 'u-mia', email: 'mia@private.test', handle: 'mia', name: 'Mia Real' });
  await seedUser(db, { id: 'u-eddie', email: 'eddie@private.test', handle: 'eddie' });
  await seedUser(db, { id: 'u-vera', email: 'vera@private.test', handle: 'vera' });
  const { simId } = await createSim({ db, title: 'Garden', managerId: 'u-mia' });
  await addMemberById({ db, simId, userId: 'u-eddie', role: 'editor' });
  await addMemberById({ db, simId, userId: 'u-vera', role: 'viewer' });
  return { db, shim, simId };
}

async function loadAs(
  env: { db: unknown; shim: D1Database; simId: string },
  userId: string,
  role: 'manager' | 'editor' | 'viewer'
): Promise<Wire> {
  vi.mocked(requireSimRole).mockResolvedValue({
    role,
    actor: { actorId: userId, actorKind: 'human' }
  } as never);
  const result = await load({
    params: { simId: env.simId },
    platform: makePlatform(env.shim),
    locals: { user: { id: userId }, capabilities: [] }
  } as never);
  return result as unknown as Wire;
}

describe('/sims/[simId] layout load', () => {
  it('propagates a requireSimRole refusal and reads nothing', async () => {
    const env = await seed();
    vi.mocked(requireSimRole).mockRejectedValue({ status: 404 });
    await expect(
      load({
        params: { simId: env.simId },
        platform: makePlatform(env.shim),
        locals: { user: null }
      } as never)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('gates on the viewer role for this sim', async () => {
    const env = await seed();
    await loadAs(env, 'u-vera', 'viewer');
    expect(requireSimRole).toHaveBeenCalledWith(expect.anything(), env.simId, 'viewer');
  });

  it('returns the title, the viewer role and the current user id', async () => {
    const env = await seed();
    const out = await loadAs(env, 'u-eddie', 'editor');
    expect(out).toMatchObject({
      simId: env.simId,
      title: 'Garden',
      role: 'editor',
      currentUserId: 'u-eddie'
    });
  });

  it('returns the roster ordered manager, editor, viewer as { userId, handle, role }', async () => {
    const env = await seed();
    const out = await loadAs(env, 'u-mia', 'manager');
    expect(out.members).toEqual([
      { userId: 'u-mia', handle: 'mia', role: 'manager' },
      { userId: 'u-eddie', handle: 'eddie', role: 'editor' },
      { userId: 'u-vera', handle: 'vera', role: 'viewer' }
    ]);
  });

  it('returns currentUserId null when there is no authenticated user', async () => {
    const env = await seed();
    vi.mocked(requireSimRole).mockResolvedValue({
      role: 'manager',
      actor: { actorId: 'u-mia', actorKind: 'human' }
    } as never);
    const result = (await load({
      params: { simId: env.simId },
      platform: makePlatform(env.shim),
      locals: { user: undefined, capabilities: [] }
    } as never)) as unknown as Wire;
    expect(result.currentUserId).toBeNull();
    expect(result.members).toHaveLength(3);
  });

  it('404s when the index has no row for the sim', async () => {
    const env = await seed();
    vi.mocked(requireSimRole).mockResolvedValue({
      role: 'manager',
      actor: { actorId: 'u-mia', actorKind: 'human' }
    } as never);
    await expect(
      load({
        params: { simId: 'no-such-sim' },
        platform: makePlatform(env.shim),
        locals: { user: { id: 'u-mia' }, capabilities: [] }
      } as never)
    ).rejects.toMatchObject({ status: 404 });
  });

  it('sends no member email, name or image to any role', async () => {
    const env = await seed();
    for (const [userId, role] of [
      ['u-mia', 'manager'],
      ['u-eddie', 'editor'],
      ['u-vera', 'viewer']
    ] as const) {
      const out = await loadAs(env, userId, role);
      for (const member of out.members) {
        expect(Object.keys(member).sort()).toEqual(['handle', 'role', 'userId']);
      }
      const wire = JSON.stringify(out);
      expect(wire).not.toContain('@private.test');
      expect(wire).not.toContain('Mia Real');
    }
  });

  describe('canInviteByEmail', () => {
    async function asManager(user: Record<string, unknown>) {
      const env = await seed();
      vi.mocked(requireSimRole).mockResolvedValue({
        role: 'manager',
        actor: { actorId: 'u-mia', actorKind: 'human' }
      } as never);
      return (await load({
        params: { simId: env.simId },
        platform: makePlatform(env.shim),
        locals: { user: { id: 'u-mia', ...user }, capabilities: [] }
      } as never)) as unknown as { canInviteByEmail: boolean };
    }

    it('is true for a manager with a confirmed, deliverable email', async () => {
      const out = await asManager({ email: 'mia@private.test', emailVerified: true });
      expect(out.canInviteByEmail).toBe(true);
    });

    it('is false for an unconfirmed email or a pseudonymous address', async () => {
      expect(
        (await asManager({ email: 'mia@private.test', emailVerified: false })).canInviteByEmail
      ).toBe(false);
      expect(
        (await asManager({ email: `x@${PSEUDONYMOUS_EMAIL_DOMAIN}`, emailVerified: true }))
          .canInviteByEmail
      ).toBe(false);
    });
  });

  describe('pending invitations', () => {
    async function withInvites() {
      const env = await seed();
      await createInvite({
        db: env.db as never,
        simId: env.simId,
        invitedByUserId: 'u-mia',
        target: { kind: 'email', email: 'Guest@Outside.test' },
        canInviteByEmail: true
      });
      return env;
    }

    it('gives a manager { id, display, invitedByEmail } and nothing else per invite', async () => {
      const env = await withInvites();
      const out = await loadAs(env, 'u-mia', 'manager');
      expect(out.pendingInvites).toEqual([
        { id: expect.any(String), display: 'guest@outside.test', invitedByEmail: true }
      ]);
    });

    it('gives an editor and a viewer none, and their wire never carries the invited address', async () => {
      const env = await withInvites();
      for (const [userId, role] of [
        ['u-eddie', 'editor'],
        ['u-vera', 'viewer']
      ] as const) {
        const out = await loadAs(env, userId, role);
        expect(out.pendingInvites).toEqual([]);
        expect(JSON.stringify(out)).not.toContain('outside.test');
      }
    });
  });
});
