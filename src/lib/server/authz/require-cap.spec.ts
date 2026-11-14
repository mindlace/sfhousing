import { describe, it, expect } from 'vitest';
import { freshDb, seedUser, makePlatform } from '$lib/server/test/auth-db';
import { createSimRecord, addMember } from '$lib/server/sims/sim-index';
import { ROLE_BUNDLE, APP_RESOURCE, type Capability } from '$lib/server/authz';
import type { ActorKind } from './actor';
import { requireCap } from './require-cap';

type EventArg = Parameters<typeof requireCap>[0];

function event(
  platform: App.Platform,
  user: { id: string; email: string } | null,
  capabilities: Capability[] = [],
  actorKind: ActorKind = 'human'
): EventArg {
  return { platform, locals: { user, capabilities, actorKind } } as unknown as EventArg;
}

async function status(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

async function httpError(fn: () => Promise<unknown>): Promise<{ status: number; body: unknown }> {
  try {
    await fn();
    return { status: 0, body: null };
  } catch (e) {
    return { status: (e as { status: number }).status, body: (e as { body: unknown }).body };
  }
}

describe('requireCap — sim resource (membership-only)', () => {
  it('401 when not signed in', async () => {
    const { shim } = freshDb();
    const platform = makePlatform(shim);
    expect(
      await status(() =>
        requireCap(event(platform, null), ROLE_BUNDLE.viewer, { type: 'sim', id: 'q1' })
      )
    ).toBe(401);
  });

  it('404 (resource:sim) when the principal is not a member', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    const stranger = await seedUser(db, { id: 'stranger', email: 's@test.com' });
    await createSimRecord({ db, simId: 'q1', title: 'T', managerId: manager.id });
    const { status: s, body } = await httpError(() =>
      requireCap(event(platform, stranger), ROLE_BUNDLE.viewer, { type: 'sim', id: 'q1' })
    );
    expect(s).toBe(404);
    expect(body).toEqual({ message: 'not found', resource: 'sim' });
  });

  it('403 when the member role is below the requested bundle', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    const viewer = await seedUser(db, { id: 'viewer', email: 'v@test.com' });
    await createSimRecord({ db, simId: 'q1', title: 'T', managerId: manager.id });
    await addMember({ db, simId: 'q1', email: viewer.email, role: 'viewer' });
    expect(
      await status(() =>
        requireCap(event(platform, viewer), ROLE_BUNDLE.editor, { type: 'sim', id: 'q1' })
      )
    ).toBe(403);
  });

  it('allows + returns the human actor when the member meets the bundle', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    await createSimRecord({ db, simId: 'q1', title: 'T', managerId: manager.id });
    const res = await requireCap(event(platform, manager), ROLE_BUNDLE.editor, {
      type: 'sim',
      id: 'q1'
    });
    expect(res.actor).toEqual({ actorId: 'manager', actorKind: 'human' });
  });

  it('stamps actorKind automation for a service principal', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const service = await seedUser(db, {
      id: 'service:support-autoclose',
      email: 'service@test.com'
    });
    await createSimRecord({ db, simId: 'q1', title: 'T', managerId: service.id });
    const res = await requireCap(event(platform, service, [], 'automation'), ROLE_BUNDLE.editor, {
      type: 'sim',
      id: 'q1'
    });
    expect(res.actor).toEqual({ actorId: 'service:support-autoclose', actorKind: 'automation' });
  });

  it('stamps actorKind human for a cookie user (default)', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager2', email: 'm2@test.com' });
    await createSimRecord({ db, simId: 'q2', title: 'T2', managerId: manager.id });
    const res = await requireCap(event(platform, manager, [], 'human'), ROLE_BUNDLE.editor, {
      type: 'sim',
      id: 'q2'
    });
    expect(res.actor.actorKind).toBe('human');
  });

  it('does NOT fold app caps into a sim check (membership-only)', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    const op = await seedUser(db, { id: 'op', email: 'op@test.com' });
    await createSimRecord({ db, simId: 'q1', title: 'T', managerId: manager.id });
    const caps: Capability[] = [{ ability: '*', resource: APP_RESOURCE }];
    expect(
      await status(() =>
        requireCap(event(platform, op, caps), ROLE_BUNDLE.viewer, { type: 'sim', id: 'q1' })
      )
    ).toBe(404);
  });
});

describe('requireCap — opts.caps short-circuit', () => {
  it('injected covering cap allows without folding membership', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const u = await seedUser(db, { id: 'u', email: 'u@test.com' });
    // q1 has no membership rows for u; the injected cap bypasses resolution entirely.
    const caps: Capability[] = [
      { ability: ROLE_BUNDLE.viewer, resource: { type: 'sim', id: 'q1' } }
    ];
    await expect(
      requireCap(event(platform, u), ROLE_BUNDLE.viewer, { type: 'sim', id: 'q1' }, { caps })
    ).resolves.toMatchObject({ actor: { actorId: 'u', actorKind: 'human' } });
  });

  it('injected empty caps for a sim resource → 404', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const u = await seedUser(db, { id: 'u', email: 'u@test.com' });
    expect(
      await status(() =>
        requireCap(event(platform, u), ROLE_BUNDLE.viewer, { type: 'sim', id: 'q1' }, { caps: [] })
      )
    ).toBe(404);
  });
});

describe('requireCap — app resource', () => {
  it('allows an operator holding the app ability', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const op = await seedUser(db, { id: 'op', email: 'op@test.com' });
    const caps: Capability[] = [{ ability: 'cap.grant', resource: APP_RESOURCE }];
    await expect(
      requireCap(event(platform, op, caps), 'cap.grant', APP_RESOURCE)
    ).resolves.toMatchObject({ actor: { actorId: 'op', actorKind: 'human' } });
  });

  it('403 (never 404) for an app ability the principal lacks', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const u = await seedUser(db, { id: 'u', email: 'u@test.com' });
    expect(await status(() => requireCap(event(platform, u, []), 'cap.grant', APP_RESOURCE))).toBe(
      403
    );
  });

  it('401 for an anonymous request to an app ability', async () => {
    const { shim } = freshDb();
    const platform = makePlatform(shim);
    expect(await status(() => requireCap(event(platform, null), 'cap.grant', APP_RESOURCE))).toBe(
      401
    );
  });
});

describe('requireCap — sim stays membership-only', () => {
  it('(c) a signed-in NON-member still 404s on a sim (membership-only, unchanged)', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    const stranger = await seedUser(db, { id: 'stranger', email: 's@test.com' });
    await createSimRecord({ db, simId: 'q1', title: 'T', managerId: manager.id });
    expect(
      await status(() =>
        requireCap(event(platform, stranger), ROLE_BUNDLE.viewer, { type: 'sim', id: 'q1' })
      )
    ).toBe(404);
  });
});
