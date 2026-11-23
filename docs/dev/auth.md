# Accounts

Sign-in and accounts. Better-Auth owns sessions and credentials; the app owns identity in D1.

## Identity model

Nine tables, all in D1 (`src/lib/server/db/schema/`):

- `principal`: the supertype of every identity; `user_identity.id` references it (`kind` `'identity'`).
- `user_identity`: the stable id the app keys off. `superseded_by_id` and `superseded_at` form the survivor graph used when two accounts fuse; `deleted_at` marks a deleted account. A deletion keeps the row and sets `deleted_at`.
- `user`: Better-Auth's live row, one per identity (`name`, `email`, `handle`, `image`, `is_anonymous`).
- `session`, `account`, `passkey`: Better-Auth's sessions, credentials (Google, password hash) and passkeys, keyed by the live `user.id`.
- `verification`: Better-Auth's one-time tokens (sign-in links, email confirmation, password reset).
- `user_version`: append-only history of handle, name and email per identity, written only by `recordUserVersion` (`src/lib/server/user-store/history.ts`).
- `handle_tombstone`: a handle vacated by a rename or a deletion, held from reuse until `expires_at` (one year).

`locals.user.id` is the stable identity id. `locals.session.userId` is the live `user.id`; the two are different id spaces. `resolveSessionUser` in `src/lib/server/user-store/user.ts` follows the survivor graph to the live row and returns null for a deleted identity. Writers keep the graph a depth-1 star: every superseded identity points straight at its survivor (`survivorId`).

Schema files import with relative paths (`../columns`), never `$lib/...`: drizzle-kit cannot resolve `$lib`, and `npm run db:generate` fails.

### Pseudonymous accounts

A pseudonymous account is Better-Auth's `anonymous()` plugin with the email domain `PSEUDONYMOUS_EMAIL_DOMAIN` (`src/lib/server/auth/brand.ts`).

- One mint seam: `mintPseudonymousSession` (`src/lib/server/onboarding/pseudonymous-mint.ts`), behind `PSEUDO_MINT_RL` (key `pseudo_mint:<ip>`, critical). Its refusals are 429 with `AUTH_COPY.tooManyAccounts` and 500 with `AUTH_COPY.sessionStart`. `POST /api/auth/sign-in/anonymous` answers 404, so the rate limit cannot be bypassed.
- The mint's one caller is `PUT /api/game/[id]` with no session, at a first win: a save whose `progress.firstWinAt` is null answers 422 `no_win` and makes nothing. A known device (`sfh_known`) is asked to sign in instead: 401 `{ error: 'sign_in' }`, and nothing is made. See [game-save.md](game-save.md).
- The known-device cookie `sfh_known` (`src/lib/server/onboarding/known-device.ts`) is set by the root layout load on any signed-in request whose account is not pseudonymous or holds a passkey.
- No account is reaped. A pseudonymous account whose session has expired is kept.
- Email and Google end pseudonymity, through the plugin's `onLinkAccount` and `handleAccountLink` (`src/lib/server/user-store/identity.ts`). When the address or Google account is new, the pseudonymous identity survives and takes the new live row (an upgrade). When it already belongs to another identity, the two fuse: the pseudonymous identity points at that identity's survivor and its live row is deleted. Only email and Google fuse.
- `handleAccountLink` takes an optional `onFuse(survivorId, absorbedId)`. It runs once, after the fuse batch has committed, and only on a fuse that wrote: never on an upgrade, when the two identities are already one, or when either live row is missing. A rejection propagates, so the sign-in fails. `onLinkAccount` calls `handleAccountLink` with `db`, `isUpgrade` and the two live user ids. `onLinkAccountFor` in `better-auth.ts` supplies `onFuse` as `moveGames`: a fuse moves the absorbed identity's saved games to the survivor ([game-save.md](game-save.md)).
- A password makes an account durable and keeps it pseudonymous. Sign-in is by handle and password: the action resolves the handle itself (`resolveHandleToEmail` in `src/lib/server/auth/magic-link.ts`). A password is set from `/account` on a signed-in session. Policy is length plus a breach check (`password-breach.ts`).
- Password reset mails only a verified, deliverable address (`mayReceivePasswordReset` in `src/lib/server/auth/password-reset-gate.ts`).

### Sign out

`/account` has a `Sign out` form action (`signOut` in `src/routes/account/+page.server.ts`): Better-Auth's `signOut` deletes the session row and clears the session cookies, and the visitor lands on `/` signed out. The known-device cookie stays. Sign out is offered, and the action acts, only for an account that can sign back in: not pseudonymous, or holding a passkey, a password or a Google account. For any other the action keeps the session and returns to `/account`.

### Deletion

`DELETE /api/account` runs the origin check, answers 401 with no user and 400 `{ deleteError }` on a wrong handle, then calls `deleteAccount({ db, identityId })` (`src/lib/server/user-store/deletion.ts`), signs out best-effort and answers 200 `{ ok: true }`. One request does it all. `deleteAccount` follows the survivor graph, returns at once for an unknown or already deleted identity, and otherwise runs `closeAccountRows`, in this order:

1. Release the handle to `handle_tombstone`.
2. Scrub the live `user` row to `deleted-<id>`, `deleted-<id>@example.com` and `Deleted User`.
3. Record that tombstone as a `user_version` row.
4. Hash the email and name of earlier `user_version` rows across the identity union (the survivor and every identity fused into it).
5. Delete every `game_save` row, live and removed, of the identity union (`deleteGamesOf`).
6. Delete the live user's `session`, `account` and `passkey` rows.
7. Set `user_identity.deleted_at`, last.

Each step commits on its own and is idempotent, and a completed deletion is a no-op. `resolveSessionUser` returns null for a deleted identity, so a lingering session does not authenticate.

## Sign-in methods

One var, `AUTH_METHODS`, switches the methods: a comma list of `magic-link`, `password`, `passkey`, `google`. It is read only in `src/lib/server/auth/methods.ts`. Unknown tokens are dropped and `magic-link` is always listed. Google also needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and is off without them.

Magic link is in effect only while mail can be delivered: it switches on when `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`, or `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`, are set. `enabledAuthMethods` drops it otherwise, through `mailCanBeDelivered` in `src/lib/server/email/provider.ts`, the same condition `sendEmail` uses to choose a provider over log mode. An e2e build keeps it, because its mail sink stands in for a provider. A local `npm run dev` or `npm run preview` without a provider has no magic link.

