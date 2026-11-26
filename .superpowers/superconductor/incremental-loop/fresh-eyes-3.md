# Fresh-eyes check 3: the build graph

This check reads `docs/superpowers/design/2026-11-24-2120-incremental-loop-build-graph.md` and the specs in the package worktree `.claude/worktrees/incremental-loop`, at HEAD `a6731240`.

Findings: 1 major, 5 minor.

## 1. The graph's chains against the chain I challenged in check 2

My check-2 chain was: contracts → game-core → tree-catalogue (code) → [game-save → tally-tree B → game-sim → game-shell] → closing.

The graph's first chain has the same edges. It is shorter only because the lane is now one unit: the lane's inner order is settled, and the two inner edges I challenged (code → game-save and B → game-sim) are now internal to it.

The other three chains add no edge that the needs lists did not already imply:
- **tree-catalogue-measure → closing** is the T1 edge that check 2 named as running beside the lane.
- **game-core → run-play → game-lane** comes from part B's need for R1 and game-sim's need for R1.
- **game-core → tally-tree-a → game-lane** comes from game-sim's and game-shell's need for U1 part A.

No edge is dropped. **No finding.**

## 2. The edges on the four chains

| Edge | Verdict |
|---|---|
| contracts → game-core | Keep. game-core fills the stubs. |
| game-core → tree-catalogue-code | Keep. `tree.ts` calls `affords`, `spend` and `shortBy` (G2). `play.ts` calls `limitsOf` and `runnable` (G4). `tuning.spec.ts` checks `SIDE_GOALS`, which game-core builds (G6). |
| tree-catalogue-code → game-lane | Real, but it can be waited on later (G3, G5). The lane's first part, game-save, calls `buy` and `NODES` only in the store and its tests, and those tests can mock `./tree` and `./catalogue/nodes`. The open game's "every node at its last level" holds trivially with the empty stub. game-sim is the lane's third part and calls `applyGrant`, `treeView` and `NODES`, so the lane could start without the code part and only game-sim would wait on it. |
| tree-catalogue-code → tree-catalogue-measure | Keep. The measurement calls `fullTree`, `buyAndApply`, `applyGrant` and `NODES`, and G6's `goalAt`, `readRun`, `resultOf` and `settle`. |
| tree-catalogue-measure → closing | Can be waited on later. closing reads prices, the lump and the ladder from the files and never as literals (closing 870-871), so its e2e specs, helpers and docs build and pass on the starting values. Only the measured run of record (the reach check on the production version, and the bench) needs T1. closing could branch before T1 and rebase onto it before `sec-design-checks`. |
| game-core → run-play | Keep for G2: `run-model.ts` and `words.ts` call `credit` and `total`. The G4 listed for run-play is only the `Hands` type and the `BASE_HANDS` constant, which the contracts stub already provides. By the design's own rule ("a row used only as a type or a constant comes from contracts"), G4 should not be listed (finding M2). The edge stands on G2. |
| run-play → game-lane | Can be waited on later (R1). game-save does not use R1. Part B calls the `prefs.ts` bodies, and game-sim mounts `RunLayer` and calls `planDrops` and `createSound`. The lane could start game-save without run-play, and part B would wait for it. |
| game-core → tally-tree-a | Keep for G2 (`total`) and G6 (`SIDE_GOALS` labels in Tally). G1 is used only as types and `NEW_GAME`, and G4 not at all in part A (`limits.hands` is part B's GamePanel), so both are listed without being called (finding M2). |
| tally-tree-a → game-lane | Can be waited on later (U1 part A). game-save does not use it. Part B imports A's `ui/words.ts` (`PLAYING`, `SAVED_GAMES`, `unitsName` and others), game-sim mounts Tally, Tree and GoalHeadline, and game-shell mounts OpeningCard. So it is needed from the lane's second part on. |
| game-lane → closing | Keep. |

The lane's other needs follow the same pattern:
- **E1 and M1 (map-lane):** only game-sim uses them, so the lane can start without them.
- **G1, G2, G4 and G6:** game-save calls them from its first step, so the lane does wait on game-core.

The lane's operator could start game-save once game-core has merged, and need only:
- G3 and G5, R1, and U1 part A before part B and game-sim begin;
- E1 and M1 before game-sim.

All four of those come from units that start no later than the lane's own inputs. Waiting later would let game-save overlap with tree-catalogue-code, run-play and tally-tree-a without the operator stalling. The cost is mocking `./tree` and `./catalogue/nodes` in game-save's store spec.

## 3. The graph against the specs

### M1. contracts' `catalogue/ladder-years.spec.ts` has no successor, and it breaks the suite once tree-catalogue-code lands
- **Major.**
- contracts 1468 creates `src/lib/game/catalogue/ladder-years.spec.ts`, and 1516 makes it assert "LADDER_YEARS equals [2060]".
- tree-catalogue-code writes the provisional `[2060, 2055, 2050, 2045]` (tree-catalogue, `sec-design-reach`), and later the measured value.
- tree-catalogue's `sec-files` does not list `ladder-years.spec.ts`; it lists `nodes.spec.ts`, `tuning.spec.ts`, `tree.spec.ts`, `grant.spec.ts` and `play.spec.ts`. The graph's "their specs" covers the file only by implication.
- The result: contracts' assertion fails at tree-catalogue-code's merge, and no unit is told to change it.
- Fix: tree-catalogue's `sec-files` (code part) should rewrite the spec to the rule (at most four years, descending, multiples of 5; `nodes.spec.ts` already tests this) or delete it. The same check found no other orphan stub spec: every other one is listed by its owner as rewritten or created over.

### M2. Needs that are only types or constants are listed
- **Minor.**
- run-play lists G4, which is only the `Hands` type and `BASE_HANDS`.
- tally-tree-a lists G1 and G4, which are only types and `NEW_GAME`; part A calls no G4 function.
- Under the design's own rule these should not be listed. The rule's text sits in the design's `sec-subsystems`, and the graph copies the lists faithfully, so the graph agrees with `sec-subsystems` and both are over-listed.
- No chain changes, because each unit still waits on game-core for G2.
- Fix: the design's `sec-subsystems` should list run-play as needing G2, and tally-tree part A as needing G2 and G6.

### M3. Two design sections no unit cites
- **Minor.**
- contracts `sec-design-corrections`: "Where the files differ from the design's code blocks". It fixes the stub files' imports, and the contracts unit implements it.
- map-run `sec-design-visible`: what shows at the fitted zoom. It is descriptive ("This unit changes no layer"), but it is a design section.
- Every other design section id in every spec is either cited or nested inside a cited section; I checked the nesting for game-shell, closing, contracts, tree-catalogue and map-run. Every cited id exists, including `sec-if-t1` and city-net's `sec-files-fixtures`.
- Fix: add both ids to their units' cells.

### M4. money-wait's produces cell contradicts closing's needs
- **Minor.**
- The money-wait row says "E2 (read when present; no unit waits on it)". The closing row lists E2 among its needs, and closing branches after every unit has merged.
- The chain is unaffected: contracts → money-wait → closing is only 3 units.
- Fix: the cell should say "only closing waits on it".

### M5. activity.spec.ts is double-owned in the graph's wording
- **Minor.**
- game-lane's game-sim cell claims "`src/lib/timeline/**` other than `activity.ts`", which takes in `activity.spec.ts`. map-lane (city-net) also writes `activity.spec.ts` as one of "their specs".
- The two never run together, because game-lane needs E1, so this does no harm.
- Fix: the game-sim cell should read "other than `activity.ts` and `activity.spec.ts`", matching the design's "other than the city index".

### M6. tally-tree `sec-design-testids` is cited only by part A
- **Minor.**
- The section also holds part B's ids: `header-units`, `header-game-panel`, and the `game-panel` family.
- Fix: cite it in both parts' cells, or say part A writes no part-B id.

### Checked with no finding
- **Writes.** I read every writes cell against the others and against each spec's `sec-files`. The only files written by two units are serialised by needs:
  - contracts then its owners;
  - city-net then map-run on `types.ts`, `map-interfaces.md` and `SimMap.svelte`;
  - map-lane then game-lane on `TimelineMode.svelte.spec.ts` (and see M5);
  - tree-catalogue-code then tree-catalogue-measure on `tuning.ts` and `ladder-years.ts`;
  - inside the lane, game-sim then game-shell on `s/[id]`.
  - Units that can run together share no file: map-lane, money-wait, run-play, tally-tree-a, tree-catalogue-code, tree-catalogue-measure, and the measurement against the lane.
- **Needs and produces.** Every row agrees with `sec-subsystems`. The lane's needs are the union of its four parts' needs less what the lane produces internally (G7, G8, U1 part B).

## What I did not examine
- The full text of each spec beyond the sections the graph cites and the `sec-files` tables.
- Whether the specs changed after `7d438ff7` in ways other than the N1 to N5 fixes. The graph-relevant needs and lanes were read at HEAD.
