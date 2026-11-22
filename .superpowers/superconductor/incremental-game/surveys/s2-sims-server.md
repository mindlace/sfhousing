# S2 survey: server side of sims

Repo: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game` (branch `worktree-incremental-game`). Read-only census. `V` = verified at the cited `path:line`; `I` = inferred (source named). All paths are relative to the repo root unless noted. Line counts are `wc -l` (a file with no trailing newline counts one fewer).

---------------------------------------------------------------------------------------------------

## 0. One-paragraph model (all V unless marked)

A "sim" is one append-only commit log, stored in a per-sim Durable Object (`SimObject`, SQLite, name = sim id). D1 keeps (a) a rebuildable copy of the log's envelopes + tip (`sim_index`, `sim_commit`), (b) membership as role-bundle grants in the shared `capability_event` ledger, (c) invitations (`sim_invite`), (d) takedown marks (`sim_takedown`). A browser writes by websocket through `/api/sims/[simId]/stream`; the Worker route decides `write` from a D1 role read and hands the object an "open header". Membership (manager/editor/viewer), invitations, roster re-reads, fan-out to other sockets, and the roster hook all exist for more-than-one-person sims. Registration (`POST /api/sims`) makes the caller the first manager and mints a pseudonymous account for a signed-out caller.

---------------------------------------------------------------------------------------------------

## 1. Modules per directory: exported symbols, line counts, importers OUTSIDE the directory

Importers are non-test (`*.spec.ts` excluded) and come from `grep -rnE "lib/server/<dir>/"` over `src e2e scripts` plus relative-import greps (V: grep output; the symbols per importer are from the import lines or call sites I opened). "none" = no non-test importer found by that grep.

### 1.1 `src/lib/server/invites/` (non-test: 4 files + 1 error-code)

| Module | Lines | Exports (kind) | Importers outside dir |
|---|---|---|---|
| `control-plane.ts` | 503 | `INVITE_TTL_MS` const (:21); `INVITE_PENDING_CAP` const (:24); `InviteTarget` type (:26); `EMAIL_RE` const (:28); `parseInviteTarget` fn (:31); `CreatedInvite` type (:37); `ManagerPendingInvite` type (:42); `createInvite` fn (:107); `InviterRoleLostError` class (:164); `toManagerPendingInviteView` fn (:207); `listManagerPendingInvites` fn (:223); `getManagerPendingInvite` fn (:250); `claimInvite` fn (:276); `acceptInviteByToken` fn (:329); `acceptInviteById` fn (:341); `declineInvite` fn (:359); `revokeInvite` fn (:375); `RESEND_COOLDOWN_MS` const (:386); `ResendResult` type (:388); `resendInvite` fn (:390); `RecipientInvite` type (:426); `listRecipientPendingInvites` fn (:433); `TokenInvite` type (:469); `findInviteByToken` fn (:479) | `src/routes/api/sims/[simId]/invites/+server.ts:9-14` (createInvite, parseInviteTarget, getManagerPendingInvite, InviterRoleLostError); `.../invites/[inviteId]/+server.ts:4` (revokeInvite); `.../resend/+server.ts:7` (resendInvite); `src/routes/api/invites/[inviteId]/accept/+server.ts:6` (acceptInviteById); `.../decline/+server.ts:5` (declineInvite); `src/routes/invite/[token]/+page.server.ts:8` (findInviteByToken, acceptInviteByToken); `src/routes/sims/+layout.server.ts:3` (listRecipientPendingInvites); `src/routes/sims/[simId]/+layout.server.ts:5` (listManagerPendingInvites) |
| `email.ts` | 25 | `sendInviteEmail` fn (:7) | `api/sims/[simId]/invites/+server.ts:16`; `.../resend/+server.ts:9` |
| `claim.ts` | 53 | `ColdDecision` type (:8); `classifyColdAccept` fn (:39) | `src/routes/invite/[token]/+page.server.ts:10` |
| `error-code.ts` | 29 | `memberErrorCode` fn (:26) | `api/invites/.../accept:4`; `api/sims/[simId]/invites:7`; `.../resend:13`; `api/sims/[simId]/members/[userId]:7`; `routes/invite/[token]/+page.server.ts:19`; `routes/sims/[simId]/+page.server.ts:7` |
| `token.ts` | 15 | `generateInviteToken` fn (:4); `hashToken` fn (:13) | none (only `control-plane.ts:14`, same dir) |

Specs: `control-plane.spec.ts` (1056), `claim.spec.ts` (169), `email.spec.ts` (85), `error-code.spec.ts` (63), `token.spec.ts` (20).

### 1.2 `src/lib/server/sims/`

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `sim-roles.ts` | 315 | `SimMemberFold` type (:101); `foldSimRole` (:75); `foldSimMembers` (:104); `SimRoleListItem` type (:147); `foldSimsForUser` (:150); `foldManagedSimCount` (:189); `setSimRole` (:260); `addSimRole` (:279); `buildFirstManagerGrantSql` (:298); `revokeSimRoles` (:306) | `src/lib/server/sim-object/sim-object.ts:12` (foldSimRole); `src/lib/server/user-store/identity.ts:9` (foldSimsForUser, used :147); `src/lib/server/test/auth-db.ts:9` (test helper) |
| `sim-index.ts` | 318 | `insertSimIndexIfFree` (:46); `buildInsertSimIndexIfFreeSql` (:56); `simIdInUse` (:68); `getSimTitle` (:74); `updateSimIndexTitle` (:84); `countSimsManagedBy` (:100); `SimListItem` type (:104); `listSimsForUser` (:111); `getRole` (:122); `ControlPlaneMember` type (:130); `listMembers` (:143); `addMember` (:172); `addMemberById` (:191); `reconcileSimManagement` (:217); `removeMembership` (:250); `prepareLeave` (:290) | `src/lib/server/authz/require-cap.ts:3` (getRole); `authz/require-sim-role.ts:2` (getRole); `user-store/deletion.ts:18` (listSimsForUser, used :167); `routes/api/sims/[simId]/stream/+server.ts:10` (getRole, getSimTitle); `routes/sims/+page.server.ts:7` (listSimsForUser); `routes/sims/[simId]/+layout.server.ts:6` (getSimTitle, listMembers); `routes/sims/[simId]/+page.server.ts:5` (getSimTitle) |
| `sims.ts` | 152 | `createSim` (:25 region); `deleteSim` (:72); `removeSimMember` (:103); `leaveSim` (:135) | `user-store/deletion.ts:19` (removeSimMember, :171); `routes/api/operator/sims/[simId]/takedown/+server.ts:9` (deleteSim); `routes/signin/+page.server.ts:20` (createSim, :238); `routes/sims/+page.server.ts:9` (createSim); `routes/sims/[simId]/+page.server.ts:6` (leaveSim) |
| `start-sim.ts` | 161 | `StartSimFailure` type (:18); `checkSimTitle` (:21); `simStartAllowed` (:31); `startSim` (:65) | `routes/api/sims/+server.ts:8` (startSim); `routes/signin/+page.server.ts:21` (checkSimTitle); `routes/sims/+page.server.ts:10` (checkSimTitle, simStartAllowed, startSim); `routes/sims/[simId]/+page.server.ts:13` (checkSimTitle) |
| `roster-hook.ts` | 62 | `REREAD_ATTEMPTS`=2 (:6); `ROSTER_FANOUT`=6 (:8); `REREAD_TIMEOUT_MS`=5000 (:10); `onSimRosterChanged` (:35); `rosterChangedAll` (:56) | `user-store/deletion.ts:20`; `user-store/identity.ts:7`; `routes/api/invites/[inviteId]/accept/+server.ts:8`; `routes/invite/[token]/+page.server.ts:9` |
| `live-sim.ts` | 13 | `liveSimStub` (:10) | `routes/api/operator/.../takedown/+server.ts:8`; `routes/sims/[simId]/+page.server.ts:10` |
| `rename.ts` | 77 | `RenameCode` type (:10); `AppendAsStub` type (:13); `renameDraft` (:19); `renameSim` (:42) | `routes/sims/[simId]/+page.server.ts:11` |
| `stamp.ts` | 22 | `serverStamp` (:10) | `routes/api/sims/[simId]/stream/+server.ts:11`; `routes/sims/[simId]/+page.server.ts:12` |
| `sim-quota.ts` | 14 | re-exports `MAX_SIMS_PER_MANAGER`, `SIM_TITLE_MAX` (:5); `simQuotaExceeded` (:11) | `routes/sims/+page.server.ts:8` |

Specs: `sim-roles.spec.ts` 528, `sim-index.spec.ts` 599, `sims.spec.ts` 755, `start-sim.spec.ts` 447, `roster-hook.spec.ts` 217, `rename.spec.ts` 165, `sim-quota.spec.ts` 32.

Exports with NO non-test caller found (V: grep of names over `src`, spec files excluded): `addMember` (sim-index.ts:172), `updateSimIndexTitle` (:84), `insertSimIndexIfFree` (:46, only its `build...` sibling is used by `createSim`). Only same-directory callers: `setSimRole` (sim-index.ts:227,275,315), `addMemberById` (control-plane.ts:315), `reconcileSimManagement` (control-plane.ts:317; sim-index.ts:277), `revokeSimRoles` (sim-index.ts:276).

### 1.3 `src/lib/server/sim-object/`

Non-test modules (specs: `log-host.spec.ts` 1378, `object-rules.spec.ts` 321, `index-runner.spec.ts` 210, `index-sync.spec.ts` 134, `access.spec.ts` 109, `decide.spec.ts` 108, `store.spec.ts` 101, `open-params.spec.ts` 85, `resume-budget.spec.ts` 84, `limits.spec.ts` 73, `migrations.spec.ts` 68).

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `sim-object.ts` | 362 | `SimObject` class (:45), extends `DurableObject<Env>` | `scripts/worker-entry.ts:16` (string in emitted entry); wrangler binding `SIM` / `class_name: SimObject` (`wrangler.jsonc:9`) |
| `log-host.ts` | 431 | `Author`, `AppendOutcome`, `StartParams`, `StartDraft`, `ServerAppend` types (:25-60); `RESUME_ROW_EXTRA` (:67); `ResumeAnswer`, `ResumeBounds`, `LogHostOptions` types; `LogHost` class (:94) | `sims/rename.ts:3` (type `ServerAppend`) |
| `object-rules.ts` | 264 | `ServerAppendResult` type (:19); `serverAppendResult` (:22); `APPEND_FAILED` (:29); `helloFrame` (:32); `OpenInput`; `openStatus` (:54); `MessageRead`; `readMessage` (:72); `closeReply` (:90); `roleChanges` (:100); `LOG_MAX`, `NON_ERROR`, `QUERY_FAILED`; `loggable` (:126); `withResumed` (:146); `ResumeSocket`; `resumeKey` (:165); `answerResume` (:181); `receivesLive` (:219); `ROLE_READ_FAILED` (:224); `rereadChanges` (:233); `distinctIdentities` (:257) | `loggable`: `sims/roster-hook.ts`, `sims/sims.ts`, `sims/start-sim.ts`, `invites/control-plane.ts`, `user-store/deletion.ts`, `user-store/identity.ts`, and 8 route files (accept, invites POST, resend, members DELETE, takedown, invite page, sims page, sims/[simId] page, signin); `ServerAppendResult`: `sims/rename.ts:4`, `routes/sims/[simId]/+page.server.ts:9` |
| `access.ts` | 75 | `SocketAttachment` interface (:12); `newSocketId` (:22); `parseAttachment` (:31); `canWrite` (:56); `accessChanges` (:65) | `sims/start-sim.ts:11` (canWrite); `routes/api/sims/[simId]/stream/+server.ts:6` (canWrite) |
| `open-params.ts` | 67 | `OPEN_HEADER` (:6); `IDENTITY_MAX`=64 (:8); `OpenParams` (:12); `encodeOpenParams` (:21); `headerTitle` (:33); `parseOpenParams` (:47) | `routes/api/sims/[simId]/stream/+server.ts:7`; `sims/rename.ts:5` (headerTitle) |
| `stub.ts` | 13 | `SimEnv` type (:7); `simStub` (:10) | `routes/api/sims/[simId]/stream/+server.ts:8`; `sims/live-sim.ts:3`; `user-store/deletion.ts:21` (type); `user-store/identity.ts:8` (type); `src/lib/server/test/sim-env.ts:1` |
| `decide.ts` | 52 | `AppendGate`, `AppendDecision` types; `decideAppend` (:27) | none (log-host.ts only) |
| `limits.ts` | 52 | re-exports `LIMITS`, `STAMP_MAX`, `fitsCommit`, `overFrameLimit`, `utf8Bytes`, `Limits` from `$lib/sim-stream/limits`; `INDEX_BATCH`=50 (:12); `INDEX_RETRY_MS`=30000 (:13); `BudgetSize`; `WRITER_RESUME_BUDGET` (:22); `READER_RESUME_BUDGET` (:25); `RateBucket` class (:27) | none (note `src/lib/sim-stream/limits.ts:2` only mentions the path in a comment) |
| `resume-budget.ts` | 61 | `paysAsWriter` (:22); `ResumeBudgets` class (:31) | none (sim-object.ts only) |
| `index-runner.ts` | 105 | `IndexSource`; `IndexRunnerOptions`; `IndexRunner` class (:22); `takeDownInOrder` (:96) | none |
| `index-sync.ts` | 67 | `IndexedCommit`, `IndexSummary` types; `envelopeRow` (:22); `syncSimIndex` (:43) | none |
| `store.ts` | 134 | `SimDb` type (:8); `StoredRow`, `Totals`; `SimStore` class (:28) | none |
| `schema.ts` | 19 | `commits` table (:7); `simState` table (:15) | none outside (drizzle config `drizzle.sim.config.ts:9`, `drizzle-cf.config.ts` `schemas.sim`) |
| `migrations.generated.ts` | 7 | `simMigrations` const (:4) | none outside (sim-object.ts:26) |
| `test/drafts.ts` (48), `test/harness.ts` (30) | | test helpers | `e2e/helpers/sim-socket.ts:82` mentions `sim-object/test` (not opened) |

### 1.4 `src/lib/server/operator/`

| Module | Lines | Exports | Importers outside dir |
|---|---|---|---|
| `capabilities.ts` | 149 | `isBootstrapEmail` (:33); `resolveGrantedCapabilities` (:43); `resolveCapabilities` (:61); `hasCapability` (:71); `isOperator` (:77); `requireCapability` (:87); `requireOperator` (:96); `resolveCapsFor` (:108) | `src/hooks.server.ts:7` (`resolveCapabilities`, used :58) |
| `token.ts` | 28 | `TOKEN_MIN`=32 (:2); `bearerMatches` (:12) | `routes/api/operator/sims/[simId]/takedown/+server.ts:5` |
| `grants.ts` | 49 | `grantCapability` (:31); `revokeCapability` (:43) | none found |
| `registry.ts` | 8 | `OPERATOR_ABILITIES` = `['cap.grant','cap.revoke']` (:6); `OperatorAbility` type | none (capabilities.ts, grants.ts only) |

Exports with no non-test caller found: `grantCapability`, `revokeCapability`, `requireCapability`, `requireOperator` (V: grep over `src`; only their own definitions and `isOperator` inside `requireOperator`). `capability_event` operator rows (`resourceType: 'app'`) are written only by `grants.ts:19-27`, which has no caller; the only live operator mechanism is the `BOOTSTRAP_EMAILS` wildcard (`capabilities.ts:66`).

Specs: `capabilities.spec.ts` 388, `grants.spec.ts` 138, `token.spec.ts` 42.

### 1.5 Schema files in scope

- `src/lib/server/db/schema/simControlPlane.ts` (51 lines): `SimMemberRole` type (:4); tables `simIndex` (:11), `simTakedown` (:24), `simCommit` (:30); type `SimCommitRow` (:51).
- `src/lib/server/db/schema/simInvite.ts` (39 lines): `InviteStatus` type (:5); table `simInvite` (:14); type `SimInvite` (:39).
- Re-exported via `src/lib/server/db/schema/index.ts:5-6`.
- Sim tables inside `sim-object`: `commits`, `sim_state` in `schema.ts` (see section 4.4).

---------------------------------------------------------------------------------------------------

## 2. The role model

### 2.1 Definitions (verbatim)

`src/lib/server/db/schema/simControlPlane.ts:4`
```ts
export type SimMemberRole = 'manager' | 'editor' | 'viewer';
```
`src/lib/server/authz/ability.ts:8-13` (outside scope; the bundle map the role model hangs on)
```ts
export const ROLE_BUNDLE = {
  manager: 'role.manager',
  editor: 'role.editor',
  viewer: 'role.viewer'
} as const;
export type RoleBundle = (typeof ROLE_BUNDLE)[keyof typeof ROLE_BUNDLE];
```
`ability.ts:18-20`
```ts
const VIEWER_ABILITIES = ['sim.read'] as const;
const EDITOR_ABILITIES = [...VIEWER_ABILITIES, 'sim.write'] as const;
const MANAGER_ABILITIES = [...EDITOR_ABILITIES, 'member.manage', 'invite.manage'] as const;
```
(V) The fine abilities `member.manage`, `invite.manage`, `sim.read` are not checked by name anywhere in S2 code; checks go by bundle (`requireSimRole` passes `ROLE_BUNDLE[minRole]`, `require-sim-role.ts:30`). Only `sim.write` is named: `access.ts:58`.

Storage of a role: not a column. A membership is a grant event in the shared `capability_event` ledger (`resourceType 'sim'`, `resourceId` = sim id, `ability` = the bundle string, `action` grant|revoke), written by `roleEvent` (`sim-roles.ts:237-255`). Effective role = latest action per bundle (revoke wins on equal timestamp, `sim-roles.ts:46-55`), highest remaining bundle wins (`higher`, `:23`, rank `:21`). Folds join `sim_index` so a grant only counts once the sim row exists (`sim-roles.ts:88,113,164`).

`sim_invite.role` (`simInvite.ts:19`) is typed `SimMemberRole`, but `createInvite` always writes `'editor'` (`control-plane.ts:141`). So the invite flow can only add editors (V).

`capability_event` table (migration `20261114112404_bizarre_oracle/migration.sql:119-132`): `id, principal_id, resource_type, resource_id, ability, action, caveats, parent_id, actor_id, created_at, created_at_counter`, FK `principal_id -> principal(id) ON DELETE CASCADE`.

### 2.2 Every site that checks a role or membership (S2 scope plus the seam they call)

| Site | Check | Gates |
|---|---|---|
| `src/lib/server/authz/require-sim-role.ts:19-38` | `getRole` -> `simCaps` -> `requireCap(..., ROLE_BUNDLE[minRole], {type:'sim'})`; 401 no user, 404 non-member, 403 below min (`require-cap.ts:58-61`) | the seam all routes below call |
| `src/lib/server/authz/require-cap.ts:24-31` | `resolveResourceCaps` for `sim` = `getRole` membership only | same seam, non-`requireSimRole` callers |
| `src/routes/api/sims/[simId]/invites/+server.ts:30` | `requireSimRole(.., 'manager')` | create invite |
| `src/routes/api/sims/[simId]/invites/[inviteId]/+server.ts:11` | manager | revoke invite |
| `src/routes/api/sims/[simId]/invites/[inviteId]/resend/+server.ts:21` | manager | resend invite |
| `src/routes/api/sims/[simId]/members/[userId]/+server.ts:14` | manager | remove a member |
| `src/routes/sims/[simId]/+layout.server.ts:16` | viewer (any member) | every `/sims/[simId]` page |
| `src/routes/sims/[simId]/+layout.server.ts:21` | `role === 'manager'` | whether pending invites are loaded |
| `src/routes/sims/[simId]/+layout.server.ts:30-32` | `user.emailVerified && isDeliverable(email)` | `canInviteByEmail` flag |
| `src/routes/sims/[simId]/+page.server.ts:17` | viewer | page load |
| `src/routes/sims/[simId]/+page.server.ts:25` | viewer | `leaveSim` action |
| `src/routes/sims/[simId]/+page.server.ts:62` | editor | `rename` action |
| `src/routes/sims/[simId]/+page.svelte:19,152` | `role === 'manager' \|\| 'editor'` -> rename box; `role === 'manager'` -> `isManager` | UI only (client) |
| `src/routes/api/sims/[simId]/stream/+server.ts:36` | `canWrite(await getRole(...))`, only if signed in | `write` flag in the open header; no role is needed to read |
| `src/lib/server/sim-object/access.ts:56-59` | `canWrite(role)`: bundle dominates `sim.write` (manager, editor) | used by stream route, `start-sim.ts:49`, `sim-object.ts:236` |
| `src/lib/server/sim-object/sim-object.ts:229-248` (`rereadRoles`) | `foldSimRole` per distinct socket identity, `canWrite` | whether each open socket may write |
| `src/lib/server/sims/start-sim.ts:49` | `canWrite(getRole)` | registering an already-used id: 200 `created:false` for a writer, else 409 `taken` |
| `src/lib/server/sims/sim-roles.ts:189-191` / `sim-quota.ts:11-13` | count of sims where role is `manager` vs `MAX_SIMS_PER_MANAGER` (1000, `src/lib/members/copy.ts:2`) | per-person sim cap (quota 403) |
| `src/lib/server/sims/sim-index.ts:224,229` | any `manager` among members | `reconcileSimManagement`: promote successor if none |
| `src/lib/server/sims/sim-index.ts:260-268` | removing a DIFFERENT principal who is `manager` throws `'cannot remove another manager; ...'` when `actorUserId` passed | co-manager protection |
| `src/lib/server/sims/sim-index.ts:273-275` | sole manager leaving with others remaining -> promote `pickSuccessor` first | orphan guard |
| `src/lib/server/sims/sim-index.ts:302-317` (`prepareLeave`) | not a member -> `'not a member'`; manager with other managers and wrong `confirmTitle` -> `'title did not match'`; sole manager with `successorUserId` -> promote | leave guards |
| `src/lib/server/invites/control-plane.ts:86-89` | `foldSimRole` non-null -> `'already a member'` | create invite |
| `src/lib/server/invites/control-plane.ts:157,179-201` (`recheckInviter`) | inviter must still be `manager` after the insert, else row deleted and `InviterRoleLostError` | create invite race guard |
| `src/lib/server/invites/control-plane.ts:311-312` | `foldSimMembers` empty -> `'invite not pending'` | accept: a sim with no members cannot be joined |
| `src/lib/server/invites/control-plane.ts:352-356` | `invitedUserId === userId` or verified email matches | accept by id (`'invite not addressed to you'`) |
| `src/lib/server/invites/control-plane.ts:366-368` | `invitedUserId` set and != caller | decline |
| `src/routes/api/sims/[simId]/invites/+server.ts:55` | `inviter.emailVerified` | email targets (else `'email invites require a verified account'`, control-plane.ts:128) |
| `src/lib/members/MembersPanel.svelte:141,145,159,191`, `LeaveSimConfirm.svelte:44-47` | role comparisons | client UI (not examined beyond grep) |
| operator: none | `SIM_TAKEDOWN_TOKEN` bearer is the only credential; sim roles are not consulted (`takedown/+server.ts:29-32`) | takedown |

### 2.3 Where roles change (V)

- First manager: `createSim` batch, `buildFirstManagerGrantSql` (`sims.ts:41`, `sim-roles.ts:298`).
- Editor added: `finalizeAccept` -> `addMemberById` -> `addSimRole(..., role from invite, actor null)` (`control-plane.ts:315`, `sim-index.ts:191`, `sim-roles.ts:279`).
- Manager promoted automatically: `reconcileSimManagement` (`sim-index.ts:217-235`), `removeMembership` (`:274-275`), `prepareLeave` (`:315`) via `setSimRole` (`sim-roles.ts:260`).
- Removed: `revokeSimRoles` (`sim-roles.ts:306`) from `removeMembership` (`sim-index.ts:276`).
- There is NO route or function that lets a manager change another member's role (no PATCH on `/members/[userId]`: that file exports only `DELETE`, `members/[userId]/+server.ts:10`). `viewer` is never granted by any code path found; it exists only as a role value (grep of `'viewer'` over S2 code: type, `ROLE_BUNDLE`, `requireSimRole(.., 'viewer')` as a minimum). (V for the route claim; I for "never granted", from the grants listed above.)

---------------------------------------------------------------------------------------------------

## 3. Routes in scope

Session notes (V): `routeNeedsSession` makes `/sims`, `/api/sims`, `/invite`, `/api/invites` resolve a session even without a cookie (`src/lib/server/auth/session-gate.ts:27-44`); `/api/operator` is NOT in the list (`:27-39`), so it never resolves a session unless a cookie is present. Same-origin JSON check = `refuseUnlessSameOriginJson` (`src/lib/server/security/same-origin-json.ts:10-16`): 415 unless `application/json`, 403 on foreign Origin.

| Route | Method | Session | Role | Behaviour | D1 tables / DO methods |
|---|---|---|---|---|---|
| `/api/sims` (`routes/api/sims/+server.ts:17`) | POST | none required; mints a pseudonymous account if signed out (`start-sim.ts:100`) | none | register a sim under a browser id: `{simId, title?}`; see section 6 | D1: `sim_index`, `sim_takedown`, `sim_commit`, `capability_event` (hasPast read; insert index row + manager grant), `user`/auth tables via mint; `sim_*` via quota fold; DO: none |
| `/api/sims/[simId]/stream` (`stream/+server.ts:19`) | GET (websocket upgrade) | optional (`locals.user?.id ?? null`, :35) | none to read; `canWrite` sets `write` | 426 without Upgrade; 403 foreign Origin; 404 bad id or no index row; 503 when `dev` or no `SIM` binding (:32); builds `OPEN_HEADER` and forwards via `stub.fetch` (:48) | D1 read: `sim_index` (title), `capability_event`+`sim_index` (role fold); DO: `fetch` |
| `/api/sims/[simId]/invites` (`invites/+server.ts:26`) | POST | required (`requireSimRole` 401) | manager | rate limits (INVITE_RL ip + actor), create invite, optionally email it; 201 `{id, display, invitedByEmail}`; 400 `{code}` | D1: `sim_invite` insert/select/delete, `user`, `capability_event`, `sim_index`; DO: none |
| `/api/sims/[simId]/invites/[inviteId]` (`:7`) | DELETE | required | manager | set invite status `revoked`; 204 | D1: `sim_invite` update; DO: none |
| `/api/sims/[simId]/invites/[inviteId]/resend` (`:17`) | POST | required | manager | rotate token, send mail; 200 `{emailed}`; 400 `{code}` | D1: `sim_invite` update/select, `user`, `sim_index`; DO: none |
| `/api/sims/[simId]/members/[userId]` (`:10`) | DELETE | required | manager | `removeSimMember` with `actorUserId` (co-manager protection); 204; 400 `{code}` | D1: `capability_event`, `sim_invite` (delete pending if emptied); DO: `rereadRoles` (via hook) |
| `/api/invites/[inviteId]/accept` (`:11`) | POST | required (401, :15) | none; invite must be addressed to caller | `acceptInviteById`, then roster hook; 200 `{simId}`; 400 `{code}` | D1: `sim_invite`, `capability_event`, `user`; DO: `rereadRoles` |
| `/api/invites/[inviteId]/decline` (`:8`) | POST | required (401, :11) | none | status `declined`; 204 | D1: `sim_invite` update; DO: none |
| `/api/operator/sims/[simId]/takedown` (`:26`) | POST | none (bearer token only) | none | section 9 | D1: `sim_takedown`, `sim_index`, `sim_commit`, `sim_invite`; DO: `takeDown` |
| `/invite/[token]` load (`+page.server.ts:22`) | GET | optional | none | returns invite summary or null | D1: `sim_invite`, `sim_index`, `user` |
| `/invite/[token]` `accept` action (`:42`) | POST form | required (redirect `/` if not, :43) | none | `acceptInviteByToken` + hook, redirect `/sims/<id>` | D1 as accept; DO: `rereadRoles` |
| `/invite/[token]` `join` action (`:63`) | POST form | signed out expected | none | cold accept: mint account / magic link / sign-in redirect (section 7) | D1: `user`, `user_version`, `sim_invite`, `capability_event`; DO: `rereadRoles` |
| `/sims` layout load (`+layout.server.ts:6`) | GET | optional | none | `recipientInvites` | D1: `sim_invite` (scans all pending), `user`, `sim_index` |
| `/sims` load (`+page.server.ts:12`) | GET | optional; signed-out gets empty | none | resume stashed title (create + redirect), else list | D1: `capability_event`, `sim_index`, `sim_*` |
| `/sims` `create` action (`:65`) | POST form | optional (mints) | none | `startSim` with a server-minted id; redirect `/sims/<id>` | as POST /api/sims |
| `/sims/[simId]` layout load (`+layout.server.ts:14`) | GET | required | viewer | shape in section 11 | D1: `sim_index`, `capability_event`, `user`, `sim_invite` |
| `/sims/[simId]` load (`+page.server.ts:15`) | GET | required | viewer | returns `{}` | `capability_event` |
| `/sims/[simId]` `leaveSim` action (`:22`) | POST form | required (redirect `/sims` if none) | viewer | `leaveSim`; redirect `/sims` | D1: `capability_event`, `sim_invite`; DO: `rereadRoles` |
| `/sims/[simId]` `rename` action (`:60`) | POST form | required | editor | `renameSim`: DO `appendAs`; redirect back | D1 read `sim_index`; DO: `appendAs` |

Rate limits on these routes (V): `INVITE_RL` 10/60 s (`wrangler.jsonc:31`) keyed `invite_ip:<ip>` (`invites/+server.ts:37`), `invite:<actorId>` (:42), `invite_email:<recipient>` (:71, silently skips the mail when over); `MUTATION_REGISTERED_RL` 120/60 s (`wrangler.jsonc:36`) keyed `invite_resend:<actorId>` (resend :23) and `sim_start:<identityId>` (`start-sim.ts:32`); `PSEUDO_MINT_RL` 5/60 s keyed `pseudo_mint:<ip>` (`onboarding/pseudonymous-mint.ts:22-25`). `enforceRate` returns true in `ENVIRONMENT==='development'` (`rate-limit.ts:23`).

---------------------------------------------------------------------------------------------------

## 4. `SimObject` (Durable Object)

File `src/lib/server/sim-object/sim-object.ts` (362 lines), class at :45. Binding `SIM` (`wrangler.jsonc:9,51`), DO migration `{ "tag": "v1-sim-object", "new_sqlite_classes": ["SimObject"] }` (`wrangler.jsonc:10,52`), `compatibility_date 2026-03-01` (`:3`). Named by sim id: `ns.getByName(simId)` (`stub.ts:12`).

### 4.1 Fetch / RPC surface

| Entry | Lines | What it does |
|---|---|---|
| `constructor` | :55-99 | `setWebSocketAutoResponse(PING->PONG)` (:57); in `blockConcurrencyWhile`: `safeMigrate` of `simMigrations` (:63), builds `LogHost(new SimStore(..), {onCommit: broadcast})` (:71-74), `IndexRunner` (:81-89), arms an alarm now if `host.indexBehind()` (:91-93). Failure leaves `#host` null -> object answers 503 |
| `fetch(request)` | :102-145 | websocket open. `openStatus`: 426 no Upgrade, 400 bad header/no id, 503 no host, 410 gone (`object-rules.ts:54-60`). `acceptWebSocket` (:116, hibernating API), `serializeAttachment({identity, write, resumed:false, sid})` (:118-123), sends `hello` then `access` frames (:124-125). If `write && identity !== null && host.tip()===0`, records a start commit (`ensureStarted`, :128-143) |
| `webSocketMessage` | :147-200 | reads one frame (`readMessage`), `resume` -> `answerResume` (:156-181), `append` -> `host.append(frame.commit, frame.id, bytes, {identity, write}, now)` (:183-189); `refused` frame to author on refusal (:191); on accept, `index.kick()` (:194) |
| `webSocketClose` | :202-212 | completes close handshake with `closeReply(code)` |
| `webSocketError` | :215-217 | no-op |
| `alarm()` | :220-222 | `index.kick()` (retry D1 copy) |
| RPC `rereadRoles()` | :229-248 | for every open socket with an identity, re-reads role from D1 and sends `access` frame on change; throws `Error('role read failed')` on read failure |
| RPC `appendAs(input)` | :256-275 | Worker-called commit append on a writer's behalf; returns `ServerAppendResult`; throws `Error('sim object unavailable')` / `Error('append failed')` |
| RPC `takeDown()` | :291-298 | `takeDownInOrder`: clear log + mark gone, wait for index pass, close every socket 4410; throws `Error('sim object unavailable')` without a host |

