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

A pseudonymous account (Better-Auth `anonymous()` plugin, email `@pseudonymous.sfhousing.invalid`, constant `PSEUDONYMOUS_EMAIL_DOMAIN` in `src/lib/server/auth/brand.ts`) is minted when a signed-out person registers a sim (`startSim`, after the in-use check), joins from an invite, or presses `Start fresh without an account` on `/signin`. Nothing is minted for a visitor who only browses, and nothing for a registration of an id already in use. The mint is rate limited (`PSEUDO_MINT_RL`).

- The known-device cookie `sfh_known` is set for non-pseudonymous users and passkey holders. A signed-out known device that tries to create a sim from the `/sims` form goes to `/signin` instead of minting again; the intent is kept in `sfh_pending_sim` and resumed after sign-in. `POST /api/sims` answers 401 instead (see Registering a sim).
- No account is ever reaped. A pseudonymous account whose session has expired is kept, with its sims, and so is an account minted for a registration that then failed.
- Email and Google end pseudonymity and can fuse two accounts (`onLinkAccount`, `handleAccountLink`). A password or a passkey does not fuse two accounts.
- A password makes an account durable without ending pseudonymity. Sign-in is by handle and password: the action resolves the handle itself (`resolveHandleToEmail` in `src/lib/server/auth/magic-link.ts`). Better-Auth's `username` plugin is not installed. There is no password sign-up; a password is set from `/account` on a signed-in session. Policy is length only plus a breach check (`password-breach.ts`).
- Password reset mails only a verified, deliverable address (`mayReceivePasswordReset` in `src/lib/server/auth/password-reset-gate.ts`). A pseudonymous account with no verified email has no reset path.

### Sign out

`/account` has a `Sign out` form action (`signOut` in `src/routes/account/+page.server.ts`): Better-Auth's `signOut` deletes the session row and clears the session cookies, and the visitor lands on `/` signed out. The known-device cookie stays, as in planafoot, so the next sim on that device steers to `/signin`. Sign out is offered, and the action acts, only for an account that can sign back in: not pseudonymous, or holding a passkey, a password or a Google account; for any other the action keeps the session and returns to `/account`, since its sims would be lost.

### Deletion

`deleteAccount` in `src/lib/server/user-store/deletion.ts` scrubs the live `user` row to a `deleted-<id>` tombstone, hashes email and name in earlier `user_version` rows, sets `user_identity.deleted_at`, removes the user from their sims and deletes the invitations they sent or received. `resolveSessionUser` returns null for a tombstoned identity, so a lingering session does not authenticate.

- Sims are kept. A sim the person was the only member of stays with no members (see Sims with no members) and its pending invitations end. A shared sim carries on, with a promoted manager if the person was its last one.
- Each membership goes through `removeSimMember(..., { notify: false })`, so no hook runs inside the loop. After the loop, also when a removal threw, one `rosterChangedAll` runs over the ids of the sims left: handed to the `defer` argument when the caller gives one (the route passes `platform.ctx.waitUntil`), awaited otherwise, and awaited too when `defer` itself throws (logged). It never rejects. The number of sims is not capped, so the fan-out may outrun `waitUntil`'s time limit; a sim it does not reach keeps its open sockets' old rights until they reconnect.
- A removal promotes a successor before it revokes the leaver: when the person is a shared sim's only manager, `removeMembership` makes the member the reconcile would pick a manager first, then revokes. A failure between the two writes leaves the person still a member and the sim managed.
- The loop makes about ten D1 queries per sim inside one request, so an account in very many sims can fail part-way, for example at the per-request query limit. The memberships removed so far stay removed and the account is not yet tombstoned. A removal cut before its revoke leaves the person a member of that sim, which the retry removes; one cut after it leaves only the reconcile (a no-op once the successor was promoted) and the ending of an emptied sim's pending invitations, which can no longer be accepted (Invitations). A retry picks up where the last run stopped and finishes; an account in very many sims may need more than one retry, since the number of sims per request is not yet bounded. A completed deletion is a no-op.

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

