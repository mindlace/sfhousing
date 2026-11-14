# Port manifest: planafoot auth, identity, authz, membership and invites into sfhousing ("quest" becomes "sim")

Path roots used below:
- **PF** = `/Users/mindlace/Projects/planafoot` (main as checked out, at `ba6ff9428`; it is one commit behind origin, which I ignored)
- **SFH** = `/Users/mindlace/Projects/sfhousing/.claude/worktrees/planafoot-auth` (at `306cba01`)

Line counts come from `wc -l`.

## Surprises (read first)

1. **sfhousing has no i18n.** No Paraglide, no `messages/`. The auth UI and handlers use **162 distinct `m.*` keys**. Every ported `.svelte` file and route needs its strings inlined into copy modules, following the `SFH/src/lib/sharing/copy.ts` pattern. Every ported test that asserts on `m.*` needs rewriting to assert on those constants. This is the biggest non-mechanical cost.
2. **A "sim" in sfhousing today is not a container.** It is an immutable published document: a row in the D1 `plan` table with `kind='sim'`, an 8-char id, deduped by content hash, served at `/s/<id>`.
   - Membership needs a new record type with its own id space. That means a new table and a new URL prefix; `/s/<id>` is taken.
   - planafoot's membership reads are **index-gated**: they `innerJoin(questIndex)` (`PF/src/lib/server/projections/quest-roles.ts:88,113,164`). Nothing in membership works until that table exists.
3. **`verifyAuthSecret` throws on every request when `BETTER_AUTH_SECRET` is missing** (`PF/src/lib/server/auth/better-auth.ts:37-43`, called from `getAuth`, which runs from hooks).
   - sfhousing staging deploys on every push to main. The secret must be set on `sfhousing-staging` (and on production before the release PR) before the hooks change merges, or the whole site returns 500.
   - The e2e `webServer` command (`SFH/playwright.config.ts`) uses `--var` flags and deliberately does not read `.dev.vars`. It needs `--var BETTER_AUTH_SECRET:<32+ chars>`.
4. **Session resolution runs on every request in planafoot**, and `getAuth()` builds a new `betterAuth()` instance each time (`PF/src/hooks.server.ts:60-116`). sfhousing's hot `/data/<version>/*` R2 route (tiles) should skip it. Gate on route or path, or on the presence of the session cookie.
5. **Turnstile is wired into `/signin` and `/forgot-password`.** It needs `script-src` and `frame-src https://challenges.cloudflare.com`. That is a CSP interface change in `SFH/svelte.config.js`. planafoot's CSP (`PF/config/security.ts:99-112`) already allows it.
   - Google OAuth needs **no** CSP change. It is the JS `authClient.signIn.social` flow: a same-origin fetch, then a top-level navigation. The callback is a same-origin GET, and sfhousing sets no `form-action`.
   - Passkeys need no CSP change. The HIBP check is a server-side fetch.
6. **The reaper needs a cron.** planafoot runs `reap.dispatch`/`reap.user` from the separate jobs-worker (cron `0 * * * *`, queue `JOBS`). sfhousing is one adapter-cloudflare worker with no `scheduled` handler.
7. **Test-only URL capture goes through `OAUTH_KV`** (`test:password-reset:`, `test:change-email-approve:`, `test:change-email-verify:`, `test:invite:`; `better-auth.ts:166,210,229`, `PF/src/lib/server/invites/email.ts`). sfhousing has no KV. Only the magic-link path uses the in-process `captureMagicLink` sink.
8. **planafoot seeded the group principals with a hand-written data migration**: `INSERT INTO principal ... ('group:public','group'),('group:authenticated','group')` in `PF/migrations/d1/0036_*`. sfhousing's rule is "never hand-edit migrations". Groups are only used on the plan/task resource path, so drop them (see section 2).
9. **The anonymous plugin's synthetic email domain `planafoot.com` is hard-coded in two places** that must stay in sync: `better-auth.ts:272` and `PF/src/lib/server/auth/password-reset-gate.ts:5`.
10. **sfhousing already has its own `enforceRate`** (`SFH/src/lib/server/sharing/rate-limit.ts`). It has a different signature (`env` rather than `platform`) and a different test bypass (`ENVIRONMENT==='development'`, not `TEST_AUTH_SECRET`).
11. **Name collisions to avoid:**
    - `SFH/src/lib/sim/` is the engine; put the server membership code elsewhere.
    - `SFH/src/lib/sim-page/sim-session.ts` (`SimSession`) means "session" is already taken in the sim namespace.
    - "plan" in sfhousing means a painted plan. Do not carry planafoot's `plan`/`task` resource types over.

---

## 1. Inventory of the source, by area

Specs sit next to their sources (`.spec.ts` or `.test.ts`).

### 1a. Better-Auth setup and providers

| File | Lines | Purpose | Tests |
|---|---|---|---|
| `PF/src/lib/server/auth/better-auth.ts` | 306 | `getAuth(platform, fallbackBaseURL, {captureMagicLink})`, `verifyAuthSecret`, `authGenerateId`. Details in the note below. | `better-auth.spec.ts` 229, `password-pseudonymity.spec.ts` 117 |
| `PF/src/lib/server/auth/google-provider.ts` | 24 | `googleProvider(env)` with `disableImplicitSignUp:true`; `GOOGLE_AUTH_ORIGIN` | `.spec` 9 |
| `PF/src/lib/server/auth/magic-link.ts` | 16 | `resolveHandleToEmail` (canonical handle, not skeleton) | `.spec` 35 |
| `PF/src/lib/server/auth/password-policy.ts` | 20 | `PASSWORD_MIN_LENGTH` 10 / `MAX` 64, `validatePasswordShape` | `.spec` 35 |
| `PF/src/lib/server/auth/password-reset-gate.ts` | 26 | `mayReceivePasswordReset` (verified and not the synthetic domain) | `.spec` 40 |
| `PF/src/lib/server/auth/password-breach.ts` | 81 | `isPasswordBreached`: HIBP k-anonymity check for `setPassword` (the plugin cannot reach it) | `.spec` 132 |
| `PF/src/routes/api/auth/[...all]/+server.ts` | 115 | Better-Auth handler. 404s `POST /api/auth/sign-in/anonymous`; rate-limits `/sign-in/email`, `/request-password-reset`, `/reset-password` | `server.test.ts` 193 |
| `PF/src/lib/client/account/auth-client.ts` | 7 | `createAuthClient` with `anonymousClient`, `magicLinkClient`, `passkeyClient` | none |
| `PF/src/lib/server/onboarding/pseudonymous-mint.ts` | 43 | `mintPseudonymousSession(event)`: the one mint seam, behind `PSEUDO_MINT_RL` | `.spec` 45 |
| `PF/src/lib/server/onboarding/known-device.ts` | 20 | `pf_known` cookie: `markKnownDevice`, `isKnownDevice` | `.spec` 40 |
| `PF/src/lib/server/onboarding/pending-identifier.ts` | 30 | `pf_pending_identifier` cookie (SC 3.3.7) | `.spec` 86 |
| `PF/src/lib/server/onboarding/pending-quest.ts` | 26 | `pf_pending_quest` cookie carrying a title across the sign-in hop | `.spec` 49 |
| Upgrade and fuse | — | `handleAccountLink`, `applyUpgrade`, `applyFuse`, `normalizeLinkArgs` in `user-store/identity.ts` (see 1b), driven from `onLinkAccount` (`better-auth.ts:274-280`) | `identity.spec.ts` |
| Not worth porting | — | `auth/bearer.ts` 78, `github-oidc.ts` 60, `mint-service-token.ts` 51 (footctl service tokens); `auth/oauth.ts` 38, `oauth-grant-admin.ts` 34 (MCP OAuth) | — |

`better-auth.ts` configuration, with line numbers:
- `anonymous` with `emailDomainName`, `disableDeleteAnonymousUser`, `onLinkAccount`: lines 271-281.
- `magicLink`: 282-295.
- `passkey` with `rpID` taken from the base URL host: 296-300.
- `haveIBeenPwned`: 301. `sveltekitCookies(getRequestEvent)` must stay last: 303.
- `emailAndPassword` with `disableSignUp:true`, no `autoSignIn`, revoke on reset, conditional `sendResetPassword`: 118-173.
- `changeEmail` with a two-hop confirm: 196-220. `emailVerification`: 222-236.
- `account.accountLinking` with Google trusted: 117.
- `additionalFields` `userIdentity`, `handle`, `handleSkeleton`: 191-195.
- `databaseHooks.user.create.before/after` and `update.after` (mint an identity, append history, track `freshlyCreated`): 240-269.

