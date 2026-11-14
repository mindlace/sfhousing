import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { revokeInvite } from '$lib/server/invites/control-plane';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';

export const DELETE: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const simId = event.params.simId!;
  await requireSimRole(event, simId, 'manager');
  const db = getDb(event.platform!);
  await revokeInvite({ db, simId, inviteId: event.params.inviteId! });
  return new Response(null, { status: 204 });
};
