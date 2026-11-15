# Accounts, sims and invitations

Sign-in, accounts, sims (a person's saved policy with a roster) and invitations. Better-Auth owns sessions and credentials; the app owns identity, roles and membership in D1.

## Identity model

Three tables, all in D1:

- `user_identity`: the stable id the app keys off. It carries `superseded_by_id` and `superseded_at` (the survivor graph used when two accounts fuse). It is never deleted.
- `user`: Better-Auth's live row, one per identity (current `name`, `email`, `handle`, `image`). `session`, `account` and `passkey` point at it.
- `user_version`: append-only history of handle, name and email, written only by `recordUserVersion` in `src/lib/server/user-store/history.ts`.

`locals.user.id` is the stable identity id. `locals.session.userId` is the live `user.id`; the two are different id spaces. `resolveSessionUser` in `src/lib/server/user-store/user.ts` follows the survivor graph to the live row.

All the port's tables came from one migration, `migrations/d1/20261114112404_bizarre_oracle.sql`. Schema files under `src/lib/server/db/schema/` import with relative paths (`../columns`), never `$lib/...`, because drizzle-kit cannot resolve `$lib` and `npm run db:generate` fails.

### Pseudonymous accounts

A pseudonymous account (Better-Auth `anonymous()` plugin, email `@pseudonymous.sfhousing.invalid`, constant `PSEUDONYMOUS_EMAIL_DOMAIN` in `src/lib/server/auth/brand.ts`) is minted when a person creates a sim, joins from an invite, or presses `Start fresh without an account` on `/signin`. Nothing is minted for a visitor who only browses. The mint is rate limited (`PSEUDO_MINT_RL`).

- The known-device cookie `sfh_known` is set for non-pseudonymous users and passkey holders. A signed-out known device that tries to create a sim goes to `/signin` instead of minting again; the intent is kept in `sfh_pending_sim` and resumed after sign-in.
- Email and Google end pseudonymity and can fuse two accounts (`onLinkAccount`, `handleAccountLink`). A password or a passkey does not fuse two accounts.
- A password makes an account durable without ending pseudonymity. Sign-in is by handle and password: the action resolves the handle itself (`resolveHandleToEmail` in `src/lib/server/auth/magic-link.ts`). Better-Auth's `username` plugin is not installed. There is no password sign-up; a password is set from `/account` on a signed-in session. Policy is length only plus a breach check (`password-breach.ts`).
- Password reset mails only a verified, deliverable address (`mayReceivePasswordReset` in `src/lib/server/auth/password-reset-gate.ts`). A pseudonymous account with no verified email has no reset path.
- A pseudonymous account whose sessions have all been expired longer than `REAP_GRACE_MS` and that holds no passkey, password or Google account is reapable (see Reaping).

### Sign out

`/account` has a `Sign out` form action (`signOut` in `src/routes/account/+page.server.ts`): Better-Auth's `signOut` deletes the session row and clears the session cookies, and the visitor lands on `/` signed out. The known-device cookie stays, as in planafoot, so the next sim on that device steers to `/signin`. Sign out is offered, and the action acts, only for an account that can sign back in: not pseudonymous, or holding a passkey, a password or a Google account; for any other the action keeps the session and returns to `/account`, since its sims would be lost.

### Deletion

`deleteAccount` in `src/lib/server/user-store/deletion.ts` scrubs the live `user` row to a `deleted-<id>` tombstone, hashes email and name in earlier `user_version` rows, sets `user_identity.deleted_at` and removes the user from their sims. A sim left with no members is deleted with its pending invites. `resolveSessionUser` returns null for a tombstoned identity, so a lingering session does not authenticate.

## Sign-in methods

One var, `AUTH_METHODS`, switches the methods: a comma list of `magic-link`, `password`, `passkey`, `google`. It is read only in `src/lib/server/auth/methods.ts`. Unknown tokens are dropped and `magic-link` is always listed. Google also needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and is off without them.

Magic link is in effect only while mail can be delivered: it switches on when `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`, or `EMAIL_PROVIDER=resend` and `RESEND_API_KEY`, are set. `enabledAuthMethods` drops it otherwise, through `mailCanBeDelivered` in `src/lib/server/email/provider.ts`, the same condition `sendEmail` uses to choose a provider over log mode. An e2e build keeps it, because its mail sink stands in for a provider. So does nothing else: a local `npm run dev` or `npm run preview` without a provider has no magic link.

With no sign-in method in effect, the header shows no `Sign in` for a signed-out visitor (the root layout's `signInAvailable`), `/signin` still answers and keeps `Start fresh without an account` but renders no email form, `/account` renders no control that sends mail, and every path that would send a magic link or a verification mail answers 404 (below). A pseudonymous account, sims, invites by handle and account deletion keep working.

Staging and production run with `AUTH_METHODS=magic-link` (in `wrangler.jsonc`): the pseudonymous account and the email magic link only, once a mail provider is configured.

A disabled method is off in three places:

- Its Better-Auth paths answer 404 at the gate in `src/routes/api/auth/[...all]/+server.ts`, decided by `methodForAuthPath` and `enabledAuthMethods`. Better-Auth's own handlers are not a sufficient gate: its password-reset, change-password and verify-password endpoints act even with `emailAndPassword.enabled` false. Magic link's paths are the ones that send mail: `/sign-in/magic-link`, `/send-verification-email`, `/change-email` and `/verify-email`; `/magic-link/verify` sends nothing and stays open.
- Its pages and account APIs answer 404 through `requireMethod(event, method)` in `src/lib/server/auth/require-method.ts`. Use it in any new route that belongs to a method. For magic link these are the `/signin` `sendLink` action, `/api/account/email`, `/api/account/email/verify` and the invite page's `join` when it would send a link.
- Its controls do not render.

### Turning a method on in a test

In an e2e build, a cookie named `sfh_e2e_auth_methods` (`E2E_AUTH_METHODS_COOKIE`) replaces `AUTH_METHODS` for that browser context. Specs call `enableAuthMethods(context, ['password'])` from `e2e/helpers/auth.ts`. The server honours the cookie only when `isE2eEnv` is true (`src/lib/server/e2e/env.ts`): `VITE_E2E=1` was set at build time, which inlines the check so a normal build drops the branch, and `ENVIRONMENT=development` at run time. Staging and production fail both tests, so a cookie cannot switch a method on there.

To turn a method on for local dev, put `AUTH_METHODS=magic-link,password` in `.dev.vars` (magic link itself also needs a mail provider there; see [developing.md](developing.md)). The e2e server pins `AUTH_METHODS=magic-link` and empty mail keys with `--var` flags, which override `.dev.vars`: the suite always runs with magic link only and in mail log mode, so it never sends real mail.

## Session gate

`src/hooks.server.ts` does Better-Auth, database and capability work only when a session cookie is present or the route needs one (`shouldResolveSession` in `src/lib/server/auth/session-gate.ts`). The routes that need one are listed in `SESSION_ROUTE_PREFIXES` there. A signed-out visitor to a public page never constructs Better-Auth and gets no cookie, with the same cache headers as before sign-in existed. Everything under `/data/` never resolves a session, even with a cookie, because its responses are public and cached.

`/api/sims/<id>/stream`, the sim websocket, is under `/api/sims` and so resolves the session. A websocket upgrade reads it with `disableRefresh` (the 101 response's headers cannot be changed), and the route checks `Origin` with `refuseForeignOrigin` from the same module as the JSON routes below. See [sim-object.md](sim-object.md).

A new page or API that reads or sets the session for a visitor with no cookie yet must be added to `SESSION_ROUTE_PREFIXES`.

### JSON routes

SvelteKit's origin check covers only form content types. Every state-changing JSON route therefore calls `refuseUnlessSameOriginJson` (`src/lib/server/security/same-origin-json.ts`) first: it answers 415 for a request that is not `application/json` and 403 for a foreign `Origin`. A new route of this kind must do the same, and its client must send `content-type: application/json` even with no body.

### Rate limits

`enforceRate` in `src/lib/server/security/rate-limit.ts` wraps the Workers rate-limit bindings: `PUBLISH_RL`, `AUTH_LINK_RL`, `AUTH_PASSWORD_RL`, `PSEUDO_MINT_RL`, `INVITE_RL`, `ACCOUNT_EDIT_RL`, `MUTATION_REGISTERED_RL` (`wrangler.jsonc`, namespaces 4101 to 4107 production and 4201 to 4207 staging). `ENVIRONMENT=development` always allows. A missing binding fails closed in production only for a call that passes `critical: true`.

## Mail

Templates are in `src/lib/server/email-templates/` and are sent by `sendEmail` (`src/lib/server/email/send.ts`): sign-in link, password reset, email-change approve and confirm, and invite.

- `EMAIL_PROVIDER` picks the backend: `ses` (default) or `resend`.
- With no provider configured (`mailProvider` in `src/lib/server/email/provider.ts` returns null: no `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`, or `EMAIL_PROVIDER=resend` without `RESEND_API_KEY`), mail runs in log mode: `sendEmail` logs `[email:log-mode]` with only the from address, the recipient and the subject, and returns `{ sent: false, logged: true }`. The link is not logged. Magic link is therefore off until a provider is configured (see Sign-in methods); an emailed invite is still created but its mail cannot be read. The only readable copy is the e2e-only dev link on `/signin` and `/api/e2e/mail`.
- No mail goes to an address `isDeliverable` refuses (same module): a pseudonymous account's `PSEUDONYMOUS_EMAIL_DOMAIN` address. Invite create and resend skip it, and the manager's pending-invite view does not mark such an invite as emailed, so Resend is not offered.
- `SES_FROM` must be set even in log mode, or `sendEmail` throws. It is a var in `wrangler.jsonc`, which local dev also reads.

## Authorization and roles

Every grant is an append-only event in the `capability_event` ledger; the effective set is a fold. The pure matcher `authorize()` in `src/lib/server/authz/` sits behind one request seam, `requireCap(event, ability, resource)`.

- Resource types are `app` and `sim`. A sim role (`manager`, `editor`, `viewer`) is a bundle capability on that sim (`simCaps`, `src/lib/server/authz/sim-caps.ts`). Sim checks use membership only: an app-scoped operator capability does not give access to a sim.
- Operator capabilities are in `src/lib/server/operator/`. An address listed in `BOOTSTRAP_EMAILS` (comma list, a secret) and verified gets the app wildcard on any request that resolved a session user.
- The first member of a sim is a manager. Roles change through `src/lib/server/sims/sim-roles.ts`.

## Sims and membership

Sims are rows in `sim_index` (`src/lib/server/sims/sim-index.ts`); membership is the ledger. `startSim` (`src/lib/server/sims/start-sim.ts`) creates a sim and mints a pseudonymous account when the visitor has none. Pages are `/sims` and `/sims/[simId]`; the API is under `/api/sims`.

Membership is D1 only. The per-sim object (`SimObject`, [sim-object.md](sim-object.md)) holds the log and not the roster: the stream route reads the role and tells the object whether the socket may write. `onSimRosterChanged` in `src/lib/server/sims/roster-hook.ts` is still a no-op seam; the control plane unit makes it call the object's `rereadRoles()` after the roster change is written. It is called after a roster change that leaves the sim alive. A sim whose last member leaves is deleted with its pending invites (`removeSimMember` in `src/lib/server/sims/sims.ts`).

## Invitations

`src/lib/server/invites/`. An invite is a bearer token, stored only as a SHA-256 hash (`token.ts`). The link is `/invite/<token>`; the mail is `invite.ts` in `email-templates/`. Create, revoke, resend, accept and decline are under `/api/sims/[simId]/invites` and `/api/invites/[inviteId]`.

- An invite names an email or a handle. A visitor with no account who opens it is classified by `classifyColdAccept` in `claim.ts`: mint (a handle invite mints a pseudonymous account; an emailed invite mints an email-bound account), sign in (the entered email owns an account), or verify (the entered email differs from the invited one).
- On failure the members routes and actions answer `{ code }` (`memberErrorCode` in `src/lib/server/invites/error-code.ts` maps the services' thrown reasons; anything else is `failed`), never an error's text. The pages show `memberErrorText(code)` from `MEMBER_ERROR_COPY` in `src/lib/members/copy.ts`. A new reason needs a code there.
- Accepting calls `onSimRosterChanged`; declining changes no roster and does not. The call sites are `createSim` and `removeSimMember` (when the sim survives) in `src/lib/server/sims/sims.ts`, the API accept route `src/routes/api/invites/[inviteId]/accept/+server.ts`, and the two accept paths (signed in, and cold accept) of `src/routes/invite/[token]/+page.server.ts`.

## e2e seams

All guarded by `isE2eEnv`, so a normal build answers 404 or drops them:

- `POST /api/e2e/login` with `{ email }` mints or reuses a registered user and sets a signed session cookie. Helper: `loginAs`.
- `GET /api/e2e/mail?kind=<kind>&to=<address>` returns `{ url }` for the latest mail of that kind (`password-reset`, `change-email-approve`, `change-email-verify`, `invite`) from an in-process sink. Helper: `readMail`.
- The sign-in methods cookie above. Helper: `enableAuthMethods`.
- The magic link of a sign-in shows on `/signin` as `dev-link`. Helper: `followMagicLink`.

All helpers are in `e2e/helpers/auth.ts`. `wrangler dev` for e2e runs with `ENVIRONMENT=development` and a fixed `BETTER_AUTH_SECRET`; see `playwright.config.ts`.

## Reaping

The reaper functions exist and have no trigger. `selectReapableUsers` (`src/lib/server/reap/eligibility.ts`) picks up to `REAP_BATCH` pseudonymous accounts whose sessions have all been expired for `REAP_GRACE_MS` (48 hours) and that are not durable (no passkey, password or Google account), and `reapUser` (`reap-user.ts`) removes one. Nothing calls them: there is no cron or queue.

## Secrets and vars

See [deploy.md](deploy.md) for where each is set.

`BETTER_AUTH_SECRET` must be set, at least 32 characters and not a placeholder (`verifyAuthSecret` in `src/lib/server/auth/better-auth.ts`). Without it every request that resolves a session fails with a 500, not only the auth routes: that is any request carrying a session cookie, on any page, plus the routes in `SESSION_ROUTE_PREFIXES`. A signed-out visitor to a public page is unaffected.
