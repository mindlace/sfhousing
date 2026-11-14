import { describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/base58';
import type { User } from '$lib/server/user-store/user';
import { freshDb, seedUser, seedIdentity, grantEvent } from '$lib/server/test/auth-db';
import { APP_RESOURCE } from '$lib/server/authz';
import type { Capability } from '$lib/server/authz';
import {
  hasCapability,
  isBootstrapEmail,
  isOperator,
  requireCapability,
  requireOperator,
  resolveCapabilities,
  resolveCapsFor
} from './capabilities';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'id1',
    handle: 'handle',
    name: 'Name',
    email: 'user@example.com',
    image: null,
    emailVerified: true,
    pseudonymous: false,
    ...overrides
  };
}

const BOOTSTRAP_ALLOWLIST = 'bootstrap@example.com, other@x.com';

describe('isBootstrapEmail', () => {
  it('is true for a verified, non-anonymous allowlisted email (case-insensitive)', () => {
    expect(
      isBootstrapEmail(makeUser({ email: 'Bootstrap@Example.com' }), BOOTSTRAP_ALLOWLIST)
    ).toBe(true);
  });

  it('is false when email is not verified', () => {
    expect(
      isBootstrapEmail(
        makeUser({ email: 'bootstrap@example.com', emailVerified: false }),
        BOOTSTRAP_ALLOWLIST
      )
    ).toBe(false);
  });

  it('is false for a pseudonymous account even when its address is listed and verified', () => {
    expect(
      isBootstrapEmail(
        makeUser({ email: 'bootstrap@example.com', pseudonymous: true }),
        BOOTSTRAP_ALLOWLIST
      )
    ).toBe(false);
  });

  it('is false for an empty config', () => {
    expect(isBootstrapEmail(makeUser({ email: 'bootstrap@example.com' }), '')).toBe(false);
  });

  it('is false for an undefined config', () => {
    expect(isBootstrapEmail(makeUser({ email: 'bootstrap@example.com' }), undefined)).toBe(false);
  });
});

describe('resolveCapabilities', () => {
  it('returns exactly the wildcard for a bootstrap email with no DB rows', async () => {
    const { db } = freshDb();
    const caps = await resolveCapabilities(
      db,
      makeUser({ email: 'bootstrap@example.com' }),
      BOOTSTRAP_ALLOWLIST
    );
    expect(caps).toEqual([{ ability: '*', resource: { type: 'app', id: '*' } }]);
  });

  it('gives an unverified bootstrap address only its ledger grants', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'bootstrap@example.com' });
    const caps = await resolveCapabilities(
      db,
      makeUser({ email: 'bootstrap@example.com', emailVerified: false }),
      BOOTSTRAP_ALLOWLIST
    );
    expect(caps).toEqual([]);
  });

  it('folds grant events latest-wins per capability', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'plain@example.com' });
    await grantEvent(db, {
      identityId: 'id1',
      capability: 'cap.revoke',
      action: 'grant',
      at: new Date(1000)
    });
    await grantEvent(db, {
      identityId: 'id1',
      capability: 'cap.revoke',
      action: 'revoke',
      at: new Date(2000)
    });
    await grantEvent(db, {
      identityId: 'id1',
      capability: 'cap.grant',
      action: 'grant',
      at: new Date(1500)
    });
    const caps = await resolveCapabilities(db, makeUser({ email: 'plain@example.com' }), '');
    expect(caps.map((c) => c.ability).sort()).toEqual(['cap.grant']);
  });

  it('breaks createdAt ties by event id (higher UUIDv7 wins)', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'id1', email: 'plain@example.com' });
    const [lowId, highId] = [newId(), newId()].sort();
    const at = new Date(1000);
    await db.insert(schema.capabilityEvent).values([
      {
        id: lowId,
        principalId: 'id1',
        resourceType: 'app',
        resourceId: '*',
        ability: 'cap.grant',
        action: 'grant',
        caveats: null,
        parentId: null,
        actorId: null,
        createdAt: at
      },
      {
        id: highId,
        principalId: 'id1',
        resourceType: 'app',
        resourceId: '*',
        ability: 'cap.grant',
        action: 'revoke',
        caveats: null,
        parentId: null,
        actorId: null,
        createdAt: at
      }
    ]);
    const caps = await resolveCapabilities(db, makeUser({ email: 'plain@example.com' }), '');
    expect(caps.some((c) => c.ability === 'cap.grant')).toBe(false);
  });

  it('unions capabilities from a fused identity', async () => {
    const { db } = freshDb();
    await seedUser(db, { id: 'survivor', email: 'survivor@example.com' });
    await seedIdentity(db, { id: 'fused', supersededById: 'survivor' });
    await grantEvent(db, {
      identityId: 'survivor',
      capability: 'cap.grant',
      at: new Date(1000)
    });
    await grantEvent(db, { identityId: 'fused', capability: 'cap.revoke', at: new Date(1000) });
    const caps = await resolveCapabilities(
      db,
      makeUser({ id: 'survivor', email: 'survivor@example.com' }),
      ''
    );
    expect(caps.map((c) => c.ability).sort()).toEqual(['cap.grant', 'cap.revoke']);
  });
});