With no sign-in method in effect, the header shows no `Sign in` for a signed-out visitor (the root layout's `signInAvailable`), `/signin` renders its heading and no form, `/account` renders no control that sends mail (add, confirm or change an address), and every path that would send a magic link or a verification mail answers 404 (below). Account deletion keeps working.

Staging and production run with `AUTH_METHODS=magic-link,password,google,passkey` (in `wrangler.jsonc`). Password and passkey are on. Google stays off, exactly as if unlisted, until both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set; adding them switches it on with no deploy of code. Magic link stays off until a mail provider is configured.

A disabled method is off in three places:

- Its Better-Auth paths answer 404 at the gate in `src/routes/api/auth/[...all]/+server.ts`, decided by `methodForAuthPath` and `enabledAuthMethods`. Better-Auth's own handlers are not a sufficient gate: its reset-password, change-password and verify-password endpoints act even with `emailAndPassword.enabled` false. Magic link's paths are the ones that send mail: `/sign-in/magic-link`, `/send-verification-email`, `/change-email` and `/verify-email`; `/magic-link/verify` sends nothing and stays open.
- Its pages and account APIs answer 404 through `requireMethod(event, method)` in `src/lib/server/auth/require-method.ts`. Use it in any new route that belongs to a method. For magic link these are the `/signin` `sendLink` action, `/api/account/email` and `/api/account/email/verify`; for password, `/forgot-password`, `/reset-password` and `/api/account/password`.
- Its controls do not render.

### Turning a method on in a test

In an e2e build, a cookie named `sfh_e2e_auth_methods` (`E2E_AUTH_METHODS_COOKIE`) replaces `AUTH_METHODS` for that browser context. Specs call `enableAuthMethods(context, ['password'])` from `e2e/helpers/auth.ts`. The server honours the cookie only when `isE2eEnv` is true (`src/lib/server/e2e/env.ts`): `VITE_E2E=1` was set at build time, which inlines the check so a normal build drops the branch, and `ENVIRONMENT=development` at run time. Staging and production fail both tests.

Local dev reads `wrangler.jsonc`'s `AUTH_METHODS`, so it runs every method the environments do; to narrow it, put `AUTH_METHODS=magic-link,password` (say) in `.dev.vars` (magic link itself also needs a mail provider there; see [developing.md](developing.md)). The e2e server pins `AUTH_METHODS=magic-link` and empty mail keys with `--var` flags, which override `.dev.vars`: the suite always runs with magic link only and in mail log mode.

## Session gate

`src/hooks.server.ts` constructs Better-Auth and reads the database only when a session cookie is present or the route needs one (`shouldResolveSession` in `src/lib/server/auth/session-gate.ts`). The routes that need one are the eight `SESSION_ROUTE_PREFIXES` there: `/api/auth`, `/account`, `/api/account`, `/signin`, `/forgot-password`, `/reset-password`, `/api/e2e` and `/api/game`. A signed-out visitor to a public page never constructs Better-Auth and gets no cookie. Everything under `/data/` never resolves a session, even with a cookie, because its responses are public and cached. A request on any other path that carries a session cookie still resolves the session; a path with no route then answers 404.

A new page or API that reads or sets the session for a visitor with no cookie yet must be added to `SESSION_ROUTE_PREFIXES`.

### JSON routes

SvelteKit's origin check covers only form content types. The account and game routes that change state (under `/api/account`, and `PUT` and `DELETE /api/game/[id]`) therefore call `refuseUnlessSameOriginJson` (`src/lib/server/security/same-origin-json.ts`) first: it answers 415 `{ error: AUTH_COPY.jsonRequired }` ("Send JSON.") for a request that is not `application/json`, and 403 `{ error: AUTH_COPY.crossOrigin }` ("Cross-site requests are not allowed.") for a foreign `Origin` (`refuseForeignOrigin`). A new route of this kind must do the same, and its client must send `content-type: application/json` even with no body. The publish routes (`POST /api/plans`, `POST /api/policies`) read no session: they answer 415 for a body that is not JSON and take any origin ([plan-sharing.md](plan-sharing.md)). `AUTH_COPY` is in `src/lib/account/copy.ts`.

### Rate limits

`enforceRate` in `src/lib/server/security/rate-limit.ts` wraps the Workers rate-limit bindings in `wrangler.jsonc`. `ENVIRONMENT=development` always allows. A missing binding fails closed in production only for a call that passes `critical: true`.

| Binding                  | Namespace (production, staging) | Per minute | Read by                                                                                                                           |
| ------------------------ | ------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLISH_RL`             | 4101, 4201                      | 10         | `src/lib/server/sharing/publish.ts`                                                                                               |
| `AUTH_LINK_RL`           | 4102, 4202                      | 5          | `/signin` `sendLink`, `/forgot-password`, `/api/account/email`, `/api/account/email/verify`, the `/api/auth` paths that send mail |
| `AUTH_PASSWORD_RL`       | 4103, 4203                      | 5          | `/signin` `signInPassword`, `/reset-password`, `/api/auth/sign-in/email`, `/api/auth/reset-password`                              |
| `PSEUDO_MINT_RL`         | 4104, 4204                      | 5          | `mintPseudonymousSession`                                                                                                         |
| `ACCOUNT_EDIT_RL`        | 4106, 4206                      | 10         | `/api/account/password`, `/api/account/profile`                                                                                   |
| `MUTATION_REGISTERED_RL` | 4107, 4207                      | 120        | `PUT` and `DELETE /api/game/[id]`, keyed `game_write:<identityId>`                                                                |

## Mail

Templates are in `src/lib/server/email-templates/` and are sent by `sendEmail` (`src/lib/server/email/send.ts`): sign-in link (`sign-in.ts`), password reset (`reset-password.ts`), email-change approve (`change-approve.ts`) and confirm (`confirm-email.ts`).

- `EMAIL_PROVIDER` picks the backend: `ses` (default) or `resend`.
- With no provider configured (`mailProvider` in `src/lib/server/email/provider.ts` returns null), mail runs in log mode: `sendEmail` logs `[email:log-mode]` with only the from address, the recipient and the subject, and returns `{ sent: false, logged: true }`. The link is not logged. Magic link is therefore off until a provider is configured (see Sign-in methods). The only readable copy is the e2e-only dev link on `/signin` and `/api/e2e/mail`.
- No mail goes to an address `isDeliverable` refuses (same module): a pseudonymous account's `PSEUDONYMOUS_EMAIL_DOMAIN` address.
- `SES_FROM` must be set even in log mode, or `sendEmail` throws. It is a var in `wrangler.jsonc`, which local dev also reads.

## e2e seams

All guarded by `VITE_E2E` and `isE2eEnv`, so a normal build answers 404:

- `POST /api/e2e/login` with `{ email }` mints or reuses a registered user; with `{ pseudonymous: true }` it mints a fresh pseudonymous account (`mintTestPseudonym` in `src/lib/server/e2e/session.ts`, its address lower-cased whole). Either way it sets a signed session cookie and answers `{ userId }`, the identity id. Helpers: `loginAs` (`e2e/helpers/auth.ts`) and `startPseudonymous` (`e2e/helpers/account.ts`).
- `GET /api/e2e/mail?kind=<kind>&to=<address>` returns `{ url }` for the latest mail of that kind (`password-reset`, `change-email-approve`, `change-email-verify`) from an in-process sink; any other kind answers 404. Helper: `readMail`.
- `POST /api/e2e/plans` seeds published plan and policy rows (`src/lib/server/sharing/e2e-seed.ts`). Helper: `seedPlanRow` (`e2e/helpers/sharing.ts`).
- The sign-in methods cookie above. Helper: `enableAuthMethods`.
- The magic link of a sign-in shows on `/signin` as `dev-link`. Helper: `followMagicLink`.

`wrangler dev` for e2e runs with `ENVIRONMENT=development` and a fixed `BETTER_AUTH_SECRET`; see `playwright.config.ts`.

## Secrets and vars

See [deploy.md](deploy.md) for where each is set.

- `BETTER_AUTH_SECRET` must be set, at least 32 characters and not a placeholder (`verifyAuthSecret` in `src/lib/server/auth/better-auth.ts`). Without it every request that resolves a session fails with a 500: any request carrying a session cookie, on any page, plus the routes in `SESSION_ROUTE_PREFIXES`. A signed-out visitor to a public page is unaffected.
- `BETTER_AUTH_URL`: Better-Auth's base URL; the request's origin when unset.
- Mail keys: `EMAIL_PROVIDER`, `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`, or `RESEND_API_KEY` (Mail).
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google sign-in, with `google` in `AUTH_METHODS`.
- `AUTH_METHODS` and `SES_FROM`: vars in `wrangler.jsonc` (Sign-in methods, Mail).
