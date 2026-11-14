import { error } from '@sveltejs/kit';
import type { Database } from '$lib/server/db';
import { newId } from '$lib/server/ids/base58';
import type { Capability } from '$lib/server/authz';
import { insertCapabilityEvent } from '$lib/server/db/capability-events';
import { hasCapability } from './capabilities';
import type { OperatorAbility } from './registry';

type MutateArgs = {
  db: Database;
  actorId: string;
  actorCaps: Capability[];
  targetId: string;
  capability: OperatorAbility;
};

/** Append the event, scoped to `app:*`. */
async function append(args: MutateArgs, action: 'grant' | 'revoke'): Promise<void> {
  await insertCapabilityEvent(args.db, {
    id: newId(),
    principalId: args.targetId,
    resourceType: 'app',
    resourceId: '*',
    ability: args.capability,
    action,
    actorId: args.actorId
  });
}

/** Grant `capability`. No-escalation: actor must hold `cap.grant` AND `capability`. */
export async function grantCapability(args: MutateArgs): Promise<void> {
  if (!hasCapability(args.actorCaps, 'cap.grant')) throw error(403, 'missing cap.grant');
  if (!hasCapability(args.actorCaps, args.capability)) {
    throw error(403, 'cannot grant a capability you do not hold');
  }
  await append(args, 'grant');
}

/**
 * Revoke `capability`. Actor must hold `cap.revoke` AND `capability` (symmetric
 * no-escalation: you can only strip a capability you yourself hold).
 */
export async function revokeCapability(args: MutateArgs): Promise<void> {
  if (!hasCapability(args.actorCaps, 'cap.revoke')) throw error(403, 'missing cap.revoke');
  if (!hasCapability(args.actorCaps, args.capability)) {
    throw error(403, 'cannot revoke a capability you do not hold');
  }
  await append(args, 'revoke');
}
