// Seeding helpers for specs that need identities, users and ledger rows on a real
// migrated in-memory D1 (better-sqlite3, foreign keys on).
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '$lib/server/db/schema';
import { newId } from '$lib/server/ids/base58';
import type { Database } from '$lib/server/db';
import { skeleton } from '$lib/server/user-store/confusable-skeleton';
import { ROLE_BUNDLE } from '$lib/server/authz';
import { addSimRole } from '$lib/server/sims/sim-roles';
import { createTestD1, testPlatform } from './d1';

export function freshDb(): { db: Database; shim: D1Database; close(): void } {
  const t = createTestD1();
  const db = drizzle(t.d1, { schema });
  return { db, shim: t.d1, close: t.close };
}

/** An App.Platform whose `env.DB` is `shim`, plus any extra env keys. */
export function makePlatform(shim: D1Database, env: Record<string, unknown> = {}): App.Platform {
  return testPlatform({ ...(env as Partial<Env>), d1: shim });
}

/**
 * Seed a stable identity (`user_identity`) plus its single live `user` row. `opts.id`
 * is the stable identity id the rest of the app keys off; the live row id is `${opts.id}-live`.
 * `handle` defaults to the local part of the email.
 */
export async function seedUser(
  db: Database,
  opts: {
    id: string;
    email: string;
    name?: string;
    handle?: string;
    emailVerified?: boolean;
  }
): Promise<{ id: string; email: string }> {
  const now = new Date();
  await db.insert(schema.principal).values({ id: opts.id, kind: 'identity' });
  await db.insert(schema.userIdentity).values({ id: opts.id, createdAt: now });
  await db.insert(schema.user).values({
    id: `${opts.id}-live`,
    name: opts.name ?? opts.email,
    email: opts.email,
    emailVerified: opts.emailVerified ?? false,
    createdAt: now,
    updatedAt: now,
    userIdentity: opts.id,
    handle: opts.handle ?? opts.email.split('@')[0],
    handleSkeleton: skeleton(opts.handle ?? opts.email.split('@')[0])
  });
  return { id: opts.id, email: opts.email };
}

/**
 * Seed a bare `user_identity` row (no live `user` row). Pass `supersededById` to
 * model a FUSED identity (its access migrates lazily to the survivor).
 */
export async function seedIdentity(
  db: Database,
  opts: { id: string; supersededById?: string }
): Promise<{ id: string }> {
  const now = new Date();
  await db.insert(schema.principal).values({ id: opts.id, kind: 'identity' }).onConflictDoNothing();
  await db.insert(schema.userIdentity).values({
    id: opts.id,
    createdAt: now,
    supersededById: opts.supersededById ?? null,
    supersededAt: opts.supersededById ? now : null
  });
  return { id: opts.id };
}

/** Append a single app-scoped capability_event row. `at` controls the timestamp (for
 *  latest-wins fold tests); `action` defaults to 'grant'. `counter` sets
 *  `createdAtCounter` (default 0) so same-`at` seeded rows fold deterministically. */
export async function grantEvent(
  db: Database,
  opts: {
    identityId: string;
    capability: string;
    action?: 'grant' | 'revoke';
    at?: Date;
    actorId?: string | null;
    counter?: number;
  }
): Promise<void> {
  await db.insert(schema.capabilityEvent).values({
    id: newId(),
    principalId: opts.identityId,
    resourceType: 'app',
    resourceId: '*',
    ability: opts.capability,
    action: opts.action ?? 'grant',
    caveats: null,
    parentId: null,
    actorId: opts.actorId ?? null,
    createdAt: opts.at ?? new Date(),
    createdAtCounter: opts.counter ?? 0
  });
}

/**
 * Seed a sim managed by `managerId` and return its id: the index row, then the manager's grant
 * (no object binding, so no roster hook). `simId` is for tests only and is not checked by
 * `isValidId` (specs use literal ids such as `'q1'`); without it a fresh `newId()` is used.
 */
export async function seedSim(
  db: Database,
  args: { title: string; managerId: string; simId?: string }
): Promise<string> {
  const simId = args.simId ?? newId();
  const now = new Date();
  await db.insert(schema.simIndex).values({
    simId,
    title: args.title,
    createdAt: now,
    updatedAt: now
  });
  await addSimRole(db, simId, args.managerId, 'manager', args.managerId);
  return simId;
}

/**
 * Seed `count` sims managed by `managerId` in one `db.batch` (the index rows and one manager
 * grant each), for quota cases that need a thousand sims. Returns their ids.
 */
export async function seedManagedSims(
  db: Database,
  args: { managerId: string; count: number }
): Promise<string[]> {
  const now = new Date();
  const ids = Array.from({ length: args.count }, () => newId());
  const rows = ids.map((simId, i) => ({
    simId,
    title: `Sim ${i}`,
    createdAt: now,
    updatedAt: now
  }));
  const grants = ids.map((simId) => ({
    id: newId(),
    principalId: args.managerId,
    resourceType: 'sim',
    resourceId: simId,
    ability: ROLE_BUNDLE.manager,
    action: 'grant' as const,
    caveats: null,
    parentId: null,
    actorId: args.managerId,
    createdAt: now,
    createdAtCounter: 0
  }));
  const chunks = <T>(xs: T[], n: number): T[][] =>
    Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const [first, ...rest] = [
    ...chunks(rows, 100).map((c) => db.insert(schema.simIndex).values(c)),
    ...chunks(grants, 50).map((c) => db.insert(schema.capabilityEvent).values(c))
  ];
  await db.batch([first, ...rest]);
  return ids;
}
