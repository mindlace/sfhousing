import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authFor } from '$lib/server/auth/better-auth';
import { enabledAuthMethods } from '$lib/server/auth/methods';
import { getDb } from '$lib/server/db';
import { userHasOAuthAccount } from '$lib/server/user-store/oauth';
import { userHasPasskey } from '$lib/server/user-store/passkey';

export const load: PageServerLoad = async (event) => {
  const { locals, platform, url } = event;
  if (!locals.user || !locals.session) throw redirect(303, '/signin?returnTo=/account');
  const db = getDb(platform!);
  const liveUserId = locals.session.userId;
  const [hasPasskey, hasOAuthAccount] = await Promise.all([
    userHasPasskey(db, liveUserId),
    userHasOAuthAccount(db, liveUserId)
  ]);
  const { id, handle, name, email, emailVerified, pseudonymous } = locals.user;
  return {
    // emailVerified decides whether the page may call the address confirmed.
    user: { id, handle, name, email, emailVerified, pseudonymous },
    // The sign-in methods switched on for this request; the page renders only those.
    methods: [...enabledAuthMethods(event)],
    hasPasskey,
    hasOAuthAccount,
    // A confirm link sent from this page that failed (expired, used) comes back marked.
    linkError: url.searchParams.get('link') === 'failed'
  };
};

export const actions: Actions = {
  // Ends this session (Better-Auth deletes its row and clears the session cookies) and lands
  // on the home page signed out. The known-device cookie stays, as planafoot kept it: the
  // next sim started on this device steers to sign-in rather than minting a second account.
  signOut: async (event) => {
    if (event.locals.user) {
      await authFor(event).api.signOut({ headers: event.request.headers });
    }
    throw redirect(303, '/');
  }
};
