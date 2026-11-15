# Sim log core

The pure TypeScript core of the sim log: `src/lib/sim-log/`. A sim is a log of commits; each commit is a list of changes to keyed items, and folding the log gives the ruleset (a schema 4 policy and a name). This is unit 1 of the sim message log; the Durable Object that orders and validates commits and the browser log store are later units and import only `$lib/sim-log`. Design: [2026-11-14-sim-message-log-design.html](../superpowers/specs/2026-11-14-sim-message-log-design.html) (rule numbers below are its rules). The policy document is that of [policy-timeline.md](policy-timeline.md).

No I/O, no DOM, no Worker-only or Node-only API, no `$app/*`, no `$lib/server/*`. Runs in the browser, a Worker and Node.

## Files

| Where                        | What                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/lib/sim-log/index.ts`   | The public surface (named re-exports). Import from `$lib/sim-log`, not from the files below                 |
| `src/lib/sim-log/types.ts`   | `Change`, `CommitDraft`, `Commit`, `Restores`, `FoldInput`, `Ruleset`, `LogError`, `LogFormatError`, limits |
| `src/lib/sim-log/parse.ts`   | `parseChange`, `parseCommitDraft`, `parseCommit`                                                            |
| `src/lib/sim-log/keys.ts`    | `NAME_KEY`, `policyKey`, `spanKey`, stroke keys, list keys                                                  |
| `src/lib/sim-log/shapes.ts`  | `REGISTRY`, `SHAPES_REVISION`, `DEFAULT_SIM_NAME`, `versionAt`, `upgradeFields`, `upgradeSet`               |
| `src/lib/sim-log/items.ts`   | `flatten`, `assemble`, `toLogForm`, `rulesetText`, the structural roles of a shape                          |
| `src/lib/sim-log/state.ts`   | `LogState`, `fold`                                                                                          |
| `src/lib/sim-log/check.ts`   | `checkRuleset`                                                                                              |
| `src/lib/sim-log/diff.ts`    | `diff`                                                                                                      |
| `src/lib/sim-log/reapply.ts` | `reapply`                                                                                                   |
| `src/lib/sim-log/history.ts` | `undoRedo`                                                                                                  |
| `src/lib/sim-log/chain.ts`   | `GENESIS_HASH`, `commitText`, `chainHash`, `verifyChain`                                                    |
| `src/lib/sim-log/test/`      | `fixtures.ts`, `arbitraries.ts`: test helpers, not exported                                                 |

## The commit

`CommitDraft` is what an author sends: `id` (a valid id), `parent` (the seq it was made on, a whole number from 0), `kind` (`edit`, `restore` or `system`), `label`, `restores`, `datasetVersion`, `shapes` (the shape revision, at least 1), `build`, `source` and `changes` (never empty). `Commit` adds `seq`, `actor`, `at` and `hash`, which the sim object sets. `parseCommit` also requires `parent === seq - 1`, `actor` of 1 to 64 characters, `at` a whole number from 0 and `hash` of 64 lowercase hex characters.

Limits (exported): `LABEL_MAX` 200, `BUILD_MAX` 64 (at least 1), `KEY_MAX` 256 (every key and `after`, at least 1), `SOURCE_MAX` 64, `SOURCE_RE` (lowercase dotted words, for example `sim.name`). A `datasetVersion` must match `DATASET_VERSION_RE`.

`restores` is `{ position, as }`, with `position` from 0 to `parent` and `as` one of `undo`, `redo` or `jump`. A `restore` commit must have it and any other kind must have null. A jump counts as an edit for undo and redo. A `system` commit empties both stacks (see Undo and redo).

The parsers throw `LogFormatError` with a `path` (`changes[2].key`). `parseChange(v, path)` takes the path its errors start from. Unknown and missing keys are errors. An absent `after` on an `add` stays an absent key; the parser never sets it to `undefined`.

## Changes

Five ops, `Change` in `types.ts`. `LogState.apply` reads a commit's changes in order, under the commit's `shapes` revision.

| Op       | Fields                             | Applies when                                                                                                                       |
| -------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `add`    | `key`, `shape`, `fields`, `after?` | Fields parse as the shape; key is free, is not `sim` and fits the fields; its parent exists with the right shape; `after` as below |
| `end`    | `key`, `to`                        | A span; `to` is not before `from`; the span has no end or ends after `to` (truncation only)                                        |
| `move`   | `key`, `after`                     | A listed item; `after` is null (first) or another key in its list                                                                  |
| `set`    | `key`, `field`, `value`            | The field is settable in the newest version of the item's shape and the value passes its check                                     |
| `delete` | `key`                              | The item exists and is not `sim`                                                                                                   |

- Listed items (policies, strokes) need `after` on an `add`: null for first, or a key already in the list. Other items must not have it.
- A `delete` cascades: a policy takes its spans and their strokes, a span its strokes, and their lists.
- There is no edit in place (R4). Only `name`, `label` and `on` can be `set`; spans and strokes have no settable field. A changed band is a delete and an add in one commit. An `end` only shortens; to lengthen a span, delete it and add it again.
- A stroke add must agree with the kind and stories of the other strokes of its brush in the span.
- `LogError` carries `code` (`invalid-change`, `invalid-ruleset` or `future-shapes`) and `index`: the change that failed, or for a stroke-order refusal the last change that touched the span; null for `invalid-ruleset` and `future-shapes`.
- Fields on an `add` are parsed under the shape version the commit's revision names, upgraded to the newest, parsed again with the newest when upgraded, and cloned (`readFields`). A faulty upgrade is `invalid-change` at that change.

## Items and keys

A sim is flattened to keyed items and ordered lists (`flatten`, `assemble` in `items.ts`).

| Item     | Key                                             | Shape                | Fields                                                |
| -------- | ----------------------------------------------- | -------------------- | ----------------------------------------------------- |
| the sim  | `sim` (`NAME_KEY`)                              | `sim`                | `name`                                                |
| a policy | `p:<id>` (`policyKey`)                          | `policy.<where tag>` | `id`, `kind`, `where`, `label`, `preset`, `on`        |
| a span   | `s:<from>:<policyId>` (`spanKey`)               | `span.<where tag>`   | `policy`, `from`, `to`, `what`                        |
| a stroke | `k:<digest>`, repeats `k:<digest>~2`, `~3`, ... | `stroke`             | `span`, `brush`, `kind`, `stories`, `path`, `radiusM` |

- The digest is `digest128(canonicalJson)` of the six fields `span`, `brush`, `kind`, `stories`, `path` and `radiusM`, picked by name (`strokeKeyBase`), so a field a later stroke version adds is not in the key. The n-th identical stroke in a span gets `~n` for n of 2 or more (`strokeKeys`). Two strokes of one span with the same fields are legal.
- Lists: `l:<kind>` holds the policy keys of `zoning`, `permitting` and `money` in order; `l:<span key>` holds the stroke keys of a span in order. An absent list and an empty list are the same, and `flatten` creates no empty list.
- A brush is not an item. Its strokes are items with the brush's `id`, `kind` and `stories` copied on each. `assemble` collects a span's strokes by `brush` in list order, so a brush's strokes must be together and agree on kind and stories. A painted span's `what` in the item is only `{ tag: 'brushes' }`. Other `what` values are kept whole.
- Spans of one policy are assembled in ascending `from`.
- Log form: no brush has zero strokes. `toLogForm(policy)` drops empty brushes; `flatten` throws `RangeError` on one.
- `flatten` also throws `RangeError` on two items with one key: two policies with one id, or two spans of a policy with one `from`. `checkRuleset` refuses both.
- A folded state is canonical: its item keys and lists always equal those of `flatten(state.ruleset())`.
- `rulesetText` is `canonicalJson({ name, policy })`: a ruleset's identity.

## Shapes

The registry (`REGISTRY`, `shapes.ts`) names every shape of the log (R57, R62).

- `revisions[revision][shape]` is the version of a shape that a commit of that `shapes` revision uses. `shapes[shape]` lists the versions, index 0 being version 1. `current` is `SHAPES_REVISION`.
- Revision 1 has sixteen shapes, all at version 1: `sim`, `stroke`, and `policy.<tag>` and `span.<tag>` for `transit`, `painted`, `category`, `routes`, `baseline`, `fund` and `terms`. A policy's `kind` and a span's `what.tag` are fixed by its tag's row (`WHERE_ROWS`).
- A `ShapeVersion` has `parse` (exact keys and primitive types, throws `LogFormatError`), `settable` (field to value check) and, except on the newest, `up`: `fields` to the next version and optionally `set`.
- `versionAt(reg, revision, shape)` throws `LogError('future-shapes')` for a revision above `current` and `invalid-change` for a revision without the shape.
- Upgrade on read (R54): fields parsed at an older version go through each `up.fields` to the newest. A `set` goes through each `up.set`, then is checked against the newest version's `settable`. A commit is never rewritten.
- `LogState.apply` throws `future-shapes` before changing anything when the commit's `shapes` is above the registry's `current`.
- A version may add fields but never changes the fields a key is built from: a stroke's six key fields, a policy's `id`, a span's `policy` and `from`. Keys are not rewritten on read, so an `up.fields` that changes one of those values is forbidden.

To add a version of a shape:

1. Append the new `ShapeVersion` to that shape's array. Do not edit or remove the old one.
2. Give the old version an `up` that takes its fields (and `set`s, if a field moved) to the new one.
3. Raise `SHAPES_REVISION` and add `revisions[new]` mapping every shape to its version. Keep every older revision row.
4. Add a fixture test: a commit written under the old revision folds to the same `rulesetText` as its upgraded form (see the tests "an older shape version folds to the same text as its upgraded form" and "an older stroke version keeps its key and folds to the text of its upgraded form" in `state.spec.ts`).

`shapes.spec.ts` fails if a shape is dropped or an older version has no `up`.

## Fold and validity

`new LogState` is private; use `LogState.empty(registry?)` (name `DEFAULT_SIM_NAME`, `DEFAULT_POLICY4`, no dataset version) or `LogState.of(ruleset, datasetVersion, registry?)`. `registry` defaults to `REGISTRY`; tests pass a fixture registry.

- `apply(input)` applies one commit's changes atomically: on any throw the state is as it was. It sets the state's dataset version to the commit's. `input` is a `FoldInput`: `changes`, `shapes`, `datasetVersion`.
- After all of a commit's changes, a check runs once for each span whose strokes the commit touched. It refuses (`LogError`, `invalid-change`) a commit that leaves a span's strokes with a brush's strokes not together, or with identical strokes not keyed `k:D`, `k:D~2`, ... in list order. A commit may pass through a bad order and be good at its end.
- `apply(input, { check: true })` also runs `checkRuleset` and, on a problem, rolls back and throws `LogError('invalid-ruleset')`. The sim object applies commits this way (R3, R18).
- `fold(commits, registry?)` applies each commit to an empty state without `check` and returns the `Ruleset`. `datasetVersion` is that of the last commit, null for none.
- `ruleset()` is memoised until the next `apply` and the same object goes to every caller until then: treat it as read-only. It shares no object with the state's items, so a write to it never reaches the state or a clone.
- `item(key)`, `list(listKey)` and `registry` read the state; `clone()` copies it.
- `checkRuleset(ruleset)` returns the first `{ path, message }` problem or null. It is structure only: the name, then `parsePolicy4` with `asOf: null` in reconcile mode, then the size limits (`simDoc4Problems`). A preset retired later never makes an accepted sim refuse edits. A null `datasetVersion` is checked as `fixture-0`.

`apply`'s only option is `check`; `reapply` defers the stroke-order check internally.

## Diff

`diff(a, b)` returns the changes that take `a` to `b`, list order included (R8, R10). Applied in order to `LogState.of(a)`, they give the items and lists of `flatten(b)`. It throws `RangeError` when either ruleset has an empty brush or two items with one key.

An item survives when it has the same shape and fields in both, apart from settable fields and a span's `to`, a surviving `to` differing only by a truncation, and its parent survives. The changes come in this order:

1. `delete` of each topmost item that does not survive; the cascade removes what is under it.
2. `add` and `move` of policies, with `after`.
3. `add` of spans (no `after`).
4. `add` and `move` of strokes, with `after`.
5. `set` of every settable field that differs, the name first.
6. `end` of every surviving span whose `to` was set or shortened.

In a list the surviving items on a longest increasing subsequence of their order are left alone; the others get a `move` after their predecessor in `b`. A changed stroke has a new key, so it is a delete and an add.

## Re-apply

`reapply(tip, input)` re-applies one pending commit's changes on a new tip (R19). `tip` is never mutated. It throws `LogError('future-shapes')` before any work when `input.shapes` is above the tip registry's `current`, as `apply` does: the commit comes from a newer build, so keep it pending rather than drop it.

It walks the changes in order, each seeing the kept ones before it. A change is dropped, and the rest of the commit stands, with one of these reasons:

| `why`            | When                                                          |
| ---------------- | ------------------------------------------------------------- |
| `gone`           | The item it names (for an add, its parent) is gone            |
| `exists`         | An add whose key is taken                                     |
| `not-truncation` | An `end` that no longer shortens its span                     |
| `no-op`          | A `move` whose anchor is gone and whose list has no other key |

- An add or move whose `after` is gone or not in the list is re-anchored. A stroke goes after the last other stroke of its brush, else last in its list; anything else goes last. A null `after` is left alone.
- A stroke add whose key is one of its own (`k:D` or `k:D~n`) takes the lowest free key of its identical strokes in the span (for example `k:X~2` becomes `k:X` when another writer deleted `k:X`). Later changes in the commit that name the old key follow it.
- An add whose key is taken is dropped as `exists` before any rewrite, so a rewrite only lowers a key. Later changes that name the key a rewrite took read as gone.
- Deletes of identical strokes are retargeted, so a delete of `k:D` on a tip where another writer added `k:D~2` does not leave the repeats unnumbered. With k deletes of one group (`k:D`, `k:D~n` for n of 2 or more) in a commit and t the highest repeat on the tip (not the working copy), the i-th delete in commit order targets repeat t - k + i, and is dropped as `gone` when that is below 1. Adds earlier in the commit are not counted: a commit deletes strokes the writer saw, and the repeats it adds are the writer's own, which the add rewrite already places. A delete is placed by this rule against the tip alone: it does not follow a key rewrite earlier in the same commit (an add whose key was lowered).
- A span key names a place (`s:<from>:<policyId>`), not content. When two writers each replace the same span, re-applying is last-writer-wins on that span: the pending delete removes the tip's replacement and the pending add stands.
- A change that `apply` refuses, other than the cases above, refuses the whole commit: `{ ok: false, why: 'invalid' }`. So does a result that fails the stroke-order check or `checkRuleset`.
- Validity is checked once per commit: the kept changes are applied one at a time with the stroke-order check deferred, then applied together to a copy of the tip with `{ check: true }`. A commit that is valid only as a whole is kept.
- A commit with nothing kept is `{ ok: false, why: 'empty' }`.
- `ok: true` returns `changes`, exactly what a full-check apply on `tip` accepted, and `dropped` (`{ index, change, why }`, `index` into the input).
- `dropped` is returned on `ok: false` too. On an `invalid` found mid-walk it holds only the changes dropped before the refusal.

## Undo and redo

`undoRedo(log)` gives the positions an undo and a redo restore to, from the log alone (R12). `log` is `{ seq, kind, restores }` for seq 1 to n in order; pending commits take provisional seqs after the tip. It keeps an undo stack and a redo stack of positions and the current position `cur` (0 at the start). For each commit:

- `system` empties both stacks. It is the barrier: nothing before it can be undone.
- A restore with `as: 'undo'` whose `position` is on the undo stack pops back to it and pushes `cur` on the redo stack. A restore with `as: 'redo'` whose `position` is on the redo stack pops back to it and pushes `cur` on the undo stack.
- Anything else, an edit, a jump or a restore whose target is not on its stack, pushes `cur` on the undo stack and empties the redo stack.
- `cur` becomes the commit's `seq`.

The result is the top of each stack, or null. The commit that carries an undo is a `restore` with `restores: { position, as: 'undo' }` whose changes are `diff(current, ruleset at position)`, folded to that position.

## Hash chain

`commitText(c)` is `canonicalJson` of every field of the commit but `hash`. It throws `TypeError` on `undefined` or a non-finite number anywhere. `chainHash(prev, c)` is `sha256Hex(prev + commitText(c))`, the `hash` of the commit table. Both `chainHash` and `verifyChain` are async. `GENESIS_HASH` is 64 zeros, the `prev` of seq 1. `verifyChain(commits, prev?)` resolves to the first `seq` whose position (a seq that is not the next one, R27) or hash is wrong, or null; `prev` is `{ seq, hash }` of the commit before `commits[0]`, default seq 0 and `GENESIS_HASH`.

`chain.spec.ts` pins the canonical text of a fixture commit and its hash `949f77d708450cca256a9febe90b7d57a978de51360da8610f03be5daee78243`, checked against Node's SHA-256. Changing `commitText` changes every stored hash: do not.

## Using it from the sim object and the store

The sim object (unit 2):

1. Parses an `append` with `parseCommitDraft`.
2. Refuses `behind` unless `parent` is its tip.
3. Calls `state.apply(draft, { check: true })`; a `LogError` is `invalid`.
4. Sets `seq`, `actor` and `at`, and `hash = await chainHash(tipHash, commit)`.

The browser store (unit 4, built in `src/lib/sim-store/`, described in [sim-store.md](sim-store.md)):

- Folds confirmed commits into one `LogState` and applies pending ones on a clone (`LocalLog`).
- On a new confirmed commit, unless it is the store's own commit coming back, calls `reapply` for each pending commit, recomputing a pending restore with `diff`.
- Commits an editor's change as `diff(current, edited)`.
- Keeps `History`, which walks the commits as `undoRedo` does (a property test pins them equal) and adds each target's label, folding to the target position to get the restore's `diff`.

### Rules for callers

- `apply` changes the state in place. The sim object runs its rate limit, size cap, `parent` check and duplicate-id check before `apply`, or applies to a `clone()` and swaps it in on success.
- The store removes pending commits whose ids are already among the confirmed ones before calling `reapply`; otherwise their adds come back `exists` and the rest re-applies on top of itself. A pending restore never goes to `reapply`; it is recomputed with `diff` (R18).
- Editor output goes through `toLogForm`, and an imported ruleset (R20) through `checkRuleset`, before `diff` or `LogState.of`.
- `future-shapes` from `apply` or `reapply` means the commit comes from a newer build: keep it, stop sending, offer a reload.
- A jump (R14) to a position before a dataset move restores rules made for the older dataset under the newer one. Undo stops at the move; the store aligns a restore to the dataset the fold is on (sim-store.md, The dataset rule).

## Tests

`npx vitest --run --project server src/lib/sim-log`. One spec per file. `index.spec.ts` compares the sorted runtime export names with a literal list, so adding or removing an export fails it until the list is updated. `test/fixtures.ts` and `test/arbitraries.ts` build rulesets and random commits for the spec files; they are not part of the public surface. Several specs are property tests (`fast-check`): a fold equals `flatten` of its ruleset, `diff(a, b)` applied to `a` gives `b`, and `undoRedo` matches a reference editor.
