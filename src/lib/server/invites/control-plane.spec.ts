import { describe, it, expect, vi, afterEach } from 'vitest';

// A seam between an accept's claim and its grant: the grant (addMemberById) first runs
// `beforeGrant` when a test sets it, so a test can interleave a leave there. `failReconcile`
// makes the next reconcile throw. `beforeRoleRead` runs before the next role fold
// (foldSimRole) and `failRoleRead` makes it throw: a create's re-check of its inviter.
const seam = vi.hoisted(() => ({
  beforeGrant: null as null | (() => Promise<void>),
  failReconcile: false,
  beforeRoleRead: null as null | (() => Promise<void>),
  failRoleRead: false
}));
vi.mock('$lib/server/sims/sim-roles', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/server/sims/sim-roles')>();
  return {
    ...real,
    foldSimRole: async (
      ...args: Parameters<typeof real.foldSimRole>
    ): ReturnType<typeof real.foldSimRole> => {
      const run = seam.beforeRoleRead;
      seam.beforeRoleRead = null;
      if (run) await run();
      if (seam.failRoleRead) {
        seam.failRoleRead = false;
        throw new Error('role read boom');
      }
      return real.foldSimRole(...args);
    }
  };
});
vi.mock('$lib/server/sims/sim-index', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/server/sims/sim-index')>();
  return {
    ...real,
    addMemberById: async (args: Parameters<typeof real.addMemberById>[0]) => {
      const run = seam.beforeGrant;
      seam.beforeGrant = null;
      if (run) await run();
      return real.addMemberById(args);
    },
    reconcileSimManagement: async (
      ...args: Parameters<typeof real.reconcileSimManagement>
    ): ReturnType<typeof real.reconcileSimManagement> => {
      if (seam.failReconcile) {
        seam.failReconcile = false;
        throw new Error('reconcile boom');
      }
      return real.reconcileSimManagement(...args);
    }
  };
});

import { freshDb, seedSim, seedUser } from '$lib/server/test/auth-db';
import { mockConsole } from '$lib/server/test/mock-console';
import { eq } from 'drizzle-orm';
import { simInvite, user } from '$lib/server/db/schema';
import { addMemberById, getRole, listMembers, removeMembership } from '$lib/server/sims/sim-index';
import { leaveSim } from '$lib/server/sims/sims';
import { revokeSimRoles, setSimRole } from '$lib/server/sims/sim-roles';
import { generateInviteToken, hashToken } from '$lib/server/invites/token';
import { PSEUDONYMOUS_EMAIL_DOMAIN } from '$lib/server/auth/brand';
import {
  claimInvite,
  createInvite,
  INVITE_PENDING_CAP,
  listManagerPendingInvites,
  acceptInviteByToken,
  acceptInviteById,
  declineInvite,
  revokeInvite,
  resendInvite,
  listRecipientPendingInvites,
  findInviteByToken,
  parseInviteTarget,
  InviterRoleLostError
} from './control-plane';

afterEach(() => {
  seam.beforeGrant = null;
  seam.failReconcile = false;
  seam.beforeRoleRead = null;
  seam.failRoleRead = false;
  vi.restoreAllMocks();
});

async function setup() {
  const { db } = freshDb();
  const manager = await seedUser(db, { id: 'manager', email: 'manager@test.com' });
  await seedSim(db, { simId: 'q1', title: 'T', managerId: manager.id });
  return { db, manager };
}

