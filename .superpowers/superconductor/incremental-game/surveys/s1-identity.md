# S1 survey: identity and accounts

Census of facts. `V` = verified in code at the cited `path:line`; `I` = inferred (source named). Paths are relative to the repo root. "Tests" means `*.spec.ts` / `*.test.ts` / `e2e/`. Importer lists below are non-test unless stated; importers were found by grepping `from '$lib/...'` over `src`, `e2e`, `scripts` (V for the grep, I for "no dynamic imports exist"). `R:` abbreviates `src/routes/`, `L:` abbreviates `src/lib/`, `S:` abbreviates `src/lib/server/`.

---

## 1. Modules, exports, line counts, outside importers

### 1.1 `src/lib/server/auth/` (non-test, 9 modules + better-auth)

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `better-auth.ts` | 345 | `verifyAuthSecret` (fn), `authGenerateId` (const fn), `GetAuthOptions` (interface), `getAuth` (fn), `authFor` (fn) | `src/hooks.server.ts`; `S:onboarding/pseudonymous-mint.ts`; `R:account/+page.server.ts`; `R:api/account/+server.ts`; `R:api/account/email/+server.ts`; `R:api/account/email/verify/+server.ts`; `R:api/account/password/+server.ts`; `R:api/auth/[...all]/+server.ts`; `R:forgot-password/+page.server.ts`; `R:invite/[token]/+page.server.ts`; `R:reset-password/+page.server.ts`; `R:signin/+page.server.ts` |
| `brand.ts` | 8 | `PRODUCT_NAME`, `PSEUDONYMOUS_EMAIL_DOMAIN`, `PASSKEY_RP_NAME` (consts) | `S:email/provider.ts` (+ `email-templates/copy.ts` via relative `../auth/brand`, `S:email-templates/copy.ts:1`) |
| `google-provider.ts` | 33 | `GOOGLE_AUTH_ORIGIN` (const), `googleConfigured` (fn), `googleProvider` (fn) | none (importers in-dir only: `better-auth.ts`, `methods.ts`) |
| `magic-link.ts` | 16 | `resolveHandleToEmail` (fn) | `R:forgot-password/+page.server.ts`; `R:signin/+page.server.ts` |
| `methods.ts` | 95 | `AUTH_METHODS` (const), `AuthMethod` (type), `parseAuthMethods`, `E2E_AUTH_METHODS_COOKIE`, `methodsFromEnv`, `enabledAuthMethods`, `methodForAuthPath` | `R:+layout.server.ts`; `R:account/+page.server.ts`; `R:api/auth/[...all]/+server.ts`; `R:signin/+page.server.ts` |
| `password-breach.ts` | 81 | `isPasswordBreached` | `R:api/account/password/+server.ts`; `R:reset-password/+page.server.ts` |
| `password-policy.ts` | 20 | `PASSWORD_MIN_LENGTH`(10), `PASSWORD_MAX_LENGTH`(64), `PasswordShape` (type), `validatePasswordShape` | `R:api/account/password/+server.ts`; `R:reset-password/+page.server.ts` |
| `password-reset-gate.ts` | 20 | `mayReceivePasswordReset` | `S:user-store/password-credential.ts` |
| `require-method.ts` | 11 | `requireMethod` | `R:api/account/email/+server.ts`; `R:api/account/email/verify/+server.ts`; `R:api/account/password/+server.ts`; `R:forgot-password/+page.server.ts`; `R:invite/[token]/+page.server.ts`; `R:reset-password/+page.server.ts`; `R:signin/+page.server.ts` |
| `session-gate.ts` | 61 | `SESSION_COOKIE_SUFFIX`, `hasSessionCookie`, `routeNeedsSession`, `shouldResolveSession` | `src/hooks.server.ts` |

Better-Auth plugins configured (V `S:auth/better-auth.ts:288-335`): `anonymous`, `magicLink`, `passkey` (only when `methods.has('passkey')`, :323), `haveIBeenPwned`, `sveltekitCookies` (last). Google is a social provider only when method on and credentials present (:123-131). Password: `emailAndPassword` with `disableSignUp: true` (:159).

### 1.2 `src/lib/server/authz/` (non-test)

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `index.ts` | 4 | re-exports `ResourceType`, `ResourceRef`, `APP_RESOURCE`, `Ability`, `RoleBundle`, `ROLE_BUNDLE`, `Capability`, `authorize`, `simCaps` | `src/app.d.ts`; `S:operator/capabilities.ts`; `S:operator/grants.ts`; `S:sims/sim-roles.ts`; `S:test/auth-db.ts` |
| `actor.ts` | 8 | `ACTOR_KINDS`, `ActorKind`, `Actor`, `PUBLIC_ACTOR_ID` | `src/app.d.ts`; `S:user-store/deletion.ts` |
| `ability.ts` | 63 | `Ability`, `WILDCARD`, `ROLE_BUNDLE`, `RoleBundle`, `abilityDominates` | `S:sim-object/access.ts` (also via index) |
| `authorize.ts` | 46 | `Capability`, `AuthRequest`, `Decision`, `holdsAnyOn`, `authorize` | none directly (via index) |
| `resource.ts` | 29 | `ResourceType`, `ResourceRef`, `APP_RESOURCE`, `covers` | none directly |
| `sim-caps.ts` | 13 | `SimMemberRole` (re-export type), `simCaps` | none directly |
| `require-cap.ts` | 62 | `CapEvent` (type), `requireCap` | none (only `authz/require-sim-role.ts`) |
| `require-sim-role.ts` | 38 | `requireSimRole` | `R:api/sims/[simId]/invites/+server.ts`; `R:api/sims/[simId]/invites/[inviteId]/+server.ts`; `R:api/sims/[simId]/invites/[inviteId]/resend/+server.ts`; `R:api/sims/[simId]/members/[userId]/+server.ts`; `R:sims/[simId]/+layout.server.ts`; `R:sims/[simId]/+page.server.ts` |

### 1.3 `src/lib/server/user-store/` (non-test)

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `user.ts` | 143 | `User` (type), `survivorId`, `principalUnion`, `getUser`, `getUserByHandle`, `getUserByEmail`, `resolveHandleOrEmailToUser`, `getUsers`, `isDeletedIdentity`, `resolveSessionUser` | `src/app.d.ts`; `src/hooks.server.ts`; `S:invites/claim.ts`; `S:invites/control-plane.ts`; `S:onboarding/pseudonymous-mint.ts`; `S:operator/capabilities.ts`; `S:sims/sim-index.ts`; `S:sims/sim-roles.ts`; `R:api/sims/[simId]/invites/+server.ts`; `R:api/sims/[simId]/invites/[inviteId]/resend/+server.ts` |
| `identity.ts` | 205 | `NewVersionColumns` (type), `createIdentityForNewVersion`, `reseedHandleFromSim`, `normalizeLinkArgs`, `handleAccountLink` | `S:auth/better-auth.ts`; `S:sims/start-sim.ts`; `R:invite/[token]/+page.server.ts`; `R:signin/+page.server.ts` |
| `history.ts` | 44 | `recordUserVersion`, `getUserHistory` | `S:auth/better-auth.ts`; `R:invite/[token]/+page.server.ts` (`getUserHistory` has NO non-test caller: grep `getUserHistory` hits only its definition) |
| `deletion.ts` | 231 | `deletedHandle`, `deletedEmail`, `releaseHandle`, `scrubLiveUser`, `hashPriorVersions`, `purgeCredentialsAndSettings`, `markIdentityDeleted`, `DELETE_SIMS_PER_PASS`, `deleteAccount`, `closeAccountRows` | `R:api/account/+server.ts` |
| `profile.ts` | 130 | `isHandleAvailable`, `HANDLE_COOLDOWN_MS`, `TOMBSTONE_TTL_MS`, `UpdateProfileInput`, `UpdateProfileResult`, `updateProfile` | `R:api/account/profile/+server.ts` (and in-dir `handle.ts`) |
| `handle.ts` | 41 | `seedHandle`, `generateUniqueHandle` | `R:invite/[token]/+page.server.ts` |
| `handle-normalize.ts` | 97 | `normalizeHandle`, `RESERVED`, `HandleValidation`, `validateHandle` | `S:auth/magic-link.ts`; `S:invites/control-plane.ts`; `R:signin/+page.server.ts` |
| `confusable-skeleton.ts` | 20 | `skeleton` | `S:e2e/session.ts`; `S:test/auth-db.ts`; `R:invite/[token]/+page.server.ts` |
| `confusables-data.ts` | 2 | default export (JSON string) | none |
| `confusables.meta.ts` | 8 | `CONFUSABLES_META` | none |
| `auth-factors.ts` | 39 | `STRONG_PROVIDERS`, `hasStrongAuthFactor` | `S:invites/claim.ts` |
| `password-credential.ts` | 87 | `liveUserFor`, `LiveUser` (type), `hasPassword`, `hasPasswordForUser`, `mayRemovePassword`, `mayRemovePasswordForUser` | `R:account/+page.server.ts`; `R:api/account/+server.ts`; `R:api/account/password/+server.ts` |
| `passkey.ts` | 13 | `userHasPasskey` | `R:+layout.server.ts`; `R:account/+page.server.ts` |
| `oauth.ts` | 21 | `OAUTH_PROVIDER_IDS`, `userHasOAuthAccount` | `R:account/+page.server.ts`; `R:api/account/+server.ts` |

`User` type (V `S:user-store/user.ts:6-14`):

```ts
export type User = {
  id: string; // STABLE identity id
  handle: string;
  name: string;
  email: string;
  image: string | null;
  emailVerified: boolean;
  pseudonymous: boolean;
};
```

### 1.4 `src/lib/server/onboarding/`

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `pseudonymous-mint.ts` | 40 | `mintPseudonymousSession` | `S:sims/start-sim.ts`; `R:invite/[token]/+page.server.ts`; `R:signin/+page.server.ts` |
| `known-device.ts` | 20 | `KNOWN_DEVICE_COOKIE`(`sfh_known`), `markKnownDevice`, `isKnownDevice` | `S:sims/start-sim.ts`; `R:+layout.server.ts`; `R:api/sims/+server.ts`; `R:invite/[token]/+page.server.ts` |
| `pending-sim.ts` | 26 | `PENDING_SIM_COOKIE`(`sfh_pending_sim`), `stashPendingSim`, `readPendingSim`, `clearPendingSim` | `S:sims/start-sim.ts`; `R:signin/+page.server.ts`; `R:sims/+page.server.ts` |
| `pending-identifier.ts` | 30 | `PENDING_IDENTIFIER_COOKIE`, `stashPendingIdentifier`, `readPendingIdentifier`, `clearPendingIdentifier` | `R:invite/[token]/+page.server.ts`; `R:signin/+page.server.ts` |

`pseudonymous-mint.ts:6` imports `SIMS_COPY` from `$lib/members/copy` (sim/members copy reaches into identity code).

