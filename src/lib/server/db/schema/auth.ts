import { sqliteTable, normText, privateText, text, integer, uniqueIndex } from '../columns';
import { userIdentity } from './users';

// Better-Auth's live user model (model `user` → table `user`). One live row per identity.
export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: normText('name').notNull(),
    email: normText('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    userIdentity: text('user_identity')
      .notNull()
      .references(() => userIdentity.id, { onDelete: 'cascade' }),
    handle: normText('handle').notNull().unique(),
    handleSkeleton: text('handle_skeleton'),
    // Plugin-owned Better-Auth field (see auth/better-auth.ts) — this name must not
    // leak past the user-store read seam; the app vocabulary is "pseudonymous".
    isAnonymous: integer('is_anonymous', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [uniqueIndex('user_handle_skeleton_unique').on(t.handleSkeleton)]
);

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: privateText('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: privateText('access_token'),
  refreshToken: privateText('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  idToken: privateText('id_token'),
  // Better-Auth's credential store for `emailAndPassword`. Nullable: only accounts
  // with `providerId: 'credential'` carry one; OAuth rows leave it null. `privateText`
  // (not `normText`) because this is an opaque hash — NFC normalization must never
  // touch it.
  password: privateText('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: privateText('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
});

export const passkey = sqliteTable('passkey', {
  id: text('id').primaryKey(),
  name: normText('name'),
  publicKey: privateText('public_key').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  credentialID: privateText('credential_id').notNull().unique(),
  counter: integer('counter').notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
  transports: text('transports'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  aaguid: privateText('aaguid')
});

export type User = typeof user.$inferSelect;