describe('createInvite', () => {
  it('email invite to a brand-new email mints a hashed token', async () => {
    const { db, manager } = await setup();
    const res = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'New@Test.com' }
    });
    expect(res.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.invite.tokenHash).not.toBe(res.token);
    expect(res.invite.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.invite.invitedEmail).toBe('new@test.com');
    expect(res.invite.invitedUserId).toBeNull();
    expect(res.invite.role).toBe('editor');
    expect(res.invite.status).toBe('pending');
    expect(res.resolvedUser).toBeNull();
  });

  it('email invite to an existing account stamps the survivor id', async () => {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'jane' });
    const res = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'jane@test.com' }
    });
    expect(res.invite.invitedUserId).toBe('jane');
    expect(res.resolvedUser?.userId).toBe('jane');
    expect(res.invite.invitedEmail).toBe('jane@test.com');
  });

  it('handle invite to an existing user resolves the identity', async () => {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'jane' });
    const res = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'jane' }
    });
    expect(res.invite.invitedUserId).toBe('jane');
    expect(res.invite.invitedEmail).toBeNull();
    expect(res.resolvedUser?.userId).toBe('jane');
  });

  it('rejects an unknown handle', async () => {
    const { db, manager } = await setup();
    await expect(
      createInvite({
        db,
        simId: 'q1',
        invitedByUserId: manager.id,
        canInviteByEmail: true,
        target: { kind: 'handle', handle: 'ghost' }
      })
    ).rejects.toThrow(/no user/i);
  });

  it('resolves a canonically-equivalent handle (uppercase, @-prefixed, NFD)', async () => {
    const { db, manager } = await setup();
    // Stored canonical form: NFC, lowercase 'café' (U+0063 U+0061 U+0066 U+00E9).
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'café' });

    // parseInviteTarget strips '@', leaving uppercase 'CAFÉ' (U+0043 U+0041 U+0046 U+00C9).
    const upper = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: parseInviteTarget('@CAFÉ')
    });
    expect(upper.invite.invitedUserId).toBe('jane');
    expect(upper.resolvedUser?.userId).toBe('jane');

    // NFD-decomposed input (U+0063 U+0061 U+0066 U+0065 U+0301) on a second sim.
    await seedSim(db, { simId: 'q2', title: 'T2', managerId: manager.id });
    const nfd = await createInvite({
      db,
      simId: 'q2',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'café'.normalize('NFD') }
    });
    expect(nfd.invite.invitedUserId).toBe('jane');
    expect(nfd.resolvedUser?.userId).toBe('jane');
  });

  it('rejects a confusable look-alike handle (same skeleton, different canonical handle)', async () => {
    const { db, manager } = await setup();
    // Stored Latin handle 'oka' (U+006F U+006B U+0061).
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'oka' });
    // Confusable input: Cyrillic о (U+043E) + Latin k (U+006B) + Cyrillic а (U+0430).
    await expect(
      createInvite({
        db,
        simId: 'q1',
        invitedByUserId: manager.id,
        canInviteByEmail: true,
        target: { kind: 'handle', handle: 'оkа' }
      })
    ).rejects.toThrow(/no user/i);
  });

  it('rejects inviting an existing member', async () => {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'jane' });
    await addMemberById({ db, simId: 'q1', userId: 'jane', role: 'editor' });
    await expect(
      createInvite({
        db,
        simId: 'q1',
        invitedByUserId: manager.id,
        canInviteByEmail: true,
        target: { kind: 'handle', handle: 'jane' }
      })
    ).rejects.toThrow(/already a member/i);
  });

  it('rejects a duplicate pending invite to the same email', async () => {
    const { db, manager } = await setup();
    await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'dup@test.com' }
    });
    await expect(
      createInvite({
        db,
        simId: 'q1',
        invitedByUserId: manager.id,
        canInviteByEmail: true,
        target: { kind: 'email', email: 'dup@test.com' }
      })
    ).rejects.toThrow(/already invited/i);
  });

  it('rejects an email target when the inviter cannot invite by email', async () => {
    const { db, manager } = await setup();
    await expect(
      createInvite({
        db,
        simId: 'q1',
        invitedByUserId: manager.id,
        canInviteByEmail: false,
        target: { kind: 'email', email: 'stranger@test.com' }
      })
    ).rejects.toThrow(/verified account/i);
    const rows = await db.select().from(simInvite);
    expect(rows).toHaveLength(0);
  });

  it('still allows a handle target when the inviter cannot invite by email', async () => {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'jane' });
    const res = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: false,
      target: { kind: 'handle', handle: 'jane' }
    });
    expect(res.invite.invitedUserId).toBe('jane');
  });

  it('rejects a new invite once the sim is at the pending-invite cap', async () => {
    const { db, manager } = await setup();
    for (let i = 0; i < INVITE_PENDING_CAP; i++) {
      await createInvite({
        db,
        simId: 'q1',
        invitedByUserId: manager.id,
        canInviteByEmail: true,
        target: { kind: 'email', email: `pending${i}@test.com` }
      });
    }
    await expect(
      createInvite({
        db,
        simId: 'q1',
        invitedByUserId: manager.id,
        canInviteByEmail: true,
        target: { kind: 'email', email: 'overflow@test.com' }
      })
    ).rejects.toThrow(/too many pending invites/i);
  });
});