### 4.2 Socket frames (verbatim, `src/lib/sim-stream/protocol.ts`)

`:5-11` constants and close codes:
```ts
export const PROTOCOL = 1;
export const PING = 'ping';
export const PONG = 'pong';
export const CLOSE_BINARY = 1003;
export const CLOSE_MALFORMED = 1008;
export const CLOSE_INTERNAL = 1011;
export const CLOSE_GONE = 4410;
```
`:17`
```ts
export type RefusedWhy = 'behind' | 'invalid' | 'newer' | 'not-writer' | 'limit' | 'full' | 'gone';
```
`:19-23` server -> client
```ts
export type ServerFrame =
  | { type: 'hello'; build: string; protocol: number; dataset?: string }
  | { type: 'access'; write: boolean }
  | { type: 'commits'; commits: Commit[]; more?: boolean }
  | { type: 'refused'; id: string | null; why: RefusedWhy };
```
`:25-26` client -> server
```ts
export type ClientFrame =
  { type: 'resume'; after: number } | { type: 'append'; commit: CommitDraft };
```
`:29-30` as the server parses it
```ts
export type ParsedClientFrame =
  { type: 'resume'; after: number } | { type: 'append'; commit: unknown; id: string | null };
```
Open header (the Worker -> object channel), `open-params.ts:12-18`:
```ts
export interface OpenParams {
  identity: string | null;
  write: boolean;
  title: string;
  datasetVersion: string;
  build: string;
}
```
Per-socket hibernation attachment, `access.ts:12-17`:
```ts
export interface SocketAttachment {
  identity: string | null;
  write: boolean;
  resumed: boolean;
  sid?: string;
}
```
RPC result, `object-rules.ts:19-20`:
```ts
export type ServerAppendResult =
  { kind: 'accepted'; seq: number } | { kind: 'duplicate' } | { kind: 'refused'; why: RefusedWhy };
```

