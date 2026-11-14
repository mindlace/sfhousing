import { capabilityEvent } from './schema';
import type { Database } from './index';
import { appendEventAsync } from '$lib/server/event-log/append';

export type NewCapabilityEvent = {
  id: string;
  principalId: string;
  resourceType: string;
  resourceId: string;
  ability: string;
  action: 'grant' | 'revoke';
  caveats?: string | null;
  parentId?: string | null;
  actorId?: string | null;
  now?: Date;
};

/**
 * Append one capability_event through the shared in-SQL append contract (event-log/append.ts).
 * The (created_at, created_at_counter) stamp is computed atomically inside the INSERT — required
 * because D1 is multi-isolate (many Worker isolates write concurrently) and a JS read-then-write
 * would race. Batch callers MUST loop this (one statement per row) so each row sees the prior
 * row's counter. Revoke-wins (see sim-roles.ts / foldRevokeWins) remains the semantic tiebreak;
 * this only makes the SQL order deterministic without relying on the random base58 id.
 */
export async function insertCapabilityEvent(db: Database, row: NewCapabilityEvent): Promise<void> {
  const now = (row.now ?? new Date()).getTime();
  await appendEventAsync(
    db,
    capabilityEvent,
    {
      id: row.id,
      principalId: row.principalId,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      ability: row.ability,
      action: row.action,
      caveats: row.caveats ?? null,
      parentId: row.parentId ?? null,
      actorId: row.actorId ?? null
    },
    now
  );
}
