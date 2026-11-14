import { sqliteTable, normText, text, integer, index } from '../columns';
import { userIdentity } from './users';

// Append-only history trail (anti-abuse groundwork). One row per attribute change.
// NEVER repointed or mutated — rows stay keyed to the identity that was live at capture,
// preserving "this handle was used WHILE the account was identity A, pre-fusion".
export const userVersion = sqliteTable(
  'user_version',
  {
    id: text('id').primaryKey(), // newId()
    userIdentity: text('user_identity')
      .notNull()
      .references(() => userIdentity.id, { onDelete: 'cascade' }),
    handle: normText('handle').notNull(),
    name: normText('name').notNull(),
    email: normText('email').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('user_version_identity_idx').on(t.userIdentity)]
);
