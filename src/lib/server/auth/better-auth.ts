import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { anonymous, magicLink } from 'better-auth/plugins';
import { haveIBeenPwned } from 'better-auth/plugins/haveibeenpwned';
import { passkey } from '@better-auth/passkey';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import * as schema from '$lib/server/db/schema';
import type { Database } from '$lib/server/db';
import { getDb } from '$lib/server/db';
import { newId } from '$lib/server/ids/factory';
import { sendEmail } from '$lib/server/email/send';
import { buildSignInEmail } from '$lib/server/email-templates/sign-in';
import { buildChangeApprove } from '$lib/server/email-templates/change-approve';
import { buildConfirmEmail } from '$lib/server/email-templates/confirm-email';
import {
  createIdentityForNewVersion,
  handleAccountLink,
  normalizeLinkArgs
} from '$lib/server/user-store/identity';
import { recordUserVersion } from '$lib/server/user-store/history';
import { recordE2eMail } from '$lib/server/e2e/mail-sink';
import { buildResetPasswordEmail } from '$lib/server/email-templates/reset-password';
import { PASSKEY_RP_NAME, PSEUDONYMOUS_EMAIL_DOMAIN } from './brand';
import { googleConfigured, googleProvider } from './google-provider';
import { enabledAuthMethods, methodsFromEnv, type AuthMethod } from './methods';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from './password-policy';
import { mayReceivePasswordReset } from './password-reset-gate';

const BAD_SECRETS = new Set([
  '',
  'DEV_SECRET_CHANGE_FOR_PRODUCTION',
  'change-me',
  'change-me-32-bytes-min'
]);

export function verifyAuthSecret(secret: string) {
  if (BAD_SECRETS.has(secret) || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET is missing, too short (<32 chars), or a known placeholder. Generate one with: openssl rand -hex 32'
    );
  }
}

/** Id generator for all Better-Auth rows: the app's id factory. */
export const authGenerateId = (): string => newId();

/** Append a history snapshot for a just-created/updated Better-Auth user row.
 *  Custom fields (userIdentity/handle) are input:false, so re-read the live row by id
 *  to be certain we capture the canonical current values. */
async function recordHistoryFor(
  db: Database,
  row: { id?: string } | null | undefined
): Promise<void> {
  if (!row?.id) return;
  const [live] = await db.select().from(schema.user).where(eq(schema.user.id, row.id));
  if (!live) return;
  await recordUserVersion({
    db,
    identityId: live.userIdentity,
    handle: live.handle,
    name: live.name,
    email: live.email
  });
}

/** Opt-in sink for the magic-link verify URL. The `magicLink` plugin's `sendMagicLink`
 *  callback runs synchronously inside `auth.api.signInMagicLink`, so a caller that passes
 *  this gets the URL handed back in-process — no eventual-consistency round-trip. The e2e
 *  dev-link seam is its sole consumer; it stays `undefined` (and the URL is never captured)
 *  in production.
 *
 *  `methods` are the sign-in methods to configure. Omitted, they are the ones `AUTH_METHODS`
 *  switches on (less Google without credentials). A method that is off gets no
 *  configuration: password off is `emailAndPassword: { enabled: false }` with no reset or
 *  other callback (so sign-in, sign-up and the reset request are refused), passkey off has
 *  no plugin, Google off has no provider. `/change-password`, `/verify-password` and
 *  `/reset-password` check no configuration at all: the first two need a credential the
 *  caller already holds, the last a reset token, and a token minted while password was on
 *  stays usable for an hour after it is switched off. The path gate over
 *  `methodForAuthPath` is what closes all three while password is off. */
export interface GetAuthOptions {
  captureMagicLink?: (link: { email: string; url: string }) => void;
  methods?: ReadonlySet<AuthMethod>;
}

