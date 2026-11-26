# Fresh-eyes check 1: incremental-loop package

Files are cited by slug for `docs/superpowers/specs/2026-11-24-<slug>-design.html`, `design` for `docs/superpowers/design/2026-11-24-2120-incremental-loop.html` and `source` for `docs/superpowers/specs/2026-11-24-incremental-feel-design.html`. Line numbers are those of the HTML files.

Count: 1 blocker, 8 major, 14 minor.

## Findings

### 1. Side goal ids differ between game-core and tree-catalogue
- Leg 2 (contradiction at a seam). **Blocker.** As written, `SIDE_GOALS` is empty, so the game has no side goals (P2) and tree-catalogue's own `tuning.spec.ts` fails.
- game-core 1252-1262 (DEFS) and 1155-1166 (starting tuning): `{ id: 'policy-homes-1', ...}`, `'collect-share-1'`, `'approved-homes'`, `'collect-run'`, ...; 1295: "Ids carry no number and do not change when a target is tuned"; 1296: "A goal with no entry in SIDE_TUNING is not offered."
- tree-catalogue 895-907: `'policy-1000': ...`, `'collect-half'`, `'approved-2000'`, `'collect-10000'`, ...; 887: "The side goals' starting targets and rewards are those of the game-core spec, by id"; 936: "SIDE_TUNING has one entry for each id in SIDE_GOALS".
- tree-catalogue's report sample (1533-1534) uses its own ids as well (`funded-15000`, `building-10000`).
- Fix: tree-catalogue should copy game-core's ids into `tuning.ts` and into the sample output. game-core owns the ids (design G6: "A side goal's reward and target are read from SIDE_TUNING by its id"), and its rule that ids carry no number exists for saved games.

### 2. Test id `run-layer` is on two elements
- Leg 2. **Major.**
- game-sim 958: `<div class="pointer-events-none absolute inset-0 z-20" data-testid="run-layer">` (and 1331, "run-layer | The box around RunLayer").
- run-play 870: `data-testid="run-layer"` is also on RunLayer's root, which carries `data-dropped` and `data-collected`.
- A strict `getByTestId('run-layer')` matches two elements. closing (937, 1442) works around it with `[data-testid="run-layer"][data-dropped]`, but game-sim's own component test ("RunLayer's feed carries…", 1420) and game-sim's sentence at 1433 ("read the run's counts from data-dropped … on the run layer") assume a single element.
- Fix: game-sim should drop or rename the wrapper's id (for example `run-layer-box`). The R1 contract puts the data attributes on the layer's root, so the id belongs there. closing then drops its workaround note.

### 3. Test id `opening-card` is on two elements
- Leg 2. **Major.**
- game-shell 501: `<OpeningCard …/> inside <div data-testid="opening-card" …>`; 756 lists `data-testid="opening-card" on the opening card's wrapper`; 469: "paint-win expectations move to the wrapper data-testid="opening-card"".
- tally-tree 1003: `<div role="dialog" … data-testid="opening-card"`; 1117 also lists `opening-card`.
- game-shell's component test (827, "a complete score at the goal opens opening-card") would hit two elements. closing (937) works around it.
- Fix: game-shell should rename its wrapper (for example `opening-card-box`) or drop the id. U1 names the component's root.

### 4. Where focus goes when the tree mounts
- Leg 2 and leg 8. **Major.**
- game-sim 858: "tree: the first button inside game-tree-pane."
- tally-tree 933: "On mount Run takes focus."; 1247: "Focus at mount goes to the one forward action: Continue, Run, Start."
- In Tree's DOM (tally-tree 788-808), the first button is the ending's Publish or the first node's `tree-node-open`. Run sits in the footer, last.
- closing depends on Run: 1024 ("waitPhase tree; tree-run has focus") and 1126 ("The page lands in tree; tree-run has focus").
- Fix: game-sim should say "tree: Tree's own mount focus (Run)" and drop its rule for that phase. U1 owns the screen's focus.

