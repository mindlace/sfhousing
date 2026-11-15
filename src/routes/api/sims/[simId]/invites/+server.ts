import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { simIndex } from '$lib/server/db/schema';
import { MEMBERS_COPY } from '$lib/members/copy';
import { memberErrorCode } from '$lib/server/invites/error-code';
import { requireSimRole } from '$lib/server/authz/require-sim-role';
import {
  createInvite,
  parseInviteTarget,
  getManagerPendingInvite,
  InviterRoleLostError
} from '$lib/server/invites/control-plane';
import { getUser } from '$lib/server/user-store/user';
import { sendInviteEmail } from '$lib/server/invites/email';
import { isDeliverable } from '$lib/server/email/provider';
import {
  enforceRate,
  enforceMutationRate,
  RATE_LIMIT_MESSAGES
} from '$lib/server/security/rate-limit';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';

export const POST: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const simId = event.params.simId!;
  const { actor } = await requireSimRole(event, simId, 'manager');
  const platform = event.platform!;
  const db = getDb(platform);

  // IP- AND identity-keyed velocity guard: exceeding either is a visible 429, before
  // any DB work or email send. The IP key survives anonymous identity rotation (#428).
  const ip = event.request.headers.get('CF-Connecting-IP') ?? 'unknown';
  await enforceMutationRate(event, `invite_ip:${ip}`, {
    limiter: platform.env.INVITE_RL,
    message: MEMBERS_COPY.inviteNetworkRateLimited,
    critical: true
  });
  await enforceMutationRate(event, `invite:${actor.actorId}`, {
    limiter: platform.env.INVITE_RL,
    message: RATE_LIMIT_MESSAGES.invites,
    critical: true
  });

  const body = (await event.request.json().catch(() => null)) as { target?: string } | null;
  if (!body || typeof body.target !== 'string') {
    return json({ code: 'target_required' }, { status: 400 });
  }
  const inviter = await getUser(db, actor.actorId);
  if (!inviter) throw error(401, MEMBERS_COPY.notSignedIn);
  // Unverified-email managers may invite by @handle only.
  const canInviteByEmail = inviter.emailVerified;
  try {
    const target = parseInviteTarget(body.target);
    const out = await createInvite({
      db,
      simId,
      invitedByUserId: actor.actorId,
      target,
      canInviteByEmail
    });
    // No mail to an address that cannot receive it (a pseudonymous account's).
    const candidate = out.invite.invitedEmail ?? (out.resolvedUser?.email || null);
    const recipientEmail = isDeliverable(candidate) ? candidate : null;
    if (recipientEmail) {
      // Per-recipient global cooldown (across sims): silently skip the send when over
      // limit — the invite row still exists and can be resent later.
      const underRecipient = await enforceRate(
        platform.env.INVITE_RL,
        `invite_email:${recipientEmail}`,
        platform.env,
        { critical: true }
      );
      if (underRecipient) {
        const [q] = await db
          .select({ title: simIndex.title })
          .from(simIndex)
          .where(eq(simIndex.simId, simId));
        try {
          await sendInviteEmail({
            platform,
            origin: event.url.origin,
            to: recipientEmail,
            token: out.token,
            inviterHandle: inviter.handle,
            simTitle: q?.title ?? MEMBERS_COPY.simTitleFallback
          });
        } catch (err) {
          console.error('invite email send failed', err);
        }
      }
    }
    // Return the manager-facing row, not just the id, so the client can local-apply the new
    // pending-invite line without reloading the whole page's data. The invite was already
    // created (and the email already sent) above, so a failure reading it back must NOT fail
    // the request — fall back to a display derived from the already-parsed target instead.
    const fallbackDisplay = target.kind === 'email' ? target.email : `@${target.handle}`;
    let view;
    try {
      view = await getManagerPendingInvite({ db, simId, inviteId: out.invite.id });
    } catch (err) {
      console.error('invite read-back failed', err);
      view = null;
    }
    return json(
      {
        id: out.invite.id,
        display: view?.display ?? fallbackDisplay,
        invitedByEmail: view?.invitedByEmail ?? !!recipientEmail
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof InviterRoleLostError) {
      // The inviter's role went while the invite was being created (their row is already
      // deleted, no mail sent). Answer as requireSimRole answers a caller who may not invite
      // (require-cap.ts): 404 to a non-member, 403 to a member below manager.
      if (e.role === null) throw error(404, { message: 'not found', resource: 'sim' });
      throw error(403, 'forbidden');
    }
    const code = memberErrorCode(e);
    if (code === 'failed') console.error('invite create failed', e);
    return json({ code }, { status: 400 });
  }
};
