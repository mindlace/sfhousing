import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedSim, seedUser, makePlatform } from '$lib/server/test/auth-db';
import { addMember } from '$lib/server/sims/sim-index';
import { ROLE_BUNDLE, type Capability } from '$lib/server/authz';
import { requireCap } from '$lib/server/authz/require-cap';

type EventArg = Parameters<typeof requireCap>[0];
function event(
  platform: App.Platform,
  user: { id: string; email: string } | null,
  caps: Capability[] = []
): EventArg {
  return { platform, locals: { user, capabilities: caps } } as unknown as EventArg;
}
async function status(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status: number }).status;
  }
}

describe('enforcement parity — requireCap reproduces legacy 401/404/403', () => {
  let platform: App.Platform;
  let users: Record<string, { id: string; email: string }>;

  beforeEach(async () => {
    const { db, shim } = freshDb();
    platform = makePlatform(shim);
    const manager = await seedUser(db, { id: 'manager', email: 'manager@test.com' });
    const editor = await seedUser(db, { id: 'editor', email: 'editor@test.com' });
    const viewer = await seedUser(db, { id: 'viewer', email: 'viewer@test.com' });
    const stranger = await seedUser(db, { id: 'stranger', email: 'stranger@test.com' });
    await seedSim(db, { simId: 'q1', title: 'T', managerId: manager.id });
    await addMember({ db, simId: 'q1', email: editor.email, role: 'editor' });
    await addMember({ db, simId: 'q1', email: viewer.email, role: 'viewer' });
    users = { manager, editor, viewer, stranger };
  });

  // [who, minBundle, expectedStatus] — 0 means allowed.
  const SIM: Array<[string, string, number]> = [
    ['viewer', ROLE_BUNDLE.viewer, 0],
    ['viewer', ROLE_BUNDLE.editor, 403],
    ['editor', ROLE_BUNDLE.editor, 0],
    ['editor', ROLE_BUNDLE.manager, 403],
    ['manager', ROLE_BUNDLE.manager, 0],
    ['stranger', ROLE_BUNDLE.viewer, 404]
  ];

  it.each(SIM)('sim q1: %s requesting %s → %i', async (who, bundle, expected) => {
    expect(
      await status(() => requireCap(event(platform, users[who]), bundle, { type: 'sim', id: 'q1' }))
    ).toBe(expected);
  });
});
