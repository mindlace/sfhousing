import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { authFor } from '$lib/server/auth/better-auth';
import { enabledAuthMethods } from '$lib/server/auth/methods';
import { getDb } from '$lib/server/db';
import type { Database } from '$lib/server/db';
import { userHasOAuthAccount } from '$lib/server/user-store/oauth';
import { userHasPasskey } from '$lib/server/user-store/passkey';
import { hasPassword } from '$lib/server/user-store/password-credential';

/**
 * Whether this account could sign back in after signing out: it is not pseudonymous (it has a
 * real email), or it holds a passkey, a password or a Google account. A pseudonymous account
 * with none of them would be lost, with every sim only it manages.
 */
function canSignBackIn(
  pseudonymous: boolean,
  factors: { hasPasskey: boolean; hasPassword: boolean; hasOAuthAccount: boolean }
): boolean {
  return !pseudonymous || factors.hasPasskey || factors.hasPassword || factors.hasOAuthAccount;
}

async function signInFactors(db: Database, identityId: string, liveUserId: string) {
  const [hasPasskey, hasOAuthAccount, hasPwd] = await Promise.all([
    userHasPasskey(db, liveUserId),
    userHasOAuthAccount(db, liveUserId),
    hasPassword(db, identityId)
  ]);
  return { hasPasskey, hasOAuthAccount, hasPassword: hasPwd };
}

export const load: PageServerLoad = async (event) => {
  const { locals, platform, url } = event;
  if (!locals.user || !locals.session) throw redirect(303, '/signin?returnTo=/account');
  const db = getDb(platform!);
  const liveUserId = locals.session.userId;
  const { id, handle, name, email, emailVerified, pseudonymous } = locals.user;
  const factors = await signInFactors(db, id, liveUserId);
  const { hasPasskey, hasOAuthAccount } = factors;
  return {
    // emailVerified decides whether the page may call the address confirmed.
    user: { id, handle, name, email, emailVerified, pseudonymous },
    // The sign-in methods switched on for this request; the page renders only those.
    methods: [...enabledAuthMethods(event)],
    hasPasskey,
    hasOAuthAccount,
    // Sign out is offered only to an account that can sign back in.
    canSignOut: canSignBackIn(pseudonymous, factors),
    // A confirm link sent from this page that failed (expired, used) comes back marked.
    linkError: url.searchParams.get('link') === 'failed'
  };
};

export const actions: Actions = {
  // Ends this session (Better-Auth deletes its row and clears the session cookies) and lands
  // on the home page signed out. The known-device cookie stays, as planafoot kept it: the
  // next sim started on this device steers to sign-in rather than minting a second account.
  // An account that could not sign back in keeps its session (back to /account), so a
  // hand-made post cannot strand it.
  signOut: async (event) => {
    const { locals, platform } = event;
    if (locals.user && locals.session) {
      const factors = await signInFactors(getDb(platform!), locals.user.id, locals.session.userId);
      if (!canSignBackIn(locals.user.pseudonymous, factors)) throw redirect(303, '/account');
      await authFor(event).api.signOut({ headers: event.request.headers });
    }
    throw redirect(303, '/');
  }
};
