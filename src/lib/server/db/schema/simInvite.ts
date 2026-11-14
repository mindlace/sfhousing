import { sqliteTable, normText, privateText, text, integer, uniqueIndex } from '../columns';
import { userIdentity } from './users';
import type { SimMemberRole } from './simControlPlane';

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

/**
 * A pending invitation to a sim. Deliberately NO FK to sim_index (rebuildable cache).
 * `tokenHash` is the SHA-256 hex of the bearer token that appears only in the
 * emailed link; the raw token is never stored. `invitedUserId` is the SURVIVOR
 * identity for handle invites (and email invites that resolve to an account),
 * stamped at creation so the in-app surfaces match on the stable id.
 */
export const simInvite = sqliteTable(
  'sim_invite',
  {
    id: text('id').primaryKey(), // newId()
    simId: text('sim_id').notNull(),
    role: text('role').$type<SimMemberRole>().notNull(),
    invitedEmail: normText('invited_email'),
    invitedUserId: text('invited_user_id').references(() => userIdentity.id, {
      onDelete: 'cascade'
    }),
    tokenHash: privateText('token_hash').notNull(),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => userIdentity.id, { onDelete: 'cascade' }),
    status: text('status').$type<InviteStatus>().notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSentAt: integer('last_sent_at', { mode: 'timestamp_ms' }),
    acceptedByUserId: text('accepted_by_user_id').references(() => userIdentity.id, {
      onDelete: 'set null'
    })
  },
  (t) => [uniqueIndex('sim_invite_token_hash_idx').on(t.tokenHash)]
);

export type SimInvite = typeof simInvite.$inferSelect;
