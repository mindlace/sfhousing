import { describe, it, expect } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { freshDb, seedUser, seedIdentity } from '$lib/server/test/auth-db';
import { capabilityEvent, simIndex } from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/base58';
import {
  foldSimRole,
  foldSimMembers,
  foldSimsForUser,
  foldManagedSimCount,
  setSimRole,
  addSimRole,
  revokeSimRoles
} from './sim-roles';

const BUNDLE = { manager: 'role.manager', editor: 'role.editor', viewer: 'role.viewer' } as const;

async function seedSim(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  simId: string,
  title = 'Q'
): Promise<void> {
  const now = new Date();
  await db.insert(simIndex).values({ simId, title, createdAt: now, updatedAt: now });
}

/** Insert a raw role event with an explicit createdAt for latest-wins ordering tests.
 *  `createdAtCounter` (default 0) ensures same-`createdAt` rows fold deterministically. */
async function rawEvent(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  opts: {
    principalId: string;
    simId: string;
    ability: string;
    action: 'grant' | 'revoke';
    createdAt: Date;
    createdAtCounter?: number;
  }
): Promise<void> {
  await db.insert(capabilityEvent).values({
    id: newId(),
    principalId: opts.principalId,
    resourceType: 'sim',
    resourceId: opts.simId,
    ability: opts.ability,
    action: opts.action,
    caveats: null,
    parentId: null,
    actorId: null,
    createdAt: opts.createdAt,
    createdAtCounter: opts.createdAtCounter ?? 0
  });
}

async function bundleCount(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  simId: string,
  userId: string
): Promise<number> {
  const rows = await db
    .select({ id: capabilityEvent.id })
    .from(capabilityEvent)
    .where(and(eq(capabilityEvent.principalId, userId), eq(capabilityEvent.resourceId, simId)));
  return rows.length;
}

describe('foldSimRole', () => {
  it('returns the granted role', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'u1', 'editor');
    expect(await foldSimRole(db, 'q1', 'u1')).toBe('editor');
  });

  it('returns the highest bundle when a principal holds several', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    // grant editor and manager directly (both held) → manager wins
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.editor,
      action: 'grant',
      createdAt: new Date(1000)
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.manager,
      action: 'grant',
      createdAt: new Date(2000)
    });
    expect(await foldSimRole(db, 'q1', 'u1')).toBe('manager');
  });

  it('revoke removes a held bundle (latest revoke wins)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.editor,
      action: 'grant',
      createdAt: new Date(1000)
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.editor,
      action: 'revoke',
      createdAt: new Date(2000)
    });
    expect(await foldSimRole(db, 'q1', 'u1')).toBeNull();
  });

  it('latest-wins per bundle: grant → revoke → grant re-grants', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.viewer,
      action: 'grant',
      createdAt: new Date(1000)
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.viewer,
      action: 'revoke',
      createdAt: new Date(2000)
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.viewer,
      action: 'grant',
      createdAt: new Date(3000)
    });
    expect(await foldSimRole(db, 'q1', 'u1')).toBe('viewer');
  });

  it('inherits a grant made on a FUSED identity via the survivor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'survivor', email: 's@test.com' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'fused', 'manager');
    // The survivor inherits the fused identity's grant.
    expect(await foldSimRole(db, 'q1', 'survivor')).toBe('manager');
  });

  it('returns null for a deleted sim (no sim_index row)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    // no seedSim → no index row; still write a grant directly
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'gone',
      ability: BUNDLE.manager,
      action: 'grant',
      createdAt: new Date(1000)
    });
    expect(await foldSimRole(db, 'gone', 'u1')).toBeNull();
  });
});

describe('foldSimMembers', () => {
  it('returns the highest role plus a joinedAt', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.viewer,
      action: 'grant',
      createdAt: new Date(5000)
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.manager,
      action: 'grant',
      createdAt: new Date(7000)
    });
    const members = await foldSimMembers(db, 'q1');
    expect(members).toEqual([{ userId: 'u1', role: 'manager', joinedAt: 5000 }]);
  });

  it('collapses fused→survivor into one member (highest role, earliest joinedAt)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'survivor', email: 's@test.com' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    await seedSim(db, 'q1');
    // survivor was viewer (joined later); fused was manager (joined earlier)
    await rawEvent(db, {
      principalId: 'survivor',
      simId: 'q1',
      ability: BUNDLE.viewer,
      action: 'grant',
      createdAt: new Date(9000)
    });
    await rawEvent(db, {
      principalId: 'fused',
      simId: 'q1',
      ability: BUNDLE.manager,
      action: 'grant',
      createdAt: new Date(3000)
    });
    const members = await foldSimMembers(db, 'q1');
    expect(members).toEqual([{ userId: 'survivor', role: 'manager', joinedAt: 3000 }]);
  });

  it('returns [] for a deleted sim (no sim_index row)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'gone',
      ability: BUNDLE.manager,
      action: 'grant',
      createdAt: new Date(1000)
    });
    expect(await foldSimMembers(db, 'gone')).toEqual([]);
  });
});