export function getAuth(
  platform: App.Platform,
  fallbackBaseURL: string,
  opts: GetAuthOptions = {}
) {
  const env = platform.env as unknown as {
    DB: D1Database;
    BETTER_AUTH_SECRET: string;
    BETTER_AUTH_URL?: string;
    AUTH_METHODS?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  };
  verifyAuthSecret(env.BETTER_AUTH_SECRET);
  const methods = opts.methods ?? methodsFromEnv(env);
  // Raw drizzle db for the Better-Auth adapter; the app `Database` wrapper for our helpers.
  const db = drizzle(env.DB, { schema });
  const drizzleDb = getDb(platform);
  // Request-scoped: ids of users created during THIS request. The `getAuth` closure is
  // re-created per request, so concurrent requests never share this set. Used to tell an
  // upgrade (the OAuth row was freshly minted this request → orphan identity to discard)
  // from a fuse (the OAuth row pre-existed → its identity wins). Populated in
  // `create.after` because Better-Auth mints `id` inside the adapter create — AFTER the
  // `create.before` hook runs — so `userData.id` is undefined in `before`.
  const freshlyCreated = new Set<string>();
  const baseURL = env.BETTER_AUTH_URL ?? fallbackBaseURL;
  const rpID = new URL(baseURL).hostname;
  // In `wrangler dev` with a `custom_domain` route, the worker sees the
  // request URL as the prod hostname while the browser's
  // Origin header is localhost. Trust both runtime values so OAuth POSTs
  // pass the origin check from either angle. In prod both collapse to the
  // real origin, so the trusted set stays narrow.
  const trustedOrigins = Array.from(new Set([baseURL, fallbackBaseURL]));
  const google =
    methods.has('google') && googleConfigured(env)
      ? {
          google: googleProvider({
            GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID!,
            GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET!
          })
        }
      : {};
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema
    }),
    baseURL,
    trustedOrigins,
    secret: env.BETTER_AUTH_SECRET,
    advanced: { database: { generateId: authGenerateId } },
    // Link a trusted Google account to the current signed-in account (e.g. a magic-link user adds Google).
    account: { accountLinking: { enabled: true, trustedProviders: ['google'] } },
    // Password is a switchable method (`AUTH_METHODS`); off by default. Off means the bare
    // `{ enabled: false }`: Better-Auth's reset request route checks only for
    // `sendResetPassword`, never `enabled`, and the reset route checks nothing, so leaving
    // the callback configured would keep the reset flow live.
    emailAndPassword: methods.has('password')
      ? {
          enabled: true,
          // There is NO password sign-up path in this product. Onboarding is zero-barrier and
          // pseudonymous (the `anonymous()` plugin); a password is only ever SET on an already
          // signed-in session. Without this flag, `enabling` email+password publishes an
          // unauthenticated POST /api/auth/sign-up/email (sign-up.mjs gates solely on
          // `enabled || disableSignUp`) whose USER_ALREADY_EXISTS error is an email-enumeration
          // oracle — exactly what the reset gate below works to avoid. `disableSignUp` is read
          // ONLY by that route: setPassword/changePassword (update-user.mjs) and
          // requestPasswordReset/resetPassword (password.mjs) never consult it, so the
          // add-a-credential flows this design depends on stay open.
          disableSignUp: true,
          minPasswordLength: PASSWORD_MIN_LENGTH,
          maxPasswordLength: PASSWORD_MAX_LENGTH,
          // Do NOT enable autoSignIn — setting a password is an add-a-credential action
          // on an already-signed-in session, never a sign-up.
          autoSignIn: false,
          // Reset is sessionless recovery — the requester may be locked out precisely
          // because someone else holds a live session, and `resetPassword` runs off a
          // token with no caller session to preserve. So ALL sessions die here, unlike
          // the change path (see the route), which keeps the caller on a rotated token.
          revokeSessionsOnPasswordReset: true,
          /**
           * Conditional by design — see password-reset-gate.ts for the two refusals.
           * Refusal is SILENT: better-auth's forgetPassword returns the same neutral
           * response either way, matching the enumeration posture of the magic-link
           * sign-in action. Do not "fix" this into unconditional sending.
           *
           * KNOWN, ACCEPTED (not fixed here): better-auth creates the verification row BEFORE
           * invoking this callback (password.mjs:63-70), so a refused address still accrues one
           * unusable reset token per request. The token is inert — a refused address can never
           * receive the link — but the rows do accumulate. Fixing it needs an upstream change or
           * a pre-route hook; deliberately out of scope for this change.
           */
          sendResetPassword: async ({
            user,
            url
          }: {
            user: { email: string; emailVerified: boolean };
            url: string;
          }) => {
            if (!mayReceivePasswordReset(user)) return;
            // e2e seam, mirroring the change-email records below: the reset URL never appears
            // in any HTTP response, so a test has no other way to follow the link. This is an
            // ADDITION, not a short-circuit — the real send still happens. Better-Auth wraps
            // this callback in runInBackgroundOrAwait, so it can land after the response
            // returns; readers must poll, not read once.
            recordE2eMail(platform, 'password-reset', user.email, url);
            await sendEmail(platform, { to: user.email, ...(await buildResetPasswordEmail(url)) });
          }
        }
      : { enabled: false },
    user: {
      // modelName removed — Better-Auth's `user` model maps to the table literally named `user`.
      // NOT-NULL custom columns must be declared or transformInput drops them on insert.
      // Keys are the camelCase drizzle field names; Drizzle maps them to snake_case columns.
      //
      // `required: false` is deliberate even though the DB columns are NOT NULL: these values
      // never arrive from input — the `databaseHooks.user.create.before` hook below mints and
      // stamps them on EVERY new user, and the NOT NULL constraint is the real backstop. Marking
      // them `required: true` makes COLD social sign-up throw `<field> is required`: Better-Auth
      // validates required fields against the OAuth profile (parseAdditionalUserInputFromProviderProfile,
      // action "create") BEFORE the create.before hook runs, and a Google profile never carries these
      // `input:false` fields. The magic-link path skips that validation, and the social LINK path runs
      // action "update" (which never required-checks) — so this only bites a brand-new Google user
      // (a create). It stayed hidden while anonymous accounts existed (Google was always a link onto the
      // pre-created anon row) and again once Google had `disableSignUp:true`; lifting both re-exposed it.
      //
      // Do NOT declare `isAnonymous` here — the anonymous plugin already adds it to the schema.
      additionalFields: {
        userIdentity: { type: 'string', required: false, input: false },
        handle: { type: 'string', required: false, input: false },
        handleSkeleton: { type: 'string', required: false, input: false }
      },
      changeEmail: {
        enabled: true,
        // Sent to the CURRENT (verified) address to approve the change. `user` here is
        // the current session user; clicking the link triggers sendVerificationEmail to
        // the new address (the second hop) via better-auth's verify-email route.
        sendChangeEmailConfirmation: async ({
          user,
          newEmail,
          url
        }: {
          user: { email: string };
          newEmail: string;
          url: string;
        }) => {
          recordE2eMail(platform, 'change-email-approve', user.email, url);
          await sendEmail(platform, {
            to: user.email,
            ...(await buildChangeApprove(url, newEmail))
          });
        }
      }
    },
    emailVerification: {
      // 15-minute link lifetime — matches the magic-link expiry and the "expires in 15
      // minutes" copy in the approve/confirm templates (both change-email tokens read this).
      expiresIn: 60 * 15,
      // Only ever fires for the change-email second hop (we don't enable verify-on-signup).
      // `user.email` here is the NEW address.
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        recordE2eMail(platform, 'change-email-verify', user.email, url);
        await sendEmail(platform, { to: user.email, ...(await buildConfirmEmail(url)) });
      }
    },
    // Google is a switchable method (`AUTH_METHODS`, plus credentials); off by default.
    socialProviders: google,
    databaseHooks: {
      user: {
        create: {
          // Mint a fresh stable identity for EVERY new user (anon, magic-link, or OAuth) and
          // stamp its columns onto the head user row. `userData.id` is not yet assigned here.
          before: async (userData) => {
            const cols = await createIdentityForNewVersion({
              db: drizzleDb,
              pseudonymous: userData.isAnonymous === true,
              displayName: userData.name
            });
            return { data: { ...userData, ...cols } };
          },
          // Now `created.id` exists — record it so onLinkAccount can detect an upgrade.
          // Also append the initial history snapshot for the new live row.
          after: async (created) => {
            if (created?.id) freshlyCreated.add(created.id);
            // Re-reads the live row so custom fields (userIdentity/handle) are present even
            // if Better-Auth's create.after payload omits input:false columns.
            await recordHistoryFor(drizzleDb, created);
          }
        },
        update: {
          // Any in-place attribute edit appends a history snapshot (the choke-point invariant).
          after: async (updated) => {
            await recordHistoryFor(drizzleDb, updated);
          }
        }
      }
    },
    plugins: [
      anonymous({
        emailDomainName: PSEUDONYMOUS_EMAIL_DOMAIN,
        disableDeleteAnonymousUser: true,
        onLinkAccount: async (args) => {
          // Fail-loud: a reconcile failure here means the identity graph is inconsistent —
          // surfacing beats silently hiding a bad graph.
          const isUpgrade = freshlyCreated.has(args.newUser.user.id);
          freshlyCreated.delete(args.newUser.user.id);
          await handleAccountLink({ db: drizzleDb, isUpgrade, ...normalizeLinkArgs(args) });
        }
      }),
      magicLink({
        // A never-seen email creates an account on verify (cold signup).
        disableSignUp: false,
        expiresIn: 60 * 15,
        sendMagicLink: async ({ email, url }) => {
          // Test-only seam: the API response never includes the verification URL, so a
          // caller that needs it (the e2e dev-link helper) passes `captureMagicLink` and
          // receives it here, synchronously, in the same request. Only the e2e onboarding
          // paths pass the sink; it is absent in production.
          opts.captureMagicLink?.({ email, url });
          await sendEmail(platform, { to: email, ...(await buildSignInEmail(url)) });
        }
      }),
      // Passkey is a switchable method (`AUTH_METHODS`); off by default, and then its
      // endpoints do not exist.
      ...(methods.has('passkey')
        ? [
            passkey({
              rpID,
              rpName: PASSKEY_RP_NAME,
              origin: baseURL
            })
          ]
        : []),
      haveIBeenPwned(),
      // sveltekitCookies MUST be last so auth.api.* calls set the session cookie.
      sveltekitCookies(getRequestEvent)
    ]
  });
}

/** The auth instance for a request, configured with the methods switched on for it. */
export function authFor(event: RequestEvent, opts: Omit<GetAuthOptions, 'methods'> = {}) {
  return getAuth(event.platform!, event.url.origin, {
    ...opts,
    methods: enabledAuthMethods(event)
  });
}