### 5. The goal headline's "unlocks" words read "Unlocks: Opens …"
- Leg 2 (user-facing words). **Major.**
- game-sim 992: `unlocks | goalUnlocks(n)`; 1317-1318: `"Opens an earlier goal", "Opens 1 lever and an earlier goal"`.
- tally-tree 636: `unlocksText(unlocks) // 'Unlocks: Height near transit'`; 972: line 2 is `unlocksText(unlocks)`.
- On screen this reads "Unlocks: Opens 1 lever and an earlier goal".
- Fix: game-sim's `goalUnlocks` should return a noun phrase, such as "1 lever and an earlier goal". U1 defines `unlocks` as "What meeting the goal opens", which is a noun phrase, and tally-tree owns the frame.

### 6. The name on `/s/[id]/+error.svelte` (and `sim-page.md:81`) has no writer
- Leg 1 (coverage, P8). **Major.**
- game-shell 605: `src/routes/s/[id]/+error.svelte:16 | {heading} · SF Housing, from SITE_NAME | game-sim`; 800: "src/routes/s/[id]/+error.svelte's title … are game-sim's."
- game-sim 1383-1387 (Changed files) lists only `src/routes/s/[id]/+page.svelte, page.view.svelte.spec.ts, test/PageHost.svelte`. Nothing in game-sim renames the site.
- The file still holds "SF Housing Simulator" (checked: `src/routes/s/[id]/+error.svelte:16`).
- closing 1334 likewise leaves `docs/dev/sim-page.md:81` ("drops Simulator") to game-sim, whose docs section (1360) does not mention that line.
- Fix: game-sim should add both edits to its Files and Words. It owns `src/routes/s/**` and `sim-page.md` in `tbl-write-sets`.

### 7. tally-tree part B needs R1, and the dependency is not listed
- Leg 9 and leg 2. **Major.** The conductor's graph would let part B build before run-play lands, and then the stubbed `write*` functions throw in its tests.
- tally-tree 597: "Part B … read … src/lib/game/run/prefs.ts of run-play"; 1067-1068 call `readMuted` / `writeMuted` / `readCollectForMe`; 1234 tests `onPrefs`.
- The interface line (22) lists "needs G1, G2, G3, G4, G6 and G7", with no R1. The design's subsystem line (design 195) says "Needs G1 to G4, G6".
- Fix: the design (subsystems paragraph) and tally-tree's sec-interfaces should add R1 (prefs) and G7 as part B's needs.

