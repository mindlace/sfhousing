import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { simIndex } from '$lib/server/db/schema';
import { requireSimRole } from '$lib/server/authz/require-sim-role';
import { resendInvite } from '$lib/server/invites/control-plane';
import { getUser } from '$lib/server/user-store/user';
import { sendInviteEmail } from '$lib/server/invites/email';
import { isDeliverable } from '$lib/server/email/provider';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';
import { MEMBERS_COPY } from '$lib/members/copy';
import { enforceMutationRate, RATE_LIMIT_MESSAGES } from '$lib/server/security/rate-limit';

export const POST: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const simId = event.params.simId!;
  const { actor } = await requireSimRole(event, simId, 'manager');
  const db = getDb(event.platform!);
  await enforceMutationRate(event, `invite_resend:${actor.actorId}`, {
    limiter: event.platform!.env.MUTATION_REGISTERED_RL,
    message: RATE_LIMIT_MESSAGES.invites,
    critical: true
  });
  let res;
  try {
    res = await resendInvite({ db, simId, inviteId: event.params.inviteId! });
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : MEMBERS_COPY.resendFailed },
      { status: 400 }
    );
  }

  // The token has already rotated; isolate email-send failures so a transient SES
  // error doesn't turn a successful rotation into a 400 (mirrors the create endpoints).
  try {
    if (res.emailed && res.token && res.invite) {
      const inv = res.invite;
      let to = inv.invitedEmail;
      if (!to && inv.invitedUserId) {
        const u = await getUser(db, inv.invitedUserId);
        to = u?.email && u.email.length > 0 ? u.email : null;
      }
      if (to && isDeliverable(to)) {
        const inviter = await getUser(db, inv.invitedByUserId);
        const [q] = await db
          .select({ title: simIndex.title })
          .from(simIndex)
          .where(eq(simIndex.simId, simId));
        if (inviter) {
          await sendInviteEmail({
            platform: event.platform!,
            origin: event.url.origin,
            to,
            token: res.token,
            inviterHandle: inviter.handle,
            simTitle: q?.title ?? MEMBERS_COPY.simTitleFallback
          });
        }
      }
    }
  } catch (err) {
    console.error('invite resend email send failed', err);
  }
  return json({ emailed: res.emailed }, { status: 200 });
};