describe('listManagerPendingInvites', () => {
  it('lists display + invitedByEmail and sorts by display', async () => {
    const { db, manager } = await setup();
    // A user with NO live email (empty string) — handle invite yields invitedByEmail false.
    await seedUser(db, { id: 'noemail', email: '', handle: 'zed' });
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'jane' });

    await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'zed' }
    });
    await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'apple@test.com' }
    });
    await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'jane' }
    });

    const list = await listManagerPendingInvites({ db, simId: 'q1' });
    // sorted by display: '@zed' (handle has no email so display is '@zed'),
    // 'apple@test.com', 'jane@test.com' — '@' (0x40) sorts before letters via localeCompare?
    // localeCompare puts '@zed' last in many locales; assert via the map instead of order assumptions.
    const byId = new Map(list.map((r) => [r.display, r]));
    // Handle invite to a user with no live email → display '@zed', invitedByEmail false.
    expect(byId.get('@zed')?.invitedByEmail).toBe(false);
    // Email invite → display is the email, invitedByEmail true.
    expect(byId.get('apple@test.com')?.invitedByEmail).toBe(true);
    // Handle invite (invitedEmail null) → display is '@jane'; jane has a live email so
    // invitedByEmail is true.
    expect(byId.get('@jane')?.invitedByEmail).toBe(true);
    expect(list).toHaveLength(3);

    // Confirm it is sorted by display (localeCompare order).
    const displays = list.map((r) => r.display);
    const sorted = [...displays].sort((a, b) => a.localeCompare(b));
    expect(displays).toEqual(sorted);
  });

  it('omits expired invites', async () => {
    const { db, manager } = await setup();
    const past = new Date('2000-01-01T00:00:00Z');
    await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'old@test.com' },
      now: past
    });
    // Also confirm the row exists but is filtered out by expiry.
    expect(await listManagerPendingInvites({ db, simId: 'q1' })).toHaveLength(0);
    // Sanity: passing a `now` before expiry surfaces it.
    expect(await listManagerPendingInvites({ db, simId: 'q1', now: past })).toHaveLength(1);
  });
});

// The inviter's last leave can run after the route authorized them. A create re-reads the
// inviter's role after its insert, so no pending invitation survives on a sim nobody manages.
describe('createInvite re-checks its inviter after the insert', () => {
  const target = { kind: 'email', email: 'invitee@test.com' } as const;

  it('the inviter leaves after the insert: the row is gone and the create is refused', async () => {
    const { db, manager } = await setup();
    const atLeave: string[] = [];
    seam.beforeRoleRead = async () => {
      const rows = await db.select().from(simInvite).where(eq(simInvite.simId, 'q1'));
      atLeave.push(...rows.map((r) => r.status));
      await leaveSim({ db, env: undefined, simId: 'q1', userId: manager.id, simTitle: 'T' });
    };

    const create = createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target
    });
    await expect(create).rejects.toBeInstanceOf(InviterRoleLostError);
    await expect(create).rejects.toMatchObject({ role: null });

    // The leave ran after the insert, and no row survives it.
    expect(atLeave).toEqual(['pending']);
    expect(await db.select().from(simInvite).where(eq(simInvite.simId, 'q1'))).toEqual([]);
  });

  it('an inviter demoted after the insert is refused with the role read', async () => {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'co', email: 'co@test.com' });
    await addMemberById({ db, simId: 'q1', userId: 'co', role: 'manager' });
    seam.beforeRoleRead = () => setSimRole(db, 'q1', manager.id, 'editor', null);

    await expect(
      createInvite({ db, simId: 'q1', invitedByUserId: manager.id, canInviteByEmail: true, target })
    ).rejects.toMatchObject({ role: 'editor' });
    expect(await db.select().from(simInvite).where(eq(simInvite.simId, 'q1'))).toEqual([]);
  });

  it('the role still held: the invitation stands', async () => {
    const { db, manager } = await setup();
    const out = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target
    });
    const rows = await db.select().from(simInvite).where(eq(simInvite.simId, 'q1'));
    expect(rows.map((r) => [r.id, r.status])).toEqual([[out.invite.id, 'pending']]);
  });

  it('a role read that throws counts as no: refused, no row, logged with safe text', async () => {
    const { db, manager } = await setup();
    const { error } = mockConsole('error');
    seam.failRoleRead = true;

    await expect(
      createInvite({ db, simId: 'q1', invitedByUserId: manager.id, canInviteByEmail: true, target })
    ).rejects.toMatchObject({ role: null });

    expect(await db.select().from(simInvite).where(eq(simInvite.simId, 'q1'))).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      '[invite-create] role re-check failed',
      'q1',
      'role read boom'
    );
  });
});

