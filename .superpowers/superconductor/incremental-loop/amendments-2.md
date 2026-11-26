# Amendments after the fresh-eyes check (composer, 2026-11-24)

The findings are in `fresh-eyes-1.md` (same folder), numbered 1 to 23. The design
`docs/superpowers/design/2026-11-24-2120-incremental-loop.html` is amended. Each spec applies the
items under its own name.

## For every spec named below

1. The composer has already replaced your copies of the design's `sec-if-<row>` sections, table
   lines and `sec-global-constraints` with the design's current text. Do not edit those copies.
   Re-read your spec file before editing it: it changed on disk.
2. Where an item adds a row to what you produce or need, copy from the design, with no change,
   the row's line of `tbl-interfaces` and its whole `sec-if-<row>` section. Where an item removes
   a row, remove both.
3. Write current-state text: no "previously", no "changed from", no mention of the finding or of
   this file.
4. Run the checker until clean:
   `python3 /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel/.superpowers/superconductor/incremental-loop/check_spec.py <your spec path>`
5. Same hard rules as before: one file, no commits, no servers, no `cd ... &&`, foreground only,
   no further agents, no Claude attribution.
6. Hand back at most 100 words: what changed, and anything you could not make agree.

## What changed in the design

- **Needs** (`sec-subsystems`): a subsystem needs a row when its code or tests call what the
  row's owner builds; a row used only as a type or a constant comes from `contracts` and is not
  listed. `run-play` needs G2, G4 (not E1). `tally-tree` part A needs G1, G2, G4, G6; part B also
  G7 and R1. `tree-catalogue` is two parts: the code (needs G1, G2, G4, G6; produces G3, G5) and
  the measurement (needs G1 to G6; produces T1).
- **T1** (new row, `sec-if-t1`, owner `tree-catalogue`, decomposition choice): the measured
  `LADDER_YEARS` and the tuned `tuning.ts`. Code and tests outside `tree-catalogue` and `closing`
  never assert a price, a ladder year or the number of rungs from those files.
- **G6**: a result settled twice pays its lump and its side rewards once; the store refuses a
  second settle of one result (G7).
- **Contracts**: `state.ts` and `save-shape.ts` import nothing through `$lib` at run time (a
  `$lib` import is a type import; a value import is relative).
- **Write sets**: `game-shell` writes the name in the title of both `src/routes/s/[id]/+page.svelte`
  and `+error.svelte`, after `game-sim`.
- **Lanes** (`sec-write-sets`): `city-net`, then `map-run`, are one lane. `game-save`,
  `tally-tree` part B, `game-sim`, `game-shell` are one lane, built in that order and merged once.
  The two parts of `tree-catalogue` merge apart, the code first.
- **Calls 26 and 27**: a bought node is not shown on the map before the next run; a first run
  that fails starts again, so the tree is never shown before a run has been settled.

## By spec

- **tree-catalogue** (findings 1, 20, the chain):
  - Use `game-core`'s side-goal ids everywhere (`tuning.ts`'s starting content, the report
    sample, the tests). Read them in `docs/superpowers/specs/2026-11-24-game-core-design.html`
    (the `DEFS` list and its starting tuning). Ids carry no number.
  - Own the rule the balance script applies to a target current law already meets (1.25 times
    current law's value, rounded up to the next 1,000): state it as this spec's rule, not
    `game-core`'s.
  - `CLOCK` and `SHARE` are assumptions, not measurements: say that this unit ships them as
    given, that no unit of this build measures them, and that the owner changes them after
    playing the built game. Name no playtest that no unit runs.
  - Split the spec's work into two named parts, as the design's `sec-subsystems` now does: "The
    code" (`tree.ts`, `grant.ts`, `catalogue/**` with starting values, `catalogue/play.ts`, their
    specs; produces G3, G5) and "The measurement" (`scripts/tree-balance.ts`,
    `scripts/reach-measure.ts`, the engine runner, the tuning loop, the measured
    `ladder-years.ts` and tuned `tuning.ts`; produces T1). Say in `sec-interfaces` which part
    needs and produces what, mark each file in `sec-files` and each test in `sec-tests` with its
    part, and make sure nothing in the code part imports a script or needs a dataset.
  - Add T1 to what you produce (table line and `sec-if-t1`).
