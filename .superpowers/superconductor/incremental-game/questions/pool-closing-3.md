# Question pool-closing-3 — from incremental-game-pool-closing
## Question
F3 makes `MoneyView.closed` and `MoneyView.shut` required. `src/lib/timeline/pool-level.spec.ts` (outside this unit's write set) builds a `MoneyView` literal cast with `as MoneyView` that lacks them, so `npm run check` fails (TS2352). May this unit add `closed: {}, shut: {}` to that literal, or does another unit own the edit?

## What the package says
- F3 (§sec-interfaces): `MoneyView { closed: Record<string, Day | null>; shut: Record<string, boolean[]> }` — required fields.
- §sec-write-set / §sec-write-set-files: `src/lib/timeline/**` is not in this unit's set; §sec-design-money names `src/lib/timeline/chunk-log.ts` zero rows as reading null/false (they typecheck: `MoneyRow.closed`/`shut` are optional).
- §sec-write-set notes `funding-measures` runs after this unit and reads `MoneyView.shut`.

## What I found
- `src/lib/timeline/pool-level.spec.ts:43`: the `money()` test helper ends `} as MoneyView` with neither field (implementer's report, Task 5; `npm run check` output TS2352). Unverified by me beyond the report.
- File history (`git log`): 22aaf877 (detail column), 8a8b4863 and 2f9fb76c (finite-funding). Not in any unit's listed write set that I know of.
- Everything else is green on the uncommitted Task 5 work: score 181 passed, world + timeline + fzp 1976 passed, lint 0 errors. Task 5 is uncommitted pending this.

## Options I see
A. (recommended) This unit adds `closed: {}, shut: {}` to the literal in `pool-level.spec.ts` — a test-only, one-line edit that keeps F3 as written; the spec's write set gains that file.
B. Make `MoneyView.closed`/`shut` optional — departs from F3 as written and weakens what `funding-measures` reads.
C. Another unit (e.g. `funding-measures`) makes the edit; this unit commits with `check` red until it merges — breaks the "report F3 only at a green full suite" condition.

## Blocking
Task 5's commit, its review and row F3; Tasks 6-8 after it.
