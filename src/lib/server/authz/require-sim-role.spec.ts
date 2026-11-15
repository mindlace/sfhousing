import { describe, it, expect } from 'vitest';
import { freshDb, seedSim, seedUser, makePlatform } from '$lib/server/test/auth-db';
import { addMember } from '$lib/server/sims/sim-index';
import { requireSimRole } from './require-sim-role';

type EventArg = Parameters<typeof requireSimRole>[0];

function event(platform: App.Platform, user: { id: string; email: string } | null): EventArg {
  return { platform, locals: { user } } as unknown as EventArg;
}

async function httpStatus(fn: () => Promise<unknown>): Promise<number> {
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

describe('requireSimRole', () => {
  it('throws 401 when there is no signed-in user', async () => {
    const { shim } = freshDb();
    const platform = makePlatform(shim);
    expect(await httpStatus(() => requireSimRole(event(platform, null), 'q1', 'viewer'))).toBe(401);
  });

  it('tags the not-a-member 404 body with resource "sim"', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    const stranger = await seedUser(db, { id: 'stranger', email: 's@test.com' });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: manager.id });
    const { status, body } = await httpError(() =>
      requireSimRole(event(platform, stranger), 'q1', 'viewer')
    );
    expect(status).toBe(404);
    expect(body).toEqual({ message: 'not found', resource: 'sim' });
  });

  it('throws 403 when the member role is below the minimum', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    const viewer = await seedUser(db, { id: 'viewer', email: 'v@test.com' });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: manager.id });
    await addMember({ db, simId: 'q1', email: viewer.email, role: 'viewer' });
    expect(await httpStatus(() => requireSimRole(event(platform, viewer), 'q1', 'editor'))).toBe(
      403
    );
  });

  it('returns { role, actor } when the member meets the minimum', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: manager.id });
    const res = await requireSimRole(event(platform, manager), 'q1', 'editor');
    expect(res).toEqual({
      role: 'manager',
      actor: { actorId: 'manager', actorKind: 'human' }
    });
  });

  it('an editor satisfies both editor and viewer minimums (bundle dominance)', async () => {
    const { db, shim } = freshDb();
    const platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'm@test.com' });
    const editor = await seedUser(db, { id: 'editor', email: 'e@test.com' });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: manager.id });
    await addMember({ db, simId: 'q1', email: editor.email, role: 'editor' });
    expect(await requireSimRole(event(platform, editor), 'q1', 'editor')).toEqual({
      role: 'editor',
      actor: { actorId: 'editor', actorKind: 'human' }
    });
    expect(await requireSimRole(event(platform, editor), 'q1', 'viewer')).toEqual({
      role: 'editor',
      actor: { actorId: 'editor', actorKind: 'human' }
    });
  });
});