### 1.5 `src/lib/server/email/`, `email-templates/`

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `email/send.ts` | 144 | `SendEmailInput`, `SendEmailResult`, `sendEmail` | `S:auth/better-auth.ts`; `S:invites/email.ts` |
| `email/provider.ts` | 36 | `MailEnv`, `MailProvider`, `mailProvider`, `mailCanBeDelivered`, `isDeliverable` | `S:auth/methods.ts`; `S:auth/password-reset-gate.ts`; `S:invites/control-plane.ts`; `R:api/sims/[simId]/invites/+server.ts`; `R:api/sims/[simId]/invites/[inviteId]/resend/+server.ts`; `R:sims/[simId]/+layout.server.ts` |
| `email/validate.ts` | 8 | `isValidEmail` | `R:api/account/email/+server.ts`; `R:api/account/email/verify/+server.ts` |
| `email-templates/sign-in.ts` | 13 | `buildSignInEmail` | `S:auth/better-auth.ts` |
| `email-templates/reset-password.ts` | 13 | `buildResetPasswordEmail` | `S:auth/better-auth.ts` |
| `email-templates/change-approve.ts` | 20 | `buildChangeApprove` | `S:auth/better-auth.ts` |
| `email-templates/confirm-email.ts` | 13 | `buildConfirmEmail` | `S:auth/better-auth.ts` |
| `email-templates/invite.ts` | 16 | `buildInviteEmail` (args `inviterHandle, simTitle, url`) | `S:invites/email.ts` |
| `email-templates/render.ts` | 24 | `RenderedEmail`, `renderEmail` | none |
| `email-templates/copy.ts` | 50 | `EMAIL_COPY` (incl. `invite` block) | none (relative importers in-dir only) |
| `email-templates/InviteEmail.svelte` | 35 | default component (props `inviterHandle, simTitle, url`) | none outside (imported by `invite.ts`) |
| `email-templates/Layout.svelte` | 40 | default component | none outside |
| `email-templates/LinkActionEmail.svelte` | 39 | default component | none outside |

### 1.6 `security/`, `config/`, `ids/`, `event-log/`

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `security/rate-limit.ts` | 55 | `RateLimiter`, `EnforceRateOptions`, `enforceRate`, `RATE_LIMIT_MESSAGES` (`invites` only), `enforceMutationRate` | `S:onboarding/pseudonymous-mint.ts`; `S:sims/start-sim.ts`; `R:api/account/email/+server.ts`; `R:api/account/email/verify/+server.ts`; `R:api/account/password/+server.ts`; `R:api/account/profile/+server.ts`; `R:api/auth/[...all]/+server.ts`; `R:api/sims/[simId]/invites/+server.ts`; `R:api/sims/[simId]/invites/[inviteId]/resend/+server.ts`; `R:forgot-password/+page.server.ts`; `R:reset-password/+page.server.ts`; `R:signin/+page.server.ts`; plus relative import `S:sharing/publish.ts:11` |
| `security/same-origin-json.ts` | 28 | `refuseUnlessSameOriginJson`, `refuseForeignOrigin` | `R:api/account/+server.ts`, `.../email/+server.ts`, `.../email/verify/+server.ts`, `.../password/+server.ts`, `.../profile/+server.ts`; `R:api/invites/[inviteId]/accept/+server.ts`, `.../decline/+server.ts`; `R:api/operator/sims/[simId]/takedown/+server.ts`; `R:api/sims/+server.ts`; `R:api/sims/[simId]/invites/+server.ts`, `.../invites/[inviteId]/+server.ts`, `.../invites/[inviteId]/resend/+server.ts`; `R:api/sims/[simId]/members/[userId]/+server.ts`; `R:api/sims/[simId]/stream/+server.ts` (uses only `refuseForeignOrigin`) |
| `config/dataset-version.ts` | 45 | `requireDatasetVersion`, `devOverride`, `resolveDatasetVersion` | `S:sims/stamp.ts`; `R:+layout.server.ts`. Not identity code; sits in an S1 directory. |
| `ids/base58.ts` | 1 | re-exports `newId`, `isValidId`, `decodeId` from `$lib/ids/base58` | `S:invites/control-plane.ts`; `S:operator/grants.ts`; `S:sims/sim-roles.ts`; `S:test/auth-db.ts` |
| `ids/factory.ts` | 6 | re-exports `newId`, `isValidId` | `S:auth/better-auth.ts`; `S:e2e/session.ts`; `S:sims/sims.ts`; `S:sims/start-sim.ts`; `S:user-store/history.ts`; `S:user-store/identity.ts`; `R:api/sims/+server.ts`; `R:signin/+page.server.ts`; `R:sims/+page.server.ts` |
| `event-log/append.ts` | 65 | `buildAppendEventSql`, `appendEventSync`, `appendEventAsync` | `S:db/capability-events.ts` (only `buildAppendEventSql`). `appendEventSync`/`appendEventAsync` have NO non-test caller (grep). |
| `event-log/fold.ts` | 52 | `foldEventLog`, `foldLatest`, `foldRevokeWins` | `S:operator/capabilities.ts` (`foldRevokeWins`); `S:sims/sim-roles.ts` (`foldRevokeWins`). `foldEventLog`/`foldLatest` have no non-test caller outside fold.ts. |

`src/lib/ids/base58.ts` (34 lines; exports `newId`, `isValidId`, `decodeId`). Importers: `L:sim-store/local-log.ts`; `L:sim-store/log-store.svelte.ts`; `L:sim-log/parse.ts`; `S:sim-object/sim-object.ts`; `S:sims/rename.ts`; `S:ids/base58.ts`; `R:api/operator/sims/[simId]/takedown/+server.ts`; `R:api/sims/[simId]/stream/+server.ts` (+ test helpers `L:sim-store/test/*`, `L:sim-sync/test/hub.ts`, `S:sim-object/test/drafts.ts`). The browser sim store imports the id factory directly (client-side id minting).

### 1.7 `src/lib/server/db/`

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `index.ts` | 11 | `Database` (type), `getDb` | 57 non-test importers; the full set (grep `from '$lib/server/db'`): `src/hooks.server.ts`; `S:` auth/better-auth, auth/magic-link, authz/require-cap, authz/require-sim-role, e2e/session, invites/claim, invites/control-plane, onboarding/pseudonymous-mint, operator/capabilities, operator/grants (type), sharing/{e2e-seed,get-plan,publish,shared-page,store}, sim-object/{index-sync,sim-object}, sims/{rename,sim-index,sim-quota,sim-roles,sims,start-sim}, user-store/{auth-factors,deletion,handle,history,identity,oauth,passkey,password-credential,profile,user}; `R:+layout.server.ts`, account/+page.server.ts, api/account/{+server,password/+server,profile/+server}.ts, api/e2e/login, api/invites/[inviteId]/{accept,decline}, api/operator/.../takedown, api/sims/[simId]/{invites,invites/[inviteId],invites/[inviteId]/resend,members/[userId],stream}, forgot-password, invite/[token], signin, sims/+layout.server.ts, sims/+page.server.ts, sims/[simId]/{+layout,+page}.server.ts |
| `columns.ts` | 40 | `toNfc`, `normTextToDriver`, `normText`, `privateText`, re-exports `sqliteTable`, `SQLiteTable`, `text`, `integer`, `real`, `index`, `uniqueIndex`, `primaryKey`, `check`, types `AnySQLiteColumn`, `AnySQLiteTable` | `S:sims/sim-index.ts` |
| `capability-events.ts` | 53 | `NewCapabilityEvent`, `insertCapabilityEvent`, `buildCapabilityEventSql` | `S:operator/grants.ts`; `S:sims/sim-roles.ts` |
| `schema/index.ts` | 9 | `export *` from plan, principal, users, auth, simControlPlane, simInvite, userVersion, capabilityEvent, handleTombstone | importers of `$lib/server/db/schema`: `S:sharing/store.ts`; `S:sim-object/{sim-object,index-sync,access}.ts`; `S:test/auth-db.ts`; `S:auth/{magic-link,better-auth}.ts`; `S:user-store/{history,oauth,deletion,identity,passkey,auth-factors,password-credential,user,profile}.ts`; `S:authz/{require-sim-role,sim-caps}.ts`; `S:invites/{control-plane,claim}.ts`; `S:e2e/session.ts`; `S:operator/capabilities.ts`; `S:sims/{sim-roles,sim-index,sims}.ts`; `R:invite/[token]/+page.server.ts`; `R:api/account/password/+server.ts`; `R:api/e2e/login/+server.ts`; `R:api/sims/[simId]/invites/+server.ts`; `.../invites/[inviteId]/resend/+server.ts` |
| `schema/{plan,principal,users,auth,userVersion,handleTombstone,capabilityEvent,simInvite,simControlPlane}.ts` | 20/14/19/87/20/21/43/39/51 | one-per-table, see section 2 | via `schema/index.ts` (direct: `simControlPlane` by `S:authz/sim-caps.ts`, `S:sim-object/access.ts`) |

### 1.8 `src/lib/server/e2e/`

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `env.ts` | 10 | `isE2eEnv` | `S:auth/methods.ts`; `R:api/account/email/verify/+server.ts`; `R:api/e2e/login/+server.ts`; `R:api/e2e/mail/+server.ts`; `R:invite/[token]/+page.server.ts`; `R:signin/+page.server.ts` |
| `mail-sink.ts` | 34 | `E2eMailKind`, `recordE2eMail`, `readE2eMail`, `clearE2eMail` | `S:auth/better-auth.ts`; `S:invites/email.ts`; `R:api/e2e/mail/+server.ts` |
| `session.ts` | 71 | `SESSION_COOKIE_NAME`, `SESSION_MAX_AGE_SECONDS`, `sessionCookieName`, `mintTestUser`, `issueTestSession` | `R:api/e2e/login/+server.ts` |

`E2eMailKind` (V `S:e2e/mail-sink.ts:4-5`):
```ts
export type E2eMailKind =
  'password-reset' | 'change-email-approve' | 'change-email-verify' | 'invite';
```

### 1.9 `src/lib/server/test/` (test support; no production importer)

| Module | Lines | Exports |
|---|---|---|
| `auth-db.ts` | 161 | `freshDb`, `makePlatform`, `seedUser`, `seedIdentity`, `grantEvent`, `seedSim`, `seedManagedSims` |
| `d1.ts` | 134 | `TestD1` (iface), `createTestD1`, `testPlatform` |
| `fake-r2.ts` | 115 | `FakeRange`, `FakeR2Options`, `FakeR2Bucket` |
| `fake-rate-limiter.ts` | 15 | `FakeRateLimiter` |
| `mock-console.ts` | 29 | `mockConsole` |
| `sim-docs.ts` | 146 | `FIXTURE0_AS_OF`, `month`, `simDoc4`, `paintedPolicy4`, `painted4`, `painted4Text`, `manyStrokes4Text`, `simDoc`, `stroke`, `freehand`, `paintedPolicy`, `paintedText`, `tamperedText`, `manyStrokesText`, `upgraded4Text`, `tampered4Text` |
| `sim-env.ts` | 13 | `fakeSimEnv` |

Importers (tests only): `auth-db` 41 spec files, `d1` 10, `fake-r2` 10, `fake-rate-limiter` 8, `mock-console` 28, `sim-docs` 9, `sim-env` 4 (counts from my grep; `I` for "all test files").

### 1.10 `src/lib/account/` (client)

