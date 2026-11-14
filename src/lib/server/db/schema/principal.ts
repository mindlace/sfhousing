import { sqliteTable, text } from '../columns';

/**
 * Supertype for every capability-holding subject. `capability_event.principal_id`
 * foreign-keys here, so a grantee is guaranteed to exist (uuidv7 uniqueness gives
 * disambiguation, NOT existence). Subtypes join down: `user_identity.id ─FK→ principal.id`
 * (kind='identity'); a future `group` table FKs here too (kind='group'). `kind='service'`
 * is a credential-less service principal (e.g. `service:support-autoclose`) with no
 * `user_identity`/`user` row — see `operator/service-principal.ts`. Minimal by
 * design — gains a `did` / public-key column when decentralization lands. INERT on the
 * authorization hot path: folds match `principal_id` strings directly and never join here.
 */
export const principal = sqliteTable('principal', {
  id: text('id').primaryKey(), // base58 uuidv7 for identities; reserved ids for groups
  kind: text('kind').$type<'identity' | 'group' | 'service'>().notNull()
});
