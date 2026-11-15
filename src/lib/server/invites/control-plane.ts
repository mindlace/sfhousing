import { and, eq, gt } from 'drizzle-orm';
import type { Database } from '$lib/server/db';
import {
  simInvite,
  simIndex,
  user,
  type SimInvite,
  type InviteStatus,
  type SimMemberRole
} from '$lib/server/db/schema';
import { getUsers, survivorId } from '$lib/server/user-store/user';
import { normalizeHandle } from '$lib/server/user-store/handle-normalize';
import { newId } from '$lib/server/ids/base58';
import { generateInviteToken, hashToken } from '$lib/server/invites/token';
import { addMemberById, reconcileSimManagement } from '$lib/server/sims/sim-index';
import { loggable } from '$lib/server/sim-object/object-rules';
import { foldSimRole } from '$lib/server/sims/sim-roles';
import { isDeliverable } from '$lib/server/email/provider';
import { MEMBERS_COPY } from '$lib/members/copy';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Max non-expired pending invites a single sim may hold at once (anti-spam). */
export const INVITE_PENDING_CAP = 50;

export type InviteTarget = { kind: 'email'; email: string } | { kind: 'handle'; handle: string };

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Classify free-text invite input as an email or a handle. */
export function parseInviteTarget(raw: string): InviteTarget {
  const s = raw.trim();
  if (!s) throw new Error('invite target required');
  if (EMAIL_RE.test(s)) return { kind: 'email', email: s.toLowerCase() };
  return { kind: 'handle', handle: s.replace(/^@/, '') };
}
export type CreatedInvite = {
  invite: SimInvite;
  token: string;
  resolvedUser: { userId: string; email: string; emailVerified: boolean } | null;
};
export type ManagerPendingInvite = {
  id: string;
  display: string;
  invitedByEmail: boolean;
  createdAt: Date;
  expiresAt: Date;
};

async function resolveHandle(db: Database, handle: string) {
  // Match the stored canonical handle (NFC + case-folded), NOT the skeleton — a
  // confusable look-alike must not resolve to someone else's account.
  const normalized = normalizeHandle(handle);
  const rows = await db
    .select({
      userIdentity: user.userIdentity,
      email: user.email,
      emailVerified: user.emailVerified
    })
    .from(user)
    .where(eq(user.handle, normalized));
  if (!rows[0]) return null;
  const sid = await survivorId(db, rows[0].userIdentity);
  if (!sid) return null;
  return { userId: sid, email: rows[0].email, emailVerified: rows[0].emailVerified };
}

async function resolveEmail(db: Database, email: string) {
  const rows = await db
    .select({ userIdentity: user.userIdentity, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email));
  if (!rows[0]) return null;
  const sid = await survivorId(db, rows[0].userIdentity);
  if (!sid) return null;
  return { userId: sid, email, emailVerified: rows[0].emailVerified };
}

async function assertNotMemberOrInvited(
  db: Database,
  simId: string,
  userId: string | null,
  email: string | null,
  now: Date
) {
  if (userId) {
    const role = await foldSimRole(db, simId, userId);
    if (role) throw new Error('already a member');
  }
  const pending = await db
    .select({
      invitedUserId: simInvite.invitedUserId,
      invitedEmail: simInvite.invitedEmail,
      expiresAt: simInvite.expiresAt
    })
    .from(simInvite)
    .where(and(eq(simInvite.simId, simId), eq(simInvite.status, 'pending')));
  let live = 0;
  for (const p of pending) {
    if (userId && p.invitedUserId === userId) throw new Error('already invited');
    if (email && p.invitedEmail === email) throw new Error('already invited');
    if (p.expiresAt > now) live++;
  }
  if (live >= INVITE_PENDING_CAP) throw new Error('too many pending invites for this sim');
}