describe('accept / decline / revoke', () => {
  async function setupInvite() {
    const { db, manager } = await setup();
    const res = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'invitee@test.com' }
    });
    return { db, manager, token: res.token, inviteId: res.invite.id };
  }

  it('accept by token adds the member and stamps the invite', async () => {
    const { db, token, inviteId } = await setupInvite();
    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });

    const result = await acceptInviteByToken({ db, token, userId: claimer.id });
    expect(result).toEqual({ simId: 'q1' });
    expect(await getRole({ db, simId: 'q1', userId: claimer.id })).toBe('editor');

    const [row] = await db.select().from(simInvite).where(eq(simInvite.id, inviteId));
    expect(row.status).toBe('accepted');
    expect(row.acceptedByUserId).toBe(claimer.id);
  });

  it('rejects accepting an expired invite', async () => {
    const { db, token, inviteId } = await setupInvite();
    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });
    await db
      .update(simInvite)
      .set({ expiresAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(simInvite.id, inviteId));

    await expect(acceptInviteByToken({ db, token, userId: claimer.id })).rejects.toThrow(
      /expired/i
    );
  });

  it('rejects a token that has already been used', async () => {
    const { db, token } = await setupInvite();
    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });
    await acceptInviteByToken({ db, token, userId: claimer.id });

    const other = await seedUser(db, { id: 'other', email: 'other@test.com' });
    await expect(acceptInviteByToken({ db, token, userId: other.id })).rejects.toThrow(
      /not found|not pending/i
    );
  });

  it('decline by the recipient marks it declined with no membership', async () => {
    const { db, inviteId } = await setupInvite();
    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });

    await declineInvite({ db, inviteId, userId: claimer.id });

    const [row] = await db.select().from(simInvite).where(eq(simInvite.id, inviteId));
    expect(row.status).toBe('declined');
    expect(await getRole({ db, simId: 'q1', userId: claimer.id })).toBeNull();
  });

  it('revoke by the manager blocks the same token from accepting', async () => {
    const { db, token, inviteId } = await setupInvite();

    await revokeInvite({ db, simId: 'q1', inviteId });
    const [row] = await db.select().from(simInvite).where(eq(simInvite.id, inviteId));
    expect(row.status).toBe('revoked');

    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });
    await expect(acceptInviteByToken({ db, token, userId: claimer.id })).rejects.toThrow(
      /not pending/i
    );
  });
});