describe('hasCapability', () => {
  it('wildcard holds any capability', () => {
    expect(hasCapability([{ ability: '*', resource: APP_RESOURCE }], 'cap.revoke')).toBe(true);
  });

  it('an exact match holds the capability', () => {
    expect(hasCapability([{ ability: 'cap.grant', resource: APP_RESOURCE }], 'cap.grant')).toBe(
      true
    );
  });

  it('unrelated capabilities do not dominate', () => {
    expect(hasCapability([{ ability: 'cap.grant', resource: APP_RESOURCE }], 'cap.revoke')).toBe(
      false
    );
  });
});

describe('requireCapability', () => {
  it('throws 401 when there is no user', () => {
    expect(() => requireCapability({ capabilities: [], user: null }, 'cap.grant')).toThrow(
      expect.objectContaining({ status: 401 })
    );
  });

  it('throws 403 when the user lacks the capability', () => {
    const caps: Capability[] = [{ ability: 'cap.grant', resource: APP_RESOURCE }];
    expect(() => requireCapability({ capabilities: caps, user: makeUser() }, 'cap.revoke')).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });

  it('does not throw when the capability is held', () => {
    const caps: Capability[] = [{ ability: '*', resource: APP_RESOURCE }];
    expect(() =>
      requireCapability({ capabilities: caps, user: makeUser() }, 'cap.revoke')
    ).not.toThrow();
  });
});