export async function createInvite(args: {
  db: Database;
  simId: string;
  invitedByUserId: string;
  target: InviteTarget;
  /**
   * Whether the inviter may send to an email address. Anonymous/unverified-email
   * managers are restricted to inviting existing accounts by `@handle`, closing the
   * arbitrary-stranger-email vector (#428).
   */
  canInviteByEmail: boolean;
  now?: Date;
}): Promise<CreatedInvite> {
  const now = args.now ?? new Date();
  let invitedEmail: string | null = null;
  let resolved: { userId: string; email: string; emailVerified: boolean } | null;

  if (args.target.kind === 'handle') {
    resolved = await resolveHandle(args.db, args.target.handle.replace(/^@/, ''));
    if (!resolved) throw new Error('no user with that handle');
  } else {
    if (!args.canInviteByEmail) throw new Error('email invites require a verified account');
    invitedEmail = args.target.email.trim().toLowerCase();
    resolved = await resolveEmail(args.db, invitedEmail);
  }

  await assertNotMemberOrInvited(args.db, args.simId, resolved?.userId ?? null, invitedEmail, now);

  const token = generateInviteToken();
  const tokenHash = await hashToken(token);
  const id = newId();
  await args.db.insert(simInvite).values({
    id,
    simId: args.simId,
    role: 'editor',
    invitedEmail,
    invitedUserId: resolved?.userId ?? null,
    tokenHash,
    invitedByUserId: args.invitedByUserId,
    status: 'pending',
    createdAt: now,
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    lastSentAt: now
  });
  await recheckInviter(args.db, args.simId, args.invitedByUserId, id);
  const [invite] = await args.db.select().from(simInvite).where(eq(simInvite.id, id));
  return { invite, token, resolvedUser: resolved };
}

/** The role an invitation needs: the invite route's `requireSimRole(..., 'manager')`. */
const INVITER_ROLE: SimMemberRole = 'manager';

/**
 * Thrown by createInvite when the inviter no longer holds INVITER_ROLE after the insert.
 * `role` is the role read (null for none, or when the read failed), so the route can answer
 * as `requireSimRole` answers a caller who may not invite.
 */
export class InviterRoleLostError extends Error {
  constructor(readonly role: SimMemberRole | null) {
    super('inviter role lost');
    this.name = 'InviterRoleLostError';
  }
}

/**
 * Re-read the inviter's role after the insert, through the fold the route used. The inviter's
 * last leave may have run after the route authorized them: it revokes, then ends pending
 * invitations. This read follows the insert, so either it sees the revoke (and the row is
 * deleted here) or the revoke follows it (and the leave's own delete ends the row). Either way
 * no pending invitation survives on a sim nobody manages. A failed read counts as "no".
 */
async function recheckInviter(
  db: Database,
  simId: string,
  inviterId: string,
  inviteId: string
): Promise<void> {
  let role: SimMemberRole | null = null;
  try {
    role = await foldSimRole(db, simId, inviterId);
  } catch (e) {
    console.error('[invite-create] role re-check failed', simId, loggable(e));
  }
  if (role === INVITER_ROLE) return;
  await db
    .delete(simInvite)
    .where(and(eq(simInvite.id, inviteId), eq(simInvite.status, 'pending')));
  throw new InviterRoleLostError(role);
}

type InviteUser = { handle: string; email: string | null } | null | undefined;

/** The manager-facing view of one pending invite. The single source of this shape — both
 *  the list load and the create endpoint's local-apply response go through it. */
export function toManagerPendingInviteView(
  row: SimInvite,
  invitedUser: InviteUser
): ManagerPendingInvite {
  const display = row.invitedEmail ?? (invitedUser ? `@${invitedUser.handle}` : '(unknown)');
  // Only an address mail can reach counts: a pseudonymous account's synthetic one does not.
  const invitedByEmail = isDeliverable(row.invitedEmail) || isDeliverable(invitedUser?.email);
  return {
    id: row.id,
    display,
    invitedByEmail,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt
  };
}

export async function listManagerPendingInvites(args: {
  db: Database;
  simId: string;
  now?: Date;
}): Promise<ManagerPendingInvite[]> {
  const now = args.now ?? new Date();
  const rows = await args.db
    .select()
    .from(simInvite)
    .where(
      and(
        eq(simInvite.simId, args.simId),
        eq(simInvite.status, 'pending'),
        gt(simInvite.expiresAt, now)
      )
    );
  const userIds = rows.map((r) => r.invitedUserId).filter((x): x is string => !!x);
  const users = await getUsers(args.db, userIds);
  return rows
    .map((r) => toManagerPendingInviteView(r, r.invitedUserId ? users.get(r.invitedUserId) : null))
    .sort((a, b) => a.display.localeCompare(b.display));
}

/** Read one pending invite in the manager-facing shape — the create endpoint's local-apply
 *  payload, built the same way the list load builds every other row. Sim-scoped: this is a
 *  manager-view reader, so the sim whose manager is asking is part of the lookup, never
 *  just the invite id. */