Sims are rows in `sim_index` (`src/lib/server/sims/sim-index.ts`); membership is the ledger. Pages are `/sims` and `/sims/[simId]`; the API is under `/api/sims`. The id of a sim is minted by its creator: by the browser for `POST /api/sims`, by the server for the `/sims` form and for `Start fresh` on `/signin`. `startSim` (`src/lib/server/sims/start-sim.ts`) registers it for `POST /api/sims` and the `/sims` form, and mints a pseudonymous account when the visitor has none. Two paths call `createSim` directly: the `/sims` load resuming a stashed title (`src/routes/sims/+page.server.ts`, with its own title, rate and cap checks) and `Start fresh` (`src/routes/signin/+page.server.ts`, with no in-use, rate or cap check: it reseeds the handle, then registers a new server-minted id).

Membership is D1 only. The per-sim object (`SimObject`, [sim-object.md](sim-object.md)) holds the log and not the roster: the stream route reads the role and tells the object whether the socket may write.

### Registering a sim

`POST /api/sims` (`src/routes/api/sims/+server.ts`) registers a sim under an id the browser minted. The shared types are in `src/lib/sim-stream/register.ts` (`RegisterOk`, `RegisterError`, `RegisterCode`; types only, so the browser imports them as they are).

Request: `content-type: application/json` and a same-origin `Origin` (`refuseUnlessSameOriginJson`), body `{ "simId": "<id>", "title": "<name>" }`. `title` is optional: omitted or null gives the name `Untitled sim` and no handle reseed. A title is trimmed, must not be empty and is at most `SIM_TITLE_MAX` (63) characters. The browser acts on the status and `code`; `error` is copy for the person.