| Module | Lines | Exports / kind | Importers outside dir |
|---|---|---|---|
| `account-copy.ts` | 88 | `ACCOUNT_COPY`, `passwordSignInAs`, `emailSentTo`, `emailConfirmed`, `emailUnconfirmed`, `emailChangeSent`, `removePasskeyNamed`, `deleteConfirmLine` | `R:account/+page.svelte`; `R:api/account/{+server,password,email,email/verify,profile}/+server.ts` |
| `copy.ts` | 56 | `AUTH_COPY`, `passwordTooShort`, `passwordTooLong`, `pendingSimLine` | `L:shell/SiteHeader.svelte`; `R:account/+page.svelte`; `R:invite/[token]/+page.svelte`; `R:signin/+page.svelte`, `+page.server.ts`; `R:forgot-password/+page.{svelte,server.ts}`; `R:reset-password/+page.{svelte,server.ts}`; `R:api/account/password/+server.ts` |
| `auth-client.ts` | 7 | `authClient` (Better-Auth client with `anonymousClient`, `magicLinkClient`, `passkeyClient`) | `R:signin/+page.svelte`; (in-dir `AuthenticationPane.svelte`) |
| `current-user.svelte.ts` | 54 | `CurrentUser` (class), `currentUser` | `R:+layout.svelte`; `R:account/+page.svelte` |
| `safe-redirect.ts` | 23 | `safeReturnTo` | `R:signin/+page.svelte`, `R:signin/+page.server.ts` |
| `ui.ts` | 8 | `BTN`, `BTN_DANGER`, `BARE`, `INPUT`, `LABEL`, `HINT` | `R:account/+page.svelte` |
| `FormStatus.svelte` | 28 | component | `L:members/{LeaveSimConfirm,InvitationsList,InviteBanner}.svelte`; `R:invite/[token]/+page.svelte`; `R:signin`, `R:forgot-password`, `R:account`, `R:sims/[simId]/+page.svelte` |
| `FieldError.svelte` | 26 | component | `R:signin`, `R:forgot-password`, `R:reset-password`, `R:sims/+page.svelte`, `R:sims/[simId]/+page.svelte` |
| `AuthenticationPane.svelte` | 346 | component | `R:account/+page.svelte` |
| `PasswordSection.svelte` | 313 | component | in-dir only (`AuthenticationPane.svelte`) |
| `DeleteAccountPane.svelte` | 114 | component | `R:account/+page.svelte` |
| `ProfilePane.svelte` | 92 | component | `R:account/+page.svelte` |

Coupling to members/sims from outside: `L:members/*` and `R:sims/*` pages import the account module's `FormStatus`/`FieldError`.

### 1.11 Route files in scope (non-test)

| File | Lines | Exports |
|---|---|---|
| `R:signin/+page.server.ts` | 258 | `load`; actions `sendLink`, `signInPassword`, `startFresh` |
| `R:signin/+page.svelte` | 291 | page (not read in full) |
| `R:forgot-password/+page.server.ts` | 74 | `load`; action `requestReset` |
| `R:reset-password/+page.server.ts` | 88 | `load`; action `resetPassword` |
| `R:account/+page.server.ts` | 69 | `load`; action `signOut` |
| `R:account/+page.svelte` | 96 | page |
| `R:api/account/+server.ts` | 52 | `GET`, `DELETE` |
| `R:api/account/profile/+server.ts` | 42 | `PATCH` |
| `R:api/account/email/+server.ts` | 37 | `PATCH` |
| `R:api/account/email/verify/+server.ts` | 62 | `POST` |
| `R:api/account/password/+server.ts` | 207 | `POST`, `DELETE` |
| `R:api/auth/[...all]/+server.ts` | 127 | `GET`, `POST` (same handler) |
| `R:api/e2e/login/+server.ts` | 56 | `POST` |
| `R:api/e2e/mail/+server.ts` | 27 | `GET` |
| `R:api/e2e/plans/+server.ts` | 11 | `POST` |
| `src/hooks.server.ts` | 96 | `sessionHandle`, `headersHandle`, `handle` |
| `src/hooks.client.ts` | 8 | nothing exported; only `z.config({ jitless: true })` (V `hooks.client.ts:8`). No identity content. |
| `src/app.d.ts` | 40 | global `App.Error`, `App.Locals`, `App.PageState`, `App.Platform` |
| `R:+layout.server.ts` | 41 | `load` |

---

## 2. D1 tables under `src/lib/server/db/schema/`

Ten schema files define 14 tables (`auth.ts` holds five: user, session, account, verification, passkey; `simControlPlane.ts` holds three: sim_index, sim_takedown, sim_commit). Identity set (V by function): `principal`, `user_identity`, `user`, `session`, `account`, `verification`, `passkey`, `user_version`, `handle_tombstone`. Authorization-ledger: `capability_event` (identity-adjacent; keyed by `principal`). Not identity: `plan`, `sim_index`, `sim_takedown`, `sim_commit`, `sim_invite` (membership; FKs `user_identity`).

Note: Better-Auth's drizzle adapter (`S:auth/better-auth.ts:133-136`, `schema` passed whole) is an additional reader/writer of `user`, `session`, `account`, `verification`, `passkey` that is not visible as `db.insert(...)` in app code (V for the adapter wiring; I for what it writes).

### 2.1 `principal` (identity table) `S:db/schema/principal.ts:11-14`
```ts
export const principal = sqliteTable('principal', {
  id: text('id').primaryKey(), // base58 uuidv7 (the identity's id)
  kind: text('kind').$type<'identity' | 'group' | 'service'>().notNull()
});
```
Writers: `S:user-store/identity.ts:31` (insert, kind 'identity'), `identity.ts:112` (delete orphan), `S:e2e/session.ts:28`. Readers: FK target only; no `select ... from(principal)` found in non-test code (V by grep `.from(principal)` empty). Schema comment says nothing writes 'group'/'service' (consistent: only 'identity' inserted).

### 2.2 `user_identity` (identity) `S:db/schema/users.ts:6-19`
```ts
export const userIdentity = sqliteTable('user_identity', {
  id: text('id')
    .primaryKey()
    .references(() => principal.id), // supertype: every identity is a principal
  supersededById: text('superseded_by_id').references((): AnySQLiteColumn => userIdentity.id),
  supersededAt: integer('superseded_at', { mode: 'timestamp_ms' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});
```
Writers: `identity.ts:32` (insert), `identity.ts:111` (delete orphan), `identity.ts:162,166` (set supersededById on fuse), `deletion.ts:126` (set deletedAt), `S:e2e/session.ts:29`. Readers: `user.ts:24,41,129`; `history.ts:32`; `deletion.ts:161,221`; `S:operator/capabilities.ts:50`.

### 2.3 `user` (identity) `S:db/schema/auth.ts:5-25`
```ts
export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: normText('name').notNull(),
    email: normText('email').notNull().unique(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    userIdentity: text('user_identity')
      .notNull()
      .references(() => userIdentity.id, { onDelete: 'cascade' }),
    handle: normText('handle').notNull().unique(),
    handleSkeleton: text('handle_skeleton'),
    isAnonymous: integer('is_anonymous', { mode: 'boolean' }).notNull().default(false)
  },
  (t) => [uniqueIndex('user_handle_skeleton_unique').on(t.handleSkeleton)]
);
```
Readers: `auth/magic-link.ts:13`; `better-auth.ts:59`; `user.ts:63,74,87,138`; `identity.ts:63,86,87,135,136`; `deletion.ts:163`; `profile.ts:24,61`; `auth-factors.ts:27`; `password-credential.ts:25`; `S:invites/control-plane.ts:60,71`; `S:invites/claim.ts:20`; `S:sims/sim-index.ts:180`; `R:api/e2e/login/+server.ts:37`. Writers: `identity.ts:58 (reseedHandleFromSim),97 (delete),99,169 (delete)`; `deletion.ts:63 (scrub)`; `profile.ts:113,118`; `R:invite/[token]/+page.server.ts:137` (binds invited email, sets `isAnonymous:false`); `R:api/e2e/login/+server.ts:45`; `S:e2e/session.ts:30`; Better-Auth adapter (inserts/updates).

### 2.4 `session` (identity) `auth.ts:27-38`
```ts
export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  token: privateText('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
```
Writers in app code: `deletion.ts:107` (delete), `S:e2e/session.ts:56`; otherwise Better-Auth adapter. Reader: Better-Auth (`auth.api.getSession`, `hooks.server.ts:38`).

### 2.5 `account` (identity) `auth.ts:40-60`
```ts
export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: privateText('access_token'),
  refreshToken: privateText('refresh_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  idToken: privateText('id_token'),
  password: privateText('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
});
```
Readers: `oauth.ts:15`; `auth-factors.ts:31`; `password-credential.ts:42,67`. Writers: `deletion.ts:108` (delete); `R:api/account/password/+server.ts:179` (delete credential row); Better-Auth adapter (set/change password, link social).

### 2.6 `verification` (identity) `auth.ts:62-69`
```ts
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: privateText('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
});
```
No app-code reader/writer (V by grep `verification` in non-test src finds none outside schema). Better-Auth adapter only (I). Not touched by `deleteAccount` (V: `deletion.ts:102-118` deletes session/account/passkey/simInvite only).

### 2.7 `passkey` (identity) `auth.ts:71-85`
```ts
export const passkey = sqliteTable('passkey', {
  id: text('id').primaryKey(),
  name: normText('name'),
  publicKey: privateText('public_key').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  credentialID: privateText('credential_id').notNull().unique(),
  counter: integer('counter').notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: integer('backed_up', { mode: 'boolean' }).notNull(),
  transports: text('transports'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  aaguid: privateText('aaguid')
});
```
Readers: `passkey.ts:9`; `auth-factors.ts:36`; `password-credential.ts:81`. Writers: `deletion.ts:109` (delete); Better-Auth passkey plugin.

### 2.8 `user_version` (identity; append-only history) `S:db/schema/userVersion.ts:7-20`
```ts
export const userVersion = sqliteTable(
  'user_version',
  {
    id: text('id').primaryKey(), // newId()
    userIdentity: text('user_identity').notNull().references(() => userIdentity.id, { onDelete: 'cascade' }),
    handle: normText('handle').notNull(),
    name: normText('name').notNull(),
    email: normText('email').notNull(),
    capturedAt: integer('captured_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [index('user_version_identity_idx').on(t.userIdentity)]
);
```
See section 10.

### 2.9 `handle_tombstone` (identity) `S:db/schema/handleTombstone.ts:9-21`
```ts
export const handleTombstone = sqliteTable(
  'handle_tombstone',
  {
    handle: text('handle').primaryKey(), // normalized, lowercase
    releasedBy: text('released_by').notNull().references(() => userIdentity.id),
    releasedAt: integer('released_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    skeleton: text('skeleton')
  },
  (t) => [index('handle_tombstone_skeleton_idx').on(t.skeleton)]
);
```
See section 10.

### 2.10 `capability_event` (authorization ledger) `S:db/schema/capabilityEvent.ts:18-43`
```ts
export const capabilityEvent = sqliteTable(
  'capability_event',
  {
    id: text('id').primaryKey(), // base58 uuidv7 (newId())
    principalId: text('principal_id').notNull().references(() => principal.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(), // 'app' | 'sim'
    resourceId: text('resource_id').notNull(), // base58 id, or '*' for app
    ability: text('ability').notNull(), // dot-namespaced, or '*'
    action: text('action').$type<'grant' | 'revoke'>().notNull(),
    caveats: text('caveats'), // JSON | null (attenuation; inert in Phase 1)
    parentId: text('parent_id'), // capability this descends from | null (provenance)
    actorId: text('actor_id'), // issuer/delegator identity id | null (system/bootstrap)
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    createdAtCounter: integer('created_at_counter').notNull().default(0)
  },
  (t) => [
    index('capability_event_principal_idx').on(t.principalId),
    index('capability_event_resource_idx').on(t.resourceType, t.resourceId),
    index('capability_event_created_idx').on(t.createdAt, t.createdAtCounter)
  ]
);
```
See section 10. Not an identity table in the strict sense, but it is the only store of sim membership (roles) AND operator capabilities, keyed to `principal`.