### 8. "A bought node is seen on the map before the next run" is dropped without a record
- Leg 7 (fidelity). **Major.**
- source 321 (Feedback): "A bought node is seen on the map before the next run: the area it affects lights, or its projects' bars shorten."
- design 1035 (traceability, Feedback row) lists "pops, sound, the bar filling, a moment at a goal met; no "Updating" seen". This item is missing from that row.
- game-sim 845-846 places the tree on an opaque pane over an inert map, so nothing on the map is seen between a purchase and the next run.
- No call or ruling drops this item. Call 20 (the tree fills the page) is what removes it.
- Fix: the design should either record it as dropped by call 20, in the list of calls told to the partner, or name a unit that shows it (for example, the first seconds of `starting` light the bought lever's area).

### 9. Calls 3 and 5 narrow the approved source model without a sign-off path
- Leg 7. **Major.**
- source 232-235 (Room for affordable units): "A drop carries its project's homes by income tier … The player's ledger keeps what was collected by tier". source 244: "A measure starts on its own lawful date".
- design 79 (call 3) defers tiers per project. design 81 (call 5) drops lawful dates. design 1055 lists only "Calls 2, 4, 8, 10 and 16" as those told to the partner.
- With tiers deferred, P10's next round needs a feed and engine change. The source model promised "a change of numbers and data, with no change to saved games or to the rules".
- Fix: the design should add calls 3 and 5 to the calls told to the partner in `rulings/`, or record the partner's sign-off.

### 10. Two lanes are not ordered
- Leg 3 and leg 9. **Minor.**
- design 971-972: "src/lib/map/types.ts is written by contracts, then by city-net (the feed) and map-run (the handle). Those two do not run together." The same holds for `docs/dev/map-interfaces.md`. Both units need no row, and neither spec gives an order.
- design 974: tally-tree part B is built "in that lane, after game-save". No spec says whether it comes before or after game-sim. It must come after run-play (finding 7) and before game-shell, which mounts GameCell.
- Fix: the design should give both orders (for example city-net, then map-run; and game-save → tally-tree B → game-sim → game-shell).

### 11. The first run's abort shows the tree before any tally
- Leg 7. **Minor.**
- game-sim 790-791 (`starting: { … abort: 'tree' }`, `run: { … abort: 'tree' }`) and 818-820.
- The brief's ruling: the first run plays current law and the tree is first shown after that run's tally.
- Fix: game-sim should send an abort while `runs === 0` back to `starting`, so the run retries, and not to `tree`.

### 12. "Settled twice pays once"
- Leg 2. **Minor.**
- design 613 (G6): "settle pays a lump or a side reward only when it also records it, so a result settled twice pays once."
- game-core 1123: "A result settled twice pays its collected units twice and nothing else twice."
- closing 1272 (game.md outline): "a result settled twice pays once."
- The store guards against a double settle (game-save 680), so play is unaffected. The documents disagree.
- Fix: the design should narrow its sentence to "pays its lump and side rewards once", and closing's outline should follow.

### 13. save-shape.ts takes value imports
- Leg 2 and leg 4. **Minor.**
- design 940 and contracts 837: "state.ts and save-shape.ts import other modules as types only".
- game-core 577 and 581-584: `import { isValidId } from '../ids/base58'`, `import { SAVE_NAME_MAX } from './saves'`, `import { UNIT_KINDS … } from './state'`.
- The intent (Playwright can load the file by relative path) still holds.
- Fix: the design and contracts should say "no runtime import through `$lib`; relative value imports only".

### 14. tally-tree contradicts itself on the goal count
- Leg 2. **Minor.**
- tally-tree 709: `'runs': 'Goal 2 of 5' (rung + 1 of RUNGS)`. tally-tree 1065: `"Goal 2 of 4" for one in its runs`.
- The provisional ladder has 5 rungs (tree-catalogue 1406).
- Fix: tally-tree should change 1065 to "Goal 2 of 5", or write "Goal 2 of N".

### 15. Who mounts GoalHeadline
- Leg 2. **Minor.**
- tally-tree 1265 (out of scope): "mounting GoalHeadline as the pinned item … : game-shell".
- game-sim 980 ("the header's pinned item is GoalHeadline") and game-shell 547 and 872 ("GoalHeadline's registration: game-sim") both give it to game-sim.
- Fix: tally-tree should name game-sim.

### 16. Two strings for one wait
- Leg 2 (words). **Minor.**
- game-sim 1315: `RUN_WAITING = 'Getting the forecast ready…'`. tally-tree 688: `RUN_BUSY = 'Getting the forecast ready'`.
- The same wait shows two spellings, on the tree and then in `starting`.
- Fix: game-sim should import tally-tree's word or match it.

### 17. Rung labels are "Dec 2060", but the examples and one test assume "2060"
- Leg 2. **Minor.**
- game-core 1013: "A rung's label is formatShortMonthYear(deadline), such as "Dec 2061"".
- tally-tree 634 and 691 give the examples `'… homes by 2055'` and `'Take the next goal: 2050'`.
- closing 985: `widestGameHeader` writes "82,069 of 82,069 homes by 2066". The real widest line is "… by Sep 2066", so the header-fit test understates it.
- Fix: closing should use "by Sep 2066", and tally-tree's examples should follow the label.

### 18. Focus after Start has two owners
- Leg 8. **Minor.**
- game-shell 386 and 418 move focus to `<main id="main">` after a tick. game-sim 856 moves it to the map box on `starting`. Neither says which runs last.
- closing 1117 hedges: "focus is on main or inside the map box after Start".
- Fix: game-shell should drop its focus move when the body becomes the simulation, since game-sim's phase focus covers it.

### 19. Motion durations defer to a playtest no unit runs
- Leg 5. **Minor.**
- tally-tree 1256: "They are starting values; closing's playtest may change them in motion.ts."
- closing has no playtest and cannot write `src/lib/game/ui/**`.
- Fix: tally-tree should state that the values are final for this round, or name who measures them.

### 20. The balance script's assumptions name no measurement or runner
- Leg 5. **Minor.**
- tree-catalogue 1473-1474: `CLOCK = { openingS: 60, runS: 20, tallyS: 8, buyS: 4 }` is "assumed", with no measurement named.
- tree-catalogue 1467: SHARE is replaced by "playtests", but no one is named to run them.
- tree-catalogue 1512 cites "1.25 times … rounded up to the next 1,000 (the game-core rule)". game-core 1298 has no such rule; it says only "above current law's value".
- Fix: tree-catalogue should name the measurement and who runs it for both CLOCK and SHARE, and own the 1.25 rule itself.

### 21. Two readings of the mute preference
- Leg 2. **Minor.**
- run-play 835 and 857: "game-sim passes one that returns the value it last read through onPrefs".
- game-sim 1302: `createSound(() => readMuted(storage()))`, which reads storage on every call.
- The effect is the same, but the seam is described two ways.
- Fix: run-play should accept either, or game-sim should follow run-play.

### 22. Readability (worst instances)
- Leg 6. **Minor.**
- game-sim 969: the whole settling procedure is one prose sentence of code fragments (`before = …; reading = readRun(...); index = …; r = resultOf(...); game.settle(r); …`). It belongs in a code block.
- game-save 930: "seedRunMs(page, ms) throws seedRunMs: ms must be a whole number from 100 to 20000 unless ms is a safe integer from 100 to 20,000". This sentence mixes the error text with the condition.
- closing 1040: the `met` entry's shape is spelled in a sentence.
- Other specs sampled (contracts, city-net, money-wait, map-run, run-play): no instance worth reporting.

### 23. run-play's needs list E1 without needing it
- Leg 9. **Minor**; also see the chain below.
- run-play 23: "Needs G2 (units), G4 (Hands), G6 (RunTake) and E1 (the marker's existing)". design 193: "Needs G2, G4, E1".
- run-play imports nothing from `$lib/map` (run-play 410). `Marker.existing` comes from the contracts stub, and its tests use a fake feed.
- Fix: the design should drop E1 from run-play's needs.

## Legs with nothing further to report

- **Leg 1 (coverage):** I walked every traceability row, the five states, each subsystem paragraph and calls 1 to 25. Apart from findings 6, 8 and 9, each requirement has exactly one carrier. Mount ownership is consistent: Tally and Tree mount in game-sim, OpeningCard and GameCell in game-shell, `won`/`startRuns` are called by game-shell, and `sound.goal`/`sound.buy` by game-sim.
- **Leg 3 (write sets):** every spec's files lie inside its `tbl-write-sets` line. The shared files are:
  - `map/types.ts` and `map-interfaces.md`: contracts, then city-net and map-run (order not stated; finding 10).
  - `SimMap.svelte`: contracts, then map-run.
  - `TimelineMode.svelte.spec.ts`: city-net, then game-sim (game-sim needs E1).
  - `s/[id]/+page.svelte`: game-sim, then game-shell, in one lane.
  - The contracts stub specs: contracts, then their owners.
- **Leg 4 (signatures):** checked against the rows: every spec code block for G2-G7, R1 and U1, the U1 props passed by game-sim and game-shell against the declared props, the `CityMarkerRow` → `Marker` mapping (identical in city-net 302-309 and game-sim 934-941), `SharedBanner`, `initialFrame`, `seedRunMs` (100 to 20,000 in both), `SITE_NAME`, `onPrefs`, `setRunView`, `fitGame` and `addChoices`' second parameter (still `cal`, so G5's `GrantCtx` holds). No mismatch beyond findings 12 and 13. At primary source I verified `moneyFigureAt(...).perAddedHome.all`, `indexOfDay`, the `publish-open` test id, `headerOverlay` returning `openOnly`, `SHORT_MONTHS` in `saves.ts`, and that tsx scripts already load `$lib` modules (level2-check does).
- **Leg 7 (rulings):** P11 holds: no node offers the painted area, `within` refuses it outside the open game, and no spec reads the plan after the opening. P9 and P10 hold: `readRun` reads homes from the series, `settle` credits only `collected`, and `Units` is keyed by `UnitKind`. The first run is current law: with nothing bought, `runnable` drops every policy of a restored document. The tree comes after the tally apart from the abort path (finding 11).

