import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MEMBERS_COPY } from '$lib/members/copy';
import { getDb } from '$lib/server/db';
import { acceptInviteById } from '$lib/server/invites/control-plane';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';
import { onSimRosterChanged } from '$lib/server/sims/roster-hook';

export const POST: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const user = event.locals.user;
  if (!user) throw error(401, MEMBERS_COPY.notSignedIn);
  const db = getDb(event.platform!);
  try {
    const res = await acceptInviteById({
      db,
      inviteId: event.params.inviteId!,
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified
    });
    await onSimRosterChanged(res.simId);
    return json({ simId: res.simId }, { status: 200 });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : MEMBERS_COPY.acceptFailed },
      { status: 400 }
    );
  }
};