### 2.11 `sim_invite` (not identity; membership) `S:db/schema/simInvite.ts:14-37`
```ts
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
export const simInvite = sqliteTable(
  'sim_invite',
  {
    id: text('id').primaryKey(), // newId()
    simId: text('sim_id').notNull(),
    role: text('role').$type<SimMemberRole>().notNull(),
    invitedEmail: normText('invited_email'),
    invitedUserId: text('invited_user_id').references(() => userIdentity.id, { onDelete: 'cascade' }),
    tokenHash: privateText('token_hash').notNull(),
    invitedByUserId: text('invited_by_user_id').notNull().references(() => userIdentity.id, { onDelete: 'cascade' }),
    status: text('status').$type<InviteStatus>().notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSentAt: integer('last_sent_at', { mode: 'timestamp_ms' }),
    acceptedByUserId: text('accepted_by_user_id').references(() => userIdentity.id, { onDelete: 'set null' })
  },
  (t) => [uniqueIndex('sim_invite_token_hash_idx').on(t.tokenHash)]
);
```
Readers: `S:invites/control-plane.ts:96,152,231,257,337,350,364,399,422,443,486`. Writers: `control-plane.ts:138 (insert),194 (delete),282,370,381,419 (update)`; `S:sims/sims.ts:84,119 (delete)`; `S:user-store/deletion.ts:111` (delete by inviter/invitee). It is the only table in `S:user-store/` deletion that is not identity. Four FKs to `user_identity`.

### 2.12 Sim control plane (not identity) `S:db/schema/simControlPlane.ts`
```ts
export type SimMemberRole = 'manager' | 'editor' | 'viewer';   // :4
export const simIndex = sqliteTable('sim_index', {            // :11-21
  simId: text('sim_id').primaryKey(),
  title: normText('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  remixedFrom: text('remixed_from'),
  remixedFromPosition: integer('remixed_from_position'),
  positions: integer('positions').notNull().default(0),
  lastChangeAt: integer('last_change_at', { mode: 'timestamp_ms' }),
  datasetVersion: text('dataset_version')
});
export const simTakedown = sqliteTable('sim_takedown', {     // :24-27
  simId: text('sim_id').primaryKey(),
  takenDownAt: integer('taken_down_at', { mode: 'timestamp_ms' }).notNull()
});
export const simCommit = sqliteTable('sim_commit', { /* simId, seq, kind, source, actor, at, build, datasetVersion, bytes, restoresPosition, restoresAs; PK (simId,seq) */ }, ...); // :30-50
```
(`sim_commit` verbatim columns at `simControlPlane.ts:31-44`: `simId text notNull`, `seq integer notNull`, `kind text $type<CommitKind> notNull`, `source text notNull`, `actor text notNull`, `at integer timestamp_ms notNull`, `build text notNull`, `datasetVersion text notNull`, `bytes integer notNull`, `restoresPosition integer`, `restoresAs text $type<Restores['as']>`.) Note `simControlPlane.ts:2` imports types from `$lib/sim-log` (type-only).
Readers/writers: `S:sim-object/index-sync.ts:52,56`; `S:sims/sim-index.ts:77,90`; `S:sims/sims.ts:77,82,83`; `S:invites/control-plane.ts:457,490` (simIndex); `S:sims/sim-roles.ts:88,113,164` (join simIndex); `R:api/sims/[simId]/invites/+server.ts:80`, `.../resend/+server.ts:51`. Not in S1 beyond the type `SimMemberRole`, which `S:authz/` imports.

### 2.13 `plan` (not identity) `S:db/schema/plan.ts:3-18`
```ts
export const plan = sqliteTable('plan', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull().default('plan'),
  schema: integer('schema').notNull(),
  datasetVersion: text('dataset_version').notNull(),
  body: text('body').notNull(),
  contentHash: text('content_hash').notNull().unique(),
  opCount: integer('op_count').notNull(),
  byteSize: integer('byte_size').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
}, (t) => [index('plan_created_at_idx').on(t.createdAt)]);
```
Has NO user/identity column (V: no FK, no author field). Readers: `S:sharing/store.ts:9,13`; writer `store.ts:18`. This is the publish store; it is not coupled to identity.

Doc/code: `docs/dev/auth.md:8` says "Three tables" for the identity model; code has also `principal`, `handle_tombstone` and uses `capability_event` (see contradictions).

---

## 3. References from scope to sims / invites / members / roles / capabilities

Grep was case-insensitive over non-test files in scope. Hits grouped by file. Excluded: "similar/simple" substrings, a11y `role="status"` attributes, `PRODUCT_NAME` "Simulator".

**`src/hooks.server.ts`**: `:7` import `resolveCapabilities` (`$lib/server/operator/capabilities`); `:12` `locals.capabilities = []` in `setPublicLocals`; `:53-58` capability resolution inside `sessionHandle`.
**`src/app.d.ts`**: `:3` `Capability` type; `:12` `Error.resource?: 'sim'`; `:20` `Locals.capabilities: Capability[]`; `:28-30` `PageState.sfhSimRemix`.
**`S:auth/session-gate.ts`**: `:31-34` `'/sims'`, `'/api/sims'`, `'/invite'`, `'/api/invites'` in `SESSION_ROUTE_PREFIXES`.
**`S:auth/brand.ts`**: `:2` product name only.
**`S:authz/*`**: whole directory is sim-role/capability model (section 4).
**`S:user-store/identity.ts`**: `:6` `loggable` from `$lib/server/sim-object/object-rules`; `:7` `rosterChangedAll` from `$lib/server/sims/roster-hook`; `:8` `SimEnv`; `:9` `foldSimsForUser` from `$lib/server/sims/sim-roles`; `:35` `simTitle` into `generateUniqueHandle`; `:46` `reseedHandleFromSim` (`simTitle` arg); `:127-171` `applyFuse` reads the absorbed identity's sims (`foldSimsForUser`, `:147`) before the fuse; `:174-204` `handleAccountLink` takes `roster` and calls `rosterChangedAll` (`:198`).
**`S:user-store/deletion.ts`**: `:10` `simInvite` import; `:18-22` `listSimsForUser`, `removeSimMember`, `rosterChangedAll`, `SimEnv`, `loggable`; `:111` deletes `simInvite`; `:130` `DELETE_SIMS_PER_PASS`; `:166-188` membership removal loop; `:179` roster fan-out.
**`S:user-store/handle.ts`**: `:29,34` `simTitle` arg.
**`S:user-store/handle-normalize.ts`**: `:15-17` reserved handles `'invite'`, `'sims'`, `'sim'` (route names).
**`S:onboarding/pending-sim.ts`**: whole module (stash of a sim title across sign-in): `PENDING_SIM_COOKIE`.
**`S:onboarding/pending-identifier.ts`**: `:3-4,9` comment ties to invite page.
**`S:onboarding/pseudonymous-mint.ts`**: `:6` `SIMS_COPY` from `$lib/members/copy`; `:15` doc names `startSim`, `/signin` start-fresh, invite cold-join as callers; `:28,38` copy keys `tooManySims`, `sessionStart`.
**`S:security/rate-limit.ts`**: `:1` comment lists invite limiters; `:41-43` `RATE_LIMIT_MESSAGES.invites`.
**`S:security/same-origin-json.ts`**: `:2` `SIMS_COPY` from `$lib/members/copy`; `:13,25` copy keys `jsonRequired`, `crossOrigin`.
**`S:email-templates/`**: `copy.ts:40-49` `invite` copy block; `invite.ts` (whole file) `buildInviteEmail`; `InviteEmail.svelte` (whole file).
**`S:e2e/mail-sink.ts`**: `:5` `'invite'` mail kind.
**`S:event-log/append.ts`**: `:6,47` comments about "single-threaded sim DO" and "sim DO SQLite" handle; `:11` "all four event tables".
**`S:event-log/fold.ts`**: `:35` comment "capability ledger".
**`S:db/schema/index.ts`**: `:5,6,8` exports `simControlPlane`, `simInvite`, `capabilityEvent`.
**`S:db/schema/{simInvite,simControlPlane,capabilityEvent,principal}.ts`**: section 2.
**`S:db/schema/plan.ts`**: `:7` comment `'plan' | 'sim'` kind.
**`S:db/capability-events.ts`**: whole file (capability ledger append); `:24` comment names `sim-roles.ts`.
**`S:test/auth-db.ts`**: `:8-9` `ROLE_BUNDLE`, `addSimRole`; `:74-157` `grantEvent`, `seedSim`, `seedManagedSims`, `simIndex`/`capabilityEvent` inserts.
**`S:test/sim-env.ts`, `S:test/sim-docs.ts`**: sim test fixtures.
**`R:signin/+page.server.ts`**: `:12` `loggable` from sim-object; `:17` `clearPendingSim`, `readPendingSim`; `:20-21` `createSim`, `checkSimTitle`; `:23` `reseedHandleFromSim`; `:40-42` load returns `pendingSim`; `:146` comment "invites and member lists"; `:212-257` `startFresh` creates a sim (`createSim`, `:238`) and redirects to `/sims/<id>` (`:250`) or `/sims` (`:223,228,256`).
**`R:signin/+page.svelte`**: `:5` `pendingSimLine`; `:120-121` shows pending sim title; `:15,277` comments.
**`R:account/+page.server.ts`**: `:14` comment ("every sim only it manages"); `:57` comment ("next sim started on this device").
**`R:api/account/+server.ts`**: `:40,43` comments about sims left.
**`R:api/account/email/verify/+server.ts`**: `:19` comment ("cold join from an emailed invite").
**`R:api/e2e/mail/+server.ts`**: `:13` `'invite'` in `KINDS`.
**`S:auth/better-auth.ts`**: `:304` roster hook (`roster: { env: platform.env, defer: ... }`) passed to `handleAccountLink`.
**`L:account/`**: `account-copy.ts:68` "You leave every sim; their links still open."; `copy.ts:56` `pendingSimLine`; `AuthenticationPane.svelte:59` comment (cold join from invite); `DeleteAccountPane.svelte:13` comment (server answers 202 while it has sims to leave).
**`S:config/`, `S:ids/`, `S:db/index.ts`, `S:db/columns.ts`, `L:ids/`, `hooks.client.ts`, `R:+layout.server.ts`**: no sim/invite/member/role/capability reference.

Summary of upward couplings (identity code importing sim-domain modules): `user-store/identity.ts` (3: `sims/roster-hook`, `sims/sim-roles`, `sim-object/object-rules`, `sim-object/stub` type), `user-store/deletion.ts` (`sims/sim-index`, `sims/sims`, `sims/roster-hook`, `sim-object/*`), `onboarding/pseudonymous-mint.ts` + `security/same-origin-json.ts` (`$lib/members/copy`), `authz/require-cap.ts` + `authz/require-sim-role.ts` (`sims/sim-index.getRole`), `R:signin/+page.server.ts` (`sims/sims`, `sims/start-sim`). `S:sims/start-sim.ts` imports `reseedHandleFromSim`, `mintPseudonymousSession`, `isKnownDevice`, `stashPendingSim` (sims code imports identity code): the dependency runs both ways.

---

## 4. `src/lib/server/authz`: full model

Types and tables, verbatim.