## The longest chain

contracts → game-core → tree-catalogue → game-save → game-sim → game-shell → closing (7 units). tally-tree part B adds an eighth if the lane serialises it between game-save and game-shell.

Edge by edge:

1. **contracts → game-core.** Keep. game-core fills the stubs, and every other unit builds against them.
2. **game-core → tree-catalogue.** Partly cuttable.
   - `tree.ts` needs only the five G2 bodies, which are about 30 lines, fully specified in game-core 535-567.
   - `grant.ts` and `nodes.ts` need no game-core body, since tests can pass a `Limits` literal.
   - Only `play.ts` and the two scripts need `limitsOf`, `runnable`, `settle`, `resultOf` and `sideGoals`.
   - The cut: move G2's bodies into contracts, and split tree-catalogue into (a) the tree, grant and catalogue code, parallel with game-core, and (b) the scripts, the reach measurement and the tuning loop after game-core.
3. **tree-catalogue → game-save.** Cuttable, and the costliest edge.
   - game-save needs only G3's `buy` body and the shape of `NODES`, for `openState`, `fitGame`'s default and the store's `buy`. Its store tests can `vi.mock('./tree')` and `./catalogue/nodes`.
   - As written, the lane waits on tree-catalogue's whole unit. That includes running the balance script on the production dataset and editing `tuning.ts` until every play passes, which may end in a hand-back to the owner (tree-catalogue 1585).
   - The cut: game-save waits for tree-catalogue part (a) only. Part (b) gates only closing, which needs the measured `LADDER_YEARS` and the tuned prices.