// A kept sim must never end with an editor and no manager. The accept claims the invitation;
// the last member then leaves, which ends only pending invitations (this one is no longer
// pending); the accept then grants editor. The accept reconciles management after its grant,
// so the invitee becomes the sim's manager.
describe('an accept racing the last member leaving', () => {
  it('the leave lands between the claim and the grant: the invitee ends as manager', async () => {
    const { db, manager } = await setup();
    const { token, invite } = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'invitee@test.com' }
    });
    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });
    const statusAtLeave: string[] = [];
    seam.beforeGrant = async () => {
      const [row] = await db.select().from(simInvite).where(eq(simInvite.id, invite.id));
      statusAtLeave.push(row.status);
      await leaveSim({ db, env: undefined, simId: 'q1', userId: manager.id, simTitle: 'T' });
    };

    await expect(acceptInviteByToken({ db, token, userId: claimer.id })).resolves.toEqual({
      simId: 'q1'
    });

    // The leave ran after the claim, while the manager was still the one member.
    expect(statusAtLeave).toEqual(['accepted']);
    expect(await getRole({ db, simId: 'q1', userId: manager.id })).toBeNull();
    expect(await getRole({ db, simId: 'q1', userId: claimer.id })).toBe('manager');
    expect((await listMembers({ db, simId: 'q1' })).map((m) => m.userId)).toEqual([claimer.id]);
  });

  it('the same holds for an accept by id', async () => {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'jane' });
    const { invite } = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'jane' }
    });
    seam.beforeGrant = () =>
      leaveSim({ db, env: undefined, simId: 'q1', userId: manager.id, simTitle: 'T' });

    await acceptInviteById({
      db,
      inviteId: invite.id,
      userId: 'jane',
      email: 'jane@test.com',
      emailVerified: true
    });

    expect(await getRole({ db, simId: 'q1', userId: 'jane' })).toBe('manager');
    expect((await listMembers({ db, simId: 'q1' })).map((m) => m.userId)).toEqual(['jane']);
  });

  it('an invitation accepted after the last membership went, before its pending rows ended, is refused', async () => {
    const { db, manager } = await setup();
    const { token, invite } = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'invitee@test.com' }
    });
    // The leave's revoke is written; its ending of pending invitations has not run yet.
    await removeMembership(db, 'q1', manager.id);
    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });

    await expect(acceptInviteByToken({ db, token, userId: claimer.id })).rejects.toThrow(
      'invite not pending'
    );

    expect(await getRole({ db, simId: 'q1', userId: claimer.id })).toBeNull();
    expect(await listMembers({ db, simId: 'q1' })).toEqual([]);
    const [row] = await db.select().from(simInvite).where(eq(simInvite.id, invite.id));
    expect(row.status).toBe('pending');
  });

  it('a failed reconcile after the grant is logged, and the accept still succeeds', async () => {
    const { db, manager } = await setup();
    const { token } = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'invitee@test.com' }
    });
    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });
    const { error } = mockConsole('error');
    seam.failReconcile = true;

    await expect(acceptInviteByToken({ db, token, userId: claimer.id })).resolves.toEqual({
      simId: 'q1'
    });

    expect(await getRole({ db, simId: 'q1', userId: claimer.id })).toBe('editor');
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith('[invite-accept] reconcile failed', 'q1', 'reconcile boom');
  });
});

// A kept sim with no members is joinable by nobody: a pending invitation that outlived the last
// member (a failed delete, a cut account deletion) is refused like one that is not pending.
describe('a pending invitation on a sim with no members', () => {
  async function seedOrphanInvite() {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'jane' });
    // The last member's roles are gone; the invitation row was never ended.
    await revokeSimRoles(db, 'q1', manager.id);
    const token = generateInviteToken();
    const now = new Date();
    await db.insert(simInvite).values({
      id: 'orphan',
      simId: 'q1',
      role: 'editor',
      invitedEmail: 'jane@test.com',
      invitedUserId: 'jane',
      tokenHash: await hashToken(token),
      invitedByUserId: manager.id,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      lastSentAt: now
    });
    return { db, token };
  }

  async function expectUntouched(db: Awaited<ReturnType<typeof seedOrphanInvite>>['db']) {
    expect(await getRole({ db, simId: 'q1', userId: 'jane' })).toBeNull();
    expect(await listMembers({ db, simId: 'q1' })).toEqual([]);
    const [row] = await db.select().from(simInvite).where(eq(simInvite.id, 'orphan'));
    expect(row.status).toBe('pending');
    expect(row.acceptedByUserId).toBeNull();
  }

  it('cannot be accepted by token', async () => {
    const { db, token } = await seedOrphanInvite();
    await expect(acceptInviteByToken({ db, token, userId: 'jane' })).rejects.toThrow(
      'invite not pending'
    );
    await expectUntouched(db);
  });

  it('cannot be accepted by id', async () => {
    const { db } = await seedOrphanInvite();
    await expect(
      acceptInviteById({
        db,
        inviteId: 'orphan',
        userId: 'jane',
        email: 'jane@test.com',
        emailVerified: true
      })
    ).rejects.toThrow('invite not pending');
    await expectUntouched(db);
  });
});

