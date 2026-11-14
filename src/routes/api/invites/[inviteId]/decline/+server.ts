import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MEMBERS_COPY } from '$lib/members/copy';
import { getDb } from '$lib/server/db';
import { declineInvite } from '$lib/server/invites/control-plane';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';

export const POST: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  if (!event.locals.user) throw error(401, MEMBERS_COPY.notSignedIn);
  const db = getDb(event.platform!);
  await declineInvite({ db, inviteId: event.params.inviteId!, userId: event.locals.user.id });
  return new Response(null, { status: 204 });
};