### 1b. Identity model

| File | Lines | Purpose | Tests |
|---|---|---|---|
| `PF/src/lib/server/user-store/user.ts` | 143 | The read seam. `User` type; `survivorId` (8-hop cap); `principalUnion`; `getUser`, `getUserByHandle`, `getUserByEmail`, `resolveHandleOrEmailToUser`, `getUsers`; `isDeletedIdentity`; `resolveSessionUser` | `.spec` 241 |
| `PF/src/lib/server/user-store/identity.ts` | 160 | `createIdentityForNewVersion`, `reseedHandleFromQuest`, upgrade and fuse | `.spec` 160 |
| `PF/src/lib/server/user-store/history.ts` | 44 | `recordUserVersion` (sole writer of `user_version`), `getUserHistory` | `.spec` 50 |
| `PF/src/lib/server/user-store/deletion.ts` | 257 | `deleteAccount`, `closeAccountRows`, `releaseHandle`, `scrubLiveUser`, `hashPriorVersions`, `purgeCredentialsAndSettings`, `markIdentityDeleted` | `.spec` 406 |
| `PF/src/lib/server/user-store/handle.ts` | 41 | `seedHandle`, `generateUniqueHandle({questTitle})` (uses unique-names-generator) | `.spec` 76 |
| `PF/src/lib/server/user-store/handle-normalize.ts` | 90 | `normalizeHandle`, `RESERVED`, `validateHandle` | `.spec` 62 |
| `PF/src/lib/server/user-store/confusable-skeleton.ts` | 20 | UTS #39 `skeleton()` | `.spec` 27 |
| `PF/src/lib/server/user-store/confusables-data.ts` | 2 lines (77 KB) | Generated Unicode confusables, stored as a JSON string | none |
| `PF/src/lib/server/user-store/confusables.meta.ts` | 8 | Version and hash of the confusables source | none |
| `PF/scripts/regen-confusables.ts` | 112 | Generator for the data file | `.spec` |
| `PF/src/lib/server/user-store/profile.ts` | 130 | `isHandleAvailable`, `updateProfile` (7-day cooldown, 1-year tombstone) | `.spec` 164 |
| `PF/src/lib/server/user-store/auth-factors.ts` | 39 | `STRONG_PROVIDERS`, `hasStrongAuthFactor` | `.spec` 91 |
| `PF/src/lib/server/user-store/password-credential.ts` | 86 | `liveUserFor`, `hasPassword`, `mayRemovePassword` | `.spec` 108 |
| `PF/src/lib/server/user-store/passkey.ts` | 13 | `userHasPasskey` | `.spec` 31 |
| `PF/src/lib/server/user-store/oauth.ts` | 21 | `userHasOAuthAccount` | `.spec` 49 |
| Skip | — | `oauth-grants.ts` 26 (MCP), `user-settings.ts` 250, `record-last-viewed.ts` 47, `backfill-handle-skeleton.ts` 24 | — |

### 1c. Session resolution

| File | Lines | Purpose |
|---|---|---|
| `PF/src/hooks.server.ts` | 404 | Only `securityHandle` lines 60-116 matter. It calls `auth.api.getSession` (with `disableRefresh` on a WebSocket upgrade, lines 64-75; keep this for the future per-sim Durable Object sockets), then `resolveSessionUser`. It sets `locals.user`, `locals.session = {id, userId}` (the live `user.id`, not the identity id), `locals.capabilities` (`resolveCapabilities(db, u, BOOTSTRAP_EMAILS)`) and `locals.actorKind`. Everything else in the file (PostHog ingest, preview gate, global rate limits, Paraglide, CSP, bearer) is planafoot-specific. |
| `PF/src/app.d.ts` | 44 | `Locals { user: User or null; session: {id, userId} or null; capabilities: Capability[]; actorKind: ActorKind }`; `Error.resource?: 'quest' or 'task' or 'plan'` |
| `PF/src/lib/shared/legacy/quest/vocab.ts` | lines 9-15 | `ACTOR_KINDS = ['human','ai','automation','public']`, `Actor` |
| `PF/src/routes/+layout.server.ts` | 80+ | Calls `markKnownDevice` when the user is durable (lines 54-57); exposes `hasPasskey`/`hasOAuthAccount`. The rest is planafoot settings. |

### 1d. Authorization

| File | Lines | Purpose | Tests |
|---|---|---|---|
| `PF/src/lib/server/authz/ability.ts` | 79 | `ROLE_BUNDLE`, bundle expansion, `abilityDominates`, `SUPPORT_ORDER` | `.spec` 57 |
| `PF/src/lib/server/authz/resource.ts` | 30 | `ResourceType = 'app' or 'quest' or 'plan' or 'task'`, `APP_RESOURCE`, `covers` | `.spec` 37 |
| `PF/src/lib/server/authz/authorize.ts` | 46 | Pure `authorize()` and `holdsAnyOn` | `.spec` 104 |
| `PF/src/lib/server/authz/quest-caps.ts` | 12 | `questCaps(role, questId)` | `.spec` 13 |
| `PF/src/lib/server/authz/require-cap.ts` | 80 | `requireCap(event, ability, resource)`: 401, then 404, then 403 | `.spec` 354, `enforcement-parity.spec.ts` 58 |
| `PF/src/lib/server/authz/require-quest-role.ts` | 38 | `requireQuestRole(event, questId, minRole)` | `.spec` 92 |
| `PF/src/lib/server/authz/groups.ts` | 18 | Live-predicate groups `group:public` and `group:authenticated` | `.spec` 20 |
| `PF/src/lib/server/authz/index.ts` | 5 | Barrel | — |
| `PF/src/lib/server/db/capability-events.ts` | 44 | `insertCapabilityEvent` (atomic in-SQL stamp) | `.spec` 30 |
| `PF/src/lib/server/event-log/append.ts` | 60 | `buildAppendEventSql`, `appendEventAsync`, `appendEventSync` | `.spec` 151 |
| `PF/src/lib/server/event-log/fold.ts` | 52 | `foldRevokeWins`, `foldLatest`, `foldEventLog` | `.spec` 71 |
| `PF/src/lib/server/projections/quest-roles.ts` | 287 | Ledger folds `foldQuestRole`, `foldQuestMembers`, `foldQuestsForUser`, `foldOwnedQuestCount`; writers `setQuestRole`, `addQuestRole`, `revokeQuestRoles` | `.spec` 480 |
| `PF/src/lib/server/projections/quest-index.ts` | 343 | The quest control plane: `createQuestRecord`, `ensureQuestRecord`, `getQuestTitle`, `updateQuestIndexTitle`, `countQuestsOwnedBy`, `listQuestsForUser`, `getRole`, `listMembers` (joins `user_settings` time zones, lines 147-174), `addMember`, `addMemberById`, `reconcileQuestManagement`, `removeMembership` (co-manager guard), `prepareLeave` | `.spec` 540 |
| `PF/src/lib/server/operator/capabilities.ts` | 146 | `isBootstrapEmail`, `resolveGrantedCapabilities`, `resolveCapabilities`, `hasCapability`, `isOperator`, `requireCapability`, `requireOperator`, and `resolveCapsFor`, the one ledger fold | `.spec` 367 |
| `PF/src/lib/server/operator/grants.ts` | 63 | `grantCapability` and `revokeCapability`, with no-escalation and a support projection | `.spec` 158 |
| `PF/src/lib/server/operator/registry.ts` | 31 | `OPERATOR_ABILITIES`, `SUPPORT_ROLE_BY_CAP` | — |
| Skip | — | `operator/support-projection.ts` 60, `ensure-support-quest.ts` 56, `service-principal.ts` 77, `operator-identities.ts` 53; routes `/ops/grant`, `/ops/signin` | — |

Roles are `manager`, `editor`, `viewer`, with ranks 2, 1, 0 (`quest-roles.ts:21`). Ability bundles: viewer = `quest.read`, `plan.read`, `task.read`, `media.read`. Editor adds `task.write`, `plan.write`, `card.move`, `media.write`, `draft.write`. Manager adds `member.manage`, `invite.manage` (`ability.ts`).