### 4.3 Alarms, hibernation, limits

- Alarms (V): one alarm slot used for the D1 index retry. Set `Date.now()` on construct if index is behind (`sim-object.ts:91-93`); `armRetry` sets `now + INDEX_RETRY_MS` (30 s) if none set (`:84-88`, `limits.ts:13`); `alarm()` kicks the pass (`:220`). No other alarm use.
- Hibernation (V): `ctx.acceptWebSocket` (:116), `serializeAttachment`/`deserializeAttachment` as the only per-socket state (:118, :235, :356), `setWebSocketAutoResponse` (:57). In-memory only and reset on wake: `#budgets` (`:50`), `#resuming` (`:53`), the LogHost's rate bucket and held fold (`log-host.ts:100-103`).
- `LIMITS` (`src/lib/sim-stream/limits.ts:16-28`): `commitBytes 1_048_576`, `frameBytes 1_052_672`, `simCommits 100_000`, `simBytes 67_108_864`, `burst 120`, `perSecond 2`, `sendBytes 1_048_576`, `resumeBytes 8_388_608`. `STAMP_MAX 1024` (:35).
- Resume budgets (`limits.ts:22,25`): writers 25_165_824 burst, 4_194_304 B/s; readers 12_582_912 burst, 2_097_152 B/s.
- Frame size pre-check `overFrameLimit` (`limits.ts` shared, :48-50). `IDENTITY_MAX 64` (`open-params.ts:8`). `INDEX_BATCH 50`.
- Append check order (`decide.ts:27-51`): gone, not-writer (`!write || identity===null`), rate token, frameBytes, parse (`invalid`), duplicate id (silent), `full` (`tip >= simCommits || bytes+frameBytes > simBytes`), `behind` (`draft.parent !== tip`). Then in `log-host.ts:398`: stored size > commitBytes -> `limit`; fold check -> `newer`/`invalid` (:405-418).
- Close codes used: 1003 binary, 1008 malformed, 1011 internal, 4410 gone.

