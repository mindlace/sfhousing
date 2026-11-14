import { sqliteTable, text, integer, index } from '../columns';
import { principal } from './principal';

/**
 * Append-only ledger of capability grants/revokes — the unitary store and audit trail
 * for ALL authority (app-level operator caps now; sim grants). The
 * CURRENT capability set for a principal is DERIVED by folding these events
 * (latest-wins per (resourceType, resourceId, ability)). Never mutate or delete rows.
 *
 * Columns mirror a UCAN delegation so the records are a serialization away from signed,
 * offline-verifiable tokens: `principalId` = audience (FKs the `principal` supertype),
 * `actorId` = issuer (null for system/bootstrap), `resourceType`/`resourceId` = `with`,
 * `ability` = `can`,
 * `caveats` = `nb` (JSON; inert in Phase 1), `parentId` = the delegation it descends
 * from (provenance; null at the root). `ability`/`resourceType` are a code-level
 * vocabulary, not FK-constrained.
 */
export const capabilityEvent = sqliteTable(
  'capability_event',
  {
    id: text('id').primaryKey(), // base58 uuidv7 (newId())
    principalId: text('principal_id')
      .notNull()
      .references(() => principal.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(), // 'app' | 'sim'
    resourceId: text('resource_id').notNull(), // base58 id, or '*' for app
    ability: text('ability').notNull(), // dot-namespaced, or '*'
    action: text('action').$type<'grant' | 'revoke'>().notNull(),
    caveats: text('caveats'), // JSON | null (attenuation; inert in Phase 1)
    parentId: text('parent_id'), // capability this descends from | null (provenance)
    actorId: text('actor_id'), // issuer/delegator identity id | null (system/bootstrap)
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Same-ms tie-break counter (see src/lib/server/db/capability-events.ts). Makes the
    // fold order deterministic without relying on non-monotonic base58 ids. Revoke-wins
    // remains the semantic tiebreak for grant-vs-revoke collisions.
    createdAtCounter: integer('created_at_counter').notNull().default(0)
  },
  (t) => [
    index('capability_event_principal_idx').on(t.principalId),
    index('capability_event_resource_idx').on(t.resourceType, t.resourceId),
    index('capability_event_created_idx').on(t.createdAt, t.createdAtCounter)
  ]
);