### 1e. Membership and invitations

| File | Lines | Purpose | Tests |
|---|---|---|---|
| `PF/src/lib/server/invites/control-plane.ts` | 452 | See the note below | `.spec` 678 |
| `PF/src/lib/server/invites/token.ts` | 15 | `generateInviteToken` (32 bytes, hex), `hashToken` (SHA-256) | `.spec` 20 |
| `PF/src/lib/server/invites/claim.ts` | 53 | `classifyColdAccept` for cases A1, A2, A3, B, C (mint, signin, verify) | `.spec` 169 |
| `PF/src/lib/server/invites/email.ts` | 26 | `sendInviteEmail` (link is `/invite/<token>`) | `.spec` 89 |
| `PF/src/lib/server/email-templates/invite.ts` | 15 | Invite email builder | `.spec` 27 |
| `PF/src/lib/server/email-templates/InviteEmail.svelte` | 34 | Invite email component | — |
| `PF/src/routes/invite/[token]/+page.server.ts` | 182 | `load`; `accept` action; `join` cold-accept action (mint, sign-in steer, or magic link) | `page.server.test.ts` 403 |
| `PF/src/routes/invite/[token]/+page.svelte` | 91 | Invite page UI | `page.svelte.test.ts` 42 |
| `PF/src/routes/api/quests/[questId]/invites/+server.ts` | 119 | POST create invite (rate limits by IP and actor, per-recipient email limit) | `api.spec.ts` 335 |
| `PF/src/routes/api/quests/[questId]/invites/[inviteId]/+server.ts` | 12 | DELETE revoke | — |
| `PF/src/routes/api/quests/[questId]/invites/[inviteId]/resend/+server.ts` | 61 | POST resend | `api.spec.ts` 136 |
| `PF/src/routes/api/invites/[inviteId]/accept/+server.ts` | 36 | In-app accept | — |
| `PF/src/routes/api/invites/[inviteId]/decline/+server.ts` | 11 | In-app decline | — |
| `PF/src/routes/api/quests/[questId]/members/[userId]/+server.ts` | 25 | DELETE member (co-manager guard) | `api.spec.ts` 79 |
| `PF/src/routes/quests/[questId]/+page.server.ts` | 65 | `leaveQuest` action (lines 20-46) | — |
| `PF/src/lib/server/quest-web/page-load.ts` | 53 | `requireQuestRole(viewer)`; manager sees `listManagerPendingInvites` | — |
| `PF/src/routes/quests/+layout.server.ts` | 15 | Recipient invitations | — |
| `PF/src/routes/quests/+page.server.ts` | 24 | Recipient invitations | — |
| `PF/src/routes/quests/[questId]/+layout.server.ts` | 96 | Builds `listMembers` for the page | — |
| `PF/src/lib/server/store-clients/quest.ts` | 277 | Durable Object side: `syncQuestRoster` (56-67), `createQuest` (75-103), `deleteQuest` (137-202), `removeMember` (215-246), `leaveQuest` (253-277) | `.spec` 840 (Durable Object bound) |
| `PF/src/lib/client/members/MembersPanel.svelte` | 157 | Member list and invite UI | `.svelte.test.ts` 158 |
| `PF/src/lib/client/members/InvitationsList.svelte` | 88 | Recipient invitations list | `.test` 83 |
| `PF/src/lib/client/members/LeaveQuestConfirm.svelte` | 184 | Leave flow with successor choice | `.test` 163 |
| `PF/src/lib/client/members/inviteBanner.ts` | 56 | Invite banner (uses `bannerToast`) | `.spec` 83 |
| `PF/src/lib/client/members/membership-overlay.svelte.ts` | 104 | Local-apply overlay for membership writes | `.spec` 110 |

`control-plane.ts` exports: `INVITE_TTL_MS` (7 days), `INVITE_PENDING_CAP` (50), `parseInviteTarget`, `createInvite` (role hard-coded `'editor'`; `canInviteByEmail` gate), `toManagerPendingInviteView`, `listManagerPendingInvites`, `getManagerPendingInvite`, `claimInvite` (guarded UPDATE, reads `meta.changes`), `acceptInviteByToken`, `acceptInviteById`, `declineInvite`, `revokeInvite`, `resendInvite` (60-second cooldown), `listRecipientPendingInvites`, `findInviteByToken`.

### 1f. Sign-in, sign-up, account UI