4. **game-save → game-sim.** Real as designed. game-save deletes six files and removes store members that game-sim's files read. Cutting it would need game-save to keep `allowed.ts`, `progress.ts` and the old store members as shims until the lane ends, which contradicts G7's "Removed" list. Keep.
5. **game-sim → game-shell.** Cuttable.
   - game-shell uses only `SimRoute`'s optional `initialFrame` prop, and its tests already stub SimRoute (game-shell 824).
   - The only shared file is `s/[id]/+page.svelte`'s title line, which can move to game-sim, since game-sim already writes that file and must also do `+error.svelte` (finding 6).
   - The cut: game-sim and game-shell build in parallel off game-save and merge together, which the lane already requires.
6. **game-shell → closing.** Keep. closing proves the merged whole.

Off the chain: city-net, map-run, money-wait and run-play each need only contracts, or game-core for G2 in run-play's case. tally-tree part A needs game-core. None of them is longer than the chain.

## What I did not examine

- The copied `sec-if-*`, `tbl-interfaces` and `sec-global-constraints` sections inside the specs (verified mechanically).
- The raw HTML formatting and the `data-lang` attributes (format checker).
- The survey reports, `ledger.md`, `amendments-1.md` and `spec-brief.md`.
- money-wait's counting rule against the funding internals (line index, lazy guard) at primary source.
- city-net's series identity against `series.ts`.
- map-run's fitted zoom figures.
- tree-catalogue's grant edits against `transit-edit.ts`'s real behaviour.
- The line-by-line e2e census in closing.
- Whether the starting prices meet the pacing targets. Only the balance script can say.