describe('resolveCapsFor', () => {
  async function grant(
    db: Awaited<ReturnType<typeof freshDb>>['db'],
    o: {
      principalId: string;
      resourceType: 'app' | 'sim';
      resourceId: string;
      ability: string;
      action?: 'grant' | 'revoke';
      at?: Date;
    }
  ): Promise<void> {
    await db.insert(schema.capabilityEvent).values({
      id: newId(),
      principalId: o.principalId,
      resourceType: o.resourceType,
      resourceId: o.resourceId,
      ability: o.ability,
      action: o.action ?? 'grant',
      caveats: null,
      parentId: null,
      actorId: null,
      createdAt: o.at ?? new Date()
    });
  }

  // resolveCapsFor takes a principal set whose ids must exist in `principal` (FK).
  async function seedPrincipal(
    db: Awaited<ReturnType<typeof freshDb>>['db'],
    id: string
  ): Promise<void> {
    await db.insert(schema.principal).values({ id, kind: 'identity' }).onConflictDoNothing();
  }

  it('scoped fold returns a grant on the matching resource, keyed by ability', async () => {
    const { db } = freshDb();
    await seedPrincipal(db, 'pr-1');
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'sim',
      resourceId: 's1',
      ability: 'role.viewer'
    });
    const caps = await resolveCapsFor(db, ['pr-1'], { type: 'sim', id: 's1' });
    expect(caps).toEqual([{ ability: 'role.viewer', resource: { type: 'sim', id: 's1' } }]);
  });

  it('scoped fold ignores a different resource id', async () => {
    const { db } = freshDb();
    await seedPrincipal(db, 'pr-1');
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'sim',
      resourceId: 's1',
      ability: 'role.viewer'
    });
    const caps = await resolveCapsFor(db, ['pr-1'], { type: 'sim', id: 'OTHER' });
    expect(caps).toEqual([]);
  });

  it('unscoped fold returns grants across resources keyed by type+id+ability', async () => {
    const { db } = freshDb();
    await seedPrincipal(db, 'pr-1');
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'sim',
      resourceId: 's1',
      ability: 'role.viewer'
    });
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'app',
      resourceId: '*',
      ability: 'cap.grant'
    });
    const caps = await resolveCapsFor(db, ['pr-1']);
    expect(caps).toContainEqual({ ability: 'role.viewer', resource: { type: 'sim', id: 's1' } });
    expect(caps).toContainEqual({ ability: 'cap.grant', resource: { type: 'app', id: '*' } });
    expect(caps).toHaveLength(2);
  });

  it('revoke wins on an EQUAL createdAt tie (scoped)', async () => {
    const { db } = freshDb();
    await seedPrincipal(db, 'pr-1');
    const at = new Date(1000);
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'sim',
      resourceId: 's1',
      ability: 'role.viewer',
      action: 'grant',
      at
    });
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'sim',
      resourceId: 's1',
      ability: 'role.viewer',
      action: 'revoke',
      at
    });
    const caps = await resolveCapsFor(db, ['pr-1'], { type: 'sim', id: 's1' });
    expect(caps).toEqual([]);
  });

  it('a later revoke supersedes an earlier grant (unscoped)', async () => {
    const { db } = freshDb();
    await seedPrincipal(db, 'pr-1');
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'sim',
      resourceId: 's1',
      ability: 'role.viewer',
      action: 'grant',
      at: new Date(1000)
    });
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'sim',
      resourceId: 's1',
      ability: 'role.viewer',
      action: 'revoke',
      at: new Date(2000)
    });
    expect(await resolveCapsFor(db, ['pr-1'])).toEqual([]);
  });

  it('a principal not in the set contributes nothing', async () => {
    const { db } = freshDb();
    await seedPrincipal(db, 'pr-1');
    await seedPrincipal(db, 'pr-2');
    await grant(db, {
      principalId: 'pr-1',
      resourceType: 'sim',
      resourceId: 's1',
      ability: 'role.viewer'
    });
    expect(await resolveCapsFor(db, ['pr-2'], { type: 'sim', id: 's1' })).toEqual([]);
  });

  it('an empty principal set is empty', async () => {
    const { db } = freshDb();
    expect(await resolveCapsFor(db, [])).toEqual([]);
  });
});

describe('requireOperator', () => {
  const user = { id: 'u1' } as never;
  it('throws 401 when signed out', () => {
    expect(() => requireOperator({ capabilities: [], user: null })).toThrow(
      expect.objectContaining({ status: 401 })
    );
  });
  it('throws 403 for a signed-in non-operator', () => {
    expect(() => requireOperator({ capabilities: [], user })).toThrow(
      expect.objectContaining({ status: 403 })
    );
  });
  it('passes for any operator ability', () => {
    expect(() =>
      requireOperator({ capabilities: [{ ability: 'cap.grant', resource: APP_RESOURCE }], user })
    ).not.toThrow();
  });
});

describe('isOperator', () => {
  it('true for the bootstrap wildcard', () => {
    expect(isOperator([{ ability: '*', resource: APP_RESOURCE }])).toBe(true);
  });
  it('true for a single DB-granted operator ability', () => {
    expect(isOperator([{ ability: 'cap.revoke', resource: APP_RESOURCE }])).toBe(true);
  });
  it('false for an empty capability set', () => {
    expect(isOperator([])).toBe(false);
  });
  it('false for a non-operator (sim-scoped) capability', () => {
    expect(isOperator([{ ability: 'role.editor', resource: { type: 'sim', id: 's1' } }])).toBe(
      false
    );
  });
});