| Status | Body                        | Means, and what the browser does                                                                                                                                                             |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ simId, created: true }`  | This call created the sim and made the caller its manager. Go on                                                                                                                             |
| 200    | `{ simId, created: false }` | The id is registered and the caller writes it (manager or editor): a repeat, or a call racing itself. Go on                                                                                  |
| 400    | `code: 'invalid_id'`        | No body, or `simId` is not a valid id (`isValidId`). A bug in the browser                                                                                                                    |
| 400    | `code: 'title'`             | `title` is not a string, is empty after trimming, or is over 63 characters. Ask the person                                                                                                   |
| 401    | `code: 'sign_in'`           | Signed out on a known device (`sfh_known`). Nothing is minted or stashed. Send the person to `/signin`, then post the same id again: nothing on the server holds it                          |
| 403    | `code: 'quota'`             | The caller manages the cap (1,000 sims) and the id is new                                                                                                                                    |
| 403    | `{ error }`, no `code`      | A foreign `Origin`                                                                                                                                                                           |
| 409    | `code: 'taken'`             | The id is spoken for and the caller does not write it. One answer for every reason (below), never saying who holds it. Mint a new id and register that                                       |
| 415    | `{ error }`, no `code`      | Not `application/json`                                                                                                                                                                       |
| 429    | `code: 'rate'`              | The mint limit (`PSEUDO_MINT_RL`) or the creation rate (`MUTATION_REGISTERED_RL`, key `sim_start:<identity>`), which every caller meets, so a writer's repeat can be 429. Back off and retry |
| 500    | `code: 'failed'`            | The create threw. Its two writes are one D1 batch, so nothing was written. Retrying the same id is safe: 201, or 200 if the first attempt had in fact committed                              |
| 500    | `code: 'session'`           | Minting the account failed. Retry, one request at a time                                                                                                                                     |
| 500    | `{ message }`, no `code`    | Another server failure: the in-use, role or cap read, or a mint that threw. Retry the same id, as for `failed`                                                                               |

Rules the browser relies on:

- **An id with any past is taken.** An id is refused when any of these exists for it: a `sim_index` row, a `sim_takedown` row, a `sim_commit` row, or a `capability_event` whose resource is that sim (`hasPast` in `sim-index.ts`). The last two cover a sim whose index row an older code path deleted while its log or ledger stayed: registering it would make the caller manager of the old log. Knowing an id never makes anyone its manager.
- **Registration and the manager grant are one atomic step.** `createSim` (`src/lib/server/sims/sims.ts`) sends one D1 batch: a conditional insert of the `sim_index` row, then the manager grant gated on `changes() = 1`, that is on this call's insert having written the row. The check and the insert are one statement, so two registrations of one id cannot both create it, and one cannot race a takedown mark. A batch that throws wrote nothing.
- **Order of the checks** (`startSim`): the same-origin check, the id, the title, the known-device rule, then for a signed-out caller the in-use check and the mint, the creation rate, for a signed-in caller the in-use check (200 for a writer, 409 for anyone else), the cap, the insert, the handle reseed. The in-use check comes before the cap, so a non-writer at the cap who posts an id in use gets 409, not 403. The `/sims` form answers the known-device case differently: it stashes the title in `sfh_pending_sim` and redirects to `/signin`, and the `/sims` load resumes it after sign-in under the same creation rate and cap. A resume refused by either clears the stash, so that title is dropped; a create that failed keeps it for the next visit.
- **The cap** is `MAX_SIMS_PER_MANAGER`, 1,000 (`src/lib/members/copy.ts`), counted by `countSimsManagedBy`: the sims whose role fold, over the person's identity and every identity fused into it, is `manager`. A co-managed sim counts for each manager.
- **The handle reseed.** A pseudonymous person's first registration with a title seeds their handle from it (`reseedHandleFromSim`). A failed reseed is logged (`[start-sim] reseed failed`) and never fails the registration.
- **A signed-out first registration mints an account** and sets its session on the response. Send it alone and wait for the answer: two at once each pass the checks and each mint an account, and the browser can end up signed in as the one that does not manage its sim.
- **A failed signed-out registration can leave an account with no sim:** a refused creation rate, a create that threw, or an id taken between the in-use check and the insert, each happens after the mint. The account is kept, and the next registration uses its session.

### Sims with no members

Nothing a member does deletes a sim. When the last member leaves, or the last member's account is deleted, `removeSimMember` keeps the sim, its log and its `sim_index` row, and ends its pending invitations in one statement (a failure of that statement is logged and does not fail the removal). Such a sim:

- opens read-only by its link: the stream route finds the row and gives every socket `write: false`;
- cannot be written by anyone: open sockets lose write on the hook's re-read, and appends are refused `not-writer`;
- is in nobody's list and has no member area: the role folds find no member, and `requireSimRole` answers 404;
- keeps its id: the index row is a past, so the id cannot be registered again;
- cannot be joined: an invitation that outlived the last member (its delete failed, or an account deletion was cut) is refused at accept as not pending (`finalizeAccept`).

Only the operator takedown removes a sim ([deploy.md](deploy.md), Operator takedown of a sim).

### The roster hook

`onSimRosterChanged(env, simId)` (`src/lib/server/sims/roster-hook.ts`) tells the sim's object to re-read its open sockets' roles (`rereadRoles()`, see [sim-object.md](sim-object.md)), so a removed member loses write and an invited one gains it on an open socket. `rosterChangedAll(env, simIds)` does it for many sims, `ROSTER_FANOUT` (6) at a time.

- The roster change is written first, then the hook runs.
- Each attempt is bounded: `REREAD_TIMEOUT_MS` (5,000 ms), after which it counts as failed. At most `REREAD_ATTEMPTS` (2) attempts, the second on a fresh stub; an overloaded object is not retried. After the last failure it logs once, `[roster-hook] reread failed`, with the sim id and `loggable(e)`.
- It never rejects and never fails a request: the roster change stands. A failed role read in the object revokes and grants nobody, so a socket keeps its old right until a later re-read succeeds or it reconnects.
- It does nothing without the object: under `npm run dev`, or with no `SIM` binding (`liveSimStub`, `src/lib/server/sims/live-sim.ts`).
- It is not called at creation: a newly registered sim has no open socket, because the stream route answers 404 until the index row exists.
- `env` is the request's `platform?.env`, typed `SimEnv` (`Pick<Env, 'SIM'> | undefined`, `src/lib/server/sim-object/stub.ts`), as on every function that threads it to the hook (`createSim`, `deleteSim`, `removeSimMember`, `leaveSim`, `deleteAccount`, the fuse's `roster`), so passing `platform` itself does not compile.

Call sites:

| Where                                                                                                                           | When                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `removeSimMember` (`src/lib/server/sims/sims.ts`): the members `DELETE` route and `leaveSim`                                    | After every removal, the last member's included, unless `notify: false` |
| `deleteAccount`                                                                                                                 | One `rosterChangedAll` over the sims left, deferred (Deletion)          |
| `src/routes/api/invites/[inviteId]/accept/+server.ts` and the two accept actions of `src/routes/invite/[token]/+page.server.ts` | After an invitation is accepted                                         |
| `handleAccountLink` (`src/lib/server/user-store/identity.ts`)                                                                   | After a fuse                                                            |

A fuse reads the sims the absorbed identity held a role on before it writes. After the sign-in, `handleAccountLink` hands one `rosterChangedAll` over them to `waitUntil`, so a sign-in never waits on it and a failure of either step never fails it. A sim the fan-out does not reach (a failed read, a failed or timed-out re-read, the work cut off) keeps its sockets' old rights until they reconnect.

## Invitations

`src/lib/server/invites/`. An invite is a bearer token, stored only as a SHA-256 hash (`token.ts`). The link is `/invite/<token>`; the mail is `invite.ts` in `email-templates/`. Create, revoke, resend, accept and decline are under `/api/sims/[simId]/invites` and `/api/invites/[inviteId]`.

- An invite names an email or a handle. A visitor with no account who opens it is classified by `classifyColdAccept` in `claim.ts`: mint (a handle invite mints a pseudonymous account; an emailed invite mints an email-bound account), sign in (the entered email owns an account), or verify (the entered email differs from the invited one).
- On failure the members routes and actions answer `{ code }` (`memberErrorCode` in `src/lib/server/invites/error-code.ts` maps the services' thrown reasons; anything else is `failed`), never an error's text. The pages show `memberErrorText(code)` from `MEMBER_ERROR_COPY` in `src/lib/members/copy.ts`. A new reason needs a code there.
- Accepting calls `onSimRosterChanged` (see The roster hook); declining changes no roster and does not.
- Creating an invitation re-checks the inviter after the insert (`recheckInviter`, `src/lib/server/invites/control-plane.ts`). If the inviter no longer holds `manager` (their last leave ran after the route authorized them), or the role read fails, the new row is deleted and `createInvite` throws `InviterRoleLostError`: the route answers 404 to a non-member and 403 to a member below manager, and no mail is sent. A failed delete is logged (`[invite-create] compensating delete failed`, the sim id and `loggable(e)`) and the create is still refused the same way; the row it leaves cannot be accepted (next point).
- An invitation to a sim with no members cannot be accepted: `finalizeAccept` reads the members before the claim and, finding none, refuses as for an invitation that is not pending, leaving the row as it is. Nobody takes over a sim its last member left.
- Accepting reconciles management (`finalizeAccept`: the member check, claim, grant, `reconcileSimManagement`). The last member can still leave between the claim and the grant, and a leave ends only pending invitations, which this one no longer is. The reconcile then makes the invitee the sim's manager, so a kept sim is never left with an editor and no manager. A failed reconcile is logged (`[invite-accept] reconcile failed`) and never fails the accept.
- The invitation routes log a failure with the sim id, where they have it, and `loggable(e)` only, never the error itself: a database error carries its bound parameters, the invited address among them.

## e2e seams

All guarded by `isE2eEnv`, so a normal build answers 404 or drops them:

- `POST /api/e2e/login` with `{ email }` mints or reuses a registered user and sets a signed session cookie. Helper: `loginAs`.
- `GET /api/e2e/mail?kind=<kind>&to=<address>` returns `{ url }` for the latest mail of that kind (`password-reset`, `change-email-approve`, `change-email-verify`, `invite`) from an in-process sink. Helper: `readMail`.
- The sign-in methods cookie above. Helper: `enableAuthMethods`.
- The magic link of a sign-in shows on `/signin` as `dev-link`. Helper: `followMagicLink`.

All helpers are in `e2e/helpers/auth.ts`. `wrangler dev` for e2e runs with `ENVIRONMENT=development` and a fixed `BETTER_AUTH_SECRET`; see `playwright.config.ts`.

## Secrets and vars

See [deploy.md](deploy.md) for where each is set.

`BETTER_AUTH_SECRET` must be set, at least 32 characters and not a placeholder (`verifyAuthSecret` in `src/lib/server/auth/better-auth.ts`). Without it every request that resolves a session fails with a 500, not only the auth routes: that is any request carrying a session cookie, on any page, plus the routes in `SESSION_ROUTE_PREFIXES`. A signed-out visitor to a public page is unaffected.
