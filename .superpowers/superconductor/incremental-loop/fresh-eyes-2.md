# Fresh-eyes check 2: the amended incremental-loop package

Checked: `git diff 6ba62672 HEAD -- docs/superpowers` (HEAD `7d438ff7`), the ledger entries "Fresh-eyes check 1" and "The chain, after fresh-eyes 1", and `amendments-2.md`. Files are cited by slug as in check 1, and line numbers are those of the HTML files at HEAD.

## 1. The 23 findings of check 1

| # | Verdict | Where it stands now |
|---|---|---|
| 1 | Fixed | The side-goal ids are now one set. tree-catalogue's `SIDE_TUNING`, report sample and `tuning.spec` use game-core's ids. A grep finds none of the old ids anywhere. |
| 2 | Fixed | game-sim 962 and 1354 use `run-layer-box`. run-play 723 keeps `run-layer`. closing 934 and 972 use one element. |
| 3 | Fixed | game-shell uses `opening-card-box` (lines 461, 747, 818). tally-tree 1020 keeps `opening-card`. |
| 4 | Fixed | game-sim's tree phase now leaves focus to `Tree` ("Tree's own … the page moves no focus"). |
| 5 | Fixed | game-sim 1341 makes `goalUnlocks(levers, earlier)` a noun phrase. The `earlier: false` form is never called: game-sim passes `true` and gives `null` at the last rung. This is harmless. |
| 6 | Fixed as ruled | The design write set and game-shell (596, 763) give `+error.svelte`'s title to game-shell. game-sim adds `sim-page.md:81` and names game-shell in its out-of-scope. |
| 7 | Fixed | tally-tree's interfaces and the design (199) list part B as needing G7 and R1. |
| 8 | Fixed as ruled | Call 26 is recorded, listed among the calls told to the partner, and has a traceability row. |
| 9 | Fixed as ruled | design 105 records the approval of calls 1 to 18, which include calls 3 and 5. Calls 3, 5 and 26 are on the told-after list. |
| 10 | Partly fixed | The design orders both lanes (design 990 and the lane item). The specs do not follow: see new findings N2 and N3. |
| 11 | Fixed | Call 27 is in the design (103) and in game-sim (`nextPhase(p, e, runs)` at 801, the transitions table and a test). closing 1158 tests it. |
| 12 | Fixed | G6 is reworded in every copy. game-core 1123 and closing's game.md outline now agree with it. |
| 13 | Fixed | The design and contracts now say "nothing through `$lib` at run time". |
| 14 | Fixed | tally-tree's examples all read "Goal 2 of 5". |
| 15 | Fixed | tally-tree's out-of-scope names game-sim as the one that registers GoalHeadline. |
| 16 | Fixed | `RUN_WAITING` is gone, and game-sim imports `RUN_BUSY`. closing's selector table follows. |
| 17 | Fixed | tally-tree's examples use "Dec 2055", and closing's `widestGameHeader` uses "by Sep 2066". |
| 18 | Fixed | game-shell moves no focus after Start. closing asserts focus is inside the map box. |
| 19 | Fixed | tally-tree's durations are "final for this round". |
| 20 | Fixed | `CLOCK` and `SHARE` are stated as assumptions the owner changes. The 1.25 rule is tree-catalogue's own. |
| 21 | Fixed | game-sim holds `muted` from `onPrefs`. |
| 22 | Fixed | game-sim's `settleRun` is a code block, game-save's `seedRunMs` is split into rules, and closing's `met` is a code block. |
| 23 | Fixed | E1 is gone from run-play's needs, table and copied section, and from the design (197). |

## 2. New findings from the amendments

### N1. game-core's needs sentence contradicts the design and makes a cycle
- Leg 9 and leg 2. **Major.**
- game-core 24: "Needed: G3 (`TreeNode`, `Grant`, `NODES`) and E2 (`TimelineView.waitingMoney`)".
- design 187: "game-core … Needs no row."
- tree-catalogue's code part needs G1, G2, G4 and G6 from game-core. A scheduler that reads game-core's spec therefore sees a cycle: game-core ⇄ tree-catalogue (code).
- Under the design's new rule, G3 and E2 are only types or the `NODES` constant from contracts. game-core's tests pass their own nodes.
- Fix: game-core should say "Needs no row", which is what the design says and what amendments-2 implies. Nothing in amendments-2 told game-core to change, which is how it was missed.