describe('createInvite when its compensating delete fails', () => {
  it('is still refused as role lost, and the failure is logged with safe text', async () => {
    const { db, manager } = await setup();
    const { error } = mockConsole('error');
    seam.failRoleRead = true;
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'delete')
          return () => {
            throw new Error('delete boom');
          };
        return Reflect.get(target, prop, receiver);
      }
    }) as typeof db;

    const create = createInvite({
      db: failing,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'invitee@test.com' }
    });
    await expect(create).rejects.toBeInstanceOf(InviterRoleLostError);
    await expect(create).rejects.toMatchObject({ role: null });
    expect(error).toHaveBeenCalledWith(
      '[invite-create] compensating delete failed',
      'q1',
      'delete boom'
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain('invitee@test.com');
  });
});

describe('acceptInviteById', () => {
  async function setupHandleInvite() {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'jane', email: 'jane@test.com', handle: 'jane' });
    const res = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'jane' }
    });
    return { db, inviteId: res.invite.id };
  }

  it('accepts when invitedUserId is the caller (a)', async () => {
    const { db, inviteId } = await setupHandleInvite();
    const result = await acceptInviteById({
      db,
      inviteId,
      userId: 'jane',
      email: 'jane@test.com',
      emailVerified: true
    });
    expect(result).toEqual({ simId: 'q1' });
    expect(await getRole({ db, simId: 'q1', userId: 'jane' })).toBe('editor');
    const [row] = await db.select().from(simInvite).where(eq(simInvite.id, inviteId));
    expect(row.status).toBe('accepted');
    expect(row.acceptedByUserId).toBe('jane');
  });

  it('throws when invitedUserId is set but differs from the caller (b)', async () => {
    const { db, inviteId } = await setupHandleInvite();
    const other = await seedUser(db, { id: 'mallory', email: 'mallory@test.com' });
    await expect(
      acceptInviteById({
        db,
        inviteId,
        userId: other.id,
        email: 'mallory@test.com',
        emailVerified: true
      })
    ).rejects.toThrow(/not addressed to you/i);
    expect(await getRole({ db, simId: 'q1', userId: other.id })).toBeNull();
  });

  it('accepts an email-only invite when the caller has a matching verified email (c)', async () => {
    const { db, manager } = await setup();
    const res = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'new@test.com' }
    });
    expect(res.invite.invitedUserId).toBeNull();
    const claimer = await seedUser(db, { id: 'claimer', email: 'new@test.com' });
    await db
      .update(user)
      .set({ emailVerified: true })
      .where(eq(user.id, `${claimer.id}-live`));

    const result = await acceptInviteById({
      db,
      inviteId: res.invite.id,
      userId: claimer.id,
      email: 'New@Test.com',
      emailVerified: true
    });
    expect(result).toEqual({ simId: 'q1' });
    expect(await getRole({ db, simId: 'q1', userId: claimer.id })).toBe('editor');
  });

  it('throws on an email-only invite when the caller email does not match (d, security)', async () => {
    const { db, manager } = await setup();
    const res = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'target@test.com' }
    });
    expect(res.invite.invitedUserId).toBeNull();
    const mallory = await seedUser(db, { id: 'mallory', email: 'mallory@test.com' });

    // Wrong email, even if verified.
    await expect(
      acceptInviteById({
        db,
        inviteId: res.invite.id,
        userId: mallory.id,
        email: 'mallory@test.com',
        emailVerified: true
      })
    ).rejects.toThrow(/not addressed to you/i);

    // Right email but unverified — still blocked.
    await expect(
      acceptInviteById({
        db,
        inviteId: res.invite.id,
        userId: mallory.id,
        email: 'target@test.com',
        emailVerified: false
      })
    ).rejects.toThrow(/not addressed to you/i);

    expect(await getRole({ db, simId: 'q1', userId: mallory.id })).toBeNull();
  });

  it('reports lifecycle errors before the ownership check', async () => {
    const { db, inviteId } = await setupHandleInvite();
    await db
      .update(simInvite)
      .set({ expiresAt: new Date('2000-01-01T00:00:00Z') })
      .where(eq(simInvite.id, inviteId));
    // A non-manager caller on an expired invite should hear "expired", not an auth error.
    const other = await seedUser(db, { id: 'mallory', email: 'mallory@test.com' });
    await expect(
      acceptInviteById({
        db,
        inviteId,
        userId: other.id,
        email: 'mallory@test.com',
        emailVerified: true
      })
    ).rejects.toThrow(/expired/i);
  });
});

