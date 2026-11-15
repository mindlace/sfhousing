import type { PageServerLoad, Actions } from './$types';
import { fail, redirect, isHttpError, isRedirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { getAuth } from '$lib/server/auth/better-auth';
import { requireMethod } from '$lib/server/auth/require-method';
import { user } from '$lib/server/db/schema';
import { findInviteByToken, acceptInviteByToken } from '$lib/server/invites/control-plane';
import { onSimRosterChanged } from '$lib/server/sims/roster-hook';
import { classifyColdAccept } from '$lib/server/invites/claim';
import { isE2eEnv } from '$lib/server/e2e/env';
import { isKnownDevice } from '$lib/server/onboarding/known-device';
import { stashPendingIdentifier } from '$lib/server/onboarding/pending-identifier';
import { mintPseudonymousSession } from '$lib/server/onboarding/pseudonymous-mint';
import { reseedHandleFromSim } from '$lib/server/user-store/identity';
import { generateUniqueHandle } from '$lib/server/user-store/handle';
import { recordUserVersion } from '$lib/server/user-store/history';
import { skeleton } from '$lib/server/user-store/confusable-skeleton';
import { memberErrorCode } from '$lib/server/invites/error-code';

export const load: PageServerLoad = async (event) => {
  const db = getDb(event.platform!);
  const invite = await findInviteByToken({ db, token: event.params.token });
  // A magic link sent from this page that failed (expired, used) comes back marked.
  const linkError = event.url.searchParams.get('link') === 'failed';
  if (!invite || invite.status !== 'pending' || invite.expired) {
    return { invite: null, signedIn: !!event.locals.user, linkError };
  }
  return {
    invite: {
      simTitle: invite.simTitle,
      inviterHandle: invite.inviterHandle,
      invitedEmail: invite.invitedEmail
    },
    signedIn: !!event.locals.user,
    linkError
  };
};

export const actions: Actions = {
  accept: async (event) => {
    if (!event.locals.user) throw redirect(303, '/');
    const db = getDb(event.platform!);
    try {
      const res = await acceptInviteByToken({
        db,
        token: event.params.token,
        userId: event.locals.user.id
      });
      await onSimRosterChanged(event.platform?.env, res.simId);
      throw redirect(303, `/sims/${res.simId}`);
    } catch (e) {
      if (isRedirect(e)) throw e;
      const code = memberErrorCode(e);
      if (code === 'failed') console.error('invite accept failed', e);
      return fail(400, { code });
    }
  },

  // Cold-accept for a signed-OUT recipient. The bearer token in the
  // URL proves control of the INVITED inbox.
  join: async (event) => {
    const form = await event.request.formData();
    const email = String(form.get('email') ?? '').trim();

    const db = getDb(event.platform!);
    const invite = await findInviteByToken({ db, token: event.params.token });
    if (!invite || invite.status !== 'pending' || invite.expired) {
      return fail(400, { code: 'invite_invalid' as const });
    }

    // Send a real magic link to `linkEmail` (always returning to this invite). The e2e
    // dev-link helper captures the verification URL synchronously from sendMagicLink, in
    // the same request, so it can follow the link without a real inbox. The sink arms only
    // in an e2e env (isE2eEnv) and stays undefined everywhere else.
    const wantDevLink = isE2eEnv(event.platform!);
    const sendMagicLink = async (linkEmail: string): Promise<string | undefined> => {
      // 404 while magic link is off (no mail provider): the link would reach no one.
      requireMethod(event, 'magic-link');
      let devLink: string | undefined;
      const auth = getAuth(event.platform!, event.url.origin, {
        captureMagicLink: wantDevLink
          ? ({ url }) => {
              devLink = url;
            }
          : undefined
      });
      await auth.api.signInMagicLink({
        headers: event.request.headers,
        body: {
          email: linkEmail,
          callbackURL: `/invite/${event.params.token}`,
          errorCallbackURL: `/invite/${event.params.token}?link=failed`
        }
      });
      return devLink;
    };

    try {
      const decision = await classifyColdAccept({
        db,
        invitedEmail: invite.invitedEmail,
        enteredEmail: email
      });
      switch (decision.kind) {
        case 'mint': {
          // Known device + not explicitly starting fresh → steer to sign-in.
          const fresh = form.get('fresh') === '1';
          if (isKnownDevice(event.cookies) && !fresh) {
            // SC 3.3.7 Redundant Entry: carry the address the user just typed so
            // /signin can seed it instead of asking for it again.
            stashPendingIdentifier(event.cookies, email);
            throw redirect(
              303,
              `/signin?returnTo=${encodeURIComponent('/invite/' + event.params.token)}`
            );
          }
          const minted = await mintPseudonymousSession(event);
          if (!minted.ok) {
            const code = minted.status === 429 ? 'rate_limited' : 'session_start';
            return fail(minted.status, { code });
          }
          const u = minted.user;

          const simTitle = invite.simTitle;
          if (decision.pseudonymous) {
            // Handle invite (no email): stay pseudonymous; seed handle from the sim title.
            await reseedHandleFromSim({ db, identityId: u.id, simTitle });
          } else {
            // Emailed invite: token possession proves inbox control. Bind the invited
            // address (unverified) — durable and non-pseudonymous from the start.
            const uniqueHandle = await generateUniqueHandle({ db, simTitle });
            const invitedEmail = invite.invitedEmail!.toLowerCase();
            try {
              await db
                .update(user)
                .set({
                  email: invitedEmail,
                  emailVerified: false,
                  isAnonymous: false,
                  handle: uniqueHandle,
                  handleSkeleton: skeleton(uniqueHandle),
                  name: uniqueHandle,
                  updatedAt: new Date()
                })
                .where(eq(user.userIdentity, u.id));
            } catch {
              return fail(400, { code: 'create_account_failed' as const });
            }
            await recordUserVersion({
              db,
              identityId: u.id,
              handle: uniqueHandle,
              name: uniqueHandle,
              email: invitedEmail
            });
          }

          const res = await acceptInviteByToken({ db, token: event.params.token, userId: u.id });
          await onSimRosterChanged(event.platform?.env, res.simId);
          throw redirect(303, `/sims/${res.simId}`);
        }
        case 'signin': {
          // A3: a stronger factor (OAuth/passkey) must not be bypassed by inbox possession —
          // require a real sign-in, returning to this invite afterwards.
          if (decision.strongFactor) {
            // SC 3.3.7 Redundant Entry: carry the address the user just typed so
            // /signin can seed it instead of asking for it again.
            stashPendingIdentifier(event.cookies, email);
            throw redirect(
              303,
              `/signin?returnTo=${encodeURIComponent('/invite/' + event.params.token)}`
            );
          }
          // A2: magic-link-only account. Possession of the invite token must NOT mint a
          // session (issue #433 / M4 — reduce blast radius if the inbox-only invariant ever
          // breaks). Send a REAL magic link to the invited inbox; the user must click it to
          // sign in, then lands back on /invite/[token] signed-in for the Accept button.
          return { checkEmail: true, devLink: await sendMagicLink(invite.invitedEmail!) };
        }
        case 'verify': {
          // C: a different address than invited — untrusted. Send a REAL magic link there
          // (the one case the second email is correct: we can't prove a different inbox).
          return { checkEmail: true, devLink: await sendMagicLink(decision.email) };
        }
      }
    } catch (e) {
      if (isRedirect(e) || isHttpError(e)) throw e;
      const code = memberErrorCode(e);
      if (code === 'failed') console.error('invite join failed', e);
      return fail(400, { code });
    }
  }
};