### 4.4 SQLite tables (verbatim `src/lib/server/sim-object/schema.ts:7-19`; SQL `migrations/sim/20261115062714_fat_scorpion/migration.sql`)

```ts
export const commits = sqliteTable('commits', {
  seq: integer('seq').primaryKey(),
  id: text('id').notNull().unique(),
  hash: text('hash').notNull(),
  bytes: integer('bytes').notNull(),
  body: text('body').notNull()
});

export const simState = sqliteTable('sim_state', {
  id: integer('id').primaryKey(),
  indexedSeq: integer('indexed_seq').notNull().default(0),
  goneAt: integer('gone_at')
});
```
`SimStore` constructor inserts the single `sim_state` row id 1 (`store.ts:30`). `commit.body` is the full JSON of the stamped commit (log-host.ts:396).

### 4.5 FACTS about multi-connection / multi-writer behaviour

Each is V with the citation; "exists only for several writers" is my classification (I) and is marked as such.

| Fact | Citation |
|---|---|
| The object fans out every accepted commit to every open socket whose attachment has `resumed === true` (the author's own socket included) | `sim-object.ts:73` (`onCommit`), `:353-361` (`#broadcast` iterates `ctx.getWebSockets()`), `object-rules.ts:219-221` (`receivesLive`) |
| The object tracks several connections: iterates `ctx.getWebSockets()` in `#broadcast` (:354), `rereadRoles` (:235), `takeDown` (:296) | same |
| One outstanding resume per socket, keyed by a per-socket id `sid` (not by identity) in the `#resuming` Set | `sim-object.ts:53`, `access.ts:19-25`, `object-rules.ts:165-216` |
| Records an author on every commit: `actor: author.identity` stamped by the object; stored inside `body`, and copied to D1 `sim_commit.actor` | `log-host.ts:392`; `index-sync.ts:27` (`actor: commit.actor`); `simControlPlane.ts:37,47` |
| Commit bodies go to every socket as stored, so actor ids are visible to any socket on the sim, signed-out readers included | `sim-object.ts:353-361` + `stream/+server.ts:35` (identity null allowed) (I for the privacy conclusion; the doc says so too, `docs/dev/sim-object.md:315`) |
| Optimistic-concurrency check: an append whose `parent !== tip` is refused `behind` (the object does no rebase; it only refuses) | `decide.ts:50`; `protocol.ts:17`. Rebase happens in the browser (not examined in S2; `src/lib/sim-page/sim-session.ts:46` has a `'rebased'` notice, I) |
| All appends/resumes/takedowns run on one promise chain | `log-host.ts:94-98,291-298` (`#serial`) |
| One rate bucket PER SIM, shared by all writers; readers take no token because the token is taken only after the `not-writer` check | `log-host.ts:304-306`, `decide.ts:5-10,36-37` |
| Resume byte budgets are split writers vs readers so "anyone holding a sim's link cannot spend what its writers need" | `resume-budget.ts:1-4,55-59` |
| Permission is re-read on demand for open sockets (`rereadRoles`), sending `access` frames to sockets whose right changed | `sim-object.ts:229-248`; `object-rules.ts:94-112,233-254`; `access.ts:65-74` |
| `rereadRoles` exists only to push roster changes onto open sockets | exists only for several people (I: with one owner the right never changes) |
| Duplicate-id handling: an append whose id is already stored gets no frame | `decide.ts:46`; `log-host.ts:28-33` (`AppendOutcome.duplicate`) |
| `appendAs` is a server-side single-writer path (no socket); used only by rename | `sim-object.ts:256`; `rename.ts:57`; `sims/[simId]/+page.server.ts:87-94` |
| Anything in `webSocketMessage` that names a role: none. The object trusts `attachment.write` and `attachment.identity` | `sim-object.ts:187` |
| The object never reads membership itself except in `rereadRoles` (reads D1 `capability_event`+`sim_index` via `foldSimRole`) and writes D1 only via `syncSimIndex` | `sim-object.ts:12,83,236` |

Components that exist only to coordinate several writers/connections (I, from the facts above): `behind` refusal + client rebase; `access` frame and `rereadRoles` and the roster hook; `#broadcast`/`receivesLive`/`resumed` mark (so a catching-up socket receives each commit once); the per-sim shared append bucket; reader vs writer resume budgets; one-resume-per-socket via `sid`; `duplicate` silence; the `not-writer` refusal reason. A single-owner design could drop these with no change to the log format (I).

---------------------------------------------------------------------------------------------------

## 5. The D1 copy of sim data

Tables (`simControlPlane.ts`): `sim_index` (:11-21), `sim_commit` (:30-50), `sim_takedown` (:24-27).

| Table | Written by | When | Read by |
|---|---|---|---|
| `sim_index` (`sim_id` PK, `title`, `created_at`, `updated_at`, `remixed_from`, `remixed_from_position`, `positions` default 0, `last_change_at`, `dataset_version`) | INSERT: `createSim` batch statement 1 via `buildInsertSimIndexIfFreeSql` (`sims.ts:41`, `sim-index.ts:56-65`), columns `sim_id,title,created_at,updated_at` only. UPDATE: `syncSimIndex` (`index-sync.ts:54-65`) sets `positions,last_change_at,dataset_version,title,updated_at` only `where simIndex.positions < summary.positions`. DELETE: `deleteSim` (`sims.ts:82`) | insert at registration; update after each batch of up to 50 commits in the object's index pass (`index-runner.ts:62-69`) after commits are sent, and on alarm retry | `getSimTitle` (`sim-index.ts:74`; stream route header title, rename, sims layout, leave); the role folds INNER JOIN it (`sim-roles.ts:88,113,164`); `listRecipientPendingInvites` / `findInviteByToken` titles (`control-plane.ts:455,488`); `invites` and `resend` routes' mail titles; `hasPast` existence checks (`sim-index.ts:31`); stream route 404 gate (`stream/+server.ts:29`) |
| `sim_commit` (PK `(sim_id, seq)`; `kind,source,actor,at,build,dataset_version,bytes,restores_position,restores_as`; indexes on `actor`, `dataset_version`) | INSERT ... ON CONFLICT DO NOTHING by `syncSimIndex` (`index-sync.ts:52`), envelope only (no changes), via `envelopeRow` (:22-37). DELETE by `deleteSim` (`sims.ts:83`) | same index pass | `hasPast` only (`sim-index.ts:33`). No reader of `actor`/`kind`/`source` etc. found in `src` (V: grep for `simCommit` shows only `index-sync.ts`, `sims.ts`, `sim-index.ts`, schema) |
| `sim_takedown` (`sim_id` PK, `taken_down_at`) | `deleteSim` upsert-safe insert (`sims.ts:76-79`) | step 1 of a takedown | `hasPast` (`sim-index.ts:32`) only (see section 9) |

- Writers other than the object: only registration and takedown touch `sim_index`; nothing else writes `title` (the rename goes through the DO; `updateSimIndexTitle` has no caller, `sim-index.ts:84`).
- `remixed_from`, `remixed_from_position`: columns exist (`simControlPlane.ts:16-17`; migration `20261115061737_small_centennial`), no code writes or reads them (V: grep `remixedFrom|remixed_from` over `src` hits only the schema file).
- The schema comment says the tables are "rebuildable from the sim objects and never read to serve a sim's rules (R24)" (`simControlPlane.ts:6-9`). Code fact: the role folds (membership/write rights) do read `sim_index` (inner join), and a sim with no `sim_index` row has no members and no stream (`stream/+server.ts:29`).
- No `sim_commit` -> D1 reader means the copy is write-only except as an id-existence mark (V as above).
- No FK from `sim_invite` or `capability_event` to `sim_index` (`simInvite.ts:8` comment "Deliberately NO FK to sim_index"; migration shows only user_identity and principal FKs).

---------------------------------------------------------------------------------------------------

## 6. `POST /api/sims` (registration)

Route `src/routes/api/sims/+server.ts:17-43`; logic `src/lib/server/sims/start-sim.ts:65-161`; write `sims.ts:25-52`; types `src/lib/sim-stream/register.ts` (verbatim):
```ts
export type RegisterCode =
  'invalid_id' | 'title' | 'sign_in' | 'taken' | 'quota' | 'rate' | 'session' | 'failed';
export interface RegisterOk { simId: string; created: boolean; }
export interface RegisterError { error: string; code: RegisterCode; }
```

Inputs: JSON `{ simId: string, title?: string | null }`. `simId` must pass `isValidId` (route :29, `startSim` :71); title non-string non-null -> 400 `title` (route :32). Title trimmed, non-empty, at most `SIM_TITLE_MAX` 63 (`start-sim.ts:21-28`, `members/copy.ts:4`); omitted gives `DEFAULT_SIM_NAME` `'Untitled sim'` (`sim-log/shapes.ts:30`; `start-sim.ts:73`) and no handle reseed (:127-129).

Order inside `startSim` (V): id check (:71) -> title (:73-79) -> signed-out on known device: stash title + redirect 303 to `/signin?returnTo=/sims` (:81-84; the JSON route answers 401 `sign_in` first, route :37-39) -> signed-out: `simIdInUse` then 409 `taken` (:96), else `mintPseudonymousSession` (:100; 429 `rate` or 500 `session`) -> creation rate `sim_start:<identity>` on `MUTATION_REGISTERED_RL` (:111; 429 `rate`) -> signed-in: `simIdInUse` -> `answerForRegistered` (:118-120) -> quota `simQuotaExceeded` (:122; 403 `quota`) -> `createSim` (:134; throw -> 500 `failed`) -> `!created` -> `answerForRegistered` (:150) -> handle reseed for pseudonymous first sim with a title (:127-158) -> `{simId, created: true}` (:160).

Statuses (V from code): 201 `{simId, created:true}`; 200 `{simId, created:false}` (caller already writes the id; `answerForRegistered` :44-50); 400 `invalid_id` / `title`; 401 `sign_in` (route :38); 403 `quota`; 409 `taken` ("not yours", same text whoever holds the id: `start-sim.ts:37`); 415 / 403 from the same-origin check (route :19); 429 `rate`; 500 `session`, `failed`. Plus any uncaught throw -> framework 500 (I; the doc lists a `{message}` 500).

Caps: `MAX_SIMS_PER_MANAGER = 1000` per person counted as sims where the person's role is `manager` (`copy.ts:2`; `sim-roles.ts:189-191`; `sim-quota.ts:11-13`). Rates: `MUTATION_REGISTERED_RL` 120/60 s per identity; `PSEUDO_MINT_RL` 5/60 s per IP.

"Ids with a past" (V, `sim-index.ts:25-38`, `hasPast`): the id exists in ANY of: `sim_index` row; `sim_takedown` row; `sim_commit` row; or a `capability_event` with `resource_type='sim'` and `resource_id` = id. Used by `buildInsertSimIndexIfFreeSql` (`insert ... where not hasPast(id) on conflict do nothing returning sim_id`, :56-65) and `simIdInUse` (:68).

Atomicity: `createSim` sends one D1 batch of two statements: conditional index insert, then the manager grant gated on `(select changes()) = 1` (`sims.ts:41-44`). `created` = first statement returned one row (:45). Uses the raw D1 client `db.$client` (:34).

Side facts: browser-minted id (`routes/api/sims`); `/sims` form action and `/signin` and the `/sims` resume path use a server-minted `newId()` (`sims/+page.server.ts:33,71`; `signin/+page.server.ts:238`). The object is not contacted at registration (`sims.ts:19-24` comment; no `stub` in `createSim`); the first start commit is written by the object when a writer opens an empty sim (`sim-object.ts:128-143`) or by `appendAs` on rename.

---------------------------------------------------------------------------------------------------

## 7. Invitations end to end

Table `sim_invite` (`simInvite.ts:14-36`; SQL `migrations/d1/20261114112404_bizarre_oracle/migration.sql:91-107`): `id` PK, `sim_id`, `role`, `invited_email` (normText), `invited_user_id` FK user_identity cascade, `token_hash` UNIQUE index `sim_invite_token_hash_idx` (:144), `invited_by_user_id` FK cascade, `status` default `'pending'`, `created_at`, `expires_at`, `last_sent_at`, `accepted_by_user_id` FK set null. Status union (`simInvite.ts:5`):
```ts
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';
```
(V) Nothing writes `'expired'`: expiry is computed by comparing `expires_at` to now (`control-plane.ts:99-103,236,267,444,501`).

Token (`token.ts`): 32 random bytes, 64 lower-hex chars (:4-10); stored as SHA-256 hex (`hashToken` -> `sha256Hex`, :13); link `${origin}/invite/${token}` (`email.ts:15`). Raw token returned only to the route that mails it (`createInvite` result, `control-plane.ts:153`; `resendInvite` :423).

Create (`POST /api/sims/[simId]/invites`): manager; two `INVITE_RL` checks (ip, actor); body `{target: string}`; `parseInviteTarget` (email regex `EMAIL_RE` :28 else `@handle`); `canInviteByEmail = inviter.emailVerified` (route :55); handle target must resolve to a user (`'no user with that handle'`, control-plane.ts:126); `assertNotMemberOrInvited` (`already a member`, `already invited` by user id or email, and `INVITE_PENDING_CAP` = 50 live pending, :79-105); insert with `role: 'editor'`, `expiresAt = now + INVITE_TTL_MS` (7 days, :21,148), `lastSentAt = now` (:141-149); `recheckInviter` (:179-201). Then mail only if the recipient address is deliverable (`isDeliverable`, route :67) and the `invite_email:<addr>` rate allows (route :71-76); `sendInviteEmail` failure is logged, not surfaced (route :91-93).

Email send: `sendInviteEmail` (`email.ts:7-25`): `recordE2eMail(platform,'invite',to,url)` then `sendEmail` with `buildInviteEmail` (`email-templates/invite`, not examined).

Resend (`POST .../resend`): manager; `MUTATION_REGISTERED_RL`; `resendInvite` (`control-plane.ts:390-424`): must be live (found, pending, not expired); address = invited email or the invited user's email; undeliverable -> `{emailed:false}` without rotation; within `RESEND_COOLDOWN_MS` 60 000 of `lastSentAt` -> throws `'resend too soon'`; else new token hash + `lastSentAt = now` (old link dies). Mail failure logged only (route :65-67).

Revoke (`DELETE .../invites/[inviteId]`): sets `status='revoked'` scoped by sim id (`control-plane.ts:375-384`). No state check (revoking a non-pending row rewrites its status; V from the unguarded `update ... where id and simId`).

Accept by token (`acceptInviteByToken`, :329-339): bearer-only, no addressing check (comment :324-328). Accept by id (`acceptInviteById`, :341-357): `targetsMe`. Both -> `finalizeAccept` (:306-322): members must be non-empty; `claimInvite` (guarded UPDATE pending->accepted, single use, :276-293); `addMemberById` with `invite.role`; `reconcileSimManagement`; caller then runs `onSimRosterChanged` (accept route :26; invite page :51,161).

Decline (`declineInvite`, :359-373): pending required; if `invitedUserId` set it must be the caller; sets `declined`. Email-only invites (no `invitedUserId`) can be declined by any signed-in caller who knows the invite id (V: the check is skipped when `invitedUserId` is null, :366). No roster hook.

Signed-out ("cold") accept: `classifyColdAccept` (`claim.ts:39-53`) -> `mint` (pseudonymous if no invited email, else email-bound unverified), `signin` (account exists: strong factor redirects to `/signin`, else a magic link is sent), `verify` (different address entered: magic link to it). Implemented in `invite/[token]/+page.server.ts:63-194` (mint branch updates the new user row to the invited email, :135-157, then `acceptInviteByToken`).

Lists: manager view `listManagerPendingInvites` (:223-244); recipient view `listRecipientPendingInvites` (:433-467) selects ALL pending non-expired invites then filters in memory (:441-449); banner on `/sims/*` layout.

Ends (V): `deleteSim` deletes pending invites (`sims.ts:84`); `removeSimMember` deletes pending invites when the sim becomes empty (`sims.ts:118-121`). The account-deletion FK cascade removes invites by user (`simInvite.ts:21-33`).

---------------------------------------------------------------------------------------------------

## 8. Members: add, remove, leave, role change, roster hook, `rereadRoles`, `appendAs`, rename

- Add: only by accepting an invitation (section 7). No add-member route (`addMember` at `sim-index.ts:172` has no caller).
- Role change: no path (section 2.3), except automatic promotion to manager.
- Remove another: `DELETE /api/sims/[simId]/members/[userId]` -> `removeSimMember({actorUserId})` (`members/[userId]/+server.ts:17-24`) -> `removeMembership` (`sim-index.ts:250-279`): resolves survivor ids, refuses removing a different manager, promotes a successor if the target is the sole manager, `revokeSimRoles`, `reconcileSimManagement`. Then, if empty, delete pending invites (`sims.ts:114-124`), then hook (`:126`).
- Leave: `leaveSim` action -> `leaveSim` (`sims.ts:135-152`): `prepareLeave` then `removeSimMember` (no `actorUserId`).
- Account deletion: `user-store/deletion.ts:167-179` calls `removeSimMember({notify:false})` per sim (pass bounded) then one `rosterChangedAll` (deferred via `waitUntil`).
- Identity fuse (pseudonymous -> real account): `user-store/identity.ts:147,198` reads the absorbed identity's sims and calls `rosterChangedAll`; wired at `auth/better-auth.ts:304`.
- Roster hook (`roster-hook.ts`): `onSimRosterChanged(env, simId)`: up to 2 attempts, 5 s timeout each, no retry when `e.overloaded`, never rejects, no-op where `liveSimStub` is null (`dev` or no `SIM`) (:35-53). `rosterChangedAll`: 6 sims at a time (:56-62). Callers listed in section 1.2 importers (accept route, invite page x2, `removeSimMember`, deletion, identity).
- `rereadRoles`: section 4.1. It is the object end of the hook.
- `appendAs` + "the rename": `renameSim` (`rename.ts:42-77`): requires a stub, reads D1 title; equal title (trimmed, NFC) -> success with no append (:56); else `stub.appendAs({actor, draft: renameDraft(name, build), start: {id, title: headerTitle(title), datasetVersion, build}})` (:57-66). `renameDraft` = `{kind:'edit', label:'Rename', source:'sim.name', changes:[{op:'set', key:NAME_KEY, field:'name', value:name}]}` (:19-33). In the object, `LogHost.appendAs` (`log-host.ts:144-190`) validates the actor (1..64 chars), records the start commit first if the log is empty (:156-166), fills `parent` = tip and `datasetVersion` from the folded state (:177-181), appends as `{identity: actor, write: true}`. D1 `sim_index.title` is updated by the index pass, which `appendAs` awaits via `#kickIfMoved` (`sim-object.ts:277-285`). Status map for refusals: `RENAME_STATUS` (`sims/[simId]/+page.server.ts:100-106`).

---------------------------------------------------------------------------------------------------

## 9. Operator takedown

Route `POST /api/operator/sims/[simId]/takedown` (`takedown/+server.ts:26-46`). Order: same-origin JSON check; `secret = platform.env.SIM_TAKEDOWN_TOKEN` (:29); 404 `{error:'Not found.'}` when `bearerMatches(Authorization, secret)` fails or `!isValidId(simId)` (:31); 503 when no live stub (:34-36); `deleteSim` (:38); 500 on throw (:41); 200 `{simId}` (:45); `console.info('[takedown] done')`.

`bearerMatches` (`operator/token.ts:12-24`): false unless secret is a string of >= `TOKEN_MIN` 32 chars; header must be `Bearer <token>`; lengths equal; SHA-256 digests compared with XOR. `SIM_TAKEDOWN_TOKEN` is read ONLY here (grep: `src/routes/api/operator/.../+server.ts:29`; other hits are comments, `playwright.config.ts:49`, docs). It is not in `wrangler.jsonc` vars (grep); `Env` typing is a cast at :29.

`deleteSim` (`sims.ts:72-86`): (1) insert `sim_takedown` row, conflict-ignore; (2) `stub.takeDown()` -> `LogHost.takeDown` -> `SimStore.clear(now)`: delete all `commits`, set `sim_state.gone_at = now`, `indexed_seq = 0` (`store.ts:130-133`), wait for index pass, close sockets 4410; (3) one D1 batch: delete `sim_index` row, `sim_commit` rows, pending `sim_invite` rows. `capability_event` rows stay (comment `sims.ts:58-60`).

`sim_takedown` readers: `hasPast` only (`sim-index.ts:32`), i.e. registration refusal (`buildInsertSimIndexIfFreeSql` and `simIdInUse`). The object's own "gone" is `sim_state.gone_at` (`store.ts:108-113`), read by `LogHost.gone()` (`log-host.ts:117-119`) -> `openStatus` 410 (`object-rules.ts:58`). The stream route answers 404 once the `sim_index` row is deleted (`stream/+server.ts:29`).

---------------------------------------------------------------------------------------------------

## 10. Sims with no members (V)

- `removeSimMember` keeps the sim, its log, and the `sim_index` row when the last member goes; deletes pending invites in one statement (failure logged only): `sims.ts:88-128` doc comment and :114-124.
- Role folds find no member -> `requireSimRole` 404 for everyone (`require-cap.ts:59-60`); the stream route still opens a read-only socket (`write:false`) for anyone because it only needs the `sim_index` row (`stream/+server.ts:29-36`).
- `rereadRoles` (invoked by the hook after the last removal, `sims.ts:126`) turns open sockets read-only.
- Registration of that id: `hasPast` true -> `taken` (409) for non-writers; no one is a writer.
- Accept refuses (`finalizeAccept` :311-312). Takedown remains the only deletion.
- Code `reconcileSimManagement` returns `{empty:true}` when no members (`sim-index.ts:223`).

---------------------------------------------------------------------------------------------------

## 11. `/sims` and `/sims/[simId]` pages: load shapes and what they show

`/sims/+layout.server.ts:6-15` returns (verbatim fields):
```ts
{ recipientInvites: RecipientInvite[] }   // [] when signed out
// RecipientInvite (control-plane.ts:426-431): { id: string; simId: string; simTitle: string; inviterHandle: string }
```
`/sims/+page.server.ts:12-62` returns `{ sims: [], invitations: [] }` when signed out (:14) else `{ sims: SimListItem[], invitations }` where `SimListItem = { simId: string; title: string; role: SimMemberRole }` (`sim-index.ts:104-108`), sorted by title, `invitations` = layout's `recipientInvites` via `event.parent()` (:60). The load may create a sim from the stashed-title cookie and redirect 303 `/sims/<id>` (:20-55; `readPendingSim`). Action `create` returns `startSim` failure data or redirects (:65-76). Page (`+page.svelte`): heading, `InvitationsList`, create form (title input, maxlength 63), list of links to `/sims/<id>` with title only; role not shown. `+layout.svelte:9-18`: `InviteBanner` when `recipientInvites` non-empty (accept -> goto sim).

`/sims/[simId]/+layout.server.ts:14-44` returns:
```ts
{
  simId,
  title,                       // from sim_index; 404 if null
  role,                        // SimMemberRole of the caller (viewer minimum)
  currentUserId: string | null,
  canInviteByEmail: boolean,   // emailVerified && isDeliverable(email)
  members: { userId: string; handle: string; role: SimMemberRole }[],   // never email/name/image
  pendingInvites: { id: string; display: string; invitedByEmail: boolean }[]  // [] unless manager
}
```
`/sims/[simId]/+page.server.ts:15-19` load returns `{}`. Actions: `leaveSim` (:22-52; failure `fail(400,{code})` or `fail(404,{code:'sim_not_found'})`), `rename` (:60-97; failure `{renameError, name}`).

Page (`[simId]/+page.svelte`): title `h1`; rename disclosure for manager/editor (:112-143); `<details>` "members" with `MembersPanel` (list, invite form, remove, resend, revoke, leave) (:145-165); calls `POST /api/sims/<id>/invites`, `DELETE .../members/<userId>`, `POST .../invites/<id>/resend`, `DELETE .../invites/<id>` (:57-97). Optimistic `MembershipOverlay` (`lib/members/membership-overlay.svelte`, not examined). Notably it does NOT show or open the sim itself (no policy editor, no socket); the sim editor lives on `/sim` (client; not examined in S2). I: it is a members-and-rename admin page.

---------------------------------------------------------------------------------------------------

## 12. Migrations

D1 track `migrations/d1/` (`drizzle.config.ts`, out `./migrations/d1`; `wrangler.jsonc:21` `migrations_dir`). Each dir has `migration.sql`, `snapshot.json`, `.flattened`; there is also a top-level flattened `<name>.sql` per migration.

| Migration | Creates / alters |
|---|---|
| `20261011113510_kind_unicorn` | `plan` (id, schema, dataset_version, body, content_hash UNIQUE, op_count, byte_size, created_at); index `plan_created_at_idx` |
| `20261031052115_silly_the_leader` | `ALTER TABLE plan ADD kind text DEFAULT 'plan' NOT NULL` (single line, 59 bytes) |
| `20261114112404_bizarre_oracle` | `principal`, `user_identity`, `account`, `passkey`, `session`, `user`, `verification`, `sim_index` (sim_id, title, created_at, updated_at), `sim_invite`, `user_version`, `capability_event`, `handle_tombstone`; unique `user_handle_skeleton_unique`, `sim_invite_token_hash_idx`; indexes `user_version_identity_idx`, `capability_event_principal_idx`, `capability_event_resource_idx`, `capability_event_created_idx`, `handle_tombstone_skeleton_idx` |
| `20261115061737_small_centennial` | `sim_commit` (+ pk `sim_commit_pk`); `ALTER sim_index ADD remixed_from, remixed_from_position, positions DEFAULT 0 NOT NULL, last_change_at, dataset_version`; indexes `sim_commit_actor_idx`, `sim_commit_dataset_version_idx` |
| `20261115104641_large_shadow_king` | `sim_takedown` (sim_id PK, taken_down_at) |

Sim track `migrations/sim/` (`drizzle.sim.config.ts`; bundled to `migrations.generated.ts` per `drizzle-cf.config.ts:8-14`): one migration `20261115062714_fat_scorpion`: `commits` (seq PK, id UNIQUE, hash, bytes, body) and `sim_state` (id PK, indexed_seq DEFAULT 0, gone_at). `drizzle-cf.config.ts` defines tracks `d1` and `sim` (`defineTracks`). Sim-track doc comment: append-only; never delete (`drizzle.sim.config.ts:3-5`).

DO class migration (wrangler, not drizzle): tag `v1-sim-object`, `new_sqlite_classes: ["SimObject"]` (`wrangler.jsonc:10,52`).

---------------------------------------------------------------------------------------------------

## 13. `scripts/worker-entry.ts`

35 lines. After `vite build`, `wrapWorker(root)` (:21-31) moves the adapter's `.svelte-kit/cloudflare/_worker.js` to `.svelte-kit/cloudflare-adapter/_worker.js` and writes a new `_worker.js` whose content is (`entrySource`, :11-18):
```
// sfhousing worker entry: written by scripts/worker-entry.ts after vite build; do not edit.
export { default } from '../cloudflare-adapter/_worker.js';
export { SimObject } from '../../src/lib/server/sim-object/sim-object.ts';
```
Guard: throws `'already wrapped'` if the file already starts with `ENTRY_MARK` (:24-26), `'no adapter output'` if absent (:23). Runs when invoked directly (:33-35). `wrangler.jsonc` `alias: { "$lib": "./src/lib" }` (:7) lets wrangler bundle the DO's `$lib` imports from source. I: `npm run build` chain calls it (not opened: `package.json`).

---------------------------------------------------------------------------------------------------

## 14. Link between published policies / plans and sims

Predicates tried (all over `src/lib/server/sharing`, `src/lib/sharing`, `src/routes/api/policies`, `src/routes/api/plans`, `src/routes/p`, `src/routes/s`, `src/lib/timeline/server-codec.ts`, `src/lib/server/db/schema/plan.ts`, spec files excluded):

- `sim_id|simId|simIndex|sim_index|simCommit|remixedFrom|sim-log|sim_commit` (case-insensitive): NO HIT.
- Repo-wide `remixedFrom|remixed_from|remixedFromPosition` (src, non-spec): only the schema columns `simControlPlane.ts:16-17`. `remixOf` (doc `sim-object.md:315`) has no occurrence in `src` code (grep over `*.ts`).
- The `plan` table (`schema/plan.ts:3-17`) has a `kind` column `'plan' | 'sim'` ("which document codec reads body"), `DocKind = 'plan' | 'sim'` (`sharing/doc-codec.ts:17`), but it is a document-type tag, not a sim id. `POST /api/policies` = `handlePublish(event, CODECS.sim)` (`routes/api/policies/+server.ts:5`); `/s/[id]` loads `loadSharedDoc(SIM_SERVER_CODEC4, ...)` (`routes/s/[id]/+page.server.ts:10`). There is no FK, join, or id reference between `plan` rows and `sim_index`/`sim_commit`/`sim_invite`/`capability_event`.
- I: a published `/s/[id]` policy is a content-addressed snapshot (the `plan.content_hash` UNIQUE, migration `kind_unicorn`) independent of any server-side sim; remixing it happens on the client (`routes/s/[id]/+page.svelte:18-29`, `SIM.remixConfirm`), not examined further.

---------------------------------------------------------------------------------------------------

## 15. What a signed-out or pseudonymous person's sim does on the server

(V for server code; I for the client behaviour, from `src/lib/sim-sync/sim-sync.svelte.ts` which is outside S2.)

- Signed out, no cookie, opens `/api/sims/<existing id>/stream`: reaches the DO as a reader (`identity: null`, `write: false`), only if the id has a `sim_index` row (`stream/+server.ts:29-36`; `parseOpenParams` allows `identity:null` only with `write:false`, `open-params.ts:60-62`). It receives `hello`, `access{write:false}`, and commits via resume; it can never append (`decide.ts:36`). The object does not need a session to open.
- Signed out and has edited locally: the browser registers once the sim "has something to send" (`sim-sync.svelte.ts:277-281`: `store.pendingCount > 0 || store.heldCount > 0` -> `#register`; doc `auth.md` says it never registers for "a look"). `POST /api/sims` then calls `mintPseudonymousSession` (`start-sim.ts:100`) = Better-Auth anonymous sign-in (`pseudonymous-mint.ts:34`), setting a session cookie, and the new pseudonymous account becomes the sim's first manager (`sims.ts:41`). From then on the sim is an ordinary server sim: the stream route resolves that session, role fold says manager, `write:true`, the object records the start commit on first writer open, and every commit stamps `actor` = the pseudonymous identity id.
- Signed out on a KNOWN device (`known-device` cookie `=== '1'`, `onboarding/known-device.ts:18-20`): `POST /api/sims` answers 401 `sign_in` and creates nothing (`routes/api/sims/+server.ts:37-39`); the form path stashes the title and redirects to `/signin?returnTo=/sims` (`start-sim.ts:81-84`).
- Pseudonymous accounts are regular `user` rows (flag `pseudonymous`); every server sim path treats them the same as registered users except: email invites are blocked for non-verified inviters (`invites/+server.ts:55`), undeliverable synthetic addresses get no mail (`isDeliverable`), handle seeding from the sim title (`start-sim.ts:127-129`), operator bootstrap ignores them (`capabilities.ts:34`).
- Under `npm run dev` (`dev` true) the object never runs: stream route 503 (`stream/+server.ts:32`), `liveSimStub` null (`live-sim.ts:11`), roster hook no-op, rename `unavailable`, takedown 503. Registration still writes D1.
- A purely local sim (never registered) has no server presence at all (I: no server code is reachable without a `POST /api/sims`).
- Published policies (`/api/policies`, `/s/<id>`) do not require a sim (section 14).

---------------------------------------------------------------------------------------------------

## 16. `SIM` / `INVITE_RL` / `SIM_TAKEDOWN_TOKEN` usages in `src` (V, non-spec)

- `SIM`: `wrangler.jsonc:9,51`; `sim-object/stub.ts:7,11` (the only `env.SIM` read; `simStub`); `sims/live-sim.ts` (wraps it); `src/lib/server/test/sim-env.ts:12` (test fake). `Env` type from generated `worker-configuration.d.ts` (not opened).
- `INVITE_RL`: `wrangler.jsonc:31,81`; `routes/api/sims/[simId]/invites/+server.ts:38,43,72`. Nowhere else.
- `SIM_TAKEDOWN_TOKEN`: `routes/api/operator/sims/[simId]/takedown/+server.ts:17,29`; `playwright.config.ts:49` (e2e value); doc `docs/dev/deploy.md:63,71,76`.
- Who calls the DO's methods: `stub.fetch` (stream route :48); `rereadRoles` (roster-hook.ts:41); `appendAs` (sims/[simId]/+page.server.ts:89); `takeDown` (sims.ts:80). No other caller of the stub.

---------------------------------------------------------------------------------------------------

## 17. Doc/code contradictions and surprises

Contradictions (doc or comment vs code):
1. `docs/dev/sim-object.md:315` says the index pass copies a remix's `remixOf` to `remixed_from` / `remixed_from_position`. Code: `index-sync.ts:54-65` never touches those columns; `remixOf` does not appear in `src` code. The columns are dead. (The doc line sits under a "Sharing (unit 5)" status entry, so it may be a plan; stated as a mismatch anyway.)
2. Comment `invites/control-plane.ts:324-328` says "the granted role is hardcoded `editor`" at accept. Code: accept uses `invite.role` read from the row (`:315`); only `createInvite` hardcodes `'editor'` (`:141`). Equivalent today only because nothing writes any other role into `sim_invite`.
3. `simControlPlane.ts:6-9` comment: `sim_index`/`sim_commit` are "never read to serve a sim's rules". Code: role/membership folds INNER JOIN `sim_index` (`sim-roles.ts:88,113,164`), and the stream route 404s without an index row and takes its start-commit title from `sim_index.title` (`stream/+server.ts:28-29,44`). Arguable ("rules" = log rules), listed for the design team's awareness.
4. No other doc/code mismatch found among the claims I cross-checked in `docs/dev/auth.md` (registration order, statuses, hasPast, no-member behaviour, hook constants 6/2/5000, invite 50/7d/60s) and `docs/dev/sim-object.md` (limits table, budgets 6 MiB/s and 36 MiB, close codes, append order, rename statuses). Not every doc sentence was checked (the docs total 524 lines; I read targeted sections).

Surprises:
- Role change does not exist: no endpoint, and `viewer` is never granted by any code path found; invitations only create editors (`control-plane.ts:141`). The three-role model is wider than its use.
- Dead/unused exports: `addMember`, `updateSimIndexTitle`, `insertSimIndexIfFree` (non-test), `grantCapability`, `revokeCapability`, `requireCapability`, `requireOperator` (the app-scoped operator ledger path is entirely unwired; only the `BOOTSTRAP_EMAILS` wildcard in `hooks.server.ts:58` runs).
- `sim_commit` in D1 has no reader other than the "id has a past" existence check; `actor`, `kind`, `source`, `bytes` are written and never read in `src`.
- Takedown does not use sessions or roles at all; it is gated only by a bearer secret that is unset by default.
- `capability_event` is a shared ledger: sims are one of its two resource types (`'sim'`, `'app'`), and its rows are never deleted by a sim takedown.
- The sim page `/sims/[simId]` is purely a members/rename admin page; the sim editor is elsewhere.
- Decline of an email-only invite is allowed for any signed-in caller (`control-plane.ts:366`: the addressee check is skipped when `invitedUserId` is null).
- `listRecipientPendingInvites` scans every pending invite in the system (`control-plane.ts:441-444`), on every `/sims/*` layout load (the page.server comment notes this, `sims/+page.server.ts:59`).
- The DO is reachable only for registered sims (an index row) and the object trusts the open header entirely (`stream/+server.ts:14-18`).

---------------------------------------------------------------------------------------------------

## Appendix

### Files read in full
`src/lib/server/db/schema/simControlPlane.ts`, `simInvite.ts`; `src/lib/server/sim-object/{schema.ts, migrations.generated.ts, sim-object.ts, log-host.ts, object-rules.ts, access.ts, limits.ts, decide.ts, open-params.ts, resume-budget.ts, index-runner.ts, index-sync.ts, stub.ts, store.ts}`; `src/lib/server/sims/{sim-roles.ts, roster-hook.ts, live-sim.ts, sim-quota.ts, stamp.ts, rename.ts, start-sim.ts (lines 1-27 via preview + 28-161 read), sims.ts, sim-index.ts}`; `src/lib/server/invites/{control-plane.ts, email.ts, claim.ts, error-code.ts, token.ts}`; `src/lib/server/operator/{token.ts, registry.ts, grants.ts, capabilities.ts}`; `src/routes/api/sims/+server.ts`, `.../[simId]/stream/+server.ts`, `.../invites/+server.ts`, `.../invites/[inviteId]/+server.ts`, `.../invites/[inviteId]/resend/+server.ts`, `.../members/[userId]/+server.ts`; `src/routes/api/invites/[inviteId]/accept/+server.ts`, `decline/+server.ts`; `src/routes/api/operator/sims/[simId]/takedown/+server.ts`; `src/routes/sims/{+layout.server.ts, +page.server.ts, +page.svelte, +layout.svelte}`; `src/routes/sims/[simId]/{+layout.server.ts, +page.server.ts, +page.svelte}`; `src/routes/invite/[token]/+page.server.ts`; `drizzle.sim.config.ts`, `drizzle.config.ts`, `drizzle-cf.config.ts`; `scripts/worker-entry.ts`; `migrations/sim/20261115062714_fat_scorpion/migration.sql`; `migrations/d1/20261011113510_kind_unicorn.sql`, `20261115061737_small_centennial/migration.sql`, `20261115104641_large_shadow_king/migration.sql`, `20261031052115_silly_the_leader.sql`; outside scope but read in full for citations: `src/lib/sim-stream/{protocol.ts, limits.ts, register.ts}`, `src/lib/server/authz/{ability.ts, require-sim-role.ts, sim-caps.ts, require-cap.ts}`, `src/lib/server/auth/session-gate.ts`, `src/lib/server/security/same-origin-json.ts`.

### Files read in part (line ranges)
- `migrations/d1/20261114112404_bizarre_oracle/migration.sql`: grep of CREATE/ALTER lines plus lines 84-133.
- `src/routes/invite/[token]/+page.svelte`: lines 1-30.
- `src/lib/members/copy.ts`: 1-40. `src/lib/server/security/rate-limit.ts`: 17-55 (grep context). `src/lib/server/onboarding/pseudonymous-mint.ts`: 10-40. `onboarding/known-device.ts`: 18-20.
- `src/lib/server/user-store/identity.ts`: 140-155 and grep hits; `user-store/deletion.ts`: 160-185 and grep hits; `src/routes/signin/+page.server.ts`: grep hits only.
- `src/hooks.server.ts`: grep hits (lines 4-12, 53-58) only.
- `src/lib/sim-sync/sim-sync.svelte.ts`: 1-30, 240-300.
- `wrangler.jsonc`: 1-60 and grep of migrations/vars.
- `docs/dev/sim-object.md` and `docs/dev/auth.md`: targeted greps and sections (auth.md lines 100-108, 125-200; sim-object.md grep hits, line 315).
- `src/routes/api/policies/+server.ts` (whole, 5 lines), `src/routes/s/[id]/+page.server.ts` (whole), `src/lib/server/db/schema/plan.ts` (1-30).
- `src/lib/server/db/capability-events.ts`: grep only.

### Dirs listed
`src/lib/server/{invites,sims,sim-object,operator}` (via `find ... | wc -l`), `src/routes/{sims,invite,api/invites,api/sims,api/operator}`, `migrations/` (full find), `src/lib/server/db/schema`, `src/lib/server/authz`, `src/lib/sim-stream`, `src/lib/sim-sync`, `src/routes/api`, `src/routes/s`, `src/routes/p`, `src/routes/api/policies`, `src/routes/api/plans`, `src/lib/server/sim-object/test`.

### NOT examined
- All `*.spec.ts` files in scope (only their line counts); `e2e/` (grep only for `SIM` hits).
- `src/lib/server/sim-object/test/drafts.ts`, `harness.ts` (test helpers).
- `src/routes/sims/**/*.svelte.spec.ts`, `page.server.spec.ts`, `layout.server.spec.ts`; `src/routes/invite/[token]/+page.svelte` beyond line 30 and its specs; `src/routes/api/**/api.spec.ts` / `server.spec.ts`.
- The `snapshot.json` files in `migrations/**` and the `.flattened` markers.
- `src/lib/members/*` Svelte components (`MembersPanel`, `InvitationsList`, `InviteBanner`, `LeaveSimConfirm`, `membership-overlay.svelte`) beyond grep hits.
- `src/lib/server/email-templates/invite`, `src/lib/server/email/*`, `src/lib/server/e2e/*`, `src/lib/server/onboarding/*` (beyond the lines listed), `src/lib/server/user-store/*` (beyond the lines listed), `src/lib/server/auth/better-auth.ts` (only the line `:304` cited from grep), `src/lib/server/db/capability-events.ts`, `src/lib/server/event-log/fold.ts`, `src/lib/sim-log/*` (log core), `src/lib/server/sharing/*`, `src/lib/timeline/server-codec.ts`, `src/lib/sim-store/*`, rest of `src/lib/sim-sync/*`.
- `worker-configuration.d.ts` (the `Env` type), `package.json` scripts (how `worker-entry.ts` is invoked), `docs/dev/deploy.md` beyond three grep lines, `docs/dev/sim-timers.md` etc.
- Staging block of `wrangler.jsonc` lines 60-110 (only grep hits).