`resource.ts:2-6`:
```ts
export type ResourceType = 'app' | 'sim';
export type ResourceRef = { type: ResourceType; id: string };
export const APP_RESOURCE: ResourceRef = { type: 'app', id: '*' };
```
`covers(held, target, ancestors=[])` (`resource.ts:21-29`): true if `held` is `APP_RESOURCE`, equals `target`, or equals an ancestor. No caller passes `ancestors` in non-test code (V: `authorize()` reads `req.ancestors ?? []`, and `requireCap` builds `{ ability, resource }` with no ancestors, `require-cap.ts:49`).

`actor.ts:2-8`:
```ts
export const ACTOR_KINDS = ['human', 'ai', 'automation', 'public'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];
export type Actor = { actorId: string; actorKind: ActorKind };
export const PUBLIC_ACTOR_ID = 'group:public';
```
Only `'human'` and `'public'` are ever assigned in non-test code (V `hooks.server.ts:13,61`; `require-cap.ts:53-54`; `R:api/account/+server.ts:39`).

`ability.ts:2-33` (roles to abilities):
```ts
export type Ability = string;
export const WILDCARD: Ability = '*';
export const ROLE_BUNDLE = {
  manager: 'role.manager',
  editor: 'role.editor',
  viewer: 'role.viewer'
} as const;
export type RoleBundle = (typeof ROLE_BUNDLE)[keyof typeof ROLE_BUNDLE];

const VIEWER_ABILITIES = ['sim.read'] as const;
const EDITOR_ABILITIES = [...VIEWER_ABILITIES, 'sim.write'] as const;
const MANAGER_ABILITIES = [...EDITOR_ABILITIES, 'member.manage', 'invite.manage'] as const;

const BUNDLE_EXPANSION: Record<RoleBundle, readonly string[]> = {
  'role.viewer': VIEWER_ABILITIES,
  'role.editor': EDITOR_ABILITIES,
  'role.manager': MANAGER_ABILITIES
};
const BUNDLE_RANK: Record<RoleBundle, number> = {
  'role.viewer': 0,
  'role.editor': 1,
  'role.manager': 2
};
```
`abilityDominates(held, target)` (`ability.ts:48-63`): `*` dominates all; exact match; `ns.*` prefix match; a bundle dominates a lower-or-equal bundle by rank and any fine ability in its expansion; otherwise false. Comment `ability.ts:15-17`: `member.leave` intentionally not an ability (self action).

`authorize.ts:4-17`:
```ts
type Caveat = { expiresAt?: number };
export type Capability = { ability: Ability; resource: ResourceRef; caveats?: Caveat };
export type AuthRequest = {
  ability: Ability;
  resource: ResourceRef;
  ancestors?: ResourceRef[];
};
export type Decision = { allow: true } | { allow: false; reason: 'forbidden' | 'not_found' };
```
`authorize(held, req)` (`:36-46`): ALLOW iff a held capability covers the resource and dominates the ability; else `not_found` if nothing covers the resource, else `forbidden`. Caveats are not evaluated (V: no read of `caveats` in `authorize.ts`).

`sim-caps.ts:11-13`:
```ts
export function simCaps(role: SimMemberRole | null, simId: string): Capability[] {
  return role ? [{ ability: ROLE_BUNDLE[role], resource: { type: 'sim', id: simId } }] : [];
}
```
`SimMemberRole = 'manager' | 'editor' | 'viewer'` (`S:db/schema/simControlPlane.ts:4`).

`require-cap.ts:40-62` `requireCap(event, ability, resource, opts?)`: caps = `opts.caps` or `resolveResourceCaps` (`:24-31`: app resource returns `event.locals.capabilities`; sim resource returns `simCaps(await getRole(...))`, or `[]` with no user). Decision map: allow returns `{caps, actor}`; deny -> 401 if no user (`:58`), 404 (`{message:'not found', resource:'sim'}`) if non-app resource and `not_found` (`:59-60`), else 403.

`require-sim-role.ts:19-38` `requireSimRole(event, simId, minRole)`: reads role via `getRole`, calls `requireCap` with `ROLE_BUNDLE[minRole]` and `simCaps(role, simId)`, returns `{ role, actor }`.

Callers outside the directory (non-test), V:
- `requireSimRole`: `R:api/sims/[simId]/invites/+server.ts:30` (manager); `R:api/sims/[simId]/invites/[inviteId]/+server.ts:11` (manager); `.../resend/+server.ts:21` (manager); `R:api/sims/[simId]/members/[userId]/+server.ts:14` (manager); `R:sims/[simId]/+layout.server.ts:16` (viewer); `R:sims/[simId]/+page.server.ts:17` (viewer), `:25` (viewer, leaveSim), `:62` (editor, rename).
- `requireCap` directly: none outside `authz/`. (`S:operator/capabilities.ts:82` mentions it in a comment only.)
- `ROLE_BUNDLE`: `S:sims/sim-roles.ts:6-20,94,118,169,220`; `S:sim-object/access.ts:1,57-58` (`canWrite`); `S:test/auth-db.ts:145`.
- `abilityDominates`: `S:sim-object/access.ts:58`.
- `authorize`, `APP_RESOURCE`, `Capability`, `ResourceRef`, `ResourceType`, `Ability`: `S:operator/capabilities.ts:7-14,66,72`; `S:operator/grants.ts:4` (`Capability`).
- `Capability`, `ActorKind`: `src/app.d.ts:3-4`. `Actor`: `S:user-store/deletion.ts:15`.
- `simCaps`: only in-dir.

Operator layer (adjacent, `S:operator/`, outside S1 scope but it is the only consumer of `app` capabilities): `registry.ts:5` `OPERATOR_ABILITIES = ['cap.grant', 'cap.revoke']`; `capabilities.ts` (`isBootstrapEmail`, `resolveGrantedCapabilities`, `resolveCapabilities`, `hasCapability`, `isOperator`, `requireCapability`, `requireOperator`, `resolveCapsFor`); `grants.ts` (`grantCapability`, `revokeCapability`). In non-test code, `requireOperator`, `requireCapability`, `grantCapability`, `revokeCapability`, `isOperator` have NO callers outside `operator/` (V grep). `hooks.server.ts:58` populates `locals.capabilities` on every session request, but the only non-test reader of `locals.capabilities` is `authz/require-cap.ts:25` (`app` branch), and `requireCap` is never called with an `app` resource in non-test code (V: only call is `require-sim-role.ts:28`, resource type `sim`). The operator takedown route authenticates by bearer token, not by capability (`R:api/operator/sims/[simId]/takedown/+server.ts:29-33`).

---

## 5. `hooks.server.ts`

Exported `handle = sequence(sessionHandle, headersHandle)` (`hooks.server.ts:96`). Order:

1. `sessionHandle` (`:24-66`):
   1. `:25` `shouldResolveSession(url, headers)`; if false: `setPublicLocals` (user null, session null, `capabilities []`, `actorKind 'public'`, `:9-14`) and `resolve` (`:26-27`). Better-Auth is not constructed.
   2. `:29` `getAuth(platform, url.origin)` (throws if `BETTER_AUTH_SECRET` missing/placeholder/<32 chars, `better-auth.ts:40-46`).
   3. `:37-41` `auth.api.getSession`; with `disableRefresh: true` when the request has `upgrade: websocket`.
   4. `:42-61` if a session user: `getDb`; `resolveSessionUser` (`:44`; null for tombstoned identity); `locals.user = u`; `locals.session = {id, userId}` (live Better-Auth user id, `:50-52`); `locals.capabilities = u ? resolveCapabilities(db, u, BOOTSTRAP_EMAILS) : []` (`:57-58`); `locals.actorKind = u ? 'human' : 'public'` (`:61`).
   5. `:62-64` else `setPublicLocals`.
2. `headersHandle` (`:81-94`): after resolve, status 101 returned untouched (`:84`); sets `referrer-policy: strict-origin-when-cross-origin`, `x-content-type-options: nosniff`, and for `text/html` without `cache-control` sets `private, no-cache` (`:68-79`); re-wraps response if headers immutable (`:88-93`). Gates nothing.

Session gate (`S:auth/session-gate.ts`):
- `shouldResolveSession(url, headers)` (`:58-61`): false if decoded pathname starts with `/data/` (`:59`, `routedPath` decodes `decodeURI`, `:48-54`); else true when a Cookie header carries `better-auth.session_token` or `__Secure-better-auth.session_token` (`:9-23`) OR the path is at/under a `SESSION_ROUTE_PREFIXES` entry.
- `SESSION_ROUTE_PREFIXES` (V `session-gate.ts:27-39`):
```ts
const SESSION_ROUTE_PREFIXES = [
  '/api/auth', '/account', '/api/account', '/sims', '/api/sims',
  '/invite', '/api/invites', '/signin', '/forgot-password', '/reset-password', '/api/e2e'
] as const;
```
  Prefix match is `pathname === p || pathname.startsWith(p + '/')` (`:42-44`). Not listed: `/`, `/sim`, `/lesscars`, `/p`, `/s`, `/about`, `/api/plans`, `/api/policies`, `/api/operator`, `/data`. Those resolve a session only when a session cookie is present (and `/data/` never).

JSON-route origin check (V `S:security/same-origin-json.ts`): NOT a hook; a per-route function. `refuseUnlessSameOriginJson(event)` (`:10-16`): 415 unless content-type is `application/json`, then `refuseForeignOrigin` (`:22-28`): 403 when `Origin` header is present and differs from `url.origin` (an empty Origin counts as present). Applied by (V, grep of importers): `/api/account` (DELETE only; GET not), `/api/account/profile` PATCH, `/api/account/email` PATCH, `/api/account/email/verify` POST, `/api/account/password` POST and DELETE, `/api/invites/[inviteId]/accept` POST, `.../decline` POST, `/api/operator/sims/[simId]/takedown` POST, `/api/sims` POST, `/api/sims/[simId]/invites` POST, `.../invites/[inviteId]` DELETE, `.../resend` POST, `/api/sims/[simId]/members/[userId]` DELETE; `/api/sims/[simId]/stream` GET uses only `refuseForeignOrigin` (after a websocket-upgrade check). Not applied: `POST /api/plans`, `POST /api/policies` (V `S:sharing/publish.ts:45-80`: checks content-type only and rate limit; no Origin check), `/api/auth/[...all]` (Better-Auth's `trustedOrigins`, `better-auth.ts:122,138`), `/api/e2e/*`, form actions (SvelteKit's own check, per comment `same-origin-json.ts:4-5`).

---

## 6. `src/routes/+layout.server.ts` returned data

