import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { ACCOUNT_COPY } from '$lib/account/account-copy';
import { AUTH_COPY, passwordTooLong, passwordTooShort } from '$lib/account/copy';
import { authFor } from '$lib/server/auth/better-auth';
import { requireMethod } from '$lib/server/auth/require-method';
import { isPasswordBreached } from '$lib/server/auth/password-breach';
import {
  validatePasswordShape,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH
} from '$lib/server/auth/password-policy';
import { getDb } from '$lib/server/db';
import { account } from '$lib/server/db/schema';
import { enforceRate } from '$lib/server/security/rate-limit';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';
import {
  hasPasswordForUser,
  liveUserFor,
  mayRemovePasswordForUser
} from '$lib/server/user-store/password-credential';

/** Better-Auth's provider id for a password row. */
const CREDENTIAL = 'credential';

export const POST: RequestHandler = async (event) => {
  // First: with password off this answers 404 before anything is read, and before
  // setPassword, which would otherwise run with none of the length limits Better-Auth's
  // config carries only while password is on.
  requireMethod(event, 'password');
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const { request, locals, platform } = event;
  if (!locals.user || !locals.session) {
    return json({ error: ACCOUNT_COPY.signinRequired }, { status: 401 });
  }

  if (
    !(await enforceRate(
      platform!.env.ACCOUNT_EDIT_RL,
      `account_pw:${locals.user.id}`,
      platform!.env,
      {
        critical: true
      }
    ))
  ) {
    return json({ error: ACCOUNT_COPY.tooManyChanges }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as {
    password?: string;
    currentPassword?: string;
  } | null;
  const password = String(body?.password ?? '');
  const currentPassword = String(body?.currentPassword ?? '');
  const shape = validatePasswordShape(password);
  if (!shape.ok) {
    return json(
      {
        error:
          shape.reason === 'too-short'
            ? passwordTooShort(PASSWORD_MIN_LENGTH)
            : passwordTooLong(PASSWORD_MAX_LENGTH)
      },
      { status: 400 }
    );
  }

  // Breach check runs HERE for BOTH branches. It is mandatory for the set
  // branch: Better-Auth's haveIBeenPwned() plugin is structurally unable to
  // fire for `setPassword` (see password-breach.ts). The change branch goes to
  // `/change-password`, which the plugin DOES cover, so there the check is
  // redundant, deliberately so: running it up front means the user gets the
  // same message and the same 400 whichever branch they are on, instead of a
  // plugin rejection surfacing as a generic failure.
  if (await isPasswordBreached(password)) {
    return json({ error: AUTH_COPY.passwordBreached }, { status: 400 });
  }

  // Resolve the live user ONCE: the same row decides which branch we take.
  const db = getDb(platform!);
  const live = await liveUserFor(db, locals.user.id);
  const existing = await hasPasswordForUser(db, live);

  const auth = authFor(event);
  try {
    if (existing) {
      // Changing, not adding. Remove-then-set is NOT an option: a user whose
      // password is their only durable factor (precisely the population this
      // feature exists for) fails `mayRemovePassword`, so they could never
      // change it, and the gap would briefly leave a pseudonymous account
      // with no credential, so no way back in.
      if (!currentPassword) {
        // `field` tells the client WHICH input is at fault, so the error marker
        // and focus land on the current-password box rather than the new one.
        return json(
          { error: ACCOUNT_COPY.passwordCurrentRequired, field: 'currentPassword' },
          { status: 400 }
        );
      }
      // A change is a rotation: sessions minted under the OLD password must not
      // outlive it. Better-Auth deletes ALL of this user's sessions, mints a fresh
      // one for the caller, and sets its cookie; `sveltekitCookies` (registered last
      // in the plugin array) mirrors that Set-Cookie onto our response, so the acting
      // user stays signed in on a rotated token while every other device is evicted.
      // The set branch below deliberately has no equivalent: adding a FIRST password
      // is add-a-credential, not rotation, and `setPassword` offers no such flag.
      await auth.api.changePassword({
        headers: request.headers,
        body: { newPassword: password, currentPassword, revokeOtherSessions: true }
      });
    } else {
      await auth.api.setPassword({ headers: request.headers, body: { newPassword: password } });
    }
  } catch (err) {
    const code = errorCodeOf(err);
    if (code === 'INVALID_PASSWORD') {
      return json(
        { error: ACCOUNT_COPY.passwordCurrentWrong, field: 'currentPassword' },
        { status: 400 }
      );
    }
    // `setPassword` throws PASSWORD_ALREADY_SET when a credential row exists: it
    // is strictly an ADD, never a replace. Reachable now only if a password was
    // created between our `hasPasswordForUser` read and this call.
    const alreadySet = code === 'PASSWORD_ALREADY_SET';
    return json(
      {
        error: alreadySet ? ACCOUNT_COPY.passwordAlreadySet : ACCOUNT_COPY.passwordSetError
      },
      { status: alreadySet ? 409 : 400 }
    );
  }
  return json({ ok: true, changed: existing });
};

export const DELETE: RequestHandler = async (event) => {
  requireMethod(event, 'password');
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const { request, locals, platform } = event;
  if (!locals.user || !locals.session) {
    return json({ error: ACCOUNT_COPY.signinRequired }, { status: 401 });
  }
  if (
    !(await enforceRate(
      platform!.env.ACCOUNT_EDIT_RL,
      `account_pw:${locals.user.id}`,
      platform!.env,
      {
        critical: true
      }
    ))
  ) {
    return json({ error: ACCOUNT_COPY.tooManyChanges }, { status: 429 });
  }
  const db = getDb(platform!);
  // Resolve the live user ONCE and hand the SAME row to the guard and the
  // delete. Re-resolving would let the check and the destructive write disagree
  // about which row they mean, in a handler whose failure mode is a stranded
  // account (a pseudonymous account without a credential cannot sign back in).
  const live = await liveUserFor(db, locals.user.id);
  // Guard FIRST: nothing is deleted until we know the user has another way back in.
  if (!(await mayRemovePasswordForUser(db, live))) {
    return json({ error: ACCOUNT_COPY.passwordLastFactor }, { status: 409 });
  }
  if (!live || !(await hasPasswordForUser(db, live))) {
    // Already absent: removal is idempotent.
    return json({ ok: true });
  }
  // Better-Auth has NO remove-password API: `setPassword`'s body schema is
  // `z.object({ newPassword: z.string() })`, so a null/empty value is a zod
  // failure, not a removal; `changePassword` and `resetPassword` both only ever
  // write a new hash. Removal is therefore a direct delete of the `credential`
  // account row, the same row `setPassword` creates via `linkAccount`.
  await db
    .delete(account)
    .where(and(eq(account.userId, live.id), eq(account.providerId, CREDENTIAL)));
  // The credential is gone; sessions that may have been minted under it must not
  // outlive it. `revokeOtherSessions` spares the acting session: safe here because
  // `mayRemovePasswordForUser` above has already proven another way back in exists.
  // This runs AFTER the delete on purpose: revoking first would evict the user's
  // other devices even on a run that then fails to remove anything.
  const auth = authFor(event);
  // Non-fatal: the credential row is ALREADY deleted by this point, so throwing here
  // would 500 a removal that in fact succeeded: the user would be told it failed and
  // would retry into the idempotent no-op branch. The removal is the promise this
  // endpoint makes; revocation is hygiene on top of it. Swallowing silently would be
  // worse than the 500 though (stale sessions nobody knows about), so it is logged.
  try {
    await auth.api.revokeOtherSessions({ headers: request.headers });
  } catch {
    console.error('auth.revoke_error', { user_id: live.id, path: 'password.remove' });
  }
  return json({ ok: true });
};

/** Better-Auth surfaces a machine-readable `code` on its APIError body. */
function errorCodeOf(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const body = (err as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
