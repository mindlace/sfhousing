# Browser log store

The browser's side of a sim's log: `src/lib/sim-store/`. It folds a sim's confirmed commits and this tab's pending ones into one ruleset, authors commits for the editors' changes, undo and redo, keeps them on the device in IndexedDB, and hands commits to a socket client to send. This is unit 4 of the sim message log, plan 1 of four (the plans after it: [the outline](../superpowers/plans/2026-11-15-sim-log-store-outline.html)). Plan 1 builds the core and plan 2 the socket client that serves it ([sim-sync.md](sim-sync.md)); nothing on any page uses either yet, and plans 3 and 4 wire them up (see What is not built yet). Design: [2026-11-14-sim-message-log-design.html](../superpowers/specs/2026-11-14-sim-message-log-design.html) (rule numbers `R..` are its rules). The log core it folds with is [sim-log.md](sim-log.md); the server it talks to is [sim-object.md](sim-object.md).

The store imports the log core only from `$lib/sim-log`, the size limits from `$lib/sim-stream/limits`, ids from `$lib/ids/base58`, `canonicalJson` from `$lib/sim-page/policy` and the policy type and default from `$lib/timeline/policy4`. Nothing in it imports `$app/*`, `$env/*` or `$lib/server/*`. It logs only with `console.error`, prefixed `[sim-store]`, with a reason code and never a commit body, ruleset, name or label (see Storage failure).

## Files