V `R:+layout.server.ts:10-41`:
```ts
export const load: LayoutServerLoad = ({ platform, locals, cookies }) => {
  const data = {
    datasetVersion: resolveDatasetVersion({
      built: __SFH_DATASET_VERSION__,
      override: devOverride(platform?.env) ?? publicEnv.PUBLIC_DATASET_VERSION,
      development: dev || platform?.env?.ENVIRONMENT === 'development'
    }),
    appRelease: platform?.env?.PUBLIC_APP_RELEASE ?? publicEnv.PUBLIC_APP_RELEASE ?? 'dev',
    user: locals?.user ?? null,
    signInAvailable: enabledAuthMethods({ platform, cookies }).size > 0
  };
  if (!locals?.user || !locals.session) return data;
  return refreshKnownDevice(platform!, locals.user, locals.session.userId, cookies).then(
    () => data
  );
};
```
Effective shape: `{ datasetVersion: string; appRelease: string; user: User | null; signInAvailable: boolean }` where `User` is the full `S:user-store/user.ts:6` type (so `email`, `emailVerified`, `pseudonymous`, `image`, `handle`, `name`, `id` all reach every page's `data.user`). Side effect: when signed in and (account not pseudonymous or has a passkey) and no `sfh_known` cookie, sets it (`:39-40`). It performs one D1 read (`userHasPasskey`) per signed-in page load. `locals.capabilities` and `locals.session` are not returned.

---

## 7. Signed-out reach: every server route file in `src/routes`

"Session?" = does the code require a signed-in user. Check location in the last column. All methods listed are exported handlers/actions. A page with only `+page.ts`/`+page.svelte` (no server file) is listed at the end.

| Route | Methods / actions | Requires session? | Check (path:line) |
|---|---|---|---|
| (root layout) | load | no | `R:+layout.server.ts:10` (user nullable) |
| `/about` | load | no | `R:about/+page.server.ts:5` |
| `/attribution` | load (308 redirect to `/about#about-data`) | no | `R:attribution/+page.server.ts:5-7` |
| `/account` | load | yes: 303 to `/signin?returnTo=/account` | `R:account/+page.server.ts:34` |
| `/account` | action `signOut` | conditional: with no user it just redirects `/` (no error); acts only for an account that can sign back in | `R:account/+page.server.ts:62-67` |
| `/signin` | load | no (signed-in users are redirected away) | `R:signin/+page.server.ts:28-30` |
| `/signin` | actions `sendLink`, `signInPassword`, `startFresh` | no (they are sign-in/mint actions); `startFresh` mints a pseudonymous account and creates a sim | `R:signin/+page.server.ts:55,152,212` |
| `/forgot-password` | load, action `requestReset` | no; 404 when password method off | `R:forgot-password/+page.server.ts:11,28` |
| `/reset-password` | load, action `resetPassword` | no; 404 when password method off | `R:reset-password/+page.server.ts:21,30` |
| `/invite/[token]` | load | no (token page shows sim title, inviter handle, invited email to anyone holding the token) | `R:invite/[token]/+page.server.ts:22-39` |
| `/invite/[token]` | action `accept` | conditional: signed out is redirected `/` | `R:invite/[token]/+page.server.ts:43` |
| `/invite/[token]` | action `join` | no (cold-accept for signed-out; may mint pseudonymous or bind an email) | `R:invite/[token]/+page.server.ts:63-193` |
| `/p/[id]` | load | no | `R:p/[id]/+page.server.ts:4` |
| `/s/[id]` | load | no | `R:s/[id]/+page.server.ts:8` |
| `/sims` (layout) | load | no (signed out gets `recipientInvites: []`) | `R:sims/+layout.server.ts:7` |
| `/sims` | load | no (signed out gets empty lists) | `R:sims/+page.server.ts:14` |
| `/sims` | action `create` | no: a signed-out visitor is minted a pseudonymous account (unless on a known device, then redirected to `/signin`) | `R:sims/+page.server.ts:64-76` -> `S:sims/start-sim.ts:81-84,90-109` |
| `/sims/[simId]` (layout) | load | yes (sign-in then membership: 401 / 404 / 403) | `R:sims/[simId]/+layout.server.ts:16` -> `S:authz/require-cap.ts:58-61` |
| `/sims/[simId]` | load | yes, role viewer | `R:sims/[simId]/+page.server.ts:17` |
| `/sims/[simId]` | action `leaveSim` | yes (303 `/sims` if no user; then viewer) | `R:sims/[simId]/+page.server.ts:24-25` |
| `/sims/[simId]` | action `rename` | yes, role editor (401 fail if no user) | `R:sims/[simId]/+page.server.ts:62-65` |
| `/data/[version]/[...path]` | GET, HEAD, OPTIONS | no; hooks never resolve a session here | `R:data/[version]/[...path]/+server.ts:81,134,146`; `S:auth/session-gate.ts:59` |
| `/api/auth/[...all]` | GET, POST | no (Better-Auth enforces its own per-endpoint session needs; `POST /sign-in/anonymous` is 404; off-method paths 404) | `R:api/auth/[...all]/+server.ts:76-123` |
| `/api/account` | GET | yes -> 401 | `R:api/account/+server.ts:12` |
| `/api/account` | DELETE | yes -> 401 | `R:api/account/+server.ts:28` |
| `/api/account/profile` | PATCH | yes -> 401 | `R:api/account/profile/+server.ts:13` |
| `/api/account/email` | PATCH | yes -> 401 (and 404 when magic-link off) | `R:api/account/email/+server.ts:12,16` |
| `/api/account/email/verify` | POST | yes -> 401 (404 when magic-link off) | `R:api/account/email/verify/+server.ts:13,17` |
| `/api/account/password` | POST | yes -> 401 (404 when password off) | `R:api/account/password/+server.ts:31,35` |
| `/api/account/password` | DELETE | yes -> 401 | `R:api/account/password/+server.ts:140,144` |
| `/api/invites/[inviteId]/accept` | POST | yes -> 401 | `R:api/invites/[inviteId]/accept/+server.ts:14-15` |
| `/api/invites/[inviteId]/decline` | POST | yes -> 401 | `R:api/invites/[inviteId]/decline/+server.ts:11` |
| `/api/operator/sims/[simId]/takedown` | POST | no session; bearer token `SIM_TAKEDOWN_TOKEN` (404 on mismatch) | `R:api/operator/sims/[simId]/takedown/+server.ts:29-33` |
| `/api/plans` | POST | no (publish is anonymous, IP rate-limited) | `R:api/plans/+server.ts:5` -> `S:sharing/publish.ts:64` |
| `/api/plans/[id]` | GET | no | `R:api/plans/[id]/+server.ts:5` |
| `/api/policies` | POST | no (publish is anonymous, IP rate-limited) | `R:api/policies/+server.ts:5` |
| `/api/policies/[id]` | GET | no | `R:api/policies/[id]/+server.ts:5` |
| `/api/sims` | POST | conditional: signed-out may register (mint) unless on a known device (401 `sign_in`) | `R:api/sims/+server.ts:37-40` |
| `/api/sims/[simId]/stream` | GET (websocket) | no: anyone with the id gets a read socket; `write` only if the user is a member with writer role | `R:api/sims/[simId]/stream/+server.ts:35-36` |
| `/api/sims/[simId]/invites` | POST | yes, role manager | `R:api/sims/[simId]/invites/+server.ts:30` |
| `/api/sims/[simId]/invites/[inviteId]` | DELETE | yes, role manager | `.../invites/[inviteId]/+server.ts:11` |
| `/api/sims/[simId]/invites/[inviteId]/resend` | POST | yes, role manager | `.../resend/+server.ts:21` |
| `/api/sims/[simId]/members/[userId]` | DELETE | yes, role manager | `R:api/sims/[simId]/members/[userId]/+server.ts:14` |
| `/api/e2e/login` | POST | no; 404 unless `VITE_E2E=1` and `ENVIRONMENT=development` | `R:api/e2e/login/+server.ts:13-14` |
| `/api/e2e/mail` | GET | no; same e2e gate | `R:api/e2e/mail/+server.ts:17-18` |
| `/api/e2e/plans` | POST | no; same e2e gate | `R:api/e2e/plans/+server.ts:9`; `S:sharing/e2e-seed.ts` |

Pages with no server file (so no server-side gate at all, reachable signed out): `/` (`R:+page.ts`, `+page.svelte`), `/sim` (`+page.ts`), `/lesscars` (`+page.ts`), `/fzp` (`+page.ts`; documented as a redirect to `/sim`, not opened). These are the map/paint/sim/lesscars surfaces.

Signed-out can: browse `/`, `/sim`, `/lesscars`, `/about`, `/p/[id]`, `/s/[id]`, read `/data/*`, read `GET /api/plans/[id]` and `/api/policies/[id]`, publish a plan/policy (`POST /api/plans`, `/api/policies`), open a sim websocket for read, view an invite page by token, start a sim (which mints a pseudonymous account on the spot). Signed-out cannot: reach `/account`, `/sims/[simId]`, any `/api/account/*`, accept/decline an invite by API, any member/invite management.

---

## 8. Pseudonymous accounts

**What mints one:** exactly one function, `mintPseudonymousSession(event, deps?)` at `S:onboarding/pseudonymous-mint.ts:17-40`, which calls `authFor(event).api.signInAnonymous()` (`:29`) after the rate check (`:22-27`). Better-Auth's `anonymous()` plugin (`better-auth.ts:289-307`) creates the user; `databaseHooks.user.create.before` (`better-auth.ts:263-270`) then calls `createIdentityForNewVersion({ pseudonymous: userData.isAnonymous === true, ... })` which inserts `principal`, `user_identity` and generates a handle (`identity.ts:25-43`). Email is a synthetic `*@pseudonymous.sfhousing.invalid` (`brand.ts:5`; `anonymous({ emailDomainName })` `better-auth.ts:290`). `disableDeleteAnonymousUser: true` (`:291`).

**Call sites of `mintPseudonymousSession`** (V grep):
1. `S:sims/start-sim.ts:100`: signed-out registration of a sim, after the in-use check (`:96`) and known-device check (`:81`). Reached from `R:sims/+page.server.ts:70` (form action `create`) and `R:api/sims/+server.ts:40` (`POST /api/sims`).
2. `R:signin/+page.server.ts:219`: action `startFresh` ("Start fresh without an account").
3. `R:invite/[token]/+page.server.ts:119`: action `join`, case `mint`, when no known device (or `fresh=1`).

**The public HTTP faucet is closed:** `R:api/auth/[...all]/+server.ts:82` returns 404 for `POST /api/auth/sign-in/anonymous`.

**Upgrade/fuse:** a pseudonymous account becomes non-pseudonymous by magic link/Google linking (`onLinkAccount` -> `handleAccountLink`, `better-auth.ts:292-306`; `identity.ts:83-122` upgrade keeps the pseudonymous identity, `:129-172` fuse points it at the survivor), by invite cold-join with an invited email (`R:invite/[token]/+page.server.ts:136-147` sets `isAnonymous:false`), and by the e2e login (`S:e2e/session.ts:30`, a registered user directly). A password or passkey does not end pseudonymity (doc `auth.md:23-24`; code: nothing sets `isAnonymous` false on password/passkey: V by grep `isAnonymous`).

**`PSEUDO_MINT_RL`:** guards only that one mint seam: `S:onboarding/pseudonymous-mint.ts:23`, key `pseudo_mint:${CF-Connecting-IP or 'unknown'}` (`:21-22`), `critical: true` (fail closed in production when the binding is missing). Config 5 per 60 s in production (`wrangler.jsonc:30`, namespace 4104) and staging (`:77`, namespace 4204). On refusal returns `{ ok:false, status:429, message: SIMS_COPY.tooManySims }` (`:28`).

**Known-device steering:** `sfh_known` cookie is set only in `R:+layout.server.ts:39-40` (not pseudonymous or has a passkey), read by `start-sim.ts:81`, `R:api/sims/+server.ts:37`, `R:invite/[token]/+page.server.ts:110`; never set on mint (comment `known-device.ts:4-5`).

**Pseudonymous-specific behaviors in code:** sign-out hidden unless the account can sign back in (`R:account/+page.server.ts:16-21,60-67`); password-removal guard (`S:user-store/password-credential.ts:58-87`); reset-password refuses undeliverable addresses (`S:auth/password-reset-gate.ts:18-20`); operator bootstrap refuses pseudonymous (`S:operator/capabilities.ts:33-36`); handle reseeded from the first sim title (`start-sim.ts:127-159`); accounts are never reaped (doc only; no reaper in code found in S1; not examined elsewhere).

---

## 9. Rate-limit bindings: consumption sites in `src` (non-test)

Binding config (V `wrangler.jsonc:26-37` production, `:68-92` staging): `PUBLISH_RL` 10/60 s, `AUTH_LINK_RL` 5/60, `AUTH_PASSWORD_RL` 5/60, `PSEUDO_MINT_RL` 5/60, `INVITE_RL` 10/60, `ACCOUNT_EDIT_RL` 10/60, `MUTATION_REGISTERED_RL` 120/60 (namespaces 4101-4107 / 4201-4207). `enforceRate` (`S:security/rate-limit.ts:17-38`) returns true always when `ENVIRONMENT === 'development'`; with a missing binding it allows unless `critical` (in production then denies).

| Binding | Site | Key | critical |
|---|---|---|---|
| `PUBLISH_RL` | `S:sharing/publish.ts:64` | `'publish:' + cf-connecting-ip` | yes |
| `AUTH_LINK_RL` | `R:signin/+page.server.ts:66` | `auth_link_ip:<ip>` | yes |
| | `R:signin/+page.server.ts:85` | `auth_link_email:<email>` (silent) | yes |
| | `R:forgot-password/+page.server.ts:40` | `auth_link_ip:<ip>` | yes |
| | `R:forgot-password/+page.server.ts:54` | `auth_link_email:<email>` (silent) | yes |
| | `R:api/account/email/+server.ts:26` | `auth_link_ip:<ip>` | yes |
| | `R:api/account/email/verify/+server.ts:33` | `auth_link_ip:<ip>` | yes |
| | `R:api/account/email/verify/+server.ts:40` | `auth_link_email:<email>` (silent) | yes |
| | `R:api/auth/[...all]/+server.ts:88,95,105` | `auth_link_ip:<ip>` and `auth_link_email:<email>` for POST `LINK_PATHS` (request-password-reset, sign-in/magic-link, send-verification-email, change-email) | yes |
| `AUTH_PASSWORD_RL` | `R:signin/+page.server.ts:174` | `auth_pw_ip:<ip>` | yes |
| | `R:signin/+page.server.ts:180` | `auth_pw_handle:<normalized handle>` | yes |
| | `R:reset-password/+page.server.ts:58` | `auth_pw_ip:<ip>` | yes |
| | `R:api/auth/[...all]/+server.ts:88,95,105` | `auth_pw_ip:<ip>`, `auth_pw_email:<email>` for POST `/sign-in/email` | yes |
| | `R:api/auth/[...all]/+server.ts:115` | `auth_pw_ip:<ip>` for POST `/reset-password` | yes |
| `PSEUDO_MINT_RL` | `S:onboarding/pseudonymous-mint.ts:23` | `pseudo_mint:<ip>` | yes |
| `INVITE_RL` | `R:api/sims/[simId]/invites/+server.ts:38` | `invite_ip:<ip>` via `enforceMutationRate` | per call (not read here) |
| | `.../invites/+server.ts:43` | `invite:<actorId>` via `enforceMutationRate` | per call |
| | `.../invites/+server.ts:72` | recipient-keyed `enforceRate` | not read |
| `ACCOUNT_EDIT_RL` | `R:api/account/profile/+server.ts:17` | `account_edit:<userId>:<ip>` | no (default) |
| | `R:api/account/password/+server.ts:41` | `account_pw:<userId>` | yes |
| | `R:api/account/password/+server.ts:149` | `account_pw:<userId>` | yes |
| `MUTATION_REGISTERED_RL` | `S:sims/start-sim.ts:32` (`simStartAllowed`) | `sim_start:<identityId>` | yes |
| | `R:api/sims/[simId]/invites/[inviteId]/resend/+server.ts:24` | `invite_resend:<actorId>` via `enforceMutationRate` | per call |

`simStartAllowed` is also called from `R:sims/+page.server.ts:27` (pending-title resume) and `start-sim.ts:111`.

The `INVITE_RL` lines 38/43/72 were read via grep only (the file `.../invites/+server.ts` was not read in full; `critical` flags for those not verified).

---

## 10. `capability_event`, `principal`, `user_version`, `handle_tombstone`, `event-log`

### `capability_event`
- Writers: all through `buildCapabilityEventSql`/`insertCapabilityEvent` (`S:db/capability-events.ts:27-53`), which uses `buildAppendEventSql` (`S:event-log/append.ts:21-45`) to stamp `created_at`/`created_at_counter` in SQL.
  - `S:operator/grants.ts:19` (`resourceType:'app'`, `resourceId:'*'`; no production caller of `grantCapability`/`revokeCapability`, section 4).
  - `S:sims/sim-roles.ts:275` (`setSimRole` loop), `:288` (`addSimRole`), `:299` (`buildFirstManagerGrantSql`, used inside `createSim` batch, doc `auth.md:126`), `:314` (`revokeSimRoles`).
  - Test seeds `S:test/auth-db.ts:88,157` (direct inserts).
- Readers: `S:operator/capabilities.ts:131` (`resolveCapsFor`; app and sim scopes); `S:sims/sim-roles.ts:87` (`foldSimRole`), `:112` (`foldSimMembers`), `:163` (`foldSimsForUser`), `:214` (`revokeSimRoles`/role read); `S:sims/sim-index.ts:35` (`hasPast`, raw `exists` subquery over `capabilityEvent`).
- Fold semantic: `foldRevokeWins` (`S:event-log/fold.ts:37-52`), called at `operator/capabilities.ts:135` and `sims/sim-roles.ts:47`.
- `S:sims/sim-roles.ts` is the sole sim membership store (membership = role grant events; V `sim-roles.ts:12-20,87-97`).

### `principal`
Writers: `identity.ts:31,112`; `S:e2e/session.ts:28`. Readers: none in non-test code besides FK enforcement. `capability_event.principal_id` FKs it with `onDelete: 'cascade'` (`capabilityEvent.ts:22-24`).

### `user_version`
- Writer: `recordUserVersion` (`S:user-store/history.ts:7-22`), the only insert. Callers: `S:auth/better-auth.ts:61` (in `recordHistoryFor`, from `databaseHooks.user.create.after` `:277` and `.update.after` `:283`); `identity.ts:65` (`reseedHandleFromSim`), `:115` (upgrade), `:153` (fuse); `deletion.ts:209` (tombstone row); `profile.ts:121`; `R:invite/[token]/+page.server.ts:151`.
- Also updated in place by `deletion.ts:92` (`hashPriorVersions`, hashes email/name), contradicting "never mutated" in the schema comment `userVersion.ts:4-6` (the erase path rewrites email and name).
- Readers: `history.ts:36` (`getUserHistory`, no non-test caller); `deletion.ts:84` (`hashPriorVersions`).

### `handle_tombstone`
Writers: `S:user-store/deletion.ts:43` (`releaseHandle`, on account deletion, 1 year TTL `:24`); `S:user-store/profile.ts:105` (on rename, `TOMBSTONE_TTL_MS` defined again at `profile.ts:34`). Readers: `profile.ts:28` (`isHandleAvailable`) and `:85` (7-day change cooldown, `HANDLE_COOLDOWN_MS`). `isHandleAvailable` is also used by `handle.ts:37` (handle generation).

### `event-log`
`S:event-log/append.ts` (`buildAppendEventSql`: used only by `db/capability-events.ts:37`; `appendEventSync`, `appendEventAsync`: no non-test caller). The comment says the contract is shared "across all four event tables" and that it serves "a single-threaded sim DO" (`append.ts:6-14,47`); in non-test code only `capability_event` uses it (V: grep `buildAppendEventSql|appendEvent(Sync|Async)`; the sim DO store `S:sim-object/store.ts` does not import it, V by grep absence). `S:event-log/fold.ts`: `foldRevokeWins` used by `operator/capabilities.ts:135` and `sims/sim-roles.ts:47`; `foldEventLog`, `foldLatest` unused outside the file.

---

## 11. Account deletion: steps in order

Route: `DELETE /api/account` (`R:api/account/+server.ts:24-52`):
1. `:25-26` `refuseUnlessSameOriginJson` (415/403).
2. `:28` 401 if `!locals.user`.
3. `:29-33` body `{confirmHandle}` must equal `locals.user.handle` else 400 `{deleteError}`.
4. `:35-42` `deleteAccount({ db, env, identityId: locals.user.id, actor: {actorId, 'human'}, defer: platform.ctx.waitUntil })`.
5. `:44` if `more`: 202 `{more:true}`; account and session stay.
6. `:46-50` otherwise best-effort `auth.api.signOut` (errors swallowed).
7. `:51` 200 `{ok:true}`.

`deleteAccount` (`S:user-store/deletion.ts:149-193`), not atomic (doc comment `:137`):
1. `:159` resolve survivor id.
2. `:161-164` no-op `{more:false}` if identity unknown/already deleted (`deletedAt`) or no live `user` row.
3. `:167` `listSimsForUser({db, userId: sid})`.
4. `:170-173` for the first `perPass` (50, `DELETE_SIMS_PER_PASS` `:130`) sims: `removeSimMember({ db, env, simId, userId: sid, notify: false })` (in `S:sims/sims.ts`, not read; the doc says it promotes a successor manager first and revokes the grant, a sim left with no members is kept).
5. `:174-188` in `finally` (also after a throw): `rosterChangedAll(env, left)`, handed to `defer` (or awaited; awaited if `defer` throws).
6. `:190` if more sims than `perPass` remain: return `{more:true}` (account untouched).
7. `:191` `closeAccountRows` (`:198-231`):
   1. `:207` `releaseHandle` -> insert `handle_tombstone` (1 year).
   2. `:208` `scrubLiveUser`: `user` row -> handle `deleted-<id>`, email `deleted-<id>@example.com`, name `Deleted User`, image null (`:55-73`).
   3. `:209-215` `recordUserVersion` with placeholder values.
   4. `:219-224` collect identity union (survivor + identities superseded by it); `hashPriorVersions` (sha256 of email and name in `user_version`, keeps handle; `:80-99`).
   5. `:227` `purgeCredentialsAndSettings` (`:102-118`): delete `session`, `account`, `passkey` rows by live user id; delete `sim_invite` rows where `invitedByUserId` or `invitedUserId` is in the union.
   6. `:230` `markIdentityDeleted` -> `user_identity.deleted_at` (last).
After deletion `resolveSessionUser` returns null for the identity (`S:user-store/user.ts:141`).

What deletion does to sims / memberships / invites: removes the person from every sim via `removeSimMember` (membership revoke events in `capability_event`); deletes all invitations they sent or received (any status, any sim); does not delete sims, sim logs, or published plans (`plan` has no owner column); does not touch `verification` rows or `capability_event` history rows. `actor` param is unused (`deletion.ts:138` comment: "nothing reads it yet"; V: `args.actor` not referenced in the function body).

Client: `DeleteAccountPane.svelte:43-65` loops `DELETE /api/account` while it answers 202, up to `DELETE_PASSES_MAX = 100` (`:14`), then `onDeleted()` -> `goto('/', { invalidateAll: true })` (`R:account/+page.svelte:45-47`).

---

## 12. `src/lib/account` UI

Account page `R:account/+page.svelte` composes:
- Heading, `FormStatus` (shows `AUTH_COPY.linkFailed` when `?link=failed`), Sign out form if `data.canSignOut` (`:62-67`).
- Profile section: `ProfilePane` (`:70-73`).
- Sign-in section: `AuthenticationPane`, shown when `!user.pseudonymous || data.methods.length > 0` (`:19,75-90`).
- Delete section: `DeleteAccountPane` (`:92-95`).

| Component | Shows | Network calls |
|---|---|---|
| `ProfilePane.svelte` (92) | handle input (with `@`), display name input (max 60), Save; success/error status | `PATCH /api/account/profile` (`:26`); writes `currentUser.apply` (`:39`) |
| `AuthenticationPane.svelte` (346) | Email (add for pseudonymous, confirm if unconfirmed, change for registered), Passkeys (list/add/remove), Google connect, embeds `PasswordSection`; each only when its method is in `methods` | `POST /api/account/email/verify` (`:65`), `PATCH /api/account/email` (`:110`), `authClient.passkey.listUserPasskeys/addPasskey/deletePasskey` (`:140,160,172`), `authClient.linkSocial` google (`:182`) |
| `PasswordSection.svelte` (313) | set/change/remove password, current-password field, "no recovery without email" and last-factor warnings | `POST`/`DELETE /api/account/password` (`:120,159`) |
| `DeleteAccountPane.svelte` (114) | description `ACCOUNT_COPY.deleteDescription` ("Deletes your account. You leave every sim; their links still open. This cannot be undone." `account-copy.ts:67-68`), confirm-by-handle form, error text | `DELETE /api/account` loop (`:44`) |
| `FormStatus.svelte`, `FieldError.svelte` | generic live status / field error; reused by `L:members/*`, `R:sims/*`, `R:invite/[token]`, `R:signin` | none |
| `current-user.svelte.ts` | overlay of handle/name keyed by identity id; read by `R:+layout.svelte:4` and the account page | none |
| `auth-client.ts` | Better-Auth browser client with anonymous, magic-link, passkey plugins | to `/api/auth/*` |
| `copy.ts`, `account-copy.ts`, `ui.ts`, `safe-redirect.ts` | strings, class names, redirect sanitizer | none |

What the account UI shows about sims/memberships/invites: no list of sims, memberships, roles or invitations anywhere under `L:account/` or `R:account/`. The only sim mentions are the delete description string (`account-copy.ts:68`), a sign-in pending-sim line `pendingSimLine` (`copy.ts:56`, used on `/signin`, `R:signin/+page.svelte:120-121`), and an unconfirmed-email comment about "cold join from an emailed invite" (`AuthenticationPane.svelte:59`; the unconfirmed state itself is identity-only logic: `!user.pseudonymous && user.emailVerified === false`).
The `/signin` page and `/invite/[token]` page (outside `L:account/`) do carry sim/invite flows: `R:signin/+page.server.ts:212-257` (`startFresh` creates a sim), `R:invite/[token]/+page.server.ts` (accept/join).

---

## Doc/code contradictions

1. `docs/dev/auth.md:8` "Three tables, all in D1" (`user_identity`, `user`, `user_version`) for the identity model. Code has nine identity-related tables (`principal`, `handle_tombstone`, `session`, `account`, `verification`, `passkey` in addition) and `capability_event` keyed to `principal`. (`S:db/schema/index.ts:1-9`.)
2. `docs/dev/auth.md:15` "Schema files ... import with relative paths, never `$lib/...`". `S:db/schema/simControlPlane.ts:2` has `import type { CommitKind, Restores } from '$lib/sim-log'` (type-only, erased at compile time, so drizzle-kit may not choke on it, but the stated rule is not literally true).
3. `docs/dev/auth.md:72` "Every state-changing JSON route therefore calls `refuseUnlessSameOriginJson`". `POST /api/plans` and `POST /api/policies` are state-changing JSON routes that do not call it (`S:sharing/publish.ts:45-80` content-type check only); `/api/e2e/login` and `/api/e2e/plans` likewise (e2e-gated); `/api/auth/*` uses Better-Auth origin check instead.
4. `S:db/schema/userVersion.ts:4-6` says rows are "NEVER repointed or mutated"; `S:user-store/deletion.ts:92-96` updates `email` and `name` in place (erasure). (The history-trail claim on `history.ts:6` that `recordUserVersion` is the "ONLY writer" is true for inserts only.)
5. `S:event-log/append.ts:11,47` describe the append contract as shared by "all four event tables" and the single-threaded sim DO; in non-test code only `capability_event` calls it, and `appendEventSync`/`appendEventAsync` have no callers.
6. `docs/dev/auth.md:89` "The pure matcher `authorize()` ... sits behind one request seam, `requireCap(event, ability, resource)`" and line 92 operator capabilities: `requireCap` is called only from `requireSimRole` (with `sim` resources); the `app`-resource branch (`require-cap.ts:25`) and `requireOperator`/`requireCapability` have no non-test callers, so `locals.capabilities` (computed per session request at `hooks.server.ts:58`) is not consumed by any route. Not a literal contradiction of the doc; a gap between described design and used paths.
7. `S:user-store/deletion.ts:138` comment: `actor` "is kept for the future sim-log attribution; nothing reads it yet". Consistent with code (unused); listed because `authz/actor.ts` types (`ACTOR_KINDS` including `'ai'`, `'automation'`) have no producer beyond `'human'`/`'public'`.

No contradiction found for: session gate prefixes (`auth.md:64-66` vs `session-gate.ts:27-39`), mint call sites and `PSEUDO_MINT_RL` (`auth.md:19`), rate-limit binding list and namespaces (`auth.md:76` vs `wrangler.jsonc`), deletion steps (`auth.md:30-38` vs `deletion.ts`), e2e seams (`auth.md:180-189`).

---

## Appendix

### Files read in full
`src/hooks.server.ts`; `src/hooks.client.ts`; `src/app.d.ts`; `src/routes/+layout.server.ts`; `src/lib/server/authz/{index,actor,ability,authorize,resource,require-cap,require-sim-role,sim-caps}.ts`; `src/lib/server/db/schema/{index,users,auth,principal,userVersion,handleTombstone,capabilityEvent,simInvite,simControlPlane,plan}.ts`; `src/lib/server/db/{index,columns,capability-events}.ts`; `src/lib/server/auth/{session-gate,methods,magic-link,brand,password-reset-gate,password-policy,google-provider,require-method,password-breach,better-auth}.ts`; `src/lib/server/onboarding/{pending-identifier,known-device,pending-sim,pseudonymous-mint}.ts`; `src/lib/server/security/{rate-limit,same-origin-json}.ts`; `src/lib/server/user-store/{user,identity,history,deletion,profile,handle,passkey,oauth,auth-factors,password-credential,confusable-skeleton}.ts`; `src/lib/server/event-log/{append,fold}.ts`; `src/lib/server/ids/{base58,factory}.ts`; `src/lib/ids/base58.ts`; `src/lib/server/config/dataset-version.ts`; `src/lib/server/e2e/{env,mail-sink,session}.ts`; `src/lib/server/email/{send,provider,validate}.ts`; `src/lib/server/email-templates/{invite,render,copy,sign-in,confirm-email,reset-password,change-approve}.ts`, `InviteEmail.svelte`; `src/routes/{signin,forgot-password,reset-password,account}/+page.server.ts`; `src/routes/account/+page.svelte`; `src/routes/api/account/{+server,profile/+server,email/+server,email/verify/+server,password/+server}.ts`; `src/routes/api/auth/[...all]/+server.ts`; `src/routes/api/e2e/{plans,mail,login}/+server.ts`; `src/lib/account/{current-user.svelte,safe-redirect,ui,auth-client,account-copy,copy}.ts`, `FormStatus.svelte`, `FieldError.svelte`, `DeleteAccountPane.svelte`, `ProfilePane.svelte`. Outside scope but read in full for section 7/8: `src/routes/{about,attribution,p/[id],s/[id]}/+page.server.ts`; `src/routes/sims/+layout.server.ts`, `sims/+page.server.ts`, `sims/[simId]/{+layout,+page}.server.ts`; `src/routes/invite/[token]/+page.server.ts`; `src/routes/api/sims/+server.ts`; `src/lib/server/sims/start-sim.ts`; `src/lib/server/operator/registry.ts` (head).

### Files read in part (line ranges)
`src/lib/account/AuthenticationPane.svelte` 1-60 plus grep for `fetch(`/`authClient.`/headings; `src/lib/account/PasswordSection.svelte` 1-30 plus grep; `src/lib/server/user-store/handle-normalize.ts` 1-10, 60-70 plus grep of exports and the reserved list lines 15-17; `src/lib/server/operator/capabilities.ts` 1-160 (whole file effectively); `src/lib/server/operator/grants.ts` 1-40; `src/lib/server/sim-object/access.ts` 1-60; `src/lib/server/sims/sim-index.ts` 25-45; `src/lib/server/sharing/publish.ts` 40-90 plus grep; `src/routes/api/sims/[simId]/stream/+server.ts` 15-49; `src/routes/api/operator/sims/[simId]/takedown/+server.ts` 15-46; `wrangler.jsonc` 20-100; `docs/dev/auth.md` lines 5-40, 62-95 plus grep of the rest; for `src/routes/api/invites/*`, `api/plans*`, `api/policies*`, `api/sims/[simId]/invites*`, `api/sims/[simId]/members/*`, `data/[version]/[...path]`: grep for export/session/rate/origin lines only (not read in full). `src/lib/server/test/*`: exports by grep only.

### Dirs listed
`src/lib/server/{auth,authz,user-store,onboarding,email,email-templates,security,config,ids,event-log,db,e2e,test}` (with line counts via `wc -l`); `src/lib/account`; `src/lib/ids`; `src/routes/{signin,forgot-password,reset-password,account}`; `src/routes/api/{account,auth,e2e}`; `src/routes` (file inventory by `find`); `src/lib/server/{operator,sims,invites}` (ls only); `migrations/d1` (ls only); `.superpowers/superconductor/incremental-game`.

### NOT examined
- Bodies of: `src/lib/server/email-templates/Layout.svelte`, `LinkActionEmail.svelte`; `user-store/confusables-data.ts`, `confusables.meta.ts`; `handle-normalize.ts` lines 10-59 and 70-97; `src/lib/server/test/*` bodies; `src/routes/{signin,forgot-password,reset-password}/+page.svelte` (grep only), `src/routes/account/page.svelte.spec.ts` etc.
- All `*.spec.ts` / `*.test.ts` files in scope (only used for importer counts; section 3 excludes them).
- `src/lib/account/AuthenticationPane.svelte` lines 60-346 and `PasswordSection.svelte` lines 30-313 (so exact conditional rendering is `I`, from grep and props).
- Outside scope, not opened: `S:sims/sims.ts` (`removeSimMember`, `createSim`, `leaveSim`), `S:sims/sim-roles.ts` bodies, `S:sims/roster-hook.ts`, `S:invites/*`, `S:sim-object/*`, `src/lib/members/copy`, migrations SQL (so the live D1 schema/indexes were not compared to the drizzle files), the Better-Auth library internals (what the adapter writes to `session`/`verification`/`account` is `I`).
- Whether any account reaper exists anywhere (doc says none; not searched beyond S1).
- `src/routes/fzp/+page.ts`, `src/routes/+page.ts`, `src/routes/sim/+page.ts`, `src/routes/lesscars/+page.ts` (listed as having no server file; contents not read).