export async function getManagerPendingInvite(args: {
  db: Database;
  simId: string;
  inviteId: string;
}): Promise<ManagerPendingInvite | null> {
  const [row] = await args.db
    .select()
    .from(simInvite)
    .where(and(eq(simInvite.id, args.inviteId), eq(simInvite.simId, args.simId)));
  if (!row) return null;
  const users = row.invitedUserId ? await getUsers(args.db, [row.invitedUserId]) : null;
  return toManagerPendingInviteView(row, row.invitedUserId ? users?.get(row.invitedUserId) : null);
}

function ensureLive(invite: SimInvite | undefined, now: Date): SimInvite {
  if (!invite) throw new Error('invite not found');
  if (invite.status !== 'pending') throw new Error('invite not pending');
  if (invite.expiresAt.getTime() <= now.getTime()) throw new Error('invite expired');
  return invite;
}

/**
 * Atomically claim a pending invite. Returns true iff THIS call flipped a row that was
 * still `pending` to `accepted`. The guarded UPDATE is the single-use lock — a concurrent
 * second claim affects 0 rows and returns false.
 */
export async function claimInvite(
  db: Database,
  inviteId: string,
  userId: string
): Promise<boolean> {
  const res = await db
    .update(simInvite)
    .set({ status: 'accepted', acceptedByUserId: userId })
    .where(and(eq(simInvite.id, inviteId), eq(simInvite.status, 'pending')));
  // drizzle-orm/d1 (and its better-sqlite3 test shim) expose affected-row count via
  // res.meta.changes — the D1Shim.run() wraps better-sqlite3's info.changes into
  // { results, success, meta: { changes } } which mapRunResult returns verbatim.
  const changes =
    (res as unknown as { meta?: { changes?: number } }).meta?.changes ??
    (res as unknown as { changes?: number }).changes ??
    0;
  return changes === 1;
}

/**
 * The one accept path (by token and by id): claim, grant, then reconcile management. The last
 * member may leave between the claim and the grant; a leave ends only pending invitations, and
 * this one is already claimed. Without the reconcile the kept sim would have an editor and no
 * manager, so the invitee becomes its manager. The caller runs the roster hook afterwards.
 * The grant stands once written: a failed reconcile is logged, never reported as a failed
 * accept (the next accepted invitation or member removal for that sim reconciles again).
 */
async function finalizeAccept(
  db: Database,
  invite: SimInvite,
  userId: string
): Promise<{ simId: string }> {
  const claimed = await claimInvite(db, invite.id, userId);
  if (!claimed) throw new Error('invite not pending');
  await addMemberById({ db, simId: invite.simId, userId, role: invite.role });
  try {
    await reconcileSimManagement(db, invite.simId);
  } catch (e) {
    console.error('[invite-accept] reconcile failed', invite.simId, loggable(e));
  }
  return { simId: invite.simId };
}

// Bearer-only accept: possession of the (hashed-on-store) token is the sole proof —
// there is intentionally no `targetsMe` check like acceptInviteById. This is safe ONLY
// because of the load-bearing invariant that the raw token is strictly inbox-delivered
// (no endpoint or log path ever returns/emits it — guarded by the invite create/resend
// regression tests) and the granted role is hardcoded `editor`. See issue #433 (M4).
export async function acceptInviteByToken(args: {
  db: Database;
  token: string;
  userId: string;
  now?: Date;
}): Promise<{ simId: string }> {
  const now = args.now ?? new Date();
  const tokenHash = await hashToken(args.token);
  const [invite] = await args.db.select().from(simInvite).where(eq(simInvite.tokenHash, tokenHash));
  return finalizeAccept(args.db, ensureLive(invite, now), args.userId);
}

export async function acceptInviteById(args: {
  db: Database;
  inviteId: string;
  userId: string;
  email: string | null;
  emailVerified: boolean;
  now?: Date;
}): Promise<{ simId: string }> {
  const now = args.now ?? new Date();
  const [invite] = await args.db.select().from(simInvite).where(eq(simInvite.id, args.inviteId));
  const live = ensureLive(invite, now); // throws not-found/not-pending/expired first
  const targetsMe =
    live.invitedUserId === args.userId ||
    (args.emailVerified && !!args.email && live.invitedEmail === args.email.toLowerCase());
  if (!targetsMe) throw new Error('invite not addressed to you');
  return finalizeAccept(args.db, live, args.userId);
}

export async function declineInvite(args: {
  db: Database;
  inviteId: string;
  userId: string;
}): Promise<void> {
  const [invite] = await args.db.select().from(simInvite).where(eq(simInvite.id, args.inviteId));
  if (!invite || invite.status !== 'pending') throw new Error('invite not pending');
  if (invite.invitedUserId && invite.invitedUserId !== args.userId) {
    throw new Error('invite not addressed to you');
  }
  await args.db
    .update(simInvite)
    .set({ status: 'declined' })
    .where(eq(simInvite.id, args.inviteId));
}

