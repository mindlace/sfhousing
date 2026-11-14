import { sqliteTable, text } from '../columns';

/**
 * Supertype for every capability-holding subject. `capability_event.principal_id`
 * foreign-keys here, so a grantee is guaranteed to exist (uuidv7 uniqueness gives
 * disambiguation, NOT existence). Subtypes join down: `user_identity.id ─FK→ principal.id`
 * (kind='identity'). Every principal this app creates is an identity; the `kind` column also
 * admits 'group' and 'service', which nothing here writes. INERT on the authorization hot
 * path: folds match `principal_id` strings directly and never join here.
 */
export const principal = sqliteTable('principal', {
  id: text('id').primaryKey(), // base58 uuidv7 (the identity's id)
  kind: text('kind').$type<'identity' | 'group' | 'service'>().notNull()
});
