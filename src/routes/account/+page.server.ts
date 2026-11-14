import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { enabledAuthMethods } from '$lib/server/auth/methods';
import { getDb } from '$lib/server/db';
import { userHasOAuthAccount } from '$lib/server/user-store/oauth';
import { userHasPasskey } from '$lib/server/user-store/passkey';

export const load: PageServerLoad = async (event) => {
  const { locals, platform } = event;
  if (!locals.user || !locals.session) throw redirect(303, '/signin?returnTo=/account');
  const db = getDb(platform!);
  const liveUserId = locals.session.userId;
  const [hasPasskey, hasOAuthAccount] = await Promise.all([
    userHasPasskey(db, liveUserId),
    userHasOAuthAccount(db, liveUserId)
  ]);
  const { id, handle, name, email, pseudonymous } = locals.user;
  return {
    user: { id, handle, name, email, pseudonymous },
    // The sign-in methods switched on for this request; the page renders only those.
    methods: [...enabledAuthMethods(event)],
    hasPasskey,
    hasOAuthAccount
  };
};