### N2. game-save and game-shell still describe the old lane
- Leg 3. **Minor.**
- game-save 17: "This unit is the first part of one lane with game-sim and game-shell".
- game-shell 23: "This is the third part of one lane after game-save and game-sim."
- The design's lane is game-save, tally-tree part B, game-sim, game-shell. tally-tree 613 states it correctly.
- Fix: game-save should name the four in order, and game-shell should call itself the fourth part.

### N3. city-net and map-run do not state their lane
- Leg 3. **Minor.**
- The design (990) says "Those two are one lane: city-net, then map-run". Neither spec says so.
- map-run edits `types.ts` and `map-interfaces.md` on top of city-net's lines.
- Fix: map-run should add one sentence saying it builds after city-net merges, and city-net one saying map-run follows it.

### N4. game-shell lists G1 among its needs
- Leg 9. **Minor.**
- game-shell 28: "It needs G1, G7 and U1".
- design 205: "Needs G7, U1".
- game-shell uses G1 only as types and as the `NEW_GAME` constant, which by the new rule come from contracts.
- Fix: game-shell should drop G1, both in the sentence and in its table.

### N5. One test list's preamble does not fit its call-27 case
- Leg 2. **Minor.**
- closing's game-sim e2e list opens with "each from `seedGame(page, { phase: 'runs', runs: 1, units })` with amount 1 and run time 2,000 ms".
- The new call-27 case (1158) seeds `{ phase: 'runs' }`, that is runs 0, and sets no run time, yet it waits through run to tally. Without `seedRunMs` that wait is a 20-second run. The reload case beside it has the same mismatch.
- Fix: closing should say the call-27 case also uses `seedGoalAmount(page, 1)` and `seedRunMs(page, 2000)`, and should limit the preamble to the cases that seed `runs: 1`.

### Checked and consistent
- **T1 and the split.** The design's subsystems, `sec-if-t1` and write-set note; tree-catalogue's interfaces, its "The two parts" section and its file and test tables; and closing 870 all agree:
  - the code part (G3, G5) merges first;
  - the measurement part (T1) needs G1 to G6 and only closing waits on it;
  - closing reads `PRICES`, `RUNG_LUMP` and `LADDER_YEARS` from the files rather than as literals.
  - The code part's tests (for example `treeView(NEW_GAME)` and "cheapest ≤ RUNG_LUMP") are inside tree-catalogue, which T1 allows. tally-tree's test note follows T1.
- **Call 27 against closing's test.** game-sim sends an abort while `runs` is 0 to `starting`, and shows the Retry. closing asserts `game-tree-pane` is never attached before tally and that Retry reaches run. These agree; N5 is the only gap.
- **Stale tokens.** A grep for the old side-goal ids, `RUN_WAITING`, "forecast ready…", "Goal 2 of 4", "by 2055'", "homes by 2066", the `<main>` focus, "first button inside game-tree-pane", "Opens 1 lever" and the doubled test ids finds nothing.

## 3. The longest chain, with the needs as they now read (design `sec-subsystems`)

contracts → game-core → tree-catalogue (the code) → [lane: game-save → tally-tree B → game-sim → game-shell] → closing.

That is 8 units, or 5 if the lane counts as one. tree-catalogue's measurement part (T1) runs beside the lane into closing, and city-net, map-run, money-wait, run-play and tally-tree A all lie off the chain.

Edge by edge:
- **contracts → game-core.** Keep.
- **game-core → tree-catalogue (code).** Keep as ruled. It could be cut by moving G2's five bodies into contracts. The gain is only the code part's duration, because game-save needs game-core anyway.
- **tree-catalogue (code) → game-save.** Still cuttable. game-save uses only `buy` and `NODES`, and its store tests can `vi.mock('./tree')` and `./catalogue/nodes`. That would take the code part off the path, so the lane waits on game-core alone. The ledger gives no reason for keeping this edge.
- **game-save → tally-tree B.** Real: B reads G7.
- **tally-tree B → game-sim.** Cuttable. game-sim needs nothing from part B. B's component tests import only the store, `words.ts` and `prefs.ts`, so they can run as soon as game-save is in. Building B beside game-sim, or after it and before game-shell, takes B's duration off the chain. The cut needs only the design's lane order to say "B and game-sim in either order, both before game-shell".
- **game-sim → game-shell.** The refusal is reasonable for `npm run check`, which needs both in. game-shell's own tests already stub SimRoute, so the refusal is about the whole-app check rather than unit tests. Keep.
- **game-shell → closing.** Keep.

## What I did not examine
- The re-copied `sec-if-*` sections (verified mechanically).
- The HTML format (checker).
- The parts of each spec the diff did not touch, beyond the greps above.
