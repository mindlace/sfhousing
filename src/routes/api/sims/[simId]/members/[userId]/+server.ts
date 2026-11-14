import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { removeSimMember } from '$lib/server/sims/sims';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';
import { memberErrorCode } from '$lib/server/invites/error-code';

export const DELETE: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const simId = event.params.simId!;
  const { actor } = await requireSimRole(event, simId, 'manager');
  const db = getDb(event.platform!);
  try {
    await removeSimMember({
      db,
      simId,
      userId: event.params.userId!,
      // Opt into co-manager protection: a manager can't eject another manager here.
      actorUserId: actor.actorId
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    const code = memberErrorCode(e);
    if (code === 'failed') console.error('member remove failed', e);
    return json({ code }, { status: 400 });
  }
};
