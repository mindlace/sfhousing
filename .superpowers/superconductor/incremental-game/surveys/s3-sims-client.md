# S3: browser side of sims (census)

Repo: /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game (branch worktree-incremental-game). Paths below are relative to `src/lib/` unless they start with `src/`, `e2e/` or `docs/`. V = verified in code (path:line), I = inferred (source named). Facts only.

## 0. Headline findings

1. **V** No non-test code outside `sim-store/` and `sim-sync/` imports either directory. `LogStore`, `SimSync`, `openSimDb`, `browserPorts`, `memorySimDb`, `LocalLog` are named only inside `sim-store/` and `sim-sync/` and in `*.spec.ts` files (grep over `src` and `e2e` for `LogStore|SimSync|openSimDb|browserPorts|memorySimDb` with `.spec.` excluded returns only `sim-store/sim-db.ts`, `sim-store/idb.ts`, `sim-store/log-store.svelte.ts`, `sim-sync/ports.ts`, `sim-sync/save-state.ts`, `sim-sync/sim-sync.svelte.ts`). `docs/dev/sim-store.md:3` says the same ("nothing on any page uses either yet, and plans 3 and 4 wire them up").
2. **V** `/sim` (`SimPage.svelte`) and Paint (`src/routes/+page.svelte`) do not import `sim-log`, `sim-store`, `sim-sync`, `sim-stream` or `members` (see section 9). The live `/sim` page saves with `Autosave` (localStorage) over an in-memory `PolicyStore`.
3. **V** The browser-side log/store/sync stack is therefore built and unit-tested but not mounted on any page. Its only live consumers outside `members/` are server code (`sim-log`, `sim-stream`) and routes (`members`).
4. **V** `members/` is mounted only on the `/sims` routes (list, one sim's member page, invitation banner), not on `/sim` or Paint.
5. **V** `sim-log/shapes.ts:1` imports `SIM_TITLE_MAX` from `$lib/members/copy`: the log core depends on the members directory for one constant (`members/copy.ts:4`, value 63).
6. **V** The browser never reads a commit's `actor`, never calls `parseCommit` (only `parseCommitDraft`), and never calls `verifyChain`/`chainHash` (server only: `server/sim-object/log-host.ts:394`).

---

## 1. Inventory: modules, exported symbols, line counts, importers outside the directory

Importers are non-spec files. Spec importers are summarised at the end of each directory.

### 1.1 `sim-log/` (core; 12 modules, 3945 lines incl. tests)

| Module | Lines | Exports (name, kind) |
|---|---|---|
| `index.ts` | 35 | barrel: re-exports everything in the rows below except `DEFER_STROKES`, `flatten/assemble/parentOf/listOf/isEndable/keyFits`, `strokeKey*`, `listKey`, `checkName`, `WHERE_ROWS`, `versionAt/readFields/upgradeFields/upgradeSet`, `Fields`, `Flat`, `StrokeFields` |
| `types.ts` | 76 | `Change`, `CommitKind`, `Restores`, `CommitDraft`, `Commit`, `FoldInput`, `RulesetContent`, `Ruleset`, `LogErrorCode` (types); `LogFormatError`, `LogError` (classes); `LABEL_MAX`, `BUILD_MAX`, `KEY_MAX`, `SOURCE_RE`, `SOURCE_MAX` (consts) |
| `parse.ts` | 189 | `parseChange`, `parseCommitDraft`, `parseCommit` (functions) |
| `keys.ts` | 49 | `NAME_KEY`, `policyKey`, `spanKey`, `listKey` (consts); `StrokeFields` (interface); `strokeKeyBase`, `strokeKeys`, `isStrokeKeyOf` (functions) |
| `shapes.ts` | 249 | `Fields`, `ShapeVersion`, `Registry` (types); `SHAPES_REVISION`, `DEFAULT_SIM_NAME`, `WHERE_ROWS`, `REGISTRY` (consts); `checkName`, `versionAt`, `readFields`, `upgradeFields`, `upgradeSet` (functions) |
| `items.ts` | 212 | `Item`, `Flat` (interfaces); `flatten`, `assemble`, `parentOf`, `listOf`, `isEndable`, `keyFits`, `toLogForm`, `rulesetText` (functions) |
| `state.ts` | 362 | `DEFER_STROKES` (unique symbol const), `LogState` (class), `fold` (function) |
| `check.ts` | 42 | `RulesetProblem` (interface), `checkRuleset` (function) |
| `diff.ts` | 134 | `diff` (function) |
| `reapply.ts` | 188 | `DropReason`, `Dropped`, `Reapplied` (types); `reapply` (function) |
| `history.ts` | 42 | `HistoryEntry`, `UndoRedo` (interfaces); `undoRedo` (function) |
| `chain.ts` | 52 | `GENESIS_HASH` (const); `commitText`, `chainHash`, `verifyChain` (functions) |

Non-spec test-folder files (fakes/fixtures only): `sim-log/test/fixtures.ts` (177), `sim-log/test/arbitraries.ts` (324).

Importers outside `sim-log/`:
- V `src/lib/server/db/schema/simControlPlane.ts:2`, `server/sim-object/decide.ts:1`, `index-runner.ts:4`, `index-sync.ts:5`, `log-host.ts:14`, `open-params.ts:3`, `store.ts:3`, `test/drafts.ts:9`, `test/harness.ts:4`, `server/sims/rename.ts:6`, `server/sims/start-sim.ts:4`
- V `sim-store/history.ts:1`, `sim-store/sim-db.ts:1`, `sim-store/local-log.ts:1-17`, `sim-store/types.ts:1`, `sim-store/idb.ts:7`, `sim-store/author.ts:1-14`, `sim-store/log-store.svelte.ts:7`
- V `sim-sync/ports.ts:1`, `sim-sync/sim-socket.ts:5`, `sim-stream/protocol.ts:3`
- V `e2e/helpers/sim-socket.ts:5` (`../../src/lib/sim-log/types`)
- Specs: many under `src/lib/server/**` and `src/routes/api/**` (listed by grep; e.g. `server/sim-object/log-host.spec.ts`, `routes/api/sims/server.spec.ts`).

### 1.2 `sim-store/` (browser store; 8 modules)

| Module | Lines | Exports |
|---|---|---|
| `types.ts` | 39 | `Stamp`, `Pending`, `DropWhy`, `DropReport`, `Align`, `Stopped` (types); `MOVE_SOURCE`, `MOVE_LABEL` (consts) |
| `dataset.ts` | 13 | `DatasetDecision` (type); `datasetDecision` (function) |
| `history.ts` | 72 | `LabelledEntry`, `HistoryTarget` (interfaces); `History` (class) |
| `author.ts` | 227 | `SOURCES`, `PENDING_MAX`, `PENDING_BYTES_MAX` (consts); `Refusal`, `Meta`, `Authored` (types); `clampLabel`, `authorEdit`, `authorRestore`, `authorMove`, `nextTarget` (functions) |
| `local-log.ts` | 815 | `CHECKPOINT_SPACING`, `CHECKPOINTS_MAX`, `PENDING_CHECKPOINT` (consts); `LocalLogInit`, `Received`, `Reapplied`, `Adopted` (types); `LocalLog` (class) |
| `sim-db.ts` | 248 | `SimRecord`, `PendingRecord`, `SimRead`, `PendingPut`, `WriteBatch`, `Marker`, `WriteResult`, `CreateResult`, `SimDb` (interfaces); `CURRENT_KEY`, `nKey`, `isReservedKey` (consts); `memorySimDb` (function) |
| `idb.ts` | 332 | `SIM_DB_NAME`, `SIM_DB_VERSION` (consts); `upgradeSimDb`, `openSimDb` (functions) |
| `log-store.svelte.ts` | 1160 | `DocStore`, `LogStoreOptions`, `ImportMarker` (interfaces); `Registration`, `LocalStatus`, `EditRefusal`, `ImportResult`, `StoreReceived` (types); `LogStore` (class) |

Test-folder files: `sim-store/test/commits.ts` (99), `sim-store/test/sim-db-contract.ts` (717).

Importers outside `sim-store/`:
- V `sim-sync/ports.ts:2-3` (type-only: `LocalStatus`, `Registration`, `StoreReceived` from log-store; `Stopped` from types), `sim-sync/save-state.ts:5-6` (type-only), `sim-sync/sim-sync.svelte.ts:7` (type-only `SimDb`).
- V No other non-test importer in `src` or `e2e` (grep, section 0.1). No spec outside the directory imports it either (grep of `.spec.ts` importers lists none for `sim-store`).

### 1.3 `sim-sync/` (socket client, registration, tabs; 7 modules)

| Module | Lines | Exports |
|---|---|---|
| `backoff.ts` | 13 | `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS`, `BACKOFF_JITTER` (consts); `backoffDelay` (function) |
| `ports.ts` | 156 | `Clock`, `SocketEventLike`, `SocketLike`, `LocksLike`, `ChannelLike`, `NetSignals`, `SyncStore`, `BrowserPorts` (interfaces); `SocketCtor`, `NetEvent` (types); `realClock`, `TAB_CHANNEL` (consts); `browserPorts`, `errorName` (functions) |
| `register.ts` | 132 | `REGISTER_LOCK`, `REGISTER_TIMEOUT_MS` (consts); `RegisterAnswer` (type); `registerAnswerOf`, `registerSim` (functions); `RegisterGate` (class) |
| `save-state.ts` | 92 | `RegState`, `SaveKind`, `SaveWhy` (types); `SaveInput`, `SaveState` (interfaces); `saveState` (function) |
| `sim-socket.ts` | 784 | `HELLO_TIMEOUT_MS`, `PING_MS`, `OFF_VIEW` (consts); `SocketPhase`, `Halt`, `Hold` (types); `SocketView`, `SimSocketOptions` (interfaces); `SimSocket` (class) |
| `tabs.ts` | 187 | `TAB_CHANNEL` (re-export), `TAB_LOCK_PREFIX` (const); `TabPresence` (class) |
| `sim-sync.svelte.ts` | 500 | `SimSyncOptions`, `SyncState` (interfaces); `SimSync` (class) |

Test-folder files (fakes): `sim-sync/test/fakes.ts` (393), `test/hub.ts` (771; `FakeHub`, mimics the sim object), plus `fakes.spec.ts`, `hub.spec.ts`.

Importers outside `sim-sync/`: V none (non-spec or spec).

### 1.4 `sim-stream/` (wire protocol and limits; 3 modules)

| Module | Lines | Exports |
|---|---|---|
| `protocol.ts` | 79 | `PROTOCOL`, `PING`, `PONG`, `CLOSE_BINARY`, `CLOSE_MALFORMED`, `CLOSE_INTERNAL`, `CLOSE_GONE` (consts); `RefusedWhy`, `ServerFrame`, `ClientFrame`, `ParsedClientFrame` (types); `parseClientFrame`, `encodeFrame`, `commitsFrame` (functions) |
| `limits.ts` | 58 | `Limits` (interface); `LIMITS`, `STAMP_MAX` (consts); `utf8Bytes`, `overFrameLimit`, `fitsCommit` (functions) |
| `register.ts` | 18 | `RegisterCode` (type); `RegisterOk`, `RegisterError` (interfaces) |

Importers outside `sim-stream/`:
- V Browser-side: `sim-store/local-log.ts:19` and `sim-store/author.ts:15` (`LIMITS, fitsCommit, utf8Bytes, Limits`); `sim-sync/sim-socket.ts:6-14` (`CLOSE_GONE, PING, PONG, PROTOCOL, encodeFrame, RefusedWhy, ServerFrame`); `sim-sync/register.ts:4` (`RegisterCode`).
- V Server: `server/sim-object/decide.ts:2`, `log-host.ts:15`, `object-rules.ts:12`, `sim-object.ts:20`, `limits.ts:10`; `server/sims/start-sim.ts:5`; `routes/api/sims/+server.ts:4`.
- V `e2e/helpers/sim-socket.ts:6`.

### 1.5 `members/` (UI and copy; 6 modules + 5 spec files)

| Module | Lines | Exports / kind |
|---|---|---|
| `copy.ts` | 137 | consts `MAX_SIMS_PER_MANAGER`, `SIM_TITLE_MAX`, `SIMS_COPY`, `MEMBERS_COPY`, `MEMBER_ERROR_COPY`; type `MemberErrorCode`; functions `titleTooLong`, `nameTooLong`, `isMemberErrorCode`, `memberErrorText`, `membersRemoveConfirm`, `membersRevokeConfirm`, `inviteHeading`, `invitationsRow`, `invitationsAcceptNamed`, `invitationsDeclineNamed`, `inviteMultiple`, `membersSummaryCount`, `membersRemoveNamed`, `membersResendNamed`, `membersRevokeNamed` |
| `invite-banner.ts` | 48 | `PendingInvite`, `BannerModel` (interfaces); `BannerActionId` (type); `inviteBannerModel` (function) |
| `membership-overlay.svelte.ts` | 100 | `OverlayInvite` (interface); `MembershipOverlay` (class) |
| `InviteBanner.svelte` | 77 | component |
| `InvitationsList.svelte` | 82 | component |
| `MembersPanel.svelte` | 227 | component |
| `LeaveSimConfirm.svelte` | 199 | component |

Importers outside `members/` (all `members/copy` unless noted):
- Server: `server/invites/control-plane.ts:19`, `server/invites/error-code.ts:1`, `server/onboarding/pseudonymous-mint.ts:6`, `server/security/same-origin-json.ts:2`, `server/sim-object/open-params.ts:2`, `server/sims/sim-quota.ts:2,5`, `server/sims/start-sim.ts:3`
- Routes: `src/routes/api/invites/[inviteId]/accept/+server.ts:3`, `.../decline/+server.ts:3`, `src/routes/api/sims/[simId]/invites/[inviteId]/resend/+server.ts:12`, `src/routes/api/sims/[simId]/invites/+server.ts:6`, `src/routes/api/sims/+server.ts:3`, `src/routes/invite/[token]/+page.svelte:5`, `src/routes/sims/[simId]/+page.server.ts:8`, `src/routes/sims/[simId]/+page.svelte:5 (MembersPanel), :12 (copy), :13 (membership-overlay)`, `src/routes/sims/+layout.svelte:4 (InviteBanner)`, `src/routes/sims/+page.svelte:5 (InvitationsList), :6 (copy)`
- Core: `sim-log/shapes.ts:1` (`SIM_TITLE_MAX`)
- E2E: `e2e/helpers/account.ts:4`, `e2e/helpers/members.ts:10`

---

## 2. `sim-log`

### 2.1 Types (verbatim, `sim-log/types.ts`)

```ts
// types.ts:4-15
export type Change =
  | {
      op: 'add';
      key: string;
      shape: string;
      fields: Record<string, unknown>;
      after?: string | null;
    }
  | { op: 'end'; key: string; to: Day }
  | { op: 'move'; key: string; after: string | null }
  | { op: 'set'; key: string; field: string; value: string | number | boolean | null }
  | { op: 'delete'; key: string };
export type CommitKind = 'edit' | 'restore' | 'system';
export interface Restores {
  position: number;
  as: 'undo' | 'redo' | 'jump';
}
// types.ts:22-40
export interface CommitDraft {
  id: string;
  parent: number;
  kind: CommitKind;
  label: string;
  restores: Restores | null;
  datasetVersion: string;
  shapes: number;
  build: string;
  source: string;
  changes: Change[];
}
export interface Commit extends CommitDraft {
  seq: number;
  actor: string;
  at: number;
  hash: string;
}
export type FoldInput = Pick<CommitDraft, 'changes' | 'shapes' | 'datasetVersion'>;
export interface RulesetContent { name: string; policy: SimPolicy4; }
export interface Ruleset extends RulesetContent { datasetVersion: string | null; }
export type LogErrorCode = 'invalid-change' | 'invalid-ruleset' | 'future-shapes';
```

### 2.2 Shape registry (V `sim-log/shapes.ts:176-186`, `:33-45`, `:29`)

`REGISTRY.current = SHAPES_REVISION = 1`; `revisions: { 1: <every shape name -> version 1> }`. Every shape has exactly one version (`[simShape]`, `[strokeShape]`, one `policyShape`/`spanShape` per row).

| Shape name | Item key form (`sim-log/keys.ts`) | Fields (shapes.ts) | Settable by `set` |
|---|---|---|---|
| `sim` | `sim` (`NAME_KEY`, keys.ts:6) | `name` | `name` (`checkName`: trimmed, 1..63 chars, shapes.ts:91, 97-103) |
| `policy.transit` / `policy.painted` / `policy.category` / `policy.routes` / `policy.baseline` / `policy.fund` / `policy.terms` | `p:<policy id>` (keys.ts:7) | `id, kind, where, label, preset, on` (shapes.ts:108) | `label`, `on` (shapes.ts:121-124) |
| `span.transit` / `span.painted` / `span.category` / `span.routes` / `span.baseline` / `span.fund` / `span.terms` | `s:<from day>:<policy id>` (keys.ts:8) | `policy, from, to, what` (shapes.ts:131) | none (`settable: {}`); `end` op sets `to` (items.ts:187 `isEndable`) |
| `stroke` | `k:` + digest128(canonicalJson of `{span, brush, kind, stories, path, radiusM}`) (keys.ts:24-27); n-th repeat gets suffix `~n`, n >= 2 (keys.ts:30-38) | `span, brush, kind, stories, path, radiusM` (shapes.ts:147) | none |

The seven policy rows are `WHERE_ROWS` (shapes.ts:33-45): zoning/transit/bands, zoning/painted/brushes, zoning/category/protect, permitting/routes/timing, money/baseline/scales, money/fund/fund, money/terms/terms.

List keys (ordered lists, not items): `l:<owner>` (keys.ts:49): `l:zoning`, `l:permitting`, `l:money` hold policy keys (items.ts:58); `l:<span key>` holds that span's stroke keys (items.ts:92). Parent roles: span -> `policy.*` item, stroke -> its `span` key (items.ts:177-181).

### 2.3 Entry points (signatures verbatim)

```ts
// state.ts:358
export function fold(commits: readonly FoldInput[], registry: Registry = REGISTRY): Ruleset
// state.ts:94  (method of class LogState; atomic, journaled rollback)
apply(input: FoldInput, opts: { check?: boolean } = {}, mode?: typeof DEFER_STROKES): void
// state.ts:64, :68
static empty(registry: Registry = REGISTRY): LogState
static of(r: RulesetContent, datasetVersion: string | null, registry: Registry = REGISTRY): LogState
// LogState other methods: ruleset(): Ruleset (131), item(key) (138), list(listKey) (143), clone() (147)
// diff.ts:37
export function diff(a: RulesetContent, b: RulesetContent): Change[]
// reapply.ts:148
export function reapply(tip: LogState, input: FoldInput): Reapplied
// reapply.ts:7-17
export type DropReason = 'gone' | 'exists' | 'not-truncation' | 'no-op';
export type Reapplied =
  | { ok: true; changes: Change[]; dropped: Dropped[] }
  | { ok: false; why: 'empty' | 'invalid'; dropped: Dropped[] };
// history.ts:15
export function undoRedo(log: readonly HistoryEntry[]): UndoRedo   // { undo: number | null; redo: number | null }
// check.ts:20
export function checkRuleset(r: Ruleset): RulesetProblem | null
```

- V Fold = replay `LogState.empty()` then `apply` each commit (state.ts:358-362). `LogState.empty()` starts from `{ name: DEFAULT_SIM_NAME, policy: DEFAULT_POLICY4 }` (state.ts:65), so an empty log folds to the default policy, not to nothing.
- V `diff` flattens both rulesets to items+lists and emits adds, ends, moves, sets, deletes (diff.ts:37-134, read to line 60 only; see appendix).
- V There is no undo/redo "apply" in `sim-log`: `undoRedo` only derives target positions (history.ts:15). A restore is an ordinary commit whose `changes` are `diff(current, target)` and which carries `restores: {position, as}`.

### 2.4 Hash chain (V `sim-log/chain.ts`)

```ts
// chain.ts:5, :24, :32, :38
export const GENESIS_HASH = '0'.repeat(64);
export function commitText(c: Omit<Commit, 'hash'> | Commit): string   // canonicalJson of every field but `hash`
export function chainHash(prevHash: string, c: Omit<Commit, 'hash'> | Commit): Promise<string>  // sha256Hex(prevHash + commitText(c))
export async function verifyChain(commits: readonly Commit[], prev = { seq: 0, hash: GENESIS_HASH }): Promise<number | null>
```
Hashed: every field of the stored commit except `hash` (so `id, parent, kind, label, restores, datasetVersion, shapes, build, source, changes, seq, actor, at`), canonical JSON, prefixed by the previous hash. TypeError on `undefined` or non-finite numbers (chain.ts:7-18). Only callers: server `log-host.ts:394` and a server test harness (`server/sim-object/test/harness.ts:26`). No browser caller (grep `verifyChain|chainHash`).

### 2.5 Parsing and limits (V)
`parseCommitDraft(v)` (parse.ts:174) requires keys `DRAFT_KEYS`; `parseCommit` (parse.ts:178-189) additionally requires `seq, actor (1..64 chars), at, hash (64 hex)` and `parent === seq - 1`. Draft checks: `datasetVersion` regex, `shapes >= 1`, `build` 1..`BUILD_MAX`(64), `source` matches `SOURCE_RE`, `changes` non-empty (parse.ts:160-172). Constants: `LABEL_MAX = 200, BUILD_MAX = 64, KEY_MAX = 256, SOURCE_MAX = 64` (types.ts:72-76).

---

## 3. `sim-store`

### 3.1 Public surfaces (verbatim)

`DocStore` (log-store.svelte.ts:43-54):
```ts
export interface DocStore {
  readonly policy: SimPolicy4;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  apply(change: (p: SimPolicy4) => SimPolicy4, label: string, coalesce?: string): void;
  /** Returns the label of the change undone, at once, or null. */
  undo(): string | null;
  redo(): string | null;
  undoTo(p: SimPolicy4, label: string): void;
}
```

`LogStoreOptions` (log-store.svelte.ts:56-79): `db: SimDb | null` (null = storage unavailable), `tabId: string`, `stamp: () => Stamp`, optional `mintId`, `normalize(next, prev)`, `align: Align`, `now`, `current?: boolean` (default true), `caps`.

`LogStore implements DocStore` (log-store.svelte.ts:147). Getters (V lines 232-299): `ready, simId, policy, name, canUndo, canRedo, undoLabel, redoLabel, local, drafting, pendingCount, pending, stopped, tipSeq, heldCount, registration, serverDataset, drops, refusal`. Methods (V): `apply(change, label, coalesce?, source = SOURCES.edit): boolean` (:~305), `undo(): string | null` (350), `redo()` (354), `undoTo(p, label)` (362), `rename(name)` (389), `settle()` (403), `clearDrops()` (409), `open(simId: string | null, opts?: { claim?: readonly string[] }): Promise<void>` (418), `claim(owners: readonly string[]): Promise<number>` (426), `importContent(content, marker, label = 'Imported'): Promise<ImportResult>` (527), `setServerDataset(s: string)` (567), `receive(simId: string, commits: readonly Commit[]): StoreReceived` (584), `head(): CommitDraft | null` (603), `dropPending(id)` (617), `written(): Promise<void>` (634), `markRegistered(simId): Promise<void>` (644), `subscribe(fn): () => void` (665).

Types (verbatim, log-store.svelte.ts:81-95; types.ts:35):
```ts
export type Registration = 'none' | 'wait' | 'needed' | 'done';
export type LocalStatus = 'idle' | 'writing' | 'failed';
export type EditRefusal = 'invalid' | 'too-large' | 'queue-full' | 'stopped';
export type ImportResult = 'imported' | 'unchanged' | 'marker' | 'stopped' | EditRefusal;
export type StoreReceived = Received | { kind: 'stale'; why: 'other-sim' | 'not-ready' };
export type Stopped = 'future' | 'stale' | 'unknown-dataset';
```

`LocalLog` (local-log.ts:156): constructor `new LocalLog(init: LocalLogInit)` (:202) with `LocalLogInit { confirmed, pending, registry?, align?, serverDataset?, build?, page?, limits? }` (:38-60). Members: `initialDrops`, `initialConfirmed`, getters `tipSeq, confirmed, pending, held, pendingBytes, position, future, serverDataset`; methods:
```ts
setServerDataset(s: string | null): Reapplied      // 272
ruleset(): Ruleset                                  // 289
rulesetAt(position: number): Ruleset                // 294
idAt(position: number): string | null               // 308
positionOf(id: string | null): number | null       // 316
history(): History                                  // 325
push(p: Pending): void                              // 334
receive(commits: readonly Commit[]): Received       // 356
drop(id: string): DropReport[]                      // 401
forget(ids: readonly string[]): Reapplied           // 413
adopt(pending: readonly Pending[]): Adopted         // 429
```
```ts
// local-log.ts:62-69
export type Received =
  | { kind: 'applied'; changed: boolean; drops: DropReport[] }
  | { kind: 'stale' }
  | { kind: 'gap'; after: number; changed: boolean; drops: DropReport[] }
  | { kind: 'future'; changed: boolean; drops: DropReport[] };
```
Pure class: "no I/O, no runes" (local-log.ts doc comment, :150 region).

`Pending` / `Stamp` / `DropReport` (types.ts:4-26): `Stamp {datasetVersion, build}`; `Pending {draft: CommitDraft; targetId: string | null}`; `DropReport {id, label, whole, why: DropWhy | null, dropped: Dropped[]}`; `DropWhy = 'empty' | 'invalid' | 'too-large' | 'target-gone'`.

### 3.2 IndexedDB (V `sim-store/idb.ts`, `sim-db.ts`)

- DB name `sfhousing-sim-log`, version 1 (idb.ts:22-23). Opened by `openSimDb`; returns null when IndexedDB is missing, open fails, or blocked (idb.ts:69-100). A newer version opened elsewhere closes this connection and calls `onVersionChange` (idb.ts:~104).
- Object stores (idb.ts:25-29, 42-52):
  - `sims`: keyPath `simId`; row `SimRecord {simId, createdAt, registered}` (sim-db.ts:4-9)
  - `commits`: keyPath `[simId, seq]`; row `{simId, seq, commit}` (confirmed commits only)
  - `pending`: keyPath `[simId, id]`, unique index `order` on `[simId, n]`; row `PendingRecord {simId, id, n, owner, pending}` (sim-db.ts:14-20)
  - `meta`: keyPath `key`; row `{key, value}`. Reserved keys: `current` (`CURRENT_KEY`) and any `n:<simId>` (per-sim counter for `n`) (sim-db.ts:99-102). Other meta keys are caller markers (compare-and-set, sim-db.ts:50-54).
- `SimDb` interface (verbatim, sim-db.ts:69-97): `read, createSim, write, claimPending, pendingOwners, setRegistered, getMeta, setMeta, close`. `memorySimDb` (sim-db.ts:159) implements the same semantics in memory (used by tests; also exported).
- `meta.current`: "a sim this store creates is made `meta.current` if none is" (log-store.svelte.ts:66-67; `createSim(..., {current})` sim-db.ts:191-196). If another tab already holds it: outcome `'current-taken'` and the store `#adoptCurrent`s that sim (log-store.svelte.ts:983-993, 1073-1085).

### 3.3 "Pending" and "drafts"
- **Pending** (V): a commit authored in this tab and not yet confirmed by the server: `Pending {draft, targetId}` (types.ts:10-14). Held in `LocalLog.#pending`, re-applied on the confirmed tip after every change so `pending[i].draft.parent === tipSeq + i` (local-log.ts:~145-152 doc comment, `#reapply` 564). Persisted as `pending` rows with `owner = tabId` (sim-db.ts:14-20). `head()` returns the first pending draft only once the exact version is in IndexedDB (log-store.svelte.ts:603-615). Limits: `PENDING_MAX = 1_000`, `PENDING_BYTES_MAX = 8 MiB` (author.ts:32-34); refusal `'queue-full'`. A pending commit leaves the list when the server echoes it (`#echoes`/`#popEchoes`, local-log.ts:541-553; echo = `draftText` equality) or on an `invalid` refusal (`dropPending`).
- **Held** (V): pending commits not in force: after a newer-build commit (`#heldFuture`) or after a restore/move `align` could not reach (`#heldDataset`) (local-log.ts:176-181, 242).
- **Drafts** (V): `LogStore.#draft` is in-memory only: a run of coalesced edits (same `coalesce` key) that becomes one commit when settled (log-store.svelte.ts:98-104 `interface Draft`, `apply` 305-348, `settle()` 403). Settled by: another action, a foreign commit arriving (`receive`, log-store.svelte.ts:588-591), `open`, `claim`, `dropPending`, `setServerDataset`. Not written to IndexedDB until settled into a pending commit (doc: sim-store.md:173, I did not re-verify the pagehide caller because no page calls it).

### 3.4 The dataset rule (V `sim-store/dataset.ts`)
```ts
export type DatasetDecision =
  { kind: 'edit' } | { kind: 'move' } | { kind: 'stop'; why: 'stale' | 'unknown-dataset' };
export function datasetDecision(page: string, fold: string | null, server: string | null): DatasetDecision {
  if (fold === null || fold === page) return { kind: 'edit' };
  if (server === null) return { kind: 'stop', why: 'unknown-dataset' };
  return server === page ? { kind: 'move' } : { kind: 'stop', why: 'stale' };
}
```
`page` = `stamp().datasetVersion`, `fold` = the dataset of the last commit folded, `server` = the dataset from the socket's `hello` (null until one) (log-store.svelte.ts:692-696, 567-581). `#stoppedNow()` (log-store.svelte.ts:698-710): `'future'` if the log saw a newer-build commit; `'unknown-dataset'`/`'stale'` if anything is held; `'stale'` if a move was refused; else the dataset decision's `stop` reason. While stopped the store authors nothing.

### 3.5 Restore commits and moves (V)
- Undo/redo/jump author a `kind: 'restore'` commit: `authorRestore(log, position, as, meta, align)` (author.ts:153-175): `changes = diff(log.ruleset(), ruleset at position)` (aligned to the stamp's dataset if it is on another), `restores = {position, as}`, `targetId = log.idAt(position)`. Refusals `'unchanged'` (empty diff), `'invalid'`.
- `SOURCES` (author.ts:21-29): `edit: 'sim.edit', undo: 'sim.undo', redo: 'sim.redo', revert: 'sim.revert', move: 'sim.dataset', name: 'sim.name', import: 'sim.import'`.
- Move commit: `kind: 'system'`, source `MOVE_SOURCE = 'sim.dataset'`, label `MOVE_LABEL = 'Moved to new data'` (types.ts:38-39), changes `diff(fold, align(fold, to))` (author.ts:181-197). Authored before an edit when the decision is `move` (`#prepare`, log-store.svelte.ts:730-746), and by `#alignStep` (833-860) and `LocalLog.#leadMove` (local-log.ts:703).
- Re-apply of a restore: on every re-walk the restore's diff is recomputed from its `targetId`'s position (local-log.ts:~775-795); target gone gives drop `'target-gone'`.

---

## 4. `sim-sync`

### 4.1 Registering a sim (V)
- Call: `registerSim(fetchFn, simId, clock)` (register.ts:68-89): `POST /api/sims`, `content-type: application/json`, body `{simId}`, same-origin default credentials, aborted after `REGISTER_TIMEOUT_MS = 30_000`. A thrown/aborted fetch is `{kind:'retry'}`.
- Answer mapping `registerAnswerOf` (register.ts:37-59), verbatim type:
```ts
export type RegisterAnswer =
  | { kind: 'ok'; created: boolean }
  | { kind: 'sign-in' } | { kind: 'taken' } | { kind: 'quota' } | { kind: 'retry' }
  | { kind: 'bug'; status: number; code: RegisterCode | null };
```
  200/201 with matching `simId` and boolean `created` is `ok`; 401 `sign-in`; 403 with code `quota` `quota`; 409 `taken`; 429 or 5xx `retry`; else `bug`.
- When it fires: `SimSync.#evaluate` (sim-sync.svelte.ts:257-286). Preconditions, all V: `o.live` true, no `open` under way, `store.simId !== null`, `store.ready`, `store.registration === 'needed'` (not `done`/`none`/`wait`), `this.#reg` not in `HOLDING`, and `store.pendingCount > 0 || store.heldCount > 0` (lines 262, 278-281). One request at a time per browser through `RegisterGate` (Web Lock `sfh-register`, register.ts:7, 96-132; falls back to a promise chain in this tab when `locks` is null).
- `store.registration` rules (log-store.svelte.ts:284-292): `'none'` if no sim; `'done'` if recorded registered; `'needed'` if the sim is stored on the device and not registered; `'wait'` if minted here, storage working, first write not landed; else `'needed'`; otherwise `'none'` (a "look": a sim with no record on this device that this store did not mint).
- Signed in? **No client-side check.** Nothing in `sim-sync`, `sim-store` or `sim-stream` reads a user or session. The browser posts; the server decides. V `src/routes/api/sims/+server.ts:35-38`: a signed-out visitor on a *known device* (`isKnownDevice(cookies)`) gets 401 `sign_in`; otherwise the call proceeds to `startSim` (server-side; the comment at register.ts:63-66 says a lost response "may have created a pseudonymous account on the server"). I did not read `startSim` (server/sims/start-sim.ts) in full. Client effect of 401: `RegState 'sign-in'` (sim-sync.svelte.ts:393-396), and `retryRegistration()` re-posts from `sign-in|quota|taken|failed|retrying` (sim-sync.svelte.ts:46-53, 219-225).
- `RegState` verbatim (save-state.ts:9-19): `'idle' | 'none' | 'waiting' | 'registering' | 'retrying' | 'sign-in' | 'taken' | 'quota' | 'failed' | 'done'`.
- After `ok`: `store.markRegistered(sim)` (sim-sync.svelte.ts:381; sets in-memory `#registered`, then `db.setRegistered`), and a socket that existed and cannot write is `reconnect()`ed (383-385).

### 4.2 Socket client `SimSocket` (V sim-socket.ts)
- URL: `${origin with http->ws}/api/sims/${encodeURIComponent(simId)}/stream` (streamUrl, :~140).
- Client sends (via `encodeFrame` and `s.send`):
  - `{ type: 'resume', after: store.tipSeq }` (sim-socket.ts:423, in `#resume`)
  - `{ type: 'append', commit: store.head() }` (sim-socket.ts:618, in `#trySend`; only when phase `live`, caught up, nothing in flight, no hold/halt, `write === true`)
  - the text `'ping'` (`PING`, :708) every `PING_MS = 30_000` while visible; expects `'pong'` (`PONG`) within `HELLO_TIMEOUT_MS = 10_000` (liveness deadline).
- Client handles (`#onMessage`, :351-381). Frame types (sim-stream/protocol.ts:19-23):
```ts
export type ServerFrame =
  | { type: 'hello'; build: string; protocol: number; dataset?: string }
  | { type: 'access'; write: boolean }
  | { type: 'commits'; commits: Commit[]; more?: boolean }
  | { type: 'refused'; id: string | null; why: RefusedWhy };
export type RefusedWhy = 'behind' | 'invalid' | 'newer' | 'not-writer' | 'limit' | 'full' | 'gone';
export type ClientFrame =
  { type: 'resume'; after: number } | { type: 'append'; commit: CommitDraft };
```
  - `hello`: `PROTOCOL` mismatch halts `'protocol'`; else `store.setServerDataset(f.dataset)`, phase `catching-up`, sends resume (:383-402). A second `hello` is ignored; nothing is read before `hello` (:360-363).
  - `access {write}`: sets `view.write`; `write: true` lifts a `not-writer` hold; then `#trySend()` (:366-372).
  - `commits {commits, more}`: `store.receive(simId, commits)` (:~470); `more: true` resumes from the tip; `more: false` caught up; `future` stalls; throw halts `'broken'`; a frame holding the in-flight id clears it.
  - `refused`: with `id === null` it answers the resume (`gone` halts `'diverged'`; `limit` backs off with `backoffDelay`); with an id it is an append refusal (`#onAppendRefused`, :630-678): `gone` halts, `not-writer|full|newer` hold, `limit` hold + backoff, `invalid` -> `store.dropPending(id)`, `behind` -> resume or resend.
  - Close code `CLOSE_GONE` (4410) halts `'gone'` (:334); other closes retry with backoff (:335).
  - Network signals: `online/offline/visible/hidden` via `NetSignals` (:739-770).
- Views (verbatim, sim-socket.ts:33-50):
```ts
export type SocketPhase = 'off' | 'connecting' | 'catching-up' | 'live' | 'offline' | 'waiting' | 'halted';
export type Halt = 'gone' | 'diverged' | 'protocol' | 'broken';
export type Hold = 'not-writer' | 'limit' | 'full' | 'newer';
export interface SocketView { phase: SocketPhase; halt: Halt | null; hold: Hold | null; write: boolean | null; serverBuild: string | null; inFlight: string | null; }
```

### 4.3 Tabs and claims (V)
- Mechanism: **Web Locks + BroadcastChannel** (`tabs.ts`, `ports.ts`).
  - Each tab holds Web Lock `sfh-tab:<tabId>` for its life (`TAB_LOCK_PREFIX`, tabs.ts:7; request at :84-87).
  - BroadcastChannel `sfh-sim` (`TAB_CHANNEL`, ports.ts:59; made in `browserPorts()` ports.ts:119-121) carries only `{ type: 'here', tabId, reply: boolean }` (tabs.ts:10-14). A tab announces itself once its lock is held; each tab that hears it `watch()`es the other's lock (waits for it to be free) and answers (tabs.ts:180-186).
  - `goneOwners(owners)` reads `locks.query()` and reports owners whose lock is not held (tabs.ts:109-115). `watch(owner)` fires `onGone` when the lock frees (tabs.ts:121-142).
  - Separate Web Lock `sfh-register` serialises registration across tabs (register.ts:7).
- Claims: pending records are owned by `tabId` (`PendingRecord.owner`, sim-db.ts:17). `SimSync.#openInTurn` (sim-sync.svelte.ts:185-207) lists `db.pendingOwners(simId)`, asks `presence.goneOwners`, and calls `store.open(simId, {claim: gone})`, which runs `db.claimPending(simId, claim, tabId)` (log-store.svelte.ts:463-468); live owners are watched and claimed on `onGone` via `store.claim([owner])` (sim-sync.svelte.ts:210-216). `LocalLog.adopt` re-applies claimed commits after this tab's own (local-log.ts:429-449). A put of a record another tab took comes back `lost` and is `forget`-ed (log-store.svelte.ts:1036-1047).
- With no Web Locks (`locks === null`): every owner but this tab counts as gone, asked at open only; nothing is watched (tabs.ts:109-111; sim-sync.svelte.ts:205).

### 4.4 Save state (V save-state.ts:32-57)
```ts
export type SaveKind = 'saved' | 'saving' | 'device' | 'unsaved';
export type SaveWhy =
  | 'dev' | 'offline' | 'unreachable' | 'sign-in' | 'taken' | 'quota' | 'register-failed'
  | 'no-write' | 'full' | 'newer' | 'gone' | 'diverged' | 'protocol' | 'broken'
  | 'stale' | 'future' | 'unknown-dataset';
export interface SaveState { kind: SaveKind; why: SaveWhy | null; }
```
Derivation `saveState(i: SaveInput)` (save-state.ts:59-92): `saved` when `pendingCount === 0 && heldCount === 0`; else `saving` when nothing blocks or `local === 'writing'`; else `unsaved` if `local === 'failed'` else `device`. `blocked()` precedence: socket halt, socket hold `full|newer`, `stopped` `stale|future`, `stopped unknown-dataset` while live, `!live` -> `'dev'`, registration `sign-in|taken|quota|failed|retrying`, hold `not-writer` or `write === false` -> `'no-write'`, phase `offline`, phase `waiting|off` -> `'unreachable'`.
Readers: only `SimSync.#next()` (sim-sync.svelte.ts:456-464) which publishes `SyncState {live, registration, socket, buildMismatch, save}` as `sync.state` (rune, :92). V no other file reads `SaveState`, `SaveKind` or `SaveWhy` (grep; `SaveIndicator.svelte` in `sharing/` uses its own `SaveStatus = 'saved' | 'saving' | 'off'`, `sharing/autosave.svelte.ts:12`).

### 4.5 "The dev rule"
- V Option `live: boolean` on `SimSyncOptions` ("False under npm run dev: nothing is fetched or opened", sim-sync.svelte.ts:21-22). Effects: `#evaluate` does nothing socket/registration-wise unless `o.live` (:262); `saveState` returns why `'dev'` when `!live` (save-state.ts:74). Doc names it S7 "Dev sends nothing" (`docs/dev/sim-sync.md:33`), `live = !dev` from `$app/environment` (`docs/dev/sim-sync.md:60`).
- I Nothing in code sets `live` from `dev`: no file constructs `SimSync` (section 0.1), and `sim-sync/` does not import `$app/environment` (grep). The rule is a caller contract.
- "The dataset rule" is a different thing (section 3.4).

---

## 5. `sim-stream`
- V What it is: three dependency-light modules shared by server and browser: the websocket frame types and codec (`protocol.ts`), size limits (`limits.ts`), and the answer shape of `POST /api/sims` (`register.ts`). Header comment `protocol.ts:1-2`, `limits.ts:1-2`, `register.ts:1-2`.
- V `LIMITS` (limits.ts:16-28): `commitBytes 1_048_576, frameBytes 1_052_672, simCommits 100_000, simBytes 67_108_864, burst 120, perSecond 2, sendBytes 1_048_576, resumeBytes 8_388_608`. `fitsCommit(draft)` = utf8 bytes of JSON + `STAMP_MAX (1024)` <= `commitBytes`.
- Users: browser `sim-store/local-log.ts:19`, `sim-store/author.ts:15`, `sim-sync/sim-socket.ts:6-14`, `sim-sync/register.ts:4`; server `server/sim-object/{decide.ts:2, log-host.ts:15, object-rules.ts:12, sim-object.ts:20, limits.ts:10}`, `server/sims/start-sim.ts:5`, `routes/api/sims/+server.ts:4`; `e2e/helpers/sim-socket.ts:6`.
- The name is a misnomer for browser-only purposes: it has no browser runtime state; it is wire contract.

## 6. `members`
All V unless marked.

| File | What it renders / does | Mounted by |
|---|---|---|
| `InviteBanner.svelte` | One banner on `/sims/*` routes for pending invitations addressed to the signed-in user: Accept / Decline / Not now (one invite) or View / Not now (several). POSTs `/api/invites/<id>/accept|decline` (:34-39). Props `invites, path, onaccepted, onview` | `src/routes/sims/+layout.svelte:4` (import), mounted `:11` |
| `invite-banner.ts` | `inviteBannerModel(invites, currentPath)`: builds the banner model; suppressed on path `/sims` (:20, 27) | `InviteBanner.svelte:4` |
| `InvitationsList.svelte` | Invitations section on the sims list: row per invite with Accept/Decline (same POSTs, :26-43). | `src/routes/sims/+page.svelte:5` (import), mounted `:19` |
| `MembersPanel.svelte` | Member list (handle, role), pending invites with Resend/Revoke, Remove with in-place confirm, invite-by-email-or-handle input; props `members, isManager, canInviteByEmail, pending, currentUserId, simId, simTitle, enhance, onInvite, onRemove, onResend, onRevoke, onLeave` (:21-34) | `src/routes/sims/[simId]/+page.svelte:5` (import), mounted `:150` |
| `LeaveSimConfirm.svelte` | Leave control: role-aware (sole member warning, last manager successor pick, other manager types title); form action `/sims/{id}?/leaveSim` (:40-47 props/derived) | `MembersPanel.svelte:2` (import), mounted `:217` |
| `membership-overlay.svelte.ts` | `MembershipOverlay`: local-apply overlay (added invites, removed invites, removed members) over `page.data`, sim-keyed, retired when `load` returns fresh arrays (:1-22) | `src/routes/sims/[simId]/+page.svelte:13`, instantiated `:33` |
| `copy.ts` | Strings for sims, invites, members, leave; error code map `MEMBER_ERROR_COPY`; `SIM_TITLE_MAX = 63`, `MAX_SIMS_PER_MANAGER = 1000` (also used by server and `sim-log`) | see section 1.5 |

None of these touch `sim-log`, `sim-store`, `sim-sync` or `sim-stream` (grep: `members/` has no imports of them).

---

## 7. FACT lists: code that matters only for another author or another device

### 7.1 `sim-log`
- V `types.ts:34-40`, `parse.ts:183-188`: `actor` (who wrote a commit) is stamped by the server and parsed (`str(r.actor, 'actor', 1, 64)`); no browser reader of `actor` (grep `actor` in `sim-store`/`sim-sync`: none).
- V `reapply.ts:7-188` (`reapply(tip, input)`, doc "R19"): re-applies one pending commit's changes on a tip that moved; drop reasons `gone` (item/parent missing), `exists` (key taken), `not-truncation`, `no-op`; re-anchoring of moved anchors (`anchorFor` :41-53); stroke key renumbering (`freeKey` :56-62, `deleteTargets` ~:100-130). Its only caller is `LocalLog.#rework` (local-log.ts:802). I: with one author and one device these drops arise only when pending commits were authored on a fold that later changed (a server-authored start commit, a held/dropped earlier commit, a dataset move); the ones named "foreign commit" in doc comments (`LogStore.receive` :588) are from another author/device.
- V `state.ts:45` `DEFER_STROKES`: used by `reapply` only.
- V `chain.ts`: hash chain, server-only callers.
- V `shapes.ts:188-249` `versionAt` / `readFields` / `upgradeFields` / `upgradeSet`, `LogError 'future-shapes'` (types.ts:60): handles commits written by a newer build (another device on a newer build). Registry has one version per shape today (shapes.ts:184).
- V `types.ts:34` `Commit.at`, `seq`: server-stamped.

### 7.2 `sim-store`
- V `local-log.ts:356-399` `receive(commits)` and `#echoes`/`#popEchoes` (:541-553): distinguishes "my own pending commits echoed back" (popped, no re-apply) from foreign commits (full re-apply of pending on the new tip, `drops` reported). Kinds `stale`, `gap {after}`, `future`.
- V `local-log.ts:564-700` `#reapply`: re-applies pending on the confirmed tip after every change; drops reported as `DropReport` (types.ts:20-26), reasons `'empty' | 'invalid' | 'too-large' | 'target-gone'`.
- V `local-log.ts:401-448` `drop`, `forget` ("pending commits another tab took"), `adopt` ("pending commits claimed from other tabs").
- V `log-store.svelte.ts:584-601` `receive`: "A new commit that is not one of this tab's pending ones ends an open draft (decision 8)" (:588-591).
- V `log-store.svelte.ts:426-432, 497-525` `claim`; `:448-495` `open(simId, {claim})` with `claimPending`.
- V `log-store.svelte.ts:1036-1047` `#lose` (records another tab took); `:1073-1085` `#adoptCurrent` (current sim made by another tab, `createSim` outcome `'current-taken'`).
- V `sim-db.ts:14-20` `PendingRecord.owner`; `PendingPut.n/move` and `lost` (sim-db.ts:26-42, 55-59); `claimPending`, `pendingOwners` (sim-db.ts:88-91); `isReservedKey`/`nKey` (the cross-tab `n` counter, sim-db.ts:99-102); `Marker` compare-and-set (sim-db.ts:50-54) which exists so two tabs importing at once do not both import (log-store.svelte.ts:527-565, decision 30 comment).
- V `idb.ts` `onVersionChange` (idb.ts:~104): another tab opened a newer DB version.
- V `types.ts:35` `Stopped = 'future' | 'stale' | 'unknown-dataset'` and `dataset.ts`: "stale" and "move" arise when the sim's server dataset differs from this page's (another device/build, or later deploy); applies to one author on one device too after a deploy (I).
- V `log-store.svelte.ts:1100`/`#addDrops`, `drops`, `clearDrops`: reporting what re-apply dropped.
- V `local-log.ts:176-181` held-future: "a commit from a newer build" (another device running a newer build).

### 7.3 `sim-sync`
- V `tabs.ts` entire file (`TabPresence`), `ports.ts:41-56` (`LocksLike`, `ChannelLike`), `ports.ts:59` `TAB_CHANNEL`, `sim-sync.svelte.ts:63-69, 135-149, 185-216` (watching and claiming other tabs), `ports.ts:86-88` (`SyncStore.open/claim`): multi-tab only.
- V `register.ts:92-132` `RegisterGate` (Web Lock `sfh-register`, "one registration at a time in this browser"): cross-tab serialisation.
- V `sim-sync.svelte.ts:429-441` (`'visible'`: reconnect a socket that cannot write, "a sign-in made in another tab or window is picked up by the new connection").
- V `sim-socket.ts`: `access {write}` and `not-writer` hold (:366-372, 639-641): the server says whether this person may write (roles/membership); `refused 'behind'` (:664-676) = another author's commit landed first; `refused 'gone'` / close 4410 -> halts `'gone'`/`'diverged'` (:330-337, 543-549, 636-638): sim deleted or log diverged; `commits` frames carry other authors' commits (the same `commits` handler serves echoes and foreign commits).
- V `save-state.ts`: `SaveWhy` values `'no-write'`, `'taken'`, `'quota'`, `'sign-in'`, `'newer'`, `'full'`, `'gone'`, `'diverged'` are server/other-party conditions; `'dev'`, `'offline'`, `'unreachable'`, `'register-failed'`, `'protocol'`, `'broken'`, `'stale'`, `'future'`, `'unknown-dataset'` are not specific to several users.
- V `sim-sync.svelte.ts:455` `buildMismatch` (`hello.build` differs from the page's build).

### 7.4 `sim-stream`
- V `protocol.ts:17` `RefusedWhy` values `behind` (another author appended first), `not-writer`, `gone`; `ServerFrame 'access'` (:21). `CLOSE_GONE`. `limits.ts` `burst/perSecond` (server rate bucket for appends).
- `register.ts:5-6` `RegisterCode`: `'invalid_id' | 'title' | 'sign_in' | 'taken' | 'quota' | 'rate' | 'session' | 'failed'`; `taken` = "not yours", i.e. someone else holds the id (register.ts:14).

### 7.5 `members` (all of it concerns other people)
- V Entire directory: invitations (`InviteBanner`, `InvitationsList`, `invite-banner.ts`), roster (`MembersPanel`), roles and leave flow (`LeaveSimConfirm`), overlay (`membership-overlay.svelte.ts`), and `MEMBERS_COPY`/`MEMBER_ERROR_COPY` (`already_member`, `manager_protected`, ... in copy.ts:36-110).
- Exceptions inside `members/copy.ts` that are not about other users: `SIM_TITLE_MAX` (copy.ts:4, used by `sim-log/shapes.ts:1` and server), `SIMS_COPY` (copy.ts:6-30: create, rename, quota, sign-in line), `MAX_SIMS_PER_MANAGER` (copy.ts:2).

---

## 8. What works with no account and no network (what the sim page gets from these modules)

- V On `/sim` and Paint: **nothing** is obtained from these five directories (section 0.1, 9). Saving on those pages is localStorage via `sharing/autosave.svelte.ts`; no sign-in or socket check exists on those paths (`getStorage` in `sharing/storage.ts:15-22`).
- For the modules themselves, if a page mounted them, branches that check sign-in, registration, network or socket state:
  - Storage: `LogStore` with `db: null` (IndexedDB unavailable) sets `local = 'failed'` at construction (log-store.svelte.ts:225) and then works in memory: edits, undo/redo, folding all run without a database; `head()` returns drafts without waiting for storage (log-store.svelte.ts:612). `#canWrite()` is false without a db (:884-886). `openSimDb` returns null on missing/blocked IndexedDB (idb.ts:69-100).
  - Registration/sign-in: `SimSync.#evaluate` (sim-sync.svelte.ts:262-283) is the only gate: `live`, `store.ready`, `store.registration`, pending/held counts. 401 -> `'sign-in'` (:393-396); `saveState` -> why `'sign-in'` (save-state.ts:76-79). The browser has no local "am I signed in" check; a signed-out person's POST either succeeds (the server mints a pseudonymous account when the device is unknown, `routes/api/sims/+server.ts:35-41` I: from the 401-only-on-known-device condition plus register.ts:63-66) or returns 401.
  - Socket/network: `SimSocket.start()` waits for online (`net.online()`, sim-socket.ts:218-221: phase `offline` when not online); `saveState` returns `offline`/`unreachable` (save-state.ts:89-90); `store.head()` returns null while `serverDs === null` (log-store.svelte.ts:606) so nothing is sent before a `hello`.
  - Undo/redo and drafts need none of the above except when `stopped`/`decision.kind !== 'edit'`: `#restore` returns null off the "edit" decision (log-store.svelte.ts:806-831). The dataset decision with `server === null` returns `edit` only if `fold === null || fold === page` (dataset.ts:10); once a sim's fold is on another dataset and no hello has come, the store is `stop: 'unknown-dataset'` (dataset.ts:11) and authors nothing: offline editing of a sim whose tip is on an older dataset is blocked by the dataset rule.
  - `live: false` (dev): no fetch, no socket (sim-sync.svelte.ts:262).

## 9. How `/sim` and Paint use these modules

- V **`SimPage.svelte`** (`src/lib/sim-page/SimPage.svelte`, imports at :26-97 read in full): imports from the five directories: **none**. Grep of `sim-log|sim-store|sim-sync|sim-stream|members|LogStore|SimSync` in `routes/+page.svelte`, `routes/sim/+page.svelte`, `lib/sim-page/*.{svelte,ts}`, `lib/sharing`, `lib/timeline` (non-spec): no hits.
  - What it uses instead: `PolicyStore<SimPolicy4>` (`sim-page/policy-store.svelte.ts`, `SimPage.svelte:194`), `PolicySync` (`:203`, from `lib/timeline/policy-sync.svelte`), `Autosave<SimDoc4>` (`:269`, `lib/sharing/autosave.svelte`, localStorage via `getStorage`, `:54, 147`), `PublishButton` (`:51, 1084`), `SaveIndicator` (`:52`), `HistoryButtons` (`:43`; `store.canUndo/canRedo/undoLabel/redoLabel` `:1075-1078`; `store.undoTo` `:1179`; `undo: () => store.undo()` `:540`, `redo` `:541`).
- V **Paint page** (`src/routes/+page.svelte`, imports :1-34 read): imports `Autosave`, `COPY`, `PLAN_CODEC`, `PublishButton`, `SaveIndicator`, `NoticeStack` from `$lib/sharing`; `Editor` from `$lib/brush`; no import of the five directories. **Paint does not use the sim log at all.** Its document is a `Plan` (`PLAN_CODEC`, :23).
- V `routes/sim/+page.svelte` mounts `SimRoute` (`lib/sim-page/SimRoute.svelte`, not read). `routes/sim/+page.ts:4` imports `loadSimScenario` from `$lib/sim-page/load` (not read).
- Therefore the question "which imported symbols and call sites" has the answer: none.

## 10. Undo/redo

- **Live pages (not in these directories, for contrast; V):** in-memory stacks `#past` and `#future` in `PolicyStore` (`sim-page/policy-store.svelte.ts:16-22`), `undo()` :88, `redo()` :99, `undoTo()` :113; cleared by `reset` (a load) (:77-80). Autosave writes the document after each change including undo/redo (`docs/dev/sim-page.md:88`; not re-read in code).
- **In `sim-store` (built, not mounted; V):** log-based. The stack is derived from the commit log, never stored: `undoRedo(log)` in `sim-log/history.ts:15-42` (full walk) and `History` class in `sim-store/history.ts:17-67` (same walk kept incrementally, each entry carries the label). `LocalLog.history()` (local-log.ts:325) is confirmed commits then pending ones. Rules (history.ts:20-39): `system` commit clears both stacks; a `restore` whose `as: 'undo'` target is on the undo stack pops undo and pushes redo; likewise for redo; an edit, a jump, or a restore with an off-stack target pushes undo and clears redo.
- Undo/redo write: `LogStore.undo()/redo()` -> `#restore(which)` (log-store.svelte.ts:806-831): settles an open draft, then `authorRestore(log, target.position, which, meta, align)` which pushes a new `kind: 'restore'` pending commit (`restores: {position, as}`, source `'sim.undo'`/`'sim.redo'`, label = target label, changes = `diff(current, target)`). Nothing is removed; the log only grows. Targets equal to the current ruleset are skipped (`nextTarget`, author.ts:205-227). `canUndo` is `editable && (draft !== null || undo !== null)` (log-store.svelte.ts:1125-1131). `undoTo(p, label)` is a `'jump'` restore (source `'sim.revert'`) when the shown policy maps to a held commit, else an edit (log-store.svelte.ts:362-387).
- Undo/redo are off while `stopped !== null` or the dataset decision is not `edit` (log-store.svelte.ts:1121-1124).

## 11. Grep: `level`, `unlock`, `locked`, `stage`, `readonly`, `read-only`, `readOnly` in the five directories (non-spec; spec files excluded)

Case-insensitive, whole word. Searched `sim-log`, `sim-store`, `sim-sync`, `sim-stream`, `members` (`*.ts`, `*.svelte`).
- `level`: 1 hit, `sim-log/diff.ts:80` comment "adds and moves, level by level: policies, spans, strokes" (list depth, not a game level).
- `unlock`: none.
- `locked`: none. (The word "lock" appears for Web Locks only, e.g. `sim-sync/tabs.ts`, `register.ts`.)
- `stage`: none.
- `read-only`: 3 comment hits: `sim-log/state.ts:130` ("shared by every caller until then: read-only"), `sim-store/local-log.ts:324` ("History over confirmed then pending (read-only: do not push)"), `sim-store/log-store.svelte.ts:265` ("The pending commits in force, in order (read-only)"). None are a view mode.
- `readOnly`: none.
- `readonly`: only the TypeScript modifier (e.g. `sim-log/shapes.ts:10,24,26`, `sim-log/items.ts:102,134`, `sim-store/log-store.svelte.ts:44-48`, `sim-store/idb.ts` IndexedDB mode `'readonly'` at :231, 285, 317); none is a page read-only mode.
- No code in these directories implements level, unlock, stage or read-only view predicates. (A read-only view of a published sim exists elsewhere: `SimPage` `mode: 'view'` / `readonly`, `SimPage.svelte:107`, `docs/dev/sim-page.md:92`; not in scope.)

---

## Doc/code contradictions

1. No direct contradiction found between `docs/dev/sim-store.md`/`sim-sync.md` and the code about what is built. `docs/dev/sim-store.md:3` ("nothing on any page uses either yet") matches the code (section 0.1). `docs/dev/sim-sync.md:325` lists "The page: `/sim` on `LogStore` and `SimSync` ... (plan 3)" under what is not built; consistent.
2. Potentially misleading (not a contradiction): `CLAUDE.md` lists "Sim sync", "Browser log store", "Sim log core", "Sim object" as scoped reference docs and its Architecture paragraph describes the `SIM` Durable Object, which can read as if `/sim` is on the log; in code `/sim` saves via localStorage `Autosave` and an in-memory `PolicyStore` (section 9). `docs/dev/sim-page.md:88` correctly says autosave is under `sfhousing:sim:v2` (not verified in code; storage keys not opened).
3. `docs/dev/sim-sync.md:60` says `live = !dev (\$app/environment)`; no code sets `live` from `dev` because no code constructs `SimSync` (V grep).
4. Not compared: `docs/dev/sim-log.md` (shape registry table, sizes) against `shapes.ts`; `docs/dev/sim-sync.md` state tables against `sim-sync.svelte.ts` beyond the rows quoted.

---

## Appendix

### Files read in full
`sim-log/types.ts, index.ts, keys.ts, chain.ts, history.ts, check.ts, shapes.ts, items.ts`; `sim-store/types.ts, dataset.ts, history.ts, sim-db.ts, author.ts`; `sim-sync/save-state.ts, register.ts, backoff.ts, ports.ts, tabs.ts, sim-sync.svelte.ts`; `sim-stream/protocol.ts, register.ts, limits.ts`; `members/copy.ts, invite-banner.ts, membership-overlay.svelte.ts, InviteBanner.svelte, InvitationsList.svelte`; `src/routes/api/sims/+server.ts` lines 14-80 (whole handler).

### Files read in part (line ranges)
- `sim-log/state.ts`: 1-140, 340-362 (LogState.apply, fold)
- `sim-log/diff.ts`: 1-60
- `sim-log/reapply.ts`: 1-80, 120-188
- `sim-log/parse.ts`: 160-189
- `sim-store/local-log.ts`: 1-460, 500-815 (not read: 460-500 internals `#prune`..`#changedSince`, `#rewalk`, `#leadMove` body 703-751)
- `sim-store/log-store.svelte.ts`: 1-146, 268-672, 675-960, 954-1160 (i.e. effectively all but 146-268 getters block 232-268 only skimmed via grep and 299-305)
- `sim-store/idb.ts`: 1-140, 236-262 (not read: 140-236 `run`/`putBatch`/`read`, 262-332)
- `sim-sync/sim-socket.ts`: 1-260, 330-480, 540-700 (not read: 260-330 `#connect`, 480-540 rest of `#onCommits`, 700-784 ping/onStore/onNet bodies except grep of case labels)
- `members/MembersPanel.svelte`: 1-80; `members/LeaveSimConfirm.svelte`: 1-60
- `src/lib/sim-page/SimPage.svelte`: 1-97 (imports), 262-300; plus grep of `new Autosave|new PolicyStore|undo|redo` lines
- `src/routes/+page.svelte`: 1-34 (imports)
- `sim-page/policy-store.svelte.ts`: 14-40 plus grep
- `sharing/storage.ts`: 1-50; `sharing/autosave.svelte.ts`: 10-60
- docs: `docs/dev/sim-sync.md` and `sim-store.md` by grep and lines 28-36, 3, 255-361 by grep matches only

### Dirs listed
`src/lib/sim-log`, `sim-store`, `sim-sync`, `sim-stream`, `members` (with `wc -l` of every file), `sim-log/test`, `sim-store/test`, `sim-sync/test`, `src/lib/sim-page`, `src/lib/sharing`, `src/routes`, `src/routes/sim`, `src/routes/sims`.

### NOT examined
- Bodies of `sim-log/parse.ts` lines 1-160 (change/draft field checks), `sim-log/state.ts` 140-340 (change application internals, `checkStrokes`), `sim-log/diff.ts` 60-134.
- `sim-store/idb.ts` transaction bodies (140-236, 262-332) and `sim-store/local-log.ts` `#rewalk`, `#leadMove`.
- `sim-sync/sim-socket.ts` `#connect`/`#retry`/`#halt`/`#set`/`#onStore`/`#onNet` bodies.
- `members/MembersPanel.svelte` 80-227, `members/LeaveSimConfirm.svelte` 60-199, and all `members/*.spec.ts`.
- All `*.spec.ts` and `test/` fakes bodies in the five directories (`sim-log/test/*`, `sim-store/test/*`, `sim-sync/test/*`); only their file names and sizes are listed.
- `src/routes/sims/**` (+layout, +page, [simId]/+page) beyond the import/mount lines found by grep; `src/routes/invite/[token]/+page.svelte`.
- `src/lib/sim-page/SimRoute.svelte`, `load.ts`, `sharing/publish-client.ts`, `PublishButton.svelte` (whether Publish needs sign-in), `timeline/policy-sync.svelte.ts`.
- Server code: `server/sims/start-sim.ts` (what it mints for a signed-out visitor), `server/sim-object/*` (only import lines seen by grep).
- `docs/dev/sim-log.md`, `docs/dev/auth.md`, `docs/dev/sim-object.md`.
