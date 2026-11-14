import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { listRecipientPendingInvites } from '$lib/server/invites/control-plane';

// The invitations addressed to the signed-in user, for the banner on every /sims page.
export const load: LayoutServerLoad = async ({ locals, platform }) => {
  if (!locals.user) return { recipientInvites: [] };
  const recipientInvites = await listRecipientPendingInvites({
    db: getDb(platform!),
    userId: locals.user.id,
    email: locals.user.email,
    emailVerified: locals.user.emailVerified
  });
  return { recipientInvites };
};
