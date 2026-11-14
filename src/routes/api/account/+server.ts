import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { authFor } from '$lib/server/auth/better-auth';
import { getDb } from '$lib/server/db';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';
import { deleteAccount } from '$lib/server/user-store/deletion';
import { userHasOAuthAccount } from '$lib/server/user-store/oauth';
import { hasPassword, mayRemovePassword } from '$lib/server/user-store/password-credential';

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user || !locals.session) {
    return json({ error: ACCOUNT_COPY.signinRequired }, { status: 401 });
  }
  const db = getDb(platform!);
  return json({
    hasGoogle: await userHasOAuthAccount(db, locals.session.userId),
    hasPassword: await hasPassword(db, locals.user.id),
    canRemovePassword: await mayRemovePassword(db, locals.user.id),
    pseudonymous: locals.user.pseudonymous
  });
};

export const DELETE: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const { locals, request, platform } = event;
  if (!locals.user) return json({ error: ACCOUNT_COPY.signinRequired }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { confirmHandle?: string } | null;
  const confirmHandle = String(body?.confirmHandle ?? '').trim();
  if (confirmHandle !== locals.user.handle) {
    return json({ deleteError: ACCOUNT_COPY.handleMismatch }, { status: 400 });
  }
  const identityId = locals.user.id;
  await deleteAccount({
    db: getDb(platform!),
    identityId,
    actor: { actorId: identityId, actorKind: 'human' }
  });
  // Best-effort: clear the session cookie (rows are already gone).
  try {
    await authFor(event).api.signOut({ headers: request.headers });
  } catch {
    // session already deleted: nothing to sign out
  }
  return json({ ok: true });
};