describe('setSimRole', () => {
  it('is idempotent: writes no event when already exactly that role', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'u1', 'editor');
    const before = await bundleCount(db, 'q1', 'u1');
    await setSimRole(db, 'q1', 'u1', 'editor');
    expect(await bundleCount(db, 'q1', 'u1')).toBe(before);
  });

  it('grant target + revoke superseded bundle on a change (editor→manager)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'u1', 'editor');
    await setSimRole(db, 'q1', 'u1', 'manager');
    expect(await foldSimRole(db, 'q1', 'u1')).toBe('manager');
    // the editor grant must be revoked, not left held
    const rows = await db
      .select({
        ability: capabilityEvent.ability,
        action: capabilityEvent.action
      })
      .from(capabilityEvent)
      .where(eq(capabilityEvent.principalId, 'u1'));
    expect(rows).toContainEqual({ ability: BUNDLE.manager, action: 'grant' });
    expect(rows).toContainEqual({ ability: BUNDLE.editor, action: 'revoke' });
  });
});

describe('addSimRole', () => {
  it('grants and returns {added:true} when no role is held', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    const res = await addSimRole(db, 'q1', 'u1', 'viewer');
    expect(res).toEqual({ added: true });
    expect(await foldSimRole(db, 'q1', 'u1')).toBe('viewer');
  });

  it('returns {added:false} and writes no event when any role is already held', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'u1', 'editor');
    const before = await bundleCount(db, 'q1', 'u1');
    const res = await addSimRole(db, 'q1', 'u1', 'manager');
    expect(res).toEqual({ added: false });
    expect(await bundleCount(db, 'q1', 'u1')).toBe(before);
    expect(await foldSimRole(db, 'q1', 'u1')).toBe('editor');
  });
});

describe('revokeSimRoles', () => {
  it('clears every held bundle', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    // hold two bundles at once
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.viewer,
      action: 'grant',
      createdAt: new Date(1000)
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.manager,
      action: 'grant',
      createdAt: new Date(2000)
    });
    await revokeSimRoles(db, 'q1', 'u1');
    expect(await foldSimRole(db, 'q1', 'u1')).toBeNull();
  });

  it('writes no event when nothing is held', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await revokeSimRoles(db, 'q1', 'u1');
    expect(await bundleCount(db, 'q1', 'u1')).toBe(0);
  });
});

describe('foldSimsForUser', () => {
  it('returns each sim with the highest role + index title', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1', 'First');
    await seedSim(db, 'q2', 'Second');
    await setSimRole(db, 'q1', 'u1', 'manager');
    await setSimRole(db, 'q2', 'u1', 'viewer');
    const out = await foldSimsForUser(db, 'u1');
    expect(out).toContainEqual({ simId: 'q1', title: 'First', role: 'manager' });
    expect(out).toContainEqual({ simId: 'q2', title: 'Second', role: 'viewer' });
    expect(out).toHaveLength(2);
  });

  it('inherits fused identity grants via the survivor', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'survivor', email: 's@test.com' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    await seedSim(db, 'q1', 'Shared');
    await setSimRole(db, 'q1', 'fused', 'editor');
    const out = await foldSimsForUser(db, 'survivor');
    expect(out).toEqual([{ simId: 'q1', title: 'Shared', role: 'editor' }]);
  });
});

describe('foldManagedSimCount', () => {
  it('counts only manager-role sims', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    await seedSim(db, 'q2');
    await seedSim(db, 'q3');
    await setSimRole(db, 'q1', 'u1', 'manager');
    await setSimRole(db, 'q2', 'u1', 'manager');
    await setSimRole(db, 'q3', 'u1', 'editor');
    expect(await foldManagedSimCount(db, 'u1')).toBe(2);
  });
});

