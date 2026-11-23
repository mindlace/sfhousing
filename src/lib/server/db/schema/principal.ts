import { sqliteTable, text } from '../columns';

/**
 * Supertype of every identity: `user_identity.id ─FK→ principal.id` (kind='identity').
 * Every principal this app creates is an identity; the `kind` column also admits 'group'
 * and 'service', which nothing here writes.
 */
export const principal = sqliteTable('principal', {
  id: text('id').primaryKey(), // base58 uuidv7 (the identity's id)
  kind: text('kind').$type<'identity' | 'group' | 'service'>().notNull()
});
