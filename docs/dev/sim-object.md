# Sim object

The per-sim Durable Object: `SimObject`, `src/lib/server/sim-object/`. It orders, checks and stores a sim's commits and serves them over a websocket. This is unit 2 of the sim message log; the browser log store (unit 4) speaks the socket protocol below, and the control plane (unit 3) calls `rereadRoles()` and `takeDown()`. Design: [2026-11-14-sim-message-log-design.html](../superpowers/specs/2026-11-14-sim-message-log-design.html) (rule numbers below, `R21` and so on, are its rules). The log core it folds with is [sim-log.md](sim-log.md).

## What it is

- One object per sim, binding `SIM`, class `SimObject` (SQLite), addressed by `getByName(simId)`. `simStub(env, simId)` (`stub.ts`) returns the stub, or null where the binding is absent.
- The log lives only in the object's SQLite. Membership lives only in D1; the Worker reads it and tells the object who may write (R46).
- The object holds no policy knowledge of its own: it folds commits with `LogState` from `$lib/sim-log`.
- The D1 `sim_index` and `sim_commit` rows are rebuildable copies (see The D1 copy). Nothing reads them to serve a sim's rules (R24).

## Files

| Where                                                              | What                                                                                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/server/sim-object/sim-object.ts`                          | The class: the platform wiring only. The only module that imports `cloudflare:workers`; no spec imports it                                                                 |
| `src/lib/server/sim-object/object-rules.ts`                        | Pure decisions the class makes: `openStatus`, `readMessage`, `closeReply`, `roleChanges`, `rereadChanges`, `withResumed`, `receivesLive`, `distinctIdentities`, `loggable` |
| `src/lib/server/sim-object/log-host.ts`                            | `LogHost`: the one path that accepts a commit, and the readers (`resume`, `summary`, `unindexed`); runs every call in turn on one promise chain                            |
| `src/lib/server/sim-object/index-runner.ts`                        | `IndexRunner` (the index pass: `kick`, `settled`) and `takeDownInOrder`                                                                                                    |
| `src/lib/server/sim-object/decide.ts`                              | `decideAppend`: the checks that need no folded state                                                                                                                       |
| `src/lib/server/sim-object/limits.ts`                              | `RateBucket`, `INDEX_BATCH`, `INDEX_RETRY_MS`; re-exports the size limits from `$lib/sim-stream/limits`                                                                    |
| `src/lib/server/sim-object/store.ts`                               | `SimStore`: the object's rows, every method synchronous                                                                                                                    |
| `src/lib/server/sim-object/schema.ts`                              | The Drizzle schema of the object's SQLite: `commits`, `sim_state`                                                                                                          |
| `src/lib/server/sim-object/migrations.generated.ts`                | The migration bundle (`simMigrations`), written by `npm run db:generate:sim`; never edited                                                                                 |
| `src/lib/server/sim-object/migrations.spec.ts`                     | The append-only guard: the frozen baseline and `SHIPPED`, the SHA-256 of each shipped migration's SQL                                                                      |
| `src/lib/server/sim-object/index-sync.ts`                          | `syncSimIndex`, `envelopeRow`: the D1 write                                                                                                                                |
| `src/lib/server/sim-object/open-params.ts`                         | `OPEN_HEADER`, `encodeOpenParams`, `parseOpenParams`                                                                                                                       |
| `src/lib/server/sim-object/access.ts`                              | `SocketAttachment`, `parseAttachment`, `canWrite`, `accessChanges`                                                                                                         |
| `src/lib/server/sim-object/stub.ts`                                | `simStub`                                                                                                                                                                  |
| `src/lib/server/sim-object/test/`                                  | `harness.ts` (`freshSimDb()`, `storeWithRow()`), `drafts.ts`: test helpers                                                                                                 |
| `src/lib/sim-stream/limits.ts`                                     | `LIMITS`, `Limits`, `utf8Bytes`, `overFrameLimit`, `fitsCommit`, `STAMP_MAX`. Imports nothing: the browser can load it                                                     |
| `src/lib/sim-stream/protocol.ts`                                   | Frame types, `PROTOCOL`, `PING`, `PONG`, close codes, `parseClientFrame`, `encodeFrame`, `commitsFrame`. Type-only imports from the log core: the browser can load it      |
| `src/routes/api/sims/[simId]/stream/+server.ts`                    | The socket route: the trust boundary                                                                                                                                       |
| `src/lib/server/security/same-origin-json.ts`                      | `refuseForeignOrigin` (the route's Origin check, shared with `refuseUnlessSameOriginJson`)                                                                                 |
| `scripts/worker-entry.ts`                                          | After `vite build`: wraps the adapter's `_worker.js` so the Worker also exports `SimObject`                                                                                |
| `e2e/sim-object.spec.ts`, `e2e/helpers/sim-socket.ts`              | End-to-end specs and their websocket client                                                                                                                                |
| `migrations/sim/`, `drizzle.sim.config.ts`, `drizzle-cf.config.ts` | The object's migration track and its config                                                                                                                                |

Modules reachable from `sim-object.ts` import no `$app/*`, no `$env/*` and no build-time global: wrangler bundles them without Vite.

## Invariants

| #   | Invariant                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Gapless: stored positions are exactly 1 to n; a row's `seq` is its position and its commit's `parent` is `seq - 1`. `SimStore.insert` throws `RangeError` unless `seq` is the tip plus 1                  |
| I2  | Chain: `verifyChain` over the stored commits from `GENESIS_HASH` finds nothing wrong                                                                                                                      |
| I3  | State is the fold: a held `LogState` always equals the fold of the stored commits. After a failed insert the host drops its state and totals and refolds on next use                                      |
| I4  | Store, send, index: a commit is inserted before any socket is sent it, and the D1 index is written after the send. An index failure never refuses or delays a commit (R41)                                |
| I5  | A refusal changes nothing: a refused or duplicate append leaves the rows, the tip, the hash and the folded state as they were. A refusal after the writer check takes a rate token                        |
| I6  | Once per id: no two rows share a commit `id` (a unique column); an append whose id is stored gets no frame                                                                                                |
| I7  | One order on every socket: a socket that has resumed gets every later commit once, in `seq` order: first the resume answer, then each new commit as it is stored                                          |
| I8  | The Worker decides who writes: a socket writes only if the Worker said so at open or a later `rereadRoles()` did. The actor stamped is the identity the Worker passed; the browser never states who it is |
| I9  | Append-only: rows are never updated or deleted, except all at once by `takeDown()` (R21). The migration track is append-only (R22)                                                                        |

## The socket

`GET /api/sims/<simId>/stream`, a websocket upgrade.

### What the route checks

`src/routes/api/sims/[simId]/stream/+server.ts`, in this order:

| Status | When                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| 426    | No `Upgrade: websocket` header                                                                                   |
| 403    | `Origin` present and not this origin (`refuseForeignOrigin`; an empty `Origin` is refused; an absent one passes) |
| 404    | The id is not a valid id, or there is no `sim_index` row                                                         |
| 503    | Under `npm run dev`, or where `platform.env.SIM` is absent; body says to use `npm run preview`                   |

Errors from the route are JSON `{ error }`. Then the route reads the session (`locals.user`, resolved by the session gate: see [auth.md](auth.md)) and the role (`getRole`) and forwards the upgrade to the object. Anyone who knows the sim id gets a socket: a signed-out visitor or a non-member gets `write: false`. The status of the object's own answer passes through unchanged, empty body:

| Status | The object's reason                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------- |
| 426    | No `Upgrade` header (not reachable through the route)                                                |
| 400    | The open header is absent or malformed, or the object was not reached by name                        |
| 503    | The object has no log host: its migration or its storage failed to open (see Storage and migrations) |
| 410    | The sim is gone (taken down)                                                                         |
| 101    | Open                                                                                                 |

### The open header

The object believes `x-sfh-sim-open` (`OPEN_HEADER`) completely. The route deletes whatever the request carried under that name and sets its own, so the browser can never set it. Its value is JSON with exactly these keys, built from the session, the role read and the sim:

| Key              | Value                                                              |
| ---------------- | ------------------------------------------------------------------ |
| `identity`       | The session user's id, 1 to 64 characters, or null when signed out |
| `write`          | Boolean; `canWrite(role)`; false when `identity` is null           |
| `title`          | `headerTitle` of the D1 `sim_index` title (see The start commit)   |
| `datasetVersion` | The resolved dataset version (`DATASET_VERSION_RE`)                |
| `build`          | `PUBLIC_APP_RELEASE`, or `dev`; 1 to `BUILD_MAX` (64) characters   |

`encodeOpenParams` escapes every non-ASCII character so the value is a legal header. `parseOpenParams` returns null for anything else, and the object answers 400.

On open the object accepts the socket, stores `{ identity, write, resumed: false }` as its attachment, and sends `hello` then `access`. A writer opening a sim with no commits then records its start commit (see The start commit).

### Frames

Text frames, one JSON object each. The browser uses `ClientFrame` and `ServerFrame` from `protocol.ts`.

Server to browser:

| Frame                                                   | When                                                                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `{"type":"hello","build":"<release>","protocol":1}`     | First, on open. `build` is the Worker's release, not the browser's; `protocol` is `PROTOCOL`                            |
| `{"type":"access","write":<boolean>}`                   | Second, on open; later whenever `rereadRoles()` changes this socket's right. The browser must show and send accordingly |
| `{"type":"commits","commits":[<commit>,...]}`           | The answer to a resume (one or more frames), and each commit stored after a resume, as a one-commit frame               |
| `{"type":"refused","id":<id or null>,"why":"<reason>"}` | An append or a resume was refused                                                                                       |

Browser to server:

| Frame                                      | Meaning                                                         |
| ------------------------------------------ | --------------------------------------------------------------- |
| `{"type":"resume","after":<n>}`            | `n` a whole number from 0: send every commit after position `n` |
| `{"type":"append","commit":<CommitDraft>}` | Append a commit made on the tip the browser knows               |

Only these two keys per frame are accepted (`parseClientFrame`). A text `ping` is answered `pong` by the platform's auto response without waking the object; neither is a JSON frame. The browser may send `ping` to keep the socket alive.

`refused.id` is the commit's `id` when the frame carried a string of 1 to 64 characters there, otherwise null. A resume refusal always has `id: null`.

### Refusal reasons and what the browser does

| `why`        | Means                                                                                                                                                                                | Browser                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `behind`     | `parent` is not the tip                                                                                                                                                              | Resume to catch up, `reapply` the pending commits (see sim-log.md), send again                                         |
| `invalid`    | The commit does not parse as a `CommitDraft`, or does not fold on the current state                                                                                                  | Drop it; it will not become valid                                                                                      |
| `newer`      | The commit's `shapes` revision is above what this server knows (the log core's `future-shapes`), or a stored commit is (a newer build wrote it, and this server cannot fold the log) | Keep it pending, stop sending, offer a reload, send again after the reload                                             |
| `not-writer` | The socket has no right to write (signed out, a reader, or a role that ended)                                                                                                        | Stop sending; keep the commit pending until an `access` frame says `write: true`                                       |
| `limit`      | The sim's rate bucket is empty, or the commit is too large (see Limits)                                                                                                              | Back off and send again. A browser that checks `fitsCommit` before sending only meets the rate                         |
| `full`       | The sim is at `LIMITS.simCommits` commits or `LIMITS.simBytes` bytes. Permanent                                                                                                      | Stop sending; keep the commit pending; offer a remix                                                                   |
| `gone`       | On an append, the sim was taken down. On a resume, the position is past the tip                                                                                                      | Taken down: stop. Resume past the tip: the browser's position is wrong (its log is not this sim's); start again from 0 |

An oversized message (text longer than `LIMITS.frameBytes` characters) is refused `limit` with `id: null` without being parsed and without taking a rate token. The object cannot name its commit, so a browser never relies on this refusal.

`limit` has these causes: the sim's rate bucket is empty (`decide.ts`, step 3); the message is over `frameBytes` (`decide.ts`, step 4, or the unparsed pre-check); the stored commit is over `commitBytes` (`log-host.ts`, step 9). The browser checks each commit with `fitsCommit(draft)` (`$lib/sim-stream/limits`) before sending: the draft's UTF-8 JSON plus `STAMP_MAX` (1,024, an upper bound on what the server adds: `seq`, `actor`, `at`, `hash` and their keys) within `commitBytes`. A commit that passes never meets the size causes, so for that browser `limit` means only "slow down". A commit that fails it is too large to ever send.

A duplicate id gets no frame: the resume answer already carried the stored copy, and the browser removes pending commits whose ids are confirmed.

### Close codes

| Code | Constant          | When                                                                                                                                                       |
| ---- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1003 | `CLOSE_BINARY`    | The browser sent a binary message                                                                                                                          |
| 1008 | `CLOSE_MALFORMED` | A text message that is not exactly one client frame, or a socket with no valid attachment                                                                  |
| 1011 | `CLOSE_INTERNAL`  | The object failed on this socket: a failed insert, a stored row that no longer folds for a reason other than a newer shape revision, no log host, an error |
| 4410 | `CLOSE_GONE`      | `takeDown()`: the sim is gone                                                                                                                              |

The reason strings are `binary`, `malformed`, `internal` and `gone`. When the browser closes, the object answers the close with the same code, or 1000 for 1005, 1006 and 1015. After 1011 the browser reconnects (with backoff) and resumes from its confirmed position; after 4410 it stops. A reconnect gets 410 from the object, or 404 from the route once the `sim_index` row is deleted.

### Resume

- `resume` is the first thing a browser sends after `hello` and `access`, and again after every reconnect. The object answers with every commit after `after`, in `seq` order, as `commits` frames of whole commits: the stored bodies of a frame sum to at most `LIMITS.sendBytes` (at least one commit; the wrapper and commas come on top), read 500 rows at a time. There is no end marker: the browser applies commits as they arrive, by `seq`.
- Nothing after the position: one frame `{"type":"commits","commits":[]}`.
- `after` greater than the tip, or a gone sim: `{"type":"refused","id":null,"why":"gone"}`. The socket stays open and is not marked resumed.
- The first frame of an answer marks the socket resumed. A resume and an append never interleave: both run in turn.
- Live commits go only to sockets that have resumed. A socket that has not sent `resume` is sent no commits, including its own accepted ones (the author of an append must have resumed to see it come back).
- A second `resume` on the same socket is answered again; the browser drops commits it already has by `seq`.

### Appending

The order of the checks, as built. The first that fails answers `refused` and changes nothing; the rest are not run.

| Step | Check                                                                                                                                                                                                                                    | Refusal             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 0    | Text longer than `LIMITS.frameBytes` characters (before parsing, no token)                                                                                                                                                               | `limit`, `id: null` |
| 1    | The sim is gone                                                                                                                                                                                                                          | `gone`              |
| 2    | The socket has no right to write, or no identity                                                                                                                                                                                         | `not-writer`        |
| 3    | The sim's rate bucket has no token (the token is taken here)                                                                                                                                                                             | `limit`             |
| 4    | The message's UTF-8 size is over `LIMITS.frameBytes`                                                                                                                                                                                     | `limit`             |
| 5    | The commit does not parse as a `CommitDraft`                                                                                                                                                                                             | `invalid`           |
| 6    | The id is already stored                                                                                                                                                                                                                 | none: no frame      |
| 7    | The log has `LIMITS.simCommits` commits, or stored bytes plus this message's would pass `LIMITS.simBytes`                                                                                                                                | `full`              |
| 8    | `parent` is not the tip                                                                                                                                                                                                                  | `behind`            |
| 9    | The object stamps `seq`, `actor`, `at` and `hash`; the stored form is over `LIMITS.commitBytes`                                                                                                                                          | `limit`             |
| 10   | The stored rows fold (once per wake), then the fold check (`apply` with `check: true`): `future-shapes` from either is `newer`; any other refusal of the commit `invalid`; any other failure of the stored rows an internal error (1011) | `newer`, `invalid`  |

So a commit that is both oversize and invalid is refused `limit`. After step 10 the commit is inserted and its stored body is sent, as a one-commit `commits` frame, to every resumed socket, the author's included. Steps 1 and 2 take no token, so a reader or a signed-out socket cannot spend the sim's budget; a refusal at step 4 or later has taken one, and so has a duplicate (step 6, no frame). A browser that re-sends its pending commits after a reconnect spends the burst on duplicates.

The rate bucket is per sim and held in memory: `LIMITS.burst` tokens, refilled at `LIMITS.perSecond`. It starts full each time the object wakes, so a writer gets a fresh burst after the sim goes idle.

### The start commit

A writer opening a sim with no commits (R58) makes the object append the start commit: `kind: 'system'`, `label: 'Start'`, `source: 'sim.start'`, `parent: 0`, the current `SHAPES_REVISION`, one `set` of the sim's `name` to the open header's `title`, the header's `datasetVersion` and `build`, the writer as actor. A reader opening an empty sim creates nothing. Two writers opening at once make one start commit. The commit reaches the opening socket through its own resume, and other resumed sockets as a live commit.

The route builds the header's `title` with `headerTitle(sim_index.title)` (`open-params.ts`): trimmed, cut to `SIM_TITLE_MAX` (63) characters, never inside an astral character, trimmed again, and the log core's `DEFAULT_SIM_NAME` (`Untitled sim`) when nothing is left. So a sim with an odd stored title still opens, and its start commit passes the name check.

## Limits

`LIMITS` in `src/lib/sim-stream/limits.ts`, which imports nothing, so the browser imports it (with `utf8Bytes`, `overFrameLimit`, `fitsCommit` and `STAMP_MAX`) from `$lib/sim-stream/limits`. `src/lib/server/sim-object/limits.ts` re-exports them and holds the server's own `RateBucket`, `INDEX_BATCH` and `INDEX_RETRY_MS`. Change a value in the shared file. `limits.spec.ts` pins `simBytes`, so changing it also means changing that spec.

| Field         | Value               | Means                                                                                                                             |
| ------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `commitBytes` | 1,048,576 (1 MiB)   | The largest stored commit (its JSON body in UTF-8, with `seq`, `actor`, `at`, `hash`)                                             |
| `frameBytes`  | 1,052,672           | The largest incoming message in UTF-8 bytes: `commitBytes` plus 4,096 of frame room                                               |
| `simCommits`  | 100,000             | Commits in one sim                                                                                                                |
| `simBytes`    | 67,108,864 (64 MiB) | Stored bytes in one sim. A fold or a resume never needs more than this in memory                                                  |
| `burst`       | 120                 | Appends a sim accepts in a burst                                                                                                  |
| `perSecond`   | 2                   | Refill rate of the sim's bucket                                                                                                   |
| `sendBytes`   | 1,048,576           | The most stored-body bytes a resume puts in one `commits` frame (wrapper and commas extra), except that one commit is always sent |

Also in `limits.ts`: `INDEX_BATCH` 50 (commits per D1 write) and `INDEX_RETRY_MS` 30,000. The resume page size, 500 rows, is `PAGE` in `log-host.ts`.

## Storage and migrations

Two tables in the object's own SQLite (`schema.ts`):

| Table       | Columns                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `commits`   | `seq` (primary key), `id` (unique), `hash`, `bytes` (UTF-8 size of `body`), `body` (the stamped commit's JSON, as stored and broadcast) |
| `sim_state` | One row, `id` 1: `indexed_seq` (the watermark, default 0), `gone_at` (null until a takedown)                                            |

The object has its own migration track, `sim`, beside the D1 one (`drizzle-cf.config.ts`).

- Edit `src/lib/server/sim-object/schema.ts`, run `npm run db:generate:sim`, commit what it writes (`migrations/sim/` and `migrations.generated.ts`). Nothing to apply: each object migrates on open.
- The track is append-only for good. Every object ever created applies this history, so never delete `migrations/sim` or regenerate it from scratch. Never hand-edit a migration. No `CHECK` constraints (the migrations package forbids them in a Durable Object track).
- `migrations.spec.ts` freezes the first migration (`20261115062714_fat_scorpion`) with `describeAppendOnlyBundle` (the baseline sorts first and creates `commits` and `sim_state`, every key is timestamp-prefixed, the bundle applies), and pins every shipped migration: `SHIPPED` maps each name to the SHA-256 of its SQL, and the spec fails, naming the migration, when one is missing from the bundle or its SQL differs. A new migration adds its line to `SHIPPED` when it ships (`shasum -a 256 migrations/sim/<name>/migration.sql`). Until then it is not pinned: a migration not yet in `SHIPPED` can be edited, and only review stops a shipped one being left out of the map.
- On construction the object runs `safeMigrate(durable, simMigrations)` inside `blockConcurrencyWhile`. If the migration fails, or the storage cannot be opened, the error is logged (the sim id and the error text) and the object has no log host: an open answers 503, a message closes the socket 1011, and `takeDown()` throws. It stays that way until the object is next constructed. The class still constructs, so it stays destroyable.
- The object logs only what is unexpected, with the sim id and an error message cut to 300 characters (`loggable`): never a commit body or an identity, and no refusal of a browser's append. The one refusal logged is the reason code of a refused start commit. A failed query logs `(query failed)`, never its parameters.

## The D1 copy

Written by the object after it has stored and sent a commit (I4). Both tables are copies: rebuildable from the objects, never read to serve rules.

- `sim_index` (one row per sim, made when the sim is created): the pass updates `positions`, `last_change_at`, `dataset_version`, `title` (the folded sim name) and `updated_at`, only where the row's `positions` is lower than the log's, so it never moves backwards. `remixed_from` and `remixed_from_position` exist but nothing writes them yet; the object will copy them from a remix's first commit (`remixOf`) when the sharing unit adds that field.
- `sim_commit` (key `sim_id`, `seq`): each commit's envelope, columns `kind`, `source`, `actor`, `at`, `build`, `dataset_version`, `bytes`, `restores_position`, `restores_as` (null when the commit is not a restore). Inserted `on conflict do nothing`, so a replay is harmless.
- The watermark is `sim_state.indexed_seq`: the last position copied. The index pass (`IndexRunner`, `index-runner.ts`) reads at most `INDEX_BATCH` unindexed commits, writes them and the `sim_index` update in one D1 batch, and moves the watermark forward only and never past the tip (`markIndexed` writes `min(seq, tip)`).
- The pass runs after an accepted append (the author's message handler waits for it) and after a start commit (`waitUntil`). It runs one at a time: a kick while a pass is in flight joins it, and the pass picks up rows stored meanwhile.
- A failed D1 write is never refused to the author. It is logged once per outage (on the change from working to failing; recovery is not logged, and a wake from hibernation forgets the state, so it may log once more). Each failed pass sets an alarm `INDEX_RETRY_MS` ahead if none is set, and `alarm()` runs the pass again. On construction, if the watermark is behind the tip and no alarm is set, the object sets one for now.
- If the stored rows do not fold on this build (a newer build wrote them; the summary throws `LogError`), the pass logs once and sets no retry: retrying cannot help, and a newer build sets the alarm on construction. If the object has no name (`ctx.id.name`), the pass logs once and copies nothing.
- After a takedown the pass stops: a pass whose D1 write was running when `takeDown()` ran does not move the watermark, and `takeDown()` waits for it (see below).
- A sim whose `sim_index` row is missing gets its `sim_commit` rows and no title update.

## For the control plane (unit 3) and the browser store (unit 4)

Both RPC methods are called through `simStub(env, simId)`, which is null without the binding.

### `rereadRoles()`

Call it after a roster change that can change who may write: an accepted invite, a role change, a removal (R53). `onSimRosterChanged` (`src/lib/server/sims/roster-hook.ts`) is its seam.

- Write the roster change to D1 first, then call `rereadRoles()`. It reads the role of every distinct identity on an open socket. A socket that opens after that list is taken and before the read ends is not in the read and keeps the right the Worker gave it at open. The route read its role before the change was written, so it can keep a stale right until the next call.
- It sends `{"type":"access","write":...}` only to sockets whose right changed, and updates their attachments. A writer who loses the right is not disconnected; later appends are refused `not-writer`. A reader who gains it gets `write: true`.
- A signed-out socket is never touched. A non-member's role is null: no write.
- If the role read fails for any reason, it logs once (the sim id and the error text), changes nothing (nobody is revoked) and throws `Error('role read failed')`, fixed text that names no identity. Over RPC the caller's await rejects: retry, or surface it. It returns normally when the read succeeded, and at once, reading nothing, when no open socket has an identity.
- It needs no log host.
- Call it when the last member leaves too (`removeSimMember` deletes the sim's rows): the route then answers 404 to new opens, but open writer sockets keep writing until `rereadRoles()` finds no role for them.

### `takeDown()`

Call it for a manual takedown (R43). It runs in turn with appends and resumes.

- It deletes every commit, sets `gone_at` and resets `indexed_seq` to 0 and drops the held state; then it waits for an index pass in flight (which stops without moving the watermark); then it closes every open socket with 4410 `gone` (`takeDownInOrder`). No index write lands after it returns. It throws `Error('sim object unavailable')` when the object has no log host; an RPC caller sees an exception, not a status.
- What it leaves: the `sim_state` row, with `gone_at` set. Later opens get 410, appends `gone`, resumes `gone`. The object stays addressable, so a takedown is final and the sim id stays dead. Calling it again only moves `gone_at`.
- It does not touch D1. The control plane deletes the sim's `sim_index` and `sim_commit` rows, after `takeDown()` returns: an index write running when it was called has landed by then.

### Notes for the later units

- A rename must become a name commit (`set` of `sim` `name`, source `sim.name`): the D1 `title` is copied from the folded name, and the object never reads `sim_index.title` after the start commit.
- The start commit takes its name from `sim_index.title` at the first writer's open (R58).
- The browser store: `resume` from its confirmed position on every open; stop sending on `not-writer` until an `access` frame allows it; keep pending commits through `behind`, `newer` and `full` as in the table above; back off on `limit`; check each commit with `fitsCommit` before sending.

## For the next units

- **Control plane (unit 3).** Write the roster change to D1, then call `rereadRoles()` and handle its throw (retry with `waitUntil`, or surface it). Call it on every path that can end a writer's role, the last member leaving included. Call `takeDown()` before deleting the sim's D1 rows. `onSimRosterChanged` needs `env` to reach `SIM`. Add the end-to-end tests deferred here: a role change ending write on an open socket, and `gone` after a takedown.
- **Log store (unit 4).** Import the limits and `fitsCommit` from `$lib/sim-stream/limits`. Treat `full` as permanent, `limit` as back off, `newer` as keep pending and reload, and `gone` on a resume as restart from 0. Resume on every open before sending pending commits (each duplicate spends a rate token). Compare `hello.build` with the page's release; send `ping` to keep the socket alive; the socket does not open under `npm run dev`. Several concurrent resumes of a very large sim are not yet bounded in memory or in rate: one resume queues every frame of the answer on the socket in one turn, and pages are 500 rows with no byte bound. This unit owns that (for example a per-socket resume throttle and byte-bounded pages); first check how workerd buffers outgoing frames. Check that CSP `connect-src 'self'` admits the socket in WebKit and Firefox.
- **Sharing (unit 5).** A remix's first commit carries `remixOf`, and the index pass copies it to `remixed_from` and `remixed_from_position`. Commit bodies go to every socket as stored, so `actor` ids (the stable identity id) are visible to anyone with a sim's link, signed-out readers included.

## Running it

- The build is `vite build && tsx scripts/worker-entry.ts`. The adapter writes `.svelte-kit/cloudflare/_worker.js` exporting only the SvelteKit handler; `wrapWorker` moves it to `.svelte-kit/cloudflare-adapter/_worker.js` and writes an entry in its place that re-exports its default and `SimObject`. It throws if the adapter output is missing or already wrapped, so run it only after a fresh `vite build`. Wrangler's `main` stays `.svelte-kit/cloudflare/_worker.js` and bundles the entry from source; the top-level `alias` `$lib` to `./src/lib` in `wrangler.jsonc` resolves `$lib` imports for every environment.
- The Durable Object does not run under `npm run dev`. The route answers 503 under dev (`dev` from `$app/environment`) and where `platform.env.SIM` is absent, whatever the platform proxy binds. But an upgrade request does not reach the route under dev: observed on 2026-11-15 (`vite dev`, a signed-in writer, a real sim, upgrade headers and a same-origin `Origin`), the connection got no answer at all, 0 bytes in 20 seconds, and the same for an unknown sim id, while the same request without `Upgrade` got the route's 426. The likely cause is that Vite's dev server handles upgrade requests itself, for its HMR socket. So in dev a page's socket does not open. Use `npm run preview` (build, then `wrangler dev` on port 4173), which also serves e2e.
- `wrangler.jsonc` declares the object in both environments: `durable_objects.bindings` (`SIM`, `SimObject`) and `migrations` with tag `v1-sim-object` and `new_sqlite_classes`. Cloudflare's configuration docs now prefer a declarative `exports` field, which cannot be mixed with `migrations`; switching is a deliberate later change. A migration tag is never edited or reused: a change of class or storage adds a new tag.
- Operators: after this deploy, rolling the Worker back to a version without the `SimObject` class is not safe.
- Hooks (`src/hooks.server.ts`): a websocket upgrade resolves the session with `disableRefresh`, because the 101 response's headers cannot be changed, and `headersHandle` returns a 101 as it is.
- e2e: `e2e/helpers/sim-socket.ts` opens sockets from the page's own `WebSocket` (so the session cookie and CSP apply), keeps every received frame in `window.__sfhSockets`, and waits on frame counts, never on time. Exports: `openSimSocket`, `framesAtLeast`, `sendFrame`, `sendAndRead`, `resumeAndRead`, `closedCode`, `commitsOf`, `nameDraft`. `e2e/sim-object.spec.ts` does not yet cover a role change ending write on an open socket, or `gone` after a takedown: they need the callers of `rereadRoles()` and `takeDown()`.

## Tests

`npx vitest --run --project server src/lib/server/sim-object src/lib/sim-stream`. The object's logic runs in Node over `freshSimDb()` (`test/harness.ts`): the object's own migration bundle in better-sqlite3. `npx playwright test e2e/sim-object.spec.ts --project chromium` runs the socket against `wrangler dev`.