- **game-sim** (findings 2, 4, 5, 6, 11, 16, 21, 22):
  - The box around `RunLayer` is `data-testid="run-layer-box"`. `run-layer` is `RunLayer`'s own
    root (R1), which carries `data-dropped` and `data-collected`.
  - Focus in the tree phase is `Tree`'s own (it focuses Run on mount, U1): drop your rule for
    that phase.
  - `goalUnlocks(n)` returns a noun phrase that `tally-tree`'s `unlocksText` frames as
    "Unlocks: …": "an earlier goal", "1 lever and an earlier goal", "N levers and an earlier
    goal" (and the form with no earlier goal).
  - `src/routes/s/[id]/+error.svelte`'s title is `game-shell`'s (with `+page.svelte`'s): say so
    in out of scope. `docs/dev/sim-page.md:81` (the name) is yours: add it to your docs edits.
  - Call 27: an abort while `runs` is 0 (in `starting` or in `run`) returns to `starting` and
    the run starts again when the forecast is ready; it never lands in the tree. An abort with
    `runs` above 0 lands in the tree, as now. Add the test.
  - The waiting text is one string: import `RUN_BUSY` ('Getting the forecast ready') from
    `src/lib/game/ui/words.ts` and drop `RUN_WAITING`.
  - Mute: follow run-play: `createSound` is given a function that returns the value last read
    through `onPrefs` (read once at mount), not a storage read on every call.
  - Put the settling procedure (your line near 969) in a code block.
- **tally-tree** (findings 7, 14, 15, 17, 19):
  - Part B needs G7 and R1: say so in `sec-interfaces`, and add R1 (table line and `sec-if-r1`).
    State the two parts' needs as the design's `sec-subsystems` does.
  - "Goal 2 of N" examples agree: the count is `RUNGS`; write the example once, as "Goal 2 of 5",
    and say it is `rung + 1` of `RUNGS`. Tests pass their own ladder and never assert the count
    from the catalogue (T1).
  - `GoalHeadline` is registered as the pinned item by `game-sim` (not `game-shell`).
  - A rung's label is `formatShortMonthYear(deadline)`, such as "Dec 2055" or "Sep 2066": make
    every example follow it ("… homes by Dec 2055", "Take the next goal: Dec 2050").
  - The motion durations are final for this round: remove the sentence that defers them to a
    playtest.
- **game-shell** (findings 3, 6, 18):
  - The wrapper around `OpeningCard` is `data-testid="opening-card-box"`. `opening-card` is
    `OpeningCard`'s own root (U1). Move expectations accordingly.
  - The title of `src/routes/s/[id]/+error.svelte` is yours, with `+page.svelte`'s, from
    `SITE_NAME`, after `game-sim`: fix the table of name occurrences, `sec-files` and
    out of scope.
  - After Start, focus is `game-sim`'s (the map box, on `starting`): drop your move of focus to
    `main` when the body becomes the simulation.
- **run-play** (findings 21, 23):
  - You do not need E1: remove it from your needs sentence, from your table and its
    `sec-if-e1` section. `Marker.existing` is a field of R1's own `Marker`.
  - Keep your rule for mute as it is (`game-sim` now follows it).
- **closing** (after the five above; findings 2, 3, 12, 17, 18, 22, T1):
  - Add T1 to your rows (table line and `sec-if-t1`). The journey and the reach check run after
    T1: say that this unit starts once the measurement has merged, and what it does when the
    tuned numbers differ from the starting ones it quotes (quote none: buy by node id, and read
    prices from the catalogue).
  - Read counts from `[data-testid="run-layer"]` and the opening from
    `[data-testid="opening-card"]`: each is one element now; drop the workarounds.
  - `docs/dev/game.md`'s outline: "a result settled twice pays its lump and side rewards once".
  - `widestGameHeader` uses the real widest label, "… homes by Sep 2066".
  - After Start, focus is inside the map box.
  - The `met` entry's shape goes in a code block, not a sentence.
  - `docs/dev/sim-page.md:81` is `game-sim`'s (it now says so); `+error.svelte`'s title is
    `game-shell`'s.
  - Re-read the five specs amended in this round for anything else you quote from them.