| Where                                   | What                                                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/sim-store/types.ts`            | `Stamp`, `Pending`, `DropReport`, `DropWhy`, `Align`, `Stopped`, `MOVE_SOURCE`, `MOVE_LABEL`                                                             |
| `src/lib/sim-store/dataset.ts`          | `datasetDecision`: the dataset rule as a pure function                                                                                                   |
| `src/lib/sim-store/history.ts`          | `History`: undo and redo targets with labels, kept incrementally                                                                                         |
| `src/lib/sim-store/local-log.ts`        | `LocalLog`: confirmed, pending and held commits, `receive`, re-applying, checkpoints. Pure: no I/O, no runes                                             |
| `src/lib/sim-store/author.ts`           | `authorEdit`, `authorRestore`, `authorMove`, `nextTarget`, `SOURCES`, the pending cap, `clampLabel`                                                      |
| `src/lib/sim-store/sim-db.ts`           | The `SimDb` interface and its records, `memorySimDb`, `CURRENT_KEY`, `nKey`, `isReservedKey`                                                             |
| `src/lib/sim-store/idb.ts`              | `openSimDb`: `SimDb` on IndexedDB; `upgradeSimDb`, `SIM_DB_NAME`, `SIM_DB_VERSION`                                                                       |
| `src/lib/sim-store/log-store.svelte.ts` | `LogStore` (the reactive store, drafts, the write chain, the import) and `DocStore` (what the editors call)                                              |
| `src/lib/sim-store/test/`               | `commits.ts` (builders, `FakeObject`, `renamingAlign`) and `sim-db-contract.ts` (the suite every `SimDb` must pass): test helpers, not part of the store |

## Invariants

Each holds after every public call returns.

| #   | Invariant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | The page is the fold. With no draft open, `LogStore.policy` and `name` are content-equal to `LocalLog.ruleset()`: the confirmed commits then the pending ones. `policy` keeps the object it already shows when the fold is canonically equal to it (`rulesetText`, the name aside). With a draft open, `policy` is the editor's output on top of the fold; `name` stays the fold's                                                                                                                                                                                                                                                                                                                                                                                                                         |
| I2  | Stored before sent while storage works. `head()` returns a pending commit only once the very version it returns is in IndexedDB (the same `Pending` object, or the same draft and target). With no database, or after a failed write, it returns the head without waiting and `local` is `'failed'`: the server then holds the only copy and nothing says the commit is stored on this device                                                                                                                                                                                                                                                                                                                                                                                                              |
| I3  | Pending commits sit on the tip: `pending[i].draft.parent === tipSeq + i`, and a pending restore's `restores.position` is the current position of its target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I4  | A commit is confirmed only from the stream (`receive` of the store's own sim while `ready`, in `seq` order with no gap) or from what the device stored of a sim at `open`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| I5  | What IndexedDB holds was a real state of the tab. Writes are serialized, each is one transaction and counts only on its `complete` event. At `open`, a stored pending record whose id is already confirmed is not re-sent: the log drops it and the next write deletes the record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| I6  | A look mints nothing and creates nothing. Until the first edit no sim id is minted and no sim is created on the device. A tab that only reads a sim already stored on the device does write the confirmed commits it receives (the device's copy of the log); that is intended. Opening the database may create an empty one                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| I7  | Only sendable commits are pending. A commit becomes pending, authored or re-applied, only after `parseCommitDraft`, `fitsCommit` and `LogState.apply(..., { check: true })` on the local tip accepted it. A re-applied commit that fails is dropped and reported (`DropReport`); a move or alignment commit that is dropped is not reported                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I8  | History comes from the log. Undo and redo targets come from the commits alone; `History`'s positions equal the log core's `undoRedo` for every log (a property test)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| I9  | Nothing past a gap or a newer build. `receive` applies nothing after a commit whose `seq` is not the next one, or whose `shapes` is above this build's revision. A commit under a newer revision, confirmed or pending, sets `future` (permanent for that log) and the store is stopped `'future'`; a pending one is held untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| I10 | One order. Two logs fed the same stream, each re-applying its own pending commits, end with the same confirmed commits and the same ruleset as the object (a property test)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| I11 | Re-applying never moves a sim to another dataset. A re-applied pending commit is stamped with the dataset the fold is on after the commits before it; only a move commit carries another, and a re-applied move to another dataset than the fold's is kept only while the server's dataset is unknown or equals the move's. Reading never moves a sim. When a move's diff is empty no move commit is made, and the first commit after it carries the page's dataset. A move is never sent alone: a bare move is not handed out by `head()`, is not written, and is dropped when the edit behind it is refused or changes nothing; and a re-walk that keeps a lead move (a move first in pending, to another dataset than the tip's) with nothing kept behind it drops it, whoever authored it and whenever |
| I12 | The store authors on a sim only when the fold's dataset is null or the page's (an edit), or the page knows it is current (its dataset is the server's) and a move goes first. It never authors while it is stopped, and `stopped` is non-null whenever the log holds anything (see the dataset rule)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## The log

`LocalLog` holds three lists of commits for one sim.

- **Confirmed**: `Commit`s in `seq` order, folded into a tip `LogState`. `receive(commits)` skips seqs at or below the tip, applies the next ones in order and answers `{ kind }`:

  | `kind`    | When                                                                                  | Also                     |
  | --------- | ------------------------------------------------------------------------------------- | ------------------------ |
  | `applied` | Every new commit applied                                                              | `changed`, `drops`       |
  | `stale`   | Every commit was already held; nothing was done                                       |                          |
  | `gap`     | A new commit is not the next seq: the ones before it applied                          | `after` (resume from it) |
  | `future`  | A commit is under a newer shape revision: nothing from it on applied, `future` is set | `changed`, `drops`       |

  A stored commit this build cannot fold (any error but `future-shapes`) is a bug: the prefix is kept and the error is thrown.

- **Pending**: `Pending { draft, targetId }`, the commits this tab made and has not seen confirmed, re-applied on the confirmed tip. `targetId` is a restore's target commit by id (null for position 0).
- **Held**: pending records kept untouched and out of force (see Held commits).

`push(p)` takes a commit authored on `position` (`tipSeq` plus the pending count): `RangeError` unless `p.draft.parent` is that position, `LogError` when it does not fold with `check`. `drop(id)` removes a pending commit the server refused `invalid` and re-applies the rest. `forget(ids)` removes ones another tab took. `adopt(pending)` appends claimed ones after this tab's own. All re-apply; each answers its `DropReport`s.

When a received commit is this tab's own head pending commit (the first ones, all ten draft fields canonically equal), `receive` takes it off pending without re-walking: the fold, local state and history stand. It re-walks anyway when a refused move or commits held for the dataset could now be retried. Any other new commit re-walks.

`rulesetAt(position)` folds from a checkpoint: a clone of the tip at every 256th confirmed seq (the spacing doubles, dropping the odd ones, past 64 checkpoints), and for pending positions a clone of the work state every 32 pending commits.

### Re-applying

Every re-walk applies the pending commits in order on a clone of the confirmed tip (`#reapply`). Per commit:

- A draft under a newer shape revision is held with everything after it, before anything else is read.
- A pending commit whose id is confirmed is removed.
- An edit goes through the log core's `reapply`: changes that no longer apply are dropped one by one (`DropReport.dropped`); a commit with nothing left is dropped whole (`why` `empty` or `invalid`).
- A restore is not re-applied: it is recomputed with `diff(current, ruleset at its target's present position)`, aligned to the fold's dataset when the target is on another. Its `restores.position` is the target's new position. No target (it was dropped) is `target-gone`; no change is `empty`.
- A move is recomputed the same way (see The move and alignment commits).
- A commit that no longer parses, fits `fitsCommit` or folds with `check` is dropped (`invalid`, `too-large`).

`DropReport` is `{ id, label, whole, why, dropped }`; `why` is `empty`, `invalid`, `too-large`, `target-gone`, or null when only some changes went. A restore or move re-applied to something different is rewritten in this build's shapes revision and build; an edit keeps its own, with its changes and dataset recomputed. A commit changed by nothing keeps its record. Re-applying never refuses for the pending cap.

## The dataset rule