describe('resendInvite', () => {
  it('rotates the token and updates lastSentAt; old token no longer accepts', async () => {
    const { db, manager } = await setup();
    const created = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'invitee@test.com' },
      now: new Date('2026-06-01T00:00:00Z')
    });
    const oldToken = created.token;
    const oldHash = created.invite.tokenHash;

    const past = new Date('2026-06-01T00:02:00Z'); // +120s, past cooldown
    const res = await resendInvite({ db, simId: 'q1', inviteId: created.invite.id, now: past });
    expect(res.emailed).toBe(true);
    expect(typeof res.token).toBe('string');
    expect(res.token).not.toBe(oldToken);
    expect(res.invite?.tokenHash).not.toBe(oldHash);
    expect(res.invite?.lastSentAt?.getTime()).toBe(past.getTime());

    const claimer = await seedUser(db, { id: 'claimer', email: 'claimer@test.com' });
    await expect(acceptInviteByToken({ db, token: oldToken, userId: claimer.id })).rejects.toThrow(
      /not found|not pending/i
    );
  });

  it('is rate-limited within the cooldown window', async () => {
    const { db, manager } = await setup();
    const now = new Date('2026-06-01T00:00:00Z');
    const created = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'invitee@test.com' },
      now
    });
    await expect(
      resendInvite({ db, simId: 'q1', inviteId: created.invite.id, now })
    ).rejects.toThrow(/too soon|rate/i);
  });

  it('returns emailed:false when there is no email to send to', async () => {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'noemail', email: '', handle: 'zed' });
    const created = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'zed' },
      now: new Date('2026-06-01T00:00:00Z')
    });
    const res = await resendInvite({
      db,
      simId: 'q1',
      inviteId: created.invite.id,
      now: new Date('2026-06-01T00:02:00Z')
    });
    expect(res).toEqual({ emailed: false });
  });

  it('returns emailed:false for a pseudonymous invitee and keeps the token', async () => {
    const { db, manager } = await setup();
    await seedUser(db, {
      id: 'pseudo',
      email: `temp-x@${PSEUDONYMOUS_EMAIL_DOMAIN}`,
      handle: 'zed'
    });
    const created = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'zed' },
      now: new Date('2026-06-01T00:00:00Z')
    });
    const res = await resendInvite({
      db,
      simId: 'q1',
      inviteId: created.invite.id,
      now: new Date('2026-06-01T00:02:00Z')
    });
    expect(res).toEqual({ emailed: false });
    const [row] = await db.select().from(simInvite).where(eq(simInvite.id, created.invite.id));
    expect(row.tokenHash).toBe(created.invite.tokenHash);
  });
});

describe('a pending invite to a pseudonymous account, in the manager view', () => {
  it('is not marked as emailed, so Resend is not offered', async () => {
    const { db, manager } = await setup();
    await seedUser(db, {
      id: 'pseudo',
      email: `temp-x@${PSEUDONYMOUS_EMAIL_DOMAIN}`,
      handle: 'zed'
    });
    await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: false,
      target: { kind: 'handle', handle: 'zed' }
    });
    const [view] = await listManagerPendingInvites({ db, simId: 'q1' });
    expect(view.display).toBe('@zed');
    expect(view.invitedByEmail).toBe(false);
  });
});

