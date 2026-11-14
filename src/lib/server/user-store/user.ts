import { eq, sql } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import { user, userIdentity } from '$lib/server/db/schema';
import { skeleton } from './confusable-skeleton';

export type User = {
  id: string; // STABLE identity id
  handle: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  pseudonymous: boolean;
};

const MAX_SURVIVOR_HOPS = 8;

/** Follow user_identity.supersededById to the live survivor identity. */
export async function survivorId(db: Database, identityId: string): Promise<string | null> {
  let id = identityId;
  for (let i = 0; i < MAX_SURVIVOR_HOPS; i++) {
    const rows = await db
      .select({ supersededById: userIdentity.supersededById })
      .from(userIdentity)
      .where(eq(userIdentity.id, id));
    if (rows.length === 0) return null;
    if (!rows[0].supersededById) return id;
    id = rows[0].supersededById;
  }
  throw new Error(
    `survivorId: superseded_by_id chain exceeded ${MAX_SURVIVOR_HOPS} hops from ${identityId}; possible cycle`
  );
}

/** A principal's survivor id plus every identity fused into it (single-hop) — the id
 *  set a ledger fold unions over so fused identities' grants are inherited. */
export async function principalUnion(db: Database, identityId: string): Promise<string[]> {
  const sid = (await survivorId(db, identityId)) ?? identityId;
  const fusedIn = await db
    .select({ id: userIdentity.id })
    .from(userIdentity)
    .where(eq(userIdentity.supersededById, sid));
  return [sid, ...fusedIn.map((r) => r.id)];
}

const liveFields = {
  handle: user.handle,
  name: user.name,
  email: user.email,
  image: user.image,
  emailVerified: user.emailVerified,
  pseudonymous: user.isAnonymous
};

function toUser(identityId: string, v: Omit<User, 'id'>): User {
  return { id: identityId, ...v };
}

/** The canonical User for an identity, following supersededById to the survivor. */
export async function getUser(db: Database, identityId: string): Promise<User | null> {
  const sid = await survivorId(db, identityId);
  if (!sid) return null;
  const rows = await db.select(liveFields).from(user).where(eq(user.userIdentity, sid));
  return rows[0] ? toUser(sid, rows[0]) : null;
}

/** Resolve a handle (with or without a leading `@`) to its canonical User via the
 *  confusable-skeleton index, following supersededById to the survivor. */
export async function getUserByHandle(db: Database, handle: string): Promise<User | null> {
  const normalized = handle.trim().replace(/^@/, '').trim();
  if (!normalized) return null;
  const rows = await db
    .select({ userIdentity: user.userIdentity })
    .from(user)
    .where(eq(user.handleSkeleton, skeleton(normalized)));
  if (!rows[0]) return null;
  return getUser(db, rows[0].userIdentity);
}

/** Resolve an email (case-insensitive, verified or not) to its canonical User,
 *  following supersededById to the survivor. Returns null for unknown/empty. */
export async function getUserByEmail(db: Database, email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const rows = await db
    .select({ userIdentity: user.userIdentity })
    .from(user)
    .where(sql`lower(${user.email}) = ${normalized}`);
  if (!rows[0]) return null;
  return getUser(db, rows[0].userIdentity);
}

/** Resolve an operator-typed identifier — either a handle or an email — to a User.
 *  Mirrors the sign-in input convention (`identifier` + `@`-detection): after a single
 *  leading `@` is stripped, a value containing `@` is an email, otherwise a handle. The
 *  handle branch keeps confusable-skeleton semantics via getUserByHandle. */
export async function resolveHandleOrEmailToUser(
  db: Database,
  identifier: string
): Promise<User | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  const withoutLeadingAt = trimmed.replace(/^@/, '');
  return withoutLeadingAt.includes('@')
    ? getUserByEmail(db, trimmed)
    : getUserByHandle(db, trimmed);
}

/** Batch-resolve identity ids to canonical Users, keyed by the REQUESTED id. */
export async function getUsers(db: Database, identityIds: string[]): Promise<Map<string, User>> {
  const out = new Map<string, User>();
  const unique = [...new Set(identityIds)];
  await Promise.all(
    unique.map(async (id) => {
      const u = await getUser(db, id);
      if (u) out.set(id, u);
    })
  );
  return out;
}

/** True iff the identity (resolved through its survivor) has been deleted (tombstoned).
 *  Unknown identity → false (the caller handles a missing user separately). */
export async function isDeletedIdentity(db: Database, identityId: string): Promise<boolean> {
  const sid = await survivorId(db, identityId);
  if (!sid) return false;
  const [row] = await db
    .select({ deletedAt: userIdentity.deletedAt })
    .from(userIdentity)
    .where(eq(userIdentity.id, sid));
  return !!row?.deletedAt;
}

/** Resolve a Better-Auth session user id (a live `user.id`) to its survivor User. */
export async function resolveSessionUser(db: Database, liveUserId: string): Promise<User | null> {
  const rows = await db
    .select({ userIdentity: user.userIdentity })
    .from(user)
    .where(eq(user.id, liveUserId));
  if (!rows[0]) return null;
  if (await isDeletedIdentity(db, rows[0].userIdentity)) return null;
  return getUser(db, rows[0].userIdentity);
}