| File | Lines | Purpose | Tests |
|---|---|---|---|
| `PF/src/routes/signin/+page.server.ts` | 236 | `load` (`?signup`, `?error`, `?reset`, pending cookies); actions `sendLink`, `signInPassword`, `startFresh` (mints, then `createSeededQuest`) | `page.server.test.ts` 504 |
| `PF/src/routes/signin/+page.svelte` | 290 | Sign-in UI: passkey, Google, magic link, password, Turnstile | `page.svelte.test.ts` 326 |
| `PF/src/routes/forgot-password/+page.server.ts` and `+page.svelte` | 87 + 79 | Request a reset | 98 + 61 |
| `PF/src/routes/reset-password/+page.server.ts` and `+page.svelte` | 86 + 91 | Set a new password | 134 + 93 |
| `PF/src/routes/api/account/+server.ts` | 60 | GET flags (also money and billing; cut those); DELETE runs `deleteAccount` | `server.test.ts` 93 |
| `PF/src/routes/api/account/password/+server.ts` | 188 | Set, change, remove password | 311 |
| `PF/src/routes/api/account/profile/+server.ts` | 41 | Handle and display name | 66 |
| `PF/src/routes/api/account/email/+server.ts` | 34 | Change email | 60 |
| `PF/src/routes/api/account/email/verify/+server.ts` | 54 | Verify email | 121 |
| `PF/src/lib/client/account/AuthenticationPane.svelte` | 324 | Passkeys, Google link, email | `.test` 268 |
| `PF/src/lib/client/account/PasswordSection.svelte` | 333 | Password section | `.test` 475 |
| `PF/src/lib/client/account/ProfilePane.svelte` | 102 | Profile pane | `.test` 92 |
| `PF/src/lib/client/account/DeleteAccountPane.svelte` | 127 | Delete account | `.test` 97 |
| `PF/src/lib/client/account/current-user.svelte.ts` | 54 | Client profile overlay | `.spec` 72 |
| `PF/src/lib/client/account/AccountDrawer.svelte` | 233 | Account drawer; couples to Billing, ThemeToggle, AssistLevelSelect, SideDrawer, PostHog, checkpoint-cache | `.test` 276 |
| UI primitives | — | `PF/src/lib/client/ui/FieldError.svelte` 24, `FormStatus.svelte` 28, `Turnstile.svelte` 22, `SideDrawer.svelte` 135 (needs `trap-focus`, `overlay-fly`, `scroll-lock`, `IconButton`), `initials.ts` 9; `PF/src/lib/client/shell/bannerToast.svelte.ts` 210 | — |
| Shared helpers | — | `PF/src/lib/shared/nav/safe-redirect.ts` 23 (`safeReturnTo`); `PF/src/lib/server/edge-security/turnstile.ts` 46 | — |
| Email | — | `PF/src/lib/server/email/send.ts` 149 (SES via aws4fetch, or Resend; log mode when keys are absent); `validate.ts` 8; templates `sign-in.ts`, `reset-password.ts`, `change-approve.ts`, `confirm-email.ts` (13-19 each), `LinkActionEmail.svelte` 38, `Layout.svelte` 39, `render.ts` 24 (`@better-svelte-email/server`) | `send.spec` 299, template specs 13-34 |
| i18n | — | `PF/messages/en.json`: 162 keys used by the files above. Families: `account_*` (about 60), `signin_*` (24), `error_*` (17), `invite_*`, `invitations_*`, `leave_quest_*`, `primitive_members_*`, `forgot_password_*`, `reset_password_*`, `common_*` | — |
| e2e | — | `PF/e2e/` specs: `account-a11y` 220, `account-deletion` 121, `account-email` 67, `account-handle` 55, `auth-a11y` 216, `email-link` 23, `invite` 69, `invite-redundant-entry` 60, `leave-quest` 84, `passkey` 56, `password-auth` 66, `password-reset` 93, `pseudonymous-onboarding` 144. Helpers: `helpers/auth.ts` 68, `mint.ts` 36, `account.ts` 31, `backend.ts` 168 (per-worker backends; sfhousing has one shared server) | — |
| Test seam | — | `PF/src/routes/api/test/login/+server.ts` 53; `PF/src/lib/server/test-support/session.ts` 75 (`mintTestUser`, `issueTestSession`, which uses `better-call`'s `serializeSignedCookie`); `auth.ts` 37 (`isTestEnv`, `verifyTestAuth`); `release-auth.ts` 29 (`isE2eEnv`); `utils.ts` 249 (`freshDb`, `seedUser`, `seedIdentity`, `grantEvent`); `PF/src/lib/server/db/d1-shim.ts` 144 | — |

### 1g. Rate limits, anti-abuse, reaping

| File | Lines | Purpose |
|---|---|---|
| `PF/src/lib/server/security/rate-limit.ts` | 104 | `enforceRate` (critical limiters fail closed in production; test-inert), `enforceMutationRate`, `RATE_LIMIT_MESSAGES` |
| `PF/src/lib/server/security/breach-context.ts` | 50 | Breach context; depends on `tiers.ts` (8, a stub) |
| `PF/src/lib/server/security/client-ip.ts` | 28 | IPv6 /64 keying |
| `PF/src/lib/server/security/quest-quota.ts` | 30 | Per-manager quest cap; needs `plan-tier/*` and `quota.ts` |
| `PF/wrangler.jsonc` ratelimits used by auth | — | `AUTH_LINK_RL` 5/60, `AUTH_PASSWORD_RL` 5/60, `PSEUDO_MINT_RL` 5/60, `INVITE_RL` 10/60, `ACCOUNT_EDIT_RL` 10/60. Optional: `GLOBAL_IP_RL` 600/60, `GLOBAL_USER_RL` 300/60 |
| `PF/src/lib/server/reap/eligibility.ts` | 55 | `selectReapableUsers(db, now, graceMs, limit)` (pure D1) |
| `PF/src/lib/server/reap/reap-user.ts` | 33 | `reapUser`, `REAP_ACTOR`; runs `deleteAccount` with `soleMemberGuard:true` |
| `PF/src/lib/server/jobs/reap.ts` | 52 | Queue dispatcher and worker |
| `PF/workers/jobs/src/handler.ts` | lines 79-85 | Cron kick |
| Config | — | `SECURITY.reap.graceMs`/`batch` in `PF/src/lib/server/edge-security/security-config.ts:35-38,152-155` |

Tests: `reap/eligibility.spec.ts` 146, `reap-user.spec.ts` 107.

### 1h. D1 schema (`PF/src/lib/server/db/schema/`)

| File | Lines | Tables |
|---|---|---|
| `principal.ts` | 16 | `principal(id, kind)` |
| `users.ts` | 19 | `user_identity(id → principal, superseded_by_id, superseded_at, deleted_at, created_at)` |
| `auth.ts` | 94 | `user`, `session`, `account`, `verification`, `passkey` (with `handle`, `handle_skeleton` unique index, `is_anonymous`, `user_identity` foreign key) |
| `userVersion.ts` | 20 | `user_version` |
| `handleTombstone.ts` | 21 | `handle_tombstone` |
| `capabilityEvent.ts` | 43 | `capability_event` (with `created_at_counter`; three indexes) |
| `group.ts` | 21 | `group` |
| `questControlPlane.ts` | 14 | `quest_index(quest_id, title, created_at, updated_at)`; `QuestMemberRole` |
| `questInvite.ts` | 49 | `quest_invite` |
| Supporting | — | `PF/src/lib/server/db/columns.ts` 41 (the `normText` NFC, `privateText` barrel); `index.ts` 40 (`Database` type); `schema/durability.ts` 45 (classification registry; useful as documentation) |

The 84 planafoot D1 migrations should **not** be copied. Regenerate one migration in sfhousing with `npm run db:generate`.

### 1i. Docs worth bringing (all rewritten)

- `PF/CLAUDE.md:111-125`: the Auth and Authorization paragraphs. They become `SFH/docs/dev/auth.md`, the primary doc, since planafoot has no auth.md.
- `PF/docs/dev/email.md` (91): the "Auth mail" and "password-reset gate" sections.
- `PF/docs/dev/schema-evolution.md` (379): only the foreign-key-action freeze notes. Better to link the `@planafoot/drizzle-cf-migrations` README.
- `PF/docs/superpowers/specs/2026-08-02-1544-password-reset-design.md`: reference only.

---

## 2. Dependency closure and couplings

### npm (planafoot ranges, with resolved versions in parentheses)

| Package | Needed by | Port? |
|---|---|---|
| `better-auth` ^1.6.25 (1.6.25) | everything | yes |
| `@better-auth/passkey` ^1.6.25 (1.6.25; pulls `@simplewebauthn/*` 13.3) | passkey | yes |
| `better-call` (1.3.7, transitive) | `test-support/session.ts` imports it directly | add explicitly |
| `kysely` override `^0.29.3` (planafoot `package.json` `overrides`) | better-auth | copy the override (the reason was not verified) |
| `bs58` ^6.0.0, `uuid` ^14.0.1 | `newId` (base58 uuidv7) | yes. sfhousing's 8-char `newPlanId` is a different id space. |
| `unique-names-generator` ^4.7.1 | handle generation | yes |
| `aws4fetch` ^1.0.20 | SES path in `email/send.ts` | yes if SES; the Resend path is plain fetch |
| `better-svelte-email` ^2.1.1 | email templates | yes, or use hand-written HTML strings |
| `drizzle-orm`, `zod` | — | already present in sfhousing |

### Cloudflare bindings and config

- **D1 `DB`**: needed; already present.
- **New ratelimits**, in both envs, with unused `namespace_id`s (production uses 41xx, staging 42xx): `AUTH_LINK_RL`, `AUTH_PASSWORD_RL`, `PSEUDO_MINT_RL`, `INVITE_RL`, `ACCOUNT_EDIT_RL`.
- **`OAUTH_KV`**: severable. Replace the test stashes (Surprise 7) with a `VITE_E2E`-gated in-process mail sink plus an e2e-only read route, in the style of `SFH/src/routes/api/e2e/plans/+server.ts`.
- **`ANALYTICS`** (`enforceRate` writes `writeDataPoint` to it): severable. Drop it.
- **Vars**: `BETTER_AUTH_URL` per env, `SES_FROM`, `SES_REGION`, `SES_ACCESS_KEY_ID`, `EMAIL_PROVIDER`; `BOOTSTRAP_EMAILS` only if operator caps are ported.
- **Secrets**: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SES_SECRET_ACCESS_KEY` or `RESEND_API_KEY`; `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` if Turnstile is kept.

### Subsystem couplings: needed (a) or severable (b), and the cut

| Coupling | Where | Class | Cut |
|---|---|---|---|
| **QuestDO roster sync** `syncQuestRoster` | `invite/[token]/+page.server.ts:46,136`; `api/invites/[inviteId]/accept/+server.ts` (about line 22); `store-clients/quest.ts:101,244` | (b) | Delete the calls. Membership is D1-only until the per-sim Durable Object lands. Leave one no-op seam `onSimRosterChanged(simId)` so the future Durable Object feature has a hook. |
| **Quest creation** `createQuest` (provisions the Durable Object, then `createQuestRecord`, then sync) | `store-clients/quest.ts:75-103`; `routes/+page.server.ts` (startQuest); `seeding/seeded-quest.ts` (from `/signin` `startFresh`) | (b) | Replace with a pure-D1 `createSim({db, title, managerId})`: `newId()`, insert `sim_index`, then `addSimRole(manager)`. See section 5. |
| **Quest teardown** `deleteQuest` (drains the MoneyDO pool, reads the media manifest, destroys the Durable Object, refunds uploads, enqueues the R2 sweep, deletes `quest_index`) | `store-clients/quest.ts:137-202`, reached from `removeMember` when the quest is empty | (b) | `deleteSim(db, simId)`: delete the `sim_index` row and its pending `sim_invite` rows. Drop `SoleMemberGuardError` and `destroyIfSoleMember`, which are Durable Object proofs. |
| `removeMember` and `leaveQuest` | `store-clients/quest.ts:215-277` | (a), rewritten | `removeSimMember` = `removeMembership` (pure D1, already in `quest-index.ts:289-304`), then `deleteSim` if the sim is empty. `leaveSim` = `prepareLeave` then `removeSimMember`. |
| **`deleteAccount`** | `deletion.ts:148-257` | (a) core, (b) parts | Keep: survivor resolution, the `listSimsForUser` plus `removeSimMember` loop, `releaseHandle`, `scrubLiveUser`, the tombstone `recordUserVersion`, `hashPriorVersions` over the identity union, purging `session`/`account`/`passkey`/`sim_invite`, and `markIdentityDeleted` last. Delete: `moneyStub().drainMember` (line 210), `forfeitWallet` (214), Stripe cancel and `markCanceled` (217-226), `revokeOAuthGrantsForIdentities` (253), purging `userSettings`/`subscription` (120-121), the `cancelSubscription` argument, and `soleMemberGuard`. `closeAccountRows` loses its `survivors` argument. |
| **Reap pipeline** | `reap/*`, `jobs/reap.ts`, jobs-worker cron | (a) the functions, (b) the trigger | Port `eligibility.ts` and `reap-user.ts` verbatim (minus `soleMemberGuard`), with `graceMs`/`batch` as constants. Defer the trigger to an owner decision (section 6). Do not port `jobs/reap.ts` or the queue. |
| Operator caps (`resolveCapabilities`, `BOOTSTRAP_EMAILS`) | `hooks.server.ts:84-86` | (b) | Set `locals.capabilities = []` initially, or port `capabilities.ts` with a registry of `['cap.grant','cap.revoke']` only. Drop `grants.ts`' support projection (`reconcileSupportMembership`). |
| Groups / plan-task path in `requireCap` | `require-cap.ts:39-45`, `groups.ts`, `group` table | (b) | Narrow `requireCap` to the `app` and `sim` resource types. Drop the `group` table and its seed-row problem. |
| MCP OAuth (`OAUTH_KV`, `isDeletedIdentity` in `handleMcp`) | `user-store/oauth-grants.ts`, `auth/oauth*.ts` | (b) | Delete. Keep `isDeletedIdentity` inside `resolveSessionUser`. |
| UserDO, MoneyDO, AI units, Stripe, plan tiers | `api/account/+server.ts` GET (`moneyStub`, `getByUser`, `CREDIT_PRESETS_CENTS`); `quest-quota.ts` (`planTierFor`) | (b) | GET `/api/account` returns only `{hasGoogle, hasPassword, canRemovePassword, pseudonymous}`. `simQuotaExceeded` becomes a constant cap (for example `MAX_SIMS_PER_MANAGER`) via `countSimsManagedBy`. |
| `user_settings` | `quest-index.ts:147-174,187` (member time zones); `deletion.ts:120` | (b) | Drop `timeZone` from `ControlPlaneMember`. |
| Email sending | `better-auth.ts` (4 callbacks), invites | (a) for magic link, invites, reset and email change | Port `email/send.ts` (log mode with no keys makes local dev and tests free). |
| i18n (`m.*`, `paraglideMiddleware`) | all UI and route files | (b) | Inline the strings into copy modules. |
| Telemetry (`captureServerEvent`, `capture`, `logEvent`, `logLimitBreach`, `breachContext`) | invites, account, signin, rate-limit | (b) | Delete. Keep `console.error` where planafoot has it. |
| Design system (`FieldError`, `FormStatus`, `SideDrawer`, `bannerToast`, `IconButton`, `trapFocus`, `scroll-lock`) | account and members UI | (b) | Copy `FieldError` and `FormStatus` (trivial). Do not port `SideDrawer`/`AccountDrawer`; render the account panes on an `/account` page. Replace `bannerToast` with sfhousing's `NoticePills`/`PILL` or an inline status. |
| `$lib/shared/nav/href` (`selfHref`/`worldHref`, enforced by a planafoot lint) | UI | (b) | Use plain strings. sfhousing turns off `svelte/no-navigation-without-resolve`. |
| `clearCheckpointCache`, `goodbye-campaign`, `secureNudgeBanner` | AccountDrawer, DeleteAccountPane | (b) | Delete. |
| Preview gate, global rate limits, PostHog ingest, `bodySizeHandle` | `hooks.server.ts` | (b) | Not ported. `GLOBAL_*_RL` is optional. |

---

## 3. Fit with the target

**Versions.** sfhousing resolves `drizzle-orm` and `drizzle-kit` at the same release candidates (`1.0.0-rc.4-5d5b77c` / `ca0f029`), svelte 5.57.2 (planafoot 5.56.8), kit 2.70.3 (2.70.2), vitest 4.1.11 (4.1.10), adapter-cloudflare 7.2.9 (same), wrangler 4.149 (4.114), better-sqlite3 13.0.3, zod 4.6.5 (planafoot 4.4.3), `@planafoot/drizzle-cf-migrations` 1.2.1. better-auth is absent. No version friction is expected. `.npmrc` already has `legacy-peer-deps`.

Places where the port cannot be a straight copy:

1. **Schema layout.**
   - sfhousing schema files import `drizzle-orm/sqlite-core` directly (`SFH/src/lib/server/db/schema/plan.ts`). Bring `columns.ts` to `SFH/src/lib/server/db/columns.ts`, because `normText` (NFC) is load-bearing for handles. Do not port planafoot's eslint restriction unless `plan.ts` is migrated too.
   - Add `export type Database = DrizzleD1Database<typeof schema>` to `SFH/src/lib/server/db/index.ts`. Its `getDb(platform)` returns an untyped drizzle instance and takes `undefined`.
   - Re-export the new files from `SFH/src/lib/server/db/schema/index.ts`.
   - `drizzle-cf.config.ts` needs no change: one `d1` track, and the schema loader is already set.
2. **Migrations.** Generate them fresh. The classifier freezes foreign-key actions: `capability_event → principal` cascade, `user` cascades, `sim_invite` cascade and set-null. Get them right in the first generate.
3. **Test harness.**
   - planafoot specs call `freshDb()`, `seedUser`, `seedIdentity`, `grantEvent`, `makePlatform` from `PF/src/lib/server/test-support/utils.ts`. sfhousing has `createTestD1()` and `testPlatform()` (`SFH/src/lib/server/test/d1.ts:97,122`); its `meta.changes` and `batch` support what `claimInvite` and `applyUpgrade` need.
   - Write `SFH/src/lib/server/test/auth-db.ts`, which re-implements those five helpers on `createTestD1`, so specs port with an import change.
   - sfhousing's `App.Platform` has `ctx`, not `context`.
   - planafoot turns foreign keys off around each migration file; sfhousing's harness does not. That is fine for a single freshly generated migration.
   - `expect.requireAssertions` is on in both.
   - planafoot's `.test.ts` names are collected by sfhousing's server project (`src/**/*.{test,spec}.ts`). Svelte component tests must be renamed to `*.svelte.spec.ts`, which is sfhousing's convention.
   - Component specs under `src/lib` must not import `$app/*`. Only `$app/state` and `$app/navigation` are stubbed, and only for route specs (`SFH/vite.config.client-test.ts`). `MembersPanel`, `LeaveQuestConfirm` (`$app/forms`) and `InvitationsList`/`inviteBanner` (`goto`) need a `vi.mock` or a callback prop.
4. **e2e.**
   - The single shared `webServer` uses `ENVIRONMENT:development` and a `VITE_E2E=1` build. It needs `--var BETTER_AUTH_SECRET:...`.
   - Replace `isTestEnv` (keyed on `TEST_AUTH_SECRET`) with `import.meta.env.VITE_E2E === '1' && ENVIRONMENT !== 'production'`, as `SFH/src/routes/api/e2e/plans/+server.ts` does. Move `/api/test/login` to `/api/e2e/login`.
   - planafoot e2e assumes a backend per worker. Use a unique email per test.
   - Passkey e2e uses a CDP virtual authenticator, so it is chromium only.
   - `expectNoA11yViolations` exists in `SFH/e2e/helpers/a11y.ts:48`. Check that its options match planafoot's callers.
5. **CSP.** No change is needed for Google OAuth, passkeys or HIBP. Turnstile needs `script-src` and `frame-src https://challenges.cloudflare.com`, an interface change under sfhousing's CLAUDE.md. Recommendation: ship without Turnstile and rely on the rate-limit bindings; that is an owner decision.
6. **Header shell.**
   - `useHeaderActions` is per page, and the latest page replaces all three slots (`SFH/src/lib/shell/header-actions.svelte.ts:36-55`), so it cannot hold an always-present "Sign in" / `@handle` link.
   - Adding one means a new prop or element in `SFH/src/lib/shell/SiteHeader.svelte`, rendered from the root layout. It should sit in the right group, and in the Menu panel below lg.
   - That changes `SiteHeader.svelte.spec.ts` and the header layout e2e and goldens: `e2e/layout.spec.ts`, and possibly `e2e/map.spec.ts-snapshots` if it overlaps the map chrome. It is a shell interface change.
   - The root layout load (`SFH/src/routes/+layout.server.ts`) must return `user`.
7. **Caching.** `/p/[id]` and `/s/[id]` set `private, max-age=300`, and HTML defaults to `private, no-cache` (`SFH/src/hooks.server.ts`). Per-user SSR in the header is therefore safe.
   - The new session handle must run inside `sequence(...)` **before** the existing header-setting handle.
   - The existing handle's re-wrap-on-immutable-headers fallback must keep the `set-cookie` headers that Better-Auth stages through `sveltekitCookies`.
8. **Rate limiting.** Use one `enforceRate`. Either extend sfhousing's (`SFH/src/lib/server/sharing/rate-limit.ts`) with an options bag and move it to `SFH/src/lib/server/security/rate-limit.ts`, or port planafoot's with the bypass rebased onto `ENVIRONMENT==='development'`. Either way it touches the sharing publish path and its spec.
9. **Code style.** sfhousing uses no trailing commas and single quotes, the same as planafoot. Prettier settings match, so expect formatting no-ops.
10. **Attribution** (`SFH/src/lib/attribution.ts` `SOFTWARE`):
    - Add better-auth (MIT), SimpleWebAuthn (MIT; bundled to the client by `passkeyClient`), bs58 (MIT), uuid (MIT), unique-names-generator (MIT).
    - Add better-svelte-email and aws4fetch (both MIT) if they reach the server bundle.
    - Add the **Unicode confusables data** (Unicode License v3), which ships in the bundle as `confusables-data.ts`.
    - `attribution.spec.ts` probably asserts the list. Update it.
11. **Copy and brand strings.** "plan afoot" appears in email subjects, `rpName: 'Plan afoot'` (`better-auth.ts:298`), and the synthetic domain.
12. **Placement.**
    - Server: `SFH/src/lib/server/{auth,authz,user-store,invites,onboarding,event-log,ids,email,security,sims}/`. Never `src/lib/sim/`.
    - Client: `SFH/src/lib/account/` and `SFH/src/lib/members/`.
    - Routes: `/signin`, `/forgot-password`, `/reset-password`, `/invite/[token]`, `/account`, `/sims`, `/sims/[simId]`, and under `/api`: `auth/[...all]`, `account/*`, `sims/*`, `invites/*`, `e2e/login`.
13. **Handle `RESERVED` list** (`handle-normalize.ts:9-27`): replace `quests` with `sims`, and add `sim`, `s`, `p`, `lesscars`, `fzp`, `attribution`, `data`.

---

## 4. The rename map

| planafoot | sfhousing | Note |
|---|---|---|
| table `quest_index` / `questIndex`, column `quest_id` | `sim_index` / `simIndex`, `sim_id` | Keeps "index" because it becomes a projection of the per-sim Durable Object later |
| `questControlPlane.ts` | `simControlPlane.ts` | — |
| `QuestMemberRole` | `SimMemberRole` (`'manager' or 'editor' or 'viewer'`, unchanged) | — |
| table `quest_invite` / `questInvite` / `QuestInvite` / `quest_invite_token_hash_idx`; column `quest_id` | `sim_invite` / `simInvite` / `SimInvite` / `sim_invite_token_hash_idx`; `sim_id` **NOT NULL** | Drop the legacy nullable quest-free invites and `body_md`. Remove the `questId === null` branches (`control-plane.ts:253,392,435`) |
| `capability_event.resource_type` value `'quest'` | `'sim'` | Comment `'app' or 'quest' or 'plan' or 'task'` becomes `'app' or 'sim'` |
| `ResourceType` | `'app' or 'sim'` | Do not keep `plan`/`task` (sfhousing "plan" means a painted plan) |
| `App.Error.resource` | `'sim'` | — |
| abilities `quest.read`, `plan.read`, `task.read`, `media.read` / `task.write`, `plan.write`, `card.move`, `media.write`, `draft.write` / `member.manage`, `invite.manage` | `sim.read` / `sim.write` / `member.manage`, `invite.manage` | `ROLE_BUNDLE` `role.manager`, `role.editor`, `role.viewer` unchanged. Drop `SUPPORT_ORDER`. |
| `questCaps`, `quest-caps.ts` | `simCaps`, `sim-caps.ts` | — |
| `requireQuestRole`, `require-quest-role.ts` | `requireSimRole`, `require-sim-role.ts` | — |
| `projections/quest-roles.ts`: `foldQuestRole`, `foldQuestMembers`, `foldQuestsForUser`, `foldOwnedQuestCount`, `setQuestRole`, `addQuestRole`, `revokeQuestRoles`, `QuestMemberFold`, `QuestRoleListItem`, `perQuest` | `server/sims/sim-roles.ts`: `foldSimRole`, `foldSimMembers`, `foldSimsForUser`, `foldManagedSimCount`, `setSimRole`, `addSimRole`, `revokeSimRoles`, `SimMemberFold`, `SimRoleListItem`, `perSim` | — |
| `projections/quest-index.ts`: `createQuestRecord`, `ensureQuestRecord`, `getQuestTitle`, `updateQuestIndexTitle`, `countQuestsOwnedBy`, `listQuestsForUser`, `QuestListItem`, `reconcileQuestManagement` | `server/sims/sim-index.ts`: `createSimRecord`, `ensureSimRecord`, `getSimTitle`, `updateSimIndexTitle`, `countSimsManagedBy`, `listSimsForUser`, `SimListItem`, `reconcileSimManagement` | `getRole`, `listMembers`, `addMember`, `addMemberById`, `removeMembership` and `prepareLeave` keep their names, with `questId` and `questTitle` becoming `simId` and `simTitle` |
| `store-clients/quest.ts` `createQuest`, `deleteQuest`, `removeMember`, `leaveQuest`, `syncQuestRoster` | `server/sims/sims.ts` `createSim`, `deleteSim`, `removeSimMember`, `leaveSim`; `onSimRosterChanged` (no-op) | `createSim` does not collide with the existing `createSimCodec`/`createSimHost`, but check the grep |
| `questQuotaExceeded`, `quest-quota.ts` | `simQuotaExceeded`, `sim-quota.ts` | — |
| `reseedHandleFromQuest`; `generateUniqueHandle({questTitle})` | `reseedHandleFromSim`; `{simTitle}` | — |
| `questId`, `questTitle`, `questName` (props and fields) | `simId`, `simTitle`, `simName` | `RecipientInvite.questTitle`, `TokenInvite.questTitle`, `sendInviteEmail({questTitle})`, `InviteEmail` prop |
| cookies `pf_known`, `pf_pending_quest`, `pf_pending_identifier`; `stash/read/clearPendingQuest` | `sfh_known`, `sfh_pending_sim`, `sfh_pending_identifier`; `stash/read/clearPendingSim` | — |
| routes `/api/quests/[questId]/invites[/[inviteId][/resend]]`, `/api/quests/[questId]/members/[userId]`, `/quests/[questId]` (`leaveQuest` action), `/quests` | `/api/sims/[simId]/...`, `/sims/[simId]` (`leaveSim`), `/sims` | **Not `/s/` and not `/sim`.** Redirect target `/quests/${questId}` becomes `/sims/${simId}` |
| components `LeaveQuestConfirm.svelte` | `LeaveSimConfirm.svelte` | — |
| message keys `leave_quest_*` (10), `invite_join_quest`, `signin_pending_quest`, `error_too_many_quests` (the mint 429 copy), `invitations_row`, `notice_invite_*` | Copy constants such as `LEAVE_SIM_*`, `INVITE_JOIN_SIM`, `SIGNIN_PENDING_SIM`, `TOO_MANY_SIMS` | No i18n in sfhousing |
| error strings `'too many pending invites for this quest'`, `'cannot remove another manager; they must leave the quest themselves'`, `'quest invite required'`, `'could not establish a quest manager; please retry'`, fallback `'a quest'` | `...sim...`, `'a sim'` | Tests match these literals |
| rate-limit context `quest_id` | `sim_id` | Key prefixes (`invite_ip:`, `invite:`, `invite_email:`, `pseudo_mint:`, `auth_link_*`, `auth_pw_*`) unchanged |
| `ensure-support-quest`, `SUPPORT_QUEST_ID`, `SUPPORT_ROLE_BY_CAP` | not ported | — |
| doc term "quest control plane", "quest membership" | "sim control plane", "sim membership" | — |

**Collisions to watch in sfhousing:**
- The `plan` table holds `kind='sim'` rows with 8-char ids. New sims use 22-char base58 uuidv7 ids. They are different things; do not reuse `/s/<id>` or the `plan` table.
- `SimDoc` and `SIM_CODEC` (`src/lib/sim-page/sim-doc.ts`) are the document, not the membership unit.
- `src/lib/sim/` is the engine. `SimSession` is in `src/lib/sim-page/sim-session.ts`.
- The existing `/sim` route is the localStorage editor.

---

## 5. What does not exist yet in the target

The membership and invitation code needs:
- **an id** to address grants: `capability_event.resource_id`, `sim_invite.sim_id`, and later `idFromName` for the Durable Object;
- **a title** for invite emails, the invite page, `/sims` lists and the leave-confirm prompt;
- **an existence gate**: reads inner-join the index;
- **a creator**, which in planafoot is not a column. It is the first `role.manager` grant, whose `actor_id` is the manager.

The smallest record (`SFH/src/lib/server/db/schema/simControlPlane.ts`):

```ts
export type SimMemberRole = 'manager' | 'editor' | 'viewer';
export const simIndex = sqliteTable('sim_index', {
  simId: text('sim_id').primaryKey(),          // newId(): base58 uuidv7; future per-sim DO name
  title: normText('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
```

- No foreign key from `sim_invite` (planafoot has none to `quest_index`, so that pending invites survive a rebuild).
- Optional, for a later link to a policy: `doc_id` naming a `plan` row. **Not needed for auth.**
- Optional: `created_by_id` referencing `user_identity`. It is redundant with the ledger. Add it only if the owner wants it queryable.

The creation path:
- `createSim({db, title, managerId})`: `newId()`, insert `sim_index` first, then `addSimRole(db, simId, managerId, 'manager', managerId)`. This mirrors `createQuestRecord` (`quest-index.ts:23-37`).
- A route `POST /api/sims {title}` (or a form action on `/sims`):
  - with `locals.user`, use it;
  - signed out on a known device, stash `sfh_pending_sim` and redirect to `/signin`;
  - otherwise call `mintPseudonymousSession` and `reseedHandleFromSim` on the first sim;
  - then check `simQuotaExceeded`, then `createSim`, then redirect to `/sims/<id>`.
  - This is planafoot's `startQuest` (`PF/src/routes/+page.server.ts:170-215`) without the Durable Object.

Deletion: `deleteSim(db, simId)` deletes the `sim_index` row and the pending `sim_invite` rows. The ledger rows stay (they are append-only, and the index gate hides them). Title edits go through `updateSimIndexTitle`.

The minimal UI home is `/sims/[simId]`, a page gated by `requireSimRole(viewer)`. It shows the title, `MembersPanel` (invite, remove, resend and revoke for managers) and `LeaveSimConfirm`. `/sims` lists `listSimsForUser` and recipient invitations. The Durable Object feature later attaches the log to the same `simId`.

---

## 6. What needs the owner

**Secrets and config:**
- `BETTER_AUTH_SECRET` for production, staging, and local `.dev.vars` and e2e. It must be set before merge (Surprise 3).
- `BETTER_AUTH_URL` per env: `https://sfhousing.mindlace.net` and `https://sfhousing-staging.mindlace.net`. The passkey `rpID` is that host, so passkeys made on staging will not work on production.
- **Google OAuth client**: a Google Cloud project and consent screen, giving `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` per env. Redirect URIs are `<origin>/api/auth/callback/google` for production, staging, `http://localhost:5173` and `http://localhost:4173`.
- **Email**: provider (SES or Resend), sending domain or subdomain, DNS (SPF, DKIM, DMARC), `SES_FROM`, keys; SES production access, or use Resend.
- **The anonymous plugin's synthetic email domain**: it must be one the owner controls and that never receives mail. It feeds both `better-auth.ts` and `password-reset-gate.ts`.
- **Ratelimit `namespace_id`s** for production and staging.
- Turnstile site and secret keys, if Turnstile is kept, plus approval of the CSP change.
- `BOOTSTRAP_EMAILS`, if operator caps are ported.
- `SFH/docs/dev/deploy.md` "Secrets and variables ... Nothing else" must be updated.

**Production resources:** no new D1 (tables go into the existing `sfhousing` and `sfhousing-staging` databases) and no KV. Only the ratelimit namespaces, which are declared in config. A cron host is needed if reaping is wanted (below).

**Decisions:**
1. The URL prefix for sims (`/sims/[simId]` is proposed) and whether a sim relates to a published `/s/<id>` policy.
2. When a pseudonymous account is minted in sfhousing, given there is no landing "start".
3. Which providers ship first.
4. The reaper trigger: a tiny cron worker with the D1 binding, a GitHub Actions schedule hitting an authenticated endpoint, or no reaping yet.
5. The header account entry, a shell interface change.
6. Whether deleting an account should remove the user's authorship from future sim logs. planafoot removes memberships only.

**Plainly not worth porting:**
- MCP OAuth (`auth/oauth.ts`, `oauth-grant-admin.ts`, `user-store/oauth-grants.ts`, `/oauth/authorize`, `OAUTH_KV`): there is no MCP endpoint.
- footctl bearer, service principal and GitHub OIDC (`auth/bearer.ts`, `github-oidc.ts`, `mint-service-token.ts`, `operator/service-principal.ts`): no CLI.
- The operator support projection and `/ops/*`: no support board.
- Billing, MoneyDO, UserDO, `subscription`, `user_settings`, `record-last-viewed`: the subsystems do not exist.
- `backfill-handle-skeleton` and `principal-backfill.spec`: historical backfills.
- Groups and the plan/task resource path: unused until a public-read grant is needed. Re-adding needs a sanctioned seed path.
- `AccountDrawer` and `SideDrawer` (drags in Billing, ThemeToggle, AssistLevel, PostHog and checkpoint-cache): use an `/account` page.
- `secureNudgeBanner`, `goodbye-campaign`, `FixtureSeedCard`, `Settings.svelte`.
- `content-tables.ts` (wipe tooling).
- The jobs-worker queue fan-out (`jobs/reap.ts`).
- planafoot's per-worker e2e backend (`e2e/helpers/backend.ts`).
- Turnstile, unless abuse appears.

---

## 7. Recommended order of work

Each task is independently testable. All server tests run with `npx vitest --run --project server <path>` and must pass `npm run check` and `npm run lint`.

1. **Primitives.**
   - Add `bs58` and `uuid`. Port `PF/src/lib/server/ids/base58.ts` (34) and `factory.ts` (6) to `SFH/src/lib/server/ids/`.
   - Port `event-log/append.ts` (60) and `fold.ts` (52).
   - Port `db/columns.ts` (41) and add the `Database` type to `SFH/src/lib/server/db/index.ts`.
   - Verify: the ported `base58.spec`, `append.spec`, `fold.spec` and `columns.spec`.
2. **Pure authz core.**
   - Port `authz/ability.ts`, `resource.ts` and `authorize.ts` with the sim rename, plus `sim-caps.ts` and `index.ts`. Drop `groups.ts` and `SUPPORT_ORDER`.
   - Verify: ported `ability`, `authorize`, `resource` and `sim-caps` specs. There are no database or Better-Auth dependencies.
3. **Identity schema and read seam.**
   - Schema: `principal`, `users` (`user_identity`), `auth` (`user`, `session`, `account`, `verification`, `passkey`), `userVersion`, `handleTombstone`. Run `npm run db:generate`.
   - Test fixtures: `SFH/src/lib/server/test/auth-db.ts` (`freshDb`, `seedUser`, `seedIdentity`).
   - user-store: `user.ts`, `history.ts`, `confusable-skeleton.ts` with its data and meta files, `scripts/regen-confusables.ts`, `handle-normalize.ts` (with the `RESERVED` update), `handle.ts` (add `unique-names-generator`), `profile.ts`, `auth-factors.ts`, `passkey.ts`, `oauth.ts`, `password-credential.ts`.
   - Verify: the ported specs; `SFH/src/lib/server/test/d1.spec.ts` still passes with the new migration; `npm run db:migrate` works locally. Add the attribution credits for Unicode data, bs58, uuid and unique-names-generator.
4. **Ledger and sim control plane.**
   - Schema: `capabilityEvent.ts`, `simControlPlane.ts` (`sim_index`). Then `db/capability-events.ts`, `server/sims/sim-roles.ts`, `server/sims/sim-index.ts` (no time zones), and `server/sims/sims.ts` (`createSim`, `deleteSim`, `removeSimMember`, `leaveSim`, the `onSimRosterChanged` no-op).
   - authz: `require-cap.ts` (narrowed to `app` and `sim`) and `require-sim-role.ts`. Add actor types in `SFH/src/lib/server/authz/actor.ts`.
   - Verify: ported `quest-roles.spec` (480) and `quest-index.spec` (540), minus title and time-zone cases; `require-cap.spec` (plan/task cases removed); `require-quest-role.spec`; `enforcement-parity.spec`. Write new `sims.spec` cases from the pure-D1 parts of `store-clients/quest.spec.ts`: empty sim deleted, successor promoted, co-manager guard.
5. **Better-Auth and session hooks.**
   - Add `better-auth`, `@better-auth/passkey`, `better-call` and the kysely override.
   - Port `auth/better-auth.ts`. Use the new synthetic domain and `rpName`. Replace the `OAUTH_KV` stashes with a `VITE_E2E`-gated mail sink. Set `user-store/identity.ts` up for upgrade and fuse.
   - Port `google-provider.ts`, `password-policy.ts`, `password-reset-gate.ts`, `magic-link.ts`, `password-breach.ts`.
   - Port `email/send.ts`, `validate.ts` and the templates; add `aws4fetch` and `better-svelte-email`, or plain-string templates.
   - Port `/api/auth/[...all]` (rate limits through the unified `enforceRate`).
   - Session handle in `SFH/src/hooks.server.ts` inside `sequence`, skipping `/data/`. Update `app.d.ts` Locals.
   - Add `/api/e2e/login` (`test-support/session.ts`) and set `BETTER_AUTH_SECRET` in the Playwright `webServer`.
   - Verify: `better-auth.spec`, `password-pseudonymity.spec`, `identity.spec` (upgrade and fuse), `auth/[...all]/server.test`. Extend `hooks.server.spec`: no cookie gives null locals; `/data/` does not touch the session. One e2e: login seam, then cookie, then `locals.user` visible on a page.
6. **Pseudonymous onboarding and sim creation.**
   - Port `onboarding/{pseudonymous-mint,known-device,pending-identifier,pending-sim}.ts`, `security/sim-quota.ts`, and `POST /api/sims` or a `/sims` action.
   - Add the ratelimit bindings (`PSEUDO_MINT_RL`, `AUTH_LINK_RL`, `AUTH_PASSWORD_RL`, `INVITE_RL`, `ACCOUNT_EDIT_RL`) to both envs in `SFH/wrangler.jsonc`, then `npm run types`.
   - Port the `markKnownDevice` refresh into the root layout load.
   - Verify: the ported onboarding specs and a creation route spec; an e2e based on `pseudonymous-onboarding.spec.ts`.
7. **Sign-in pages.**
   - `/signin` (magic link, password, passkey, Google; `startFresh` resumes a pending sim instead of `createSeededQuest`), `/forgot-password`, `/reset-password`.
   - `auth-client.ts`, `FieldError`, `FormStatus`, `safe-redirect.ts`, and a copy module.
   - Header "Sign in" / `@handle` entry in `SiteHeader`.
   - Verify: ported `page.server` and `page.svelte` specs (assertions on copy constants); e2e `email-link`, `password-auth`, `password-reset`, `passkey` (chromium), and an `auth-a11y` pass with `expectNoA11yViolations`; refreshed header layout and goldens.
8. **Invitations.**
   - Schema `simInvite.ts`. Port `invites/{token,claim,control-plane,email}.ts` and the invite template.
   - Routes: `/api/sims/[simId]/invites` (POST), `.../[inviteId]` (DELETE), `.../[inviteId]/resend`, `/api/invites/[inviteId]/accept|decline`, `/invite/[token]` (accept and cold-join `join`, without `syncQuestRoster`).
   - Verify: `control-plane.spec` (678), `claim.spec`, `token.spec`, `email.spec`, the invites `api.spec`s, `invite/[token]/page.server.test` (403); e2e `invite` and `invite-redundant-entry`.
9. **Member management UI.**
   - `/sims` and `/sims/[simId]` pages; `MembersPanel`, `InvitationsList`, `LeaveSimConfirm`, `membership-overlay`, `inviteBanner` (with sfhousing notices); `/api/sims/[simId]/members/[userId]` DELETE; the `leaveSim` action.
   - Verify: the ported component specs (renamed `*.svelte.spec.ts`, `$app/*` mocked); the members route `api.spec`; e2e `leave-sim` and an a11y pass.
10. **Account pane.**
    - An `/account` page with `ProfilePane`, `AuthenticationPane` with `PasswordSection`, and `DeleteAccountPane`; `current-user.svelte.ts`.
    - Routes `/api/account` (GET trimmed, DELETE), `/password`, `/profile`, `/email`, `/email/verify`.
    - Verify: the ported specs; e2e `account-handle`, `account-email`, `account-a11y`.
11. **Deletion and reaping.**
    - `user-store/deletion.ts`, cut as in section 2. `reap/eligibility.ts` and `reap/reap-user.ts`, with no trigger.
    - Verify: `deletion.spec` (Money, Stripe and OAuth cases removed; sim-removal cases rewritten), `eligibility.spec`, `reap-user.spec`; e2e `account-deletion`. The trigger waits on the owner's decision.
12. **Optional: operator caps.**
    - `operator/capabilities.ts` with a trimmed `registry.ts`; `BOOTSTRAP_EMAILS`; `locals.capabilities` in hooks.
    - Verify: `capabilities.spec` (trimmed).
13. **Docs.**
    - `SFH/docs/dev/auth.md`, rewritten from `PF/CLAUDE.md:111-125` and the email reset-gate section; a line in `SFH/CLAUDE.md`'s scoped-docs list.
    - Updates to `docs/dev/deploy.md` (secrets), `docs/dev/developing.md` (`.dev.vars` keys) and `docs/dev/testing.md` (auth fixtures, `/api/e2e/login`, the mail sink).

### Critical files for implementation
- `/Users/mindlace/Projects/planafoot/src/lib/server/auth/better-auth.ts`
- `/Users/mindlace/Projects/planafoot/src/lib/server/projections/quest-roles.ts` and `/Users/mindlace/Projects/planafoot/src/lib/server/projections/quest-index.ts`
- `/Users/mindlace/Projects/planafoot/src/lib/server/invites/control-plane.ts` and `/Users/mindlace/Projects/planafoot/src/routes/invite/[token]/+page.server.ts`
- `/Users/mindlace/Projects/planafoot/src/lib/server/user-store/deletion.ts` and `/Users/mindlace/Projects/planafoot/src/lib/server/store-clients/quest.ts` (the Durable Object cut points)
- `/Users/mindlace/Projects/sfhousing/.claude/worktrees/planafoot-auth/src/hooks.server.ts`, `/Users/mindlace/Projects/sfhousing/.claude/worktrees/planafoot-auth/src/lib/server/db/schema/index.ts`, `/Users/mindlace/Projects/sfhousing/.claude/worktrees/planafoot-auth/svelte.config.js`