describe('listRecipientPendingInvites', () => {
  it('matches by invitedUserId and by verified email; populates title + handle', async () => {
    const { db, manager } = await setup();
    await seedUser(db, { id: 'meId', email: 'me@x.com', handle: 'me' });
    // Email-only invite to an address with no account.
    await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'other@x.com' }
    });
    // Handle invite to identity meId.
    await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'handle', handle: 'me' }
    });
    // A second sim with an email invite to me@x.com (no account on that address path).
    await seedSim(db, { simId: 'q2', title: 'Second', managerId: manager.id });
    await createInvite({
      db,
      simId: 'q2',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'me@x.com' }
    });

    const list = await listRecipientPendingInvites({
      db,
      userId: 'meId',
      email: 'me@x.com',
      emailVerified: true
    });
    // The handle invite (invitedUserId=meId) + the email invite to me@x.com.
    // Note: the email invite to me@x.com resolved to meId at create time too, but both surface.
    const simIds = list.map((r) => r.simId).sort();
    expect(simIds).toContain('q1');
    expect(simIds).toContain('q2');
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const r of list) {
      expect(r.simTitle.length).toBeGreaterThan(0);
      expect(r.inviterHandle.length).toBeGreaterThan(0);
    }

    // Unverified email suppresses the email-only match.
    const unverified = await listRecipientPendingInvites({
      db,
      userId: 'nobody',
      email: 'other@x.com',
      emailVerified: false
    });
    expect(unverified).toHaveLength(0);
  });
});

describe('parseInviteTarget', () => {
  it('classifies emails and handles', () => {
    expect(parseInviteTarget('  Foo@Bar.com ')).toEqual({ kind: 'email', email: 'foo@bar.com' });
    expect(parseInviteTarget('@jane')).toEqual({ kind: 'handle', handle: 'jane' });
    expect(parseInviteTarget('jane')).toEqual({ kind: 'handle', handle: 'jane' });
  });
  it('rejects empty input', () => {
    expect(() => parseInviteTarget('   ')).toThrow(/required/i);
  });
});

describe('findInviteByToken', () => {
  it('returns title, handle, and invitedEmail for a live invite; null for bogus', async () => {
    const { db, manager } = await setup();
    const created = await createInvite({
      db,
      simId: 'q1',
      invitedByUserId: manager.id,
      canInviteByEmail: true,
      target: { kind: 'email', email: 'invitee@test.com' }
    });
    const found = await findInviteByToken({ db, token: created.token });
    expect(found).not.toBeNull();
    expect(found?.simId).toBe('q1');
    expect(found?.simTitle).toBe('T');
    expect(found?.inviterHandle).toBe('manager');
    expect(found?.invitedEmail).toBe('invitee@test.com');
    expect(found?.status).toBe('pending');
    expect(found?.expired).toBe(false);

    expect(await findInviteByToken({ db, token: 'bogustoken' })).toBeNull();
  });
});

describe('claimInvite', () => {
  it('claimInvite is single-use under concurrent claims', async () => {
    const { db, manager } = await setup();
    // Seed a user whose identity id is 'idA' (acceptedByUserId FK requires userIdentity row).
    await seedUser(db, { id: 'idA', email: 'idA@test.com' });
    // Insert a pending invite with a fixed id 'inv1' targeting simId 'q1'.
    await db.insert(simInvite).values({
      id: 'inv1',
      simId: 'q1',
      role: 'editor',
      invitedEmail: null,
      invitedUserId: null,
      tokenHash: 'fakehash1',
      invitedByUserId: manager.id,
      status: 'pending',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      lastSentAt: new Date()
    });

    const [a, b] = await Promise.all([
      claimInvite(db, 'inv1', 'idA'),
      claimInvite(db, 'inv1', 'idA')
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one wins
    const [row] = await db.select().from(simInvite).where(eq(simInvite.id, 'inv1'));
    expect(row.status).toBe('accepted');
  });
});