export async function revokeInvite(args: {
  db: Database;
  simId: string;
  inviteId: string;
}): Promise<void> {
  await args.db
    .update(simInvite)
    .set({ status: 'revoked' })
    .where(and(eq(simInvite.id, args.inviteId), eq(simInvite.simId, args.simId)));
}

export const RESEND_COOLDOWN_MS = 60_000;

export type ResendResult = { emailed: boolean; token?: string; invite?: SimInvite };

export async function resendInvite(args: {
  db: Database;
  simId: string;
  inviteId: string;
  now?: Date;
}): Promise<ResendResult> {
  const now = args.now ?? new Date();
  const [invite] = await args.db
    .select()
    .from(simInvite)
    .where(and(eq(simInvite.id, args.inviteId), eq(simInvite.simId, args.simId)));
  const live = ensureLive(invite, now);

  let email = live.invitedEmail;
  if (!email && live.invitedUserId) {
    const u = (await getUsers(args.db, [live.invitedUserId])).get(live.invitedUserId);
    email = u?.email && u.email.length > 0 ? u.email : null;
  }
  if (!isDeliverable(email)) {
    return { emailed: false };
  }

  if (live.lastSentAt && now.getTime() - live.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new Error('resend too soon');
  }

  const token = generateInviteToken();
  const tokenHash = await hashToken(token);
  await args.db
    .update(simInvite)
    .set({ tokenHash, lastSentAt: now })
    .where(eq(simInvite.id, live.id));
  const [updated] = await args.db.select().from(simInvite).where(eq(simInvite.id, live.id));
  return { emailed: true, token, invite: updated };
}

export type RecipientInvite = {
  id: string;
  simId: string;
  simTitle: string;
  inviterHandle: string;
};

export async function listRecipientPendingInvites(args: {
  db: Database;
  userId: string;
  email: string | null;
  emailVerified: boolean;
  now?: Date;
}): Promise<RecipientInvite[]> {
  const now = args.now ?? new Date();
  const rows = await args.db
    .select()
    .from(simInvite)
    .where(and(eq(simInvite.status, 'pending'), gt(simInvite.expiresAt, now)));
  const mine = rows.filter(
    (r) =>
      r.invitedUserId === args.userId ||
      (args.emailVerified && args.email && r.invitedEmail === args.email.toLowerCase())
  );
  const inviterIds = mine.map((r) => r.invitedByUserId);
  const inviters = await getUsers(args.db, inviterIds);
  const titles = new Map<string, string>();
  for (const r of mine) {
    if (titles.has(r.simId)) continue;
    const [q] = await args.db
      .select({ title: simIndex.title })
      .from(simIndex)
      .where(eq(simIndex.simId, r.simId));
    titles.set(r.simId, q?.title ?? MEMBERS_COPY.simTitleFallback);
  }
  return mine.map((r) => ({
    id: r.id,
    simId: r.simId,
    simTitle: titles.get(r.simId) ?? MEMBERS_COPY.simTitleFallback,
    inviterHandle: inviters.get(r.invitedByUserId)?.handle ?? 'someone'
  }));
}

export type TokenInvite = {
  id: string;
  simId: string;
  simTitle: string;
  inviterHandle: string;
  invitedEmail: string | null;
  status: InviteStatus;
  expired: boolean;
};

export async function findInviteByToken(args: {
  db: Database;
  token: string;
  now?: Date;
}): Promise<TokenInvite | null> {
  const now = args.now ?? new Date();
  const tokenHash = await hashToken(args.token);
  const [r] = await args.db.select().from(simInvite).where(eq(simInvite.tokenHash, tokenHash));
  if (!r) return null;
  const [q] = await args.db
    .select({ title: simIndex.title })
    .from(simIndex)
    .where(eq(simIndex.simId, r.simId));
  const simTitle = q?.title ?? MEMBERS_COPY.simTitleFallback;
  const inviter = (await getUsers(args.db, [r.invitedByUserId])).get(r.invitedByUserId);
  return {
    id: r.id,
    simId: r.simId,
    simTitle,
    inviterHandle: inviter?.handle ?? 'someone',
    invitedEmail: r.invitedEmail,
    status: r.status,
    expired: r.expiresAt.getTime() <= now.getTime()
  };
}