// L7a — fold tie-break ordering. Base58(uuidv7) ids are NOT lexicographically
// time-monotonic, so the fold must not rely on `id` order to break a same-ms tie.
// Two guards: (1) no single writer CALL co-emits grant+revoke of the same ability
// in its one insert batch (the invariant the fold's correctness rests on); (2) even
// when two SEPARATE rapid calls collide a grant+revoke of one bundle on the same
// createdAt, the fold folds to revoke (fail-safe / least-privilege), independent of
// id order.
describe('capability fold tie-break (L7a)', () => {
  it('INVARIANT: a single setSimRole call never co-emits grant+revoke of the SAME ability', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    // Seed two held bundles at OLD timestamps so the events from the call under test
    // are isolable by createdAt.
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.viewer,
      action: 'grant',
      createdAt: new Date(1000)
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.editor,
      action: 'grant',
      createdAt: new Date(2000)
    });

    // ONE call that produces both a grant (manager) and revokes (viewer, editor).
    await setSimRole(db, 'q1', 'u1', 'manager');

    // Inspect only this call's events (createdAt newer than the seeds). No ability
    // appears with BOTH a grant and a revoke within the single insert batch.
    const rows = (
      await db
        .select({
          ability: capabilityEvent.ability,
          action: capabilityEvent.action,
          createdAt: capabilityEvent.createdAt
        })
        .from(capabilityEvent)
        .where(eq(capabilityEvent.principalId, 'u1'))
    ).filter((r) => r.createdAt.getTime() > 2000);

    const byAbility = new Map<string, Set<string>>();
    for (const r of rows) {
      const actions = byAbility.get(r.ability) ?? new Set<string>();
      actions.add(r.action);
      byAbility.set(r.ability, actions);
    }
    for (const [ability, actions] of byAbility)
      expect(actions, `co-emit on ${ability}`).not.toEqual(new Set(['grant', 'revoke']));
    // And the call did its job: manager granted, the two prior bundles revoked.
    expect(byAbility.get(BUNDLE.manager)).toEqual(new Set(['grant']));
    expect(byAbility.get(BUNDLE.viewer)).toEqual(new Set(['revoke']));
    expect(byAbility.get(BUNDLE.editor)).toEqual(new Set(['revoke']));
  });

  it('a rapid add→set→revoke sequence folds correctly even when calls share a millisecond', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    // These four calls run sub-millisecond apart, so e.g. the viewer grant and the
    // viewer revoke can land on the SAME createdAt — the exact L7a tie. revoke-wins
    // makes the final fold deterministically null regardless of id order.
    await addSimRole(db, 'q1', 'u1', 'viewer');
    await setSimRole(db, 'q1', 'u1', 'editor');
    await setSimRole(db, 'q1', 'u1', 'manager');
    await revokeSimRoles(db, 'q1', 'u1');
    expect(await foldSimRole(db, 'q1', 'u1')).toBeNull();
    expect(await foldSimMembers(db, 'q1')).toEqual([]);
  });

  it('FAIL-SAFE: a same-createdAt grant+revoke of one bundle folds to revoke (no role)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    const sameInstant = new Date(1000);
    // Insert grant first, then revoke — but at the SAME createdAt. The asc(id)
    // secondary sort is base58-id order (non-monotonic), so the outcome must come
    // from the revoke-wins tie-break, not from row order.
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.manager,
      action: 'grant',
      createdAt: sameInstant
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.manager,
      action: 'revoke',
      createdAt: sameInstant
    });
    expect(await foldSimRole(db, 'q1', 'u1')).toBeNull();
    expect(await foldSimMembers(db, 'q1')).toEqual([]);
  });

  it('FAIL-SAFE holds regardless of insertion order (revoke before grant, same instant)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'u1', email: 'u1@test.com' });
    await seedSim(db, 'q1');
    const sameInstant = new Date(1000);
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.manager,
      action: 'revoke',
      createdAt: sameInstant
    });
    await rawEvent(db, {
      principalId: 'u1',
      simId: 'q1',
      ability: BUNDLE.manager,
      action: 'grant',
      createdAt: sameInstant
    });
    expect(await foldSimRole(db, 'q1', 'u1')).toBeNull();
  });
});

describe('writes across a fused principal', () => {
  it('revokeSimRoles on the survivor revokes a bundle held by a fused identity', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'survivor', email: 's@test.com' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'fused', 'manager');
    await revokeSimRoles(db, 'q1', 'survivor');
    expect(await foldSimRole(db, 'q1', 'survivor')).toBeNull();
    const rows = await db
      .select({ ability: capabilityEvent.ability, action: capabilityEvent.action })
      .from(capabilityEvent)
      .where(eq(capabilityEvent.principalId, 'fused'));
    expect(rows).toContainEqual({ ability: BUNDLE.manager, action: 'revoke' });
  });

  it('setSimRole on the survivor demotes a role held by a fused identity', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'survivor', email: 's@test.com' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'fused', 'manager');
    await setSimRole(db, 'q1', 'survivor', 'editor');
    expect(await foldSimRole(db, 'q1', 'survivor')).toBe('editor');
  });

  it('setSimRole writes no event when a fused identity already holds exactly that role', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'survivor', email: 's@test.com' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'fused', 'editor');
    await setSimRole(db, 'q1', 'survivor', 'editor');
    expect(await bundleCount(db, 'q1', 'survivor')).toBe(0);
    expect(await foldSimRole(db, 'q1', 'survivor')).toBe('editor');
  });

  it('addSimRole adds nothing when a fused identity already holds a role', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'survivor', email: 's@test.com' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    await seedSim(db, 'q1');
    await setSimRole(db, 'q1', 'fused', 'viewer');
    expect(await addSimRole(db, 'q1', 'survivor', 'manager')).toEqual({ added: false });
    expect(await foldSimRole(db, 'q1', 'survivor')).toBe('viewer');
  });
});