The page's dataset is `stamp().datasetVersion`, read when a log is made and at each authoring. The fold's dataset is the dataset of the last commit folded (null with none). The server's dataset is null until `setServerDataset` (the socket's `hello` carries it). `datasetDecision(page, fold, server)`:

| Fold's dataset      | Server's dataset | Decision                     |
| ------------------- | ---------------- | ---------------------------- |
| null, or the page's | any              | `edit`                       |
| another             | null             | stop `'unknown-dataset'`     |
| another             | the page's       | `move` (the page is current) |
| another             | another          | stop `'stale'`               |

`edit` authors an ordinary commit. `move` authors the move commit first, then the edit behind it. Undo and redo are off while the decision is `move` or a stop.

`LogStore.stopped` is `Stopped | null`, derived in this order:

| `stopped`           | Set when                                                                                                                                    | Cleared by                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `'future'`          | The log holds a commit (confirmed or pending) under a newer shape revision                                                                  | Nothing, for that log. `open` makes a new log, which is `'future'` only if that sim holds such a commit                                                      |
| `'unknown-dataset'` | The fold is on another dataset and no `setServerDataset` came; or any commit is held and no `setServerDataset` came                         | `setServerDataset`                                                                                                                                           |
| `'stale'`           | The decision says stop `'stale'`; or any commit is held and the server's dataset is known; or the server refused a move or alignment commit | The server's dataset changing (`setServerDataset` with a different value); a commit applied by `receive` (for the refusal); the held commits leaving; `open` |

The store never authors while the log holds anything (a push would land behind it, out of view). While stopped: `apply` answers false, `rename`, `undoTo`, `undo` and `redo` do nothing, `importContent` answers `'stopped'`, `head()` answers null. An open draft is settled before any call that can stop the store, and one that cannot be authored then is discarded with `refusal` `'stopped'` (see Drafts).

A move or alignment commit the server refuses: the client calls `dropPending(id)`; the store is stopped `'stale'` until a commit is applied by `receive` or the server's dataset changes, and no other move is authored in that time, so a refused move never loops.

### The move and alignment commits

A `system` commit with source `sim.dataset` (`MOVE_SOURCE`) and label `Moved to new data` (`MOVE_LABEL`) whose changes are `diff(fold, align(fold, to))`. `align(content, to)` is the page's: it moves a ruleset onto dataset `to` or answers null when it has no calibration for `to`; it is pure and idempotent (plan 3 supplies `reconcilePolicy4`; the default is the identity). A move to another dataset is a move; one on the fold's own dataset (re-aligning what a foreign commit or restore brought in) is an alignment commit, treated the same. `authorMove` answers `'unchanged'` for an empty diff or a log with no commits, `'invalid'` when `align` answers null.

The store authors one:

- Before an edit, when the decision is `move` (`#prepare`). It is a bare move until a commit is authored behind it; with a coalescing draft open it stays bare across calls.
- After a re-walk with pending commits, when not stopped and the decision is `move` or the fold is already on the page's dataset: an alignment of what changed (the alignment step, run after `setServerDataset`, `receive`, `dropPending`, a claim and the like). An open draft is settled first when there is anything to align. With nothing pending, nothing is authored.

The log itself also authors a move. When the page is current (the server's dataset is the page's, nothing newer is held) and the confirmed tip is on another dataset, a re-walk puts a move to the page's dataset ahead of the pending commits (a new id, or the pending head if it already is such a move, recomputed). If `align` changes nothing, no move is made and the first pending commit carries the page's dataset. A lead move with nothing kept behind it (everything after it dropped or held) is dropped, unreported: this holds for any move kept first whose target is another dataset than the tip's, whether this log, the store or an earlier page authored it (I11). An alignment commit on the tip's own dataset moves nothing and may be left as the only pending commit. If the caller drops a lead move the log authored, none is authored again until `receive` applies a commit or the server's dataset changes.

### Re-stamping

A re-applied commit is stamped with the dataset the fold is on after the commits before it (I11). A pending edit made while the page was current is therefore re-stamped when the page stops being current (`setServerDataset` to another value with pending commits re-walks). A move to another dataset than the fold's is kept while the server's dataset is unknown or is the move's, and dropped (unreported) when the server's is another. A restore is recomputed against the dataset the fold is on at that point.

### Held commits

What is held, in first-seen order:

- Pending commits from a newer build (`shapes` above this build's revision) and everything after them. The log is `future`.
- A restore or move whose `align` answered null, and everything after it (the fold is on a dataset this page has no calibration for).
- A commit pushed or adopted while anything is held goes behind it, held, and does not change the fold (adopted ones are retried with the rest when the page is current).

They are stored in IndexedDB with the pending records (a held record is a record of work, not of what is in force) and are never sent: `head()` reads only pending. They are not counted by the pending cap. They come back:

- Commits held for the dataset are retried, in their order, at every re-walk while the page is current. One that still cannot be aligned is held again.
- Commits held for a newer build are not retried by that log. Reloading on a newer build reads them as pending.
- A held commit whose id turns up confirmed (an earlier page sent it) is no longer held. `forget` removes one another tab took.

## Authoring

Every authored commit has `id` (from `mintId`, default `newId`), `parent` (the log's `position`), `shapes` (this build's `SHAPES_REVISION`), `build` and `datasetVersion` from `stamp()`, a `source` and a `label` (`clampLabel`: one over `LABEL_MAX`, 200 UTF-16 units, is cut to 199 units, or 198 where 199 would split a surrogate pair, plus `…`; one at or under it is kept). Its `changes` are `diff`s from the fold.

| Call                | `kind`                             | `source`                                       | `label`                        |
| ------------------- | ---------------------------------- | ---------------------------------------------- | ------------------------------ |
| `apply`             | `edit`                             | `sim.edit` (the fourth parameter overrides it) | the editor's label             |
| `rename`            | `edit`                             | `sim.name`                                     | `Rename`                       |
| `undo`              | `restore` (`as: 'undo'`)           | `sim.undo`                                     | the label of the change undone |
| `redo`              | `restore` (`as: 'redo'`)           | `sim.redo`                                     | the label of the change redone |
| `undoTo`            | `restore` (`as: 'jump'`) or `edit` | `sim.revert`                                   | the caller's label             |
| `importContent`     | `system`                           | `sim.import`                                   | `Imported` unless given        |
| a move or alignment | `system`                           | `sim.dataset`                                  | `Moved to new data`            |

An authored commit is refused, in this order: nothing changed (`unchanged`: not reported to the editor, no `refusal`); `toLogForm` or `diff` throws `RangeError` (an empty brush, two items with one key), `parseCommitDraft` fails, or `align` answers null (`invalid`, logged `[sim-store] edit refused`); it does not fit `fitsCommit` (`too-large`); the pending cap (`queue-full`). The cap is `PENDING_MAX` 1,000 commits or `PENDING_BYTES_MAX` 8 MiB of draft JSON in force in this tab for the sim. The cap counts what is in force, not what is held. A refusal leaves the policy as it was and sets `refusal`; the next authored commit, or an `unchanged` outcome, clears it. Reason for the cap: it sits far inside the object's limits of 100,000 commits and 64 MiB a sim, so one tab's queue cannot fill a sim; and it drains in about seven and a half minutes at the object's rate.

The first authored commit of a store with no sim id mints the sim id (`mintId`).

## Drafts

An edit with a `coalesce` key equal to the open draft's continues it: the policy shown is the editor's output, in memory only, no commit, `drafting` is true and `apply` answers true. A drag or a stepper run is one draft and, once settled, one commit (R1). Anything else ends the draft first, then acts.

A draft ends in one of these ways, and `drafting` is false afterwards:

| Way it ends                                                                                   | Result                                                                          |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `settle()`                                                                                    | Committed as one `edit` with the draft's label and source                       |
| An `apply` with another key or none, `rename`, `undoTo`                                       | Committed, then the call goes on                                                |
| `undo()` or `redo()`                                                                          | Committed, then undone; or see Undo                                             |
| `importContent`, `open`, `claim`                                                              | Committed first (a draft opened meanwhile during a claim is committed after it) |
| A foreign commit in `receive`                                                                 | Committed before the commit is folded                                           |
| `setServerDataset` with a different value                                                     | Committed before the change, while the store can still author                   |
| `dropPending`                                                                                 | Committed before the drop, while the store can still author                     |
| The alignment step, with something to align                                                   | Committed before the alignment                                                  |
| A write completing with a lost record (`#lose`), a withdrawn import, adopting the current sim | Committed before the fold changes                                               |

A draft that cannot be authored (the store is stopped, or the move it needs was refused) is discarded, never silently: `refusal` is `'stopped'` (or the move's reason). A draft that changes nothing (a stepper run up and back) is dropped with no commit and no refusal. `refusal` after a draft refused by `open` is kept visible.

Every call that can stop the store settles the draft first, so work in progress is committed and stored before the stop. A call that does nothing (`setServerDataset` with the value it has) leaves the draft open: a reconnect whose `hello` carries the same value and whose resume brings no foreign commit does not split a drag.

A drag can still become two commits: a foreign commit arriving, another tab's claim of this tab's records (the write answers `lost`), a withdrawn import, and a changed `hello` each settle the draft first, and the rest of the drag is a new draft.

A draft open when the tab closes is committed in memory by `settle()` (the page will call it on `pagehide`); its IndexedDB write is best effort, since the page may be gone before it completes. `written()` resolves when nothing is left to write, for a caller that can wait.

## Undo, redo and jumps

`canUndo`, `canRedo`, `undoLabel` and `redoLabel` come from `History`, which walks the commits as the log core's `undoRedo` does and keeps the label of the commit that put each target on a stack. A `system` commit empties both stacks. A restore with `as: 'undo'` or `'redo'` to a position on its stack pops back to it; anything else (an edit, a jump, a restore to a position not on its stack) pushes the current position on the undo stack and empties redo.

- `undo()` and `redo()` author a restore of the target position and return its label (the label of the change undone or redone) at once, or null. Nothing is authored when stopped or when the decision is not `edit`; both are off then (`canUndo`, `canRedo` false).
- A target is compared as `authorRestore` would author it, aligned to the page's dataset when it is on another, and skipped when that equals the current ruleset (`nextTarget(log, which, align, stamp)`), so `canUndo` is never true for an undo that would do nothing. A target `align` cannot reach is not skipped: the undo is refused `invalid`.
- While a draft is open, `canUndo` is true with the draft's label and `canRedo` is false. `undo()` commits the draft and undoes it. If the draft came to nothing it returns its label and undoes nothing, so undo stops there rather than undoing an older change; a draft refused at that moment answers null with `refusal` set.
- `undoTo(p, label)` is a jump. It restores the position of the commit that produced `p` when this store showed `p` and that commit is still in the log (a restore `as: 'jump'`, which clears redo and counts as an edit for later undo); a policy this store never showed, or whose commit is gone, is an ordinary edit to `p` through `normalize`. Both use source `sim.revert`. When `p` is what the fold is, nothing is authored.

## The database

`SimDb` is the store's view of the device: `memorySimDb()` (Node, tests, and the reference semantics) and `openSimDb()` (IndexedDB). Both pass the same suite, `test/sim-db-contract.ts`. Every write is one atomic transaction: it applies wholly or not at all, and its promise settles only when the transaction is durable (resolved) or refused (rejected, nothing written).

### Schema

Database `sfhousing-sim-log`, version `SIM_DB_VERSION` 1.

| Store     | Key            | Holds                                                                                                    |
| --------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `sims`    | `simId`        | `SimRecord { simId, createdAt, registered }` (`registered`: `setRegistered`, called by `markRegistered`) |
| `commits` | `[simId, seq]` | `{ simId, seq, commit }`: the device's copy of a sim's confirmed log                                     |
| `pending` | `[simId, id]`  | `PendingRecord { simId, id, n, owner, pending }`; unique index `order` on `[simId, n]`                   |
| `meta`    | `key`          | `{ key, value }`: the current-sim pointer, `n:<simId>` counters, markers                                 |

Version steps: `upgradeSimDb(db, oldVersion)` runs `if (oldVersion < 1)` creating the four stores; step 1 is never edited and a later change adds an `oldVersion < 2` step. Transactions that write ask for `durability: 'strict'`.

### Operations

| Method                                       | Does                                                                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `read(simId)`                                | `{ sim, confirmed (seq order), pending (n order, every owner) }`                                                             |
| `createSim(sim, { current, marker, batch })` | One transaction: the marker, then `current`, then the sim and batch (see below)                                              |
| `write(simId, batch, { marker })`            | One transaction: the marker, then the batch                                                                                  |
| `claimPending(simId, from, to)`              | Every pending record of the sim whose owner is in `from` gets owner `to` (its `n` is kept); answers the records in `n` order |
| `pendingOwners(simId)`                       | The distinct owners of the sim's pending records, in `n` order of their first record                                         |
| `setRegistered(simId)`                       | Sets `registered` on the sim record                                                                                          |
| `getMeta(key)`, `setMeta(key, value)`        | A meta row; `undefined` when absent                                                                                          |
| `close()`                                    | Closes the connection; later calls reject                                                                                    |

### The write batch and ownership

`WriteBatch { owner, confirmed, put, remove }`. The owner is the tab id. In one transaction: `confirmed` commits are put by `[simId, seq]` (idempotent), then `put` in order, then `remove` (an id both put and removed ends removed). Each record has one owner: a record put by one tab is the only one that can update, move or remove it.

There are three kinds of put, and `lost`:

| Put                             | A record this owner holds                                                     | Absent                  | Held by another owner |
| ------------------------------- | ----------------------------------------------------------------------------- | ----------------------- | --------------------- |
| `{ id, pending }` (plain)       | Replaced, with a new `n` (to the tail)                                        | Created with a new `n`  | `lost`                |
| `{ id, pending, n }` (in place) | Replaced, its stored `n` kept; the given `n` is ignored                       | `lost`, nothing created | `lost`                |
| `{ id, pending, move: true }`   | Moved to the tail: a new `n`, the rest replaced; `n` is ignored if also given | `lost`, nothing created | `lost`                |

`WriteResult { applied, n, lost }` answers the `n` of each put written and the ids refused. A `remove` deletes only the owner's records. The `n` counter is `meta['n:<simId>']`: it moves only up, never from a caller's value, and is written only when a put spent one. So the stored order, read back in `n` order, is the order the tab last wrote.

### The current-sim pointer

`meta['current']` names the sim `/sim` opens. `createSim(sim, { current: true })` sets it only if it is absent. The transaction is checked in this order: the marker (outcome `'marker'`, nothing written), then `current` asked while one is set (outcome `'current-taken'`, nothing written; `current` is the sim that holds it), else it puts the sim (an existing sim keeps its record: `registered` and `createdAt` stay), sets the pointer if asked, the marker's value, and applies the batch (outcome `'created'`; `applied` is true only then). Two tabs that mint a sim at once: one sets the pointer; the other's write answers `'current-taken'` and the store adopts the pointer's sim (see Two tabs).

### Reserved keys and the marker

`CURRENT_KEY` and every key starting `n:` are reserved (`isReservedKey`): `setMeta` and a marker on one reject, writing nothing.

A `Marker { key, value, expect }` is a compare-and-set on a meta row, in the same transaction as the write: written only when the stored value equals `expect` (compared by `JSON.stringify`; `expect: undefined` means the row must be absent). A write whose marker does not match writes nothing (`applied: false`).

### Opening

`openSimDb({ name, onVersionChange })` answers a `SimDb`, or null when there is no `indexedDB`, reading `indexedDB` throws (some private modes), the open is blocked, or the open fails, including a version error. A version error is what an older build's tab sees after a newer build upgraded the database: today it is indistinguishable from "no storage". A newer version opened elsewhere closes this connection and calls `onVersionChange`; every call then rejects with `Error('closed')`.

### Completion and failure

A call settles on its transaction's `complete` (resolve) or `abort` (reject; an `error` event is followed by `abort`), never on a request's `success`: a quota error aborts a transaction after its requests succeeded. A write that fails rejects with its own error (the request's or the transaction's), so its `name` survives. Inside a transaction's body only requests are awaited. `openSimDb` logs nothing: the store says what to log.

## The store

`LogStore implements DocStore` over a `LocalLog` and a `SimDb | null`. `LogStoreOptions`: `db` (null: no storage), `tabId` (this page load's id, the owner of its pending records), `stamp()` (`{ datasetVersion, build }`, read at each commit), `mintId`, `normalize(next, prev)`, `align`, `now`, `current` (default true: a sim this store mints asks for the pointer) and `caps` (tests only).

Every derived value is a rune set once per change (`$state.raw`), and subscribers are told once at the end of each public call that changed something, and at the end of each write loop (after a write lands). The notification is synchronous, inside the call, and is part of the store's contract (the store's tests pin it): the sync client relies on it to send a commit once it is stored, and a subscriber may call into a socket that stops or reconnects from inside it. A store starts not `ready`: `open` makes it so, and until then `apply`, `rename`, `undo`, `redo`, `undoTo` and `importContent` do nothing, and `head()` answers null.

### Writes

The write chain keeps one write in flight. Each write is the whole dirty state at the time it starts, so a burst made during a write becomes one following batch. The batch is:

- the confirmed commits not yet stored;
- a put for each pending then held record in the log's order, a bare move aside. A record stored before is put in place (with its `n`) while the stored order matches the log's, and from the first one out of order on, each is put `move: true` (to the tail). A new commit of this tab is put plainly; a claimed record, which this tab never wrote but owns, is put `move: true`. A record stored before is never put plainly, so one another tab took comes back `lost` and is not re-created;
- a remove for each record stored and no longer pending or held.

A sim not yet on the device is created by `createSim` with its first commit's batch; a sim already stored is `write`n. With nothing to write, or a sim not stored and nothing authored, no write starts (I6). `local` is `'writing'` during a write, `'idle'` after, `'failed'` for ever after a failure. A write that comes back `lost` forgets those records (`LocalLog.forget`): they are never sent from this tab.

### Storage failure

With `db: null`, or after any failed write, `local` is `'failed'` for the store's life, and the failure is logged once as `[sim-store] write failed <error name>`. Commits are still handed out by `head()`, at once, to be sent. Nothing says they are stored on this device: `local` stays `'failed'`. `open` still reads when it can, but claims nothing, and nothing further is written. An import with storage failed answers `'imported'` and records no marker, so the next page load would import the same autosave again.

### The import

`importContent(content, marker, label?)` authors one `system` commit (`sim.import`) to `content`, written together with the marker. It answers:

| Result                                     | Means                                                                                                                                                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'imported'`                               | The commit is pending, and with storage working its write, marker included, landed; or storage is failed or absent (no marker recorded)                                                              |
| `'marker'`                                 | The marker was not what was expected: withdrawn, no marker written, unreported. Or re-applying dropped the import before its write: withdrawn, no marker written, and a drop report names the import |
| `'unchanged'`                              | `content` is what the fold is                                                                                                                                                                        |
| `'invalid'`, `'too-large'`, `'queue-full'` | The edit refusals                                                                                                                                                                                    |
| `'stopped'`                                | Not ready or stopped                                                                                                                                                                                 |

Imports run one at a time. A withdrawn import takes with it the move it needed, and a sim minted for it that holds nothing is not made.

### Opening a sim and claiming

`open(simId | null, { claim? })` replaces the log. It settles an open draft, writes what this tab made on the sim it leaves, claims (`claimPending(simId, claim, tabId)`) when `claim` is non-empty and storage works, reads the sim and takes the confirmed commits and this tab's records (including claimed ones), in `n` order, as its pending commits, re-applied. `null` is a new sim: its id is minted at the first commit. With no database, a known id opens with an empty log. `open` rejects when the read fails, and the store then stays not `ready`: nothing can be authored or sent until an `open` succeeds. The server's dataset is kept across `open`.

`claim(owners)` takes other tabs' pending records of the open sim and re-applies them after this tab's own, putting them again with new `n`. It answers how many were adopted, and settles a draft first. `open` and `claim` run one at a time in the order called; calling `claim` then `open` without awaiting is safe.

### What the socket reads

`tipSeq` (the last confirmed seq, a resume's `after`) and `heldCount` (commits held out of force: not pending, never sent, still on the device) are set in the one derive step. `registration` is a plain getter over the store's fields, not a rune (read it from a subscriber call): `'none'` (no sim, or a look: a sim with no record here that this store did not mint), `'wait'` (minted here, storage working, first write not landed), `'needed'` (stored and not recorded registered, or minted with storage absent or failed), `'done'`. `markRegistered(simId)` (the server answered 200 or 201) does nothing for another sim than the open one; else it sets `'done'` and tells subscribers at once, then, after the write chain, records it with `setRegistered` when the sim is stored and storage works. It never rejects: a failed record logs `[sim-store] registration not stored` with the error name, and the next load registers again.

### Two tabs

Each tab shows the confirmed commits and its own pending ones. A tab does not see another's pending commits (the records of every owner are read, but only its own, and any it claims, are taken). A tab notices a record another tab took only when it next writes that record (the answer says `lost`). A commit sent by two tabs is answered `duplicate` by the sim object ([sim-object.md](sim-object.md): no frame, one rate token spent), so it cannot become two commits.

Two fresh tabs making their first edit at once: one sets the current pointer. The other's `createSim` answers `'current-taken'`: it reads that sim, replaces its log with that sim's confirmed commits and its own pending ones on top, under that id, and writes them there (an import's marker goes with them).

## The interfaces

### For the editors: `DocStore`

```ts
interface DocStore {
  readonly policy: SimPolicy4;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | null;
  readonly redoLabel: string | null;
  apply(change: (p: SimPolicy4) => SimPolicy4, label: string, coalesce?: string): void;
  undo(): string | null;
  redo(): string | null;
  undoTo(p: SimPolicy4, label: string): void;
}
```

There is no `reset`: a load is `open` or the import. `LogStore.apply` has the same parameters plus a `source` and returns a boolean, true when this edit changed what is shown (its own change after settling a draft; false when stopped, refused, unchanged, or the fold came out equal to what was shown). The structural `DocStore` type is what the editors' props change to.

### For everything else: `LogStore`

Read-only state: `ready`, `simId` (null until the first commit mints it), `policy`, `name`, `canUndo`, `canRedo`, `undoLabel`, `redoLabel`, `local` (`'idle' | 'writing' | 'failed'`), `drafting`, `pending` and `pendingCount` (in force, in order), `stopped`, `tipSeq`, `heldCount`, `registration`, `serverDataset`, `drops` (`DropReport`s, kept until `clearDrops()`), `refusal` (`'invalid' | 'too-large' | 'queue-full' | 'stopped' | null`).

Calls: `rename(name)`, `settle()`, `clearDrops()`, `open(simId, { claim })`, `claim(owners)`, `importContent(content, marker, label)`, `written()`, `subscribe(fn)` (returns the unsubscribe), and for the socket client:

| Call                      | When and what                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setServerDataset(s)`     | From the socket's `hello`. A value equal to the one held does nothing. Re-applies, then re-decides (the dataset rule)                                                                                                                                                                                                                                                                                                                    |
| `receive(simId, commits)` | Any commit from the stream of sim `simId`, a confirmation included. Answers `StoreReceived`: the log's `applied`, `stale` (every commit already held), `gap` (resume from `after`) or `future`; or `{ kind: 'stale', why }` when the frame was ignored, applying and writing nothing: `why` is `'other-sim'` (`simId` is not the store's sim) or `'not-ready'` (an `open` under way, or one that rejected). Writes the confirmed commits |
| `head()`                  | The head pending `CommitDraft` that may be sent now, or null (see below)                                                                                                                                                                                                                                                                                                                                                                 |
| `markRegistered(simId)`   | The server answered 200 or 201 for `simId`: `registration` becomes `'done'` (see What the socket reads). Never rejects                                                                                                                                                                                                                                                                                                                   |
| `dropPending(id)`         | The server refused `id` `invalid`: drops it, re-applies the rest, reports it. A refused move or alignment commit also stops the store `'stale'`. An id not pending does nothing                                                                                                                                                                                                                                                          |

`head()` answers null: while not `ready` (an `open` under way, or one that rejected); before `setServerDataset`; while stopped; for a bare move; and, with storage working, until the version of `pending[0]` it would return is stored. With no database or `local` `'failed'` it answers at once. After a write lands, subscribers are told: ask `head()` again.

## Costs and limits

- The pending cap is 1,000 commits and 8 MiB per tab and sim (see Authoring).
- Confirmed positions are folded from checkpoints (every 256, at most 64, then the spacing doubles); pending positions from every 32nd.
- Each re-walk clones the confirmed tip and the confirmed history, so a `receive` that applies foreign commits costs time linear in the log's length once per call, not once per commit.
- The store writes the confirmed commits of every sim it opens that is on the device, and of a new sim from its first commit; a look at an unstored sim writes nothing. A sim at the object's limit is 64 MiB.
- Not tested: Firefox (it could not be launched on the machine that built this: "Could not find profile folder"), and a real quota error (the write-abort seam, `abortWrites`, stands in for one).

## For the next plans

The socket client (plan 2) is built in `src/lib/sim-sync/` ([sim-sync.md](sim-sync.md)); a page opens the store through it (`SimSync.open`) and does not call the store's socket side itself. What it relies on, for anyone else who calls the store:

- `simId` can change after it first appears: adopting the current sim another tab made replaces a minted id, and a withdrawn import sets it back to null. Register a sim only when `registration` says `'needed'` and it has something to send: `'wait'` (minted here, storage working, the first write not landed) is not yet, `'none'` is a look, and with no database or after a failed write a minted sim is `'needed'` at once. Not when `simId` first appears.
- After a failed write the device keeps its records as they were at the failure (removes are never written). A later load reads them again: commits confirmed since are removed by id after the resume (each early re-send spends a rate token as a `duplicate`), and commits dropped since come back and are reported again.

The page (plan 3):

- calls `settle()` when focus leaves an editor, on `visibilitychange` to hidden, on `pagehide`, in `beforeNavigate` and in teardown;
- switches the editors' props to `DocStore`, and replaces the page's load (`PolicyStore.reset`) with `open` or the import;
- shows a notice for each stopped reason (`'stale'`, `'unknown-dataset'`, `'future'`) and each refusal reason (`'invalid'`, `'too-large'`, `'queue-full'`, `'stopped'`);
- decides what an out-of-date tab (a connection closed by a newer version, `onVersionChange`, or an `openSimDb` that answers null on a version error) and a browser with failing storage see;
- shows the save state from `sync.state.save` ([sim-sync.md](sim-sync.md), The save state), which counts held commits and a stop only while something is pending or held; the page's part is the copy for each `why`;
- does not offer editing a known sim with no copy on this device (no IndexedDB, `open` with `db: null`, or a sim never stored here) until its first `commits` frame: until then the fold is empty, the dataset decision is `edit`, and edits on that empty fold are re-applied, and may be dropped, once commits arrive;
- needs a new operation for Remix. A new sim's first write asks to become the current sim, and when one is already current the store adopts it (decision 28): right for two fresh tabs, wrong for Remix, where `open(null)` plus `importContent` would write the shared document into the person's existing sim. There is no workaround in the store as built (`setMeta` refuses `CURRENT_KEY`; `current: false` leaves the remix unreachable from `/sim`). Plan 3 must add an operation that creates a new sim and makes it the current one in one write, replacing the pointer, designed so that the two-fresh-tabs rule still holds, and Remix uses it. Until then the store cannot start a second sim in a browser that already has one.

## What is not built yet

- The page, the autosave import (`importContent`'s caller), the copy for each save-state reason and the notices: plan 3.
- Pending commits becoming a remix when a sim stops being writable, and a way to re-home a sim's pending records to a new sim id in one transaction: the sharing unit.
- Reading a sim on its tip's own dataset: plan 4.

## Tests

`npx vitest --run --project server src/lib/sim-store src/lib/sim-log` runs the Node specs: `dataset`, `history` (a property test against `undoRedo`), `local-log` (including convergence and release properties), `author`, `log-store` and `log-store.persist` (the store over `memorySimDb`), and `sim-db.spec.ts`, which runs the contract suite on `memorySimDb`.

The sync client's specs are in [sim-sync.md](sim-sync.md). `npx vitest --run --project client src/lib/sim-store` runs `idb.svelte.spec.ts` in Chromium: the same contract suite on `openSimDb`, plus the database name and version, reopening, a newer version closing the connection, a write settling on `complete`, two connections allocating `n`, one `current`, a failed write rejecting with its own error and a throwing `indexedDB` answering null. `SFH_BROWSER=webkit` runs it in WebKit ([testing.md](testing.md)). Firefox is not run.
