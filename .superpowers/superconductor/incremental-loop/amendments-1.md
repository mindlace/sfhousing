# Amendments after the first round of specs (composer, 2026-11-24)

The design `docs/superpowers/design/2026-11-24-2120-incremental-loop.html` changed. Every spec
re-syncs to it and applies the items under its own name below.

## For every spec

1. Re-read the design's `sec-rulings-calls` (calls 19 to 25 are new), `sec-interfaces`,
   `sec-contracts`, `sec-write-sets` and `sec-global-constraints`.
2. Replace your copies of the interface rows (each `sec-if-<row>` section you hold) and of
   `sec-global-constraints` with the design's text as it is now, with no change.
3. Make your `sec-design`, `sec-files`, `sec-tests` and `sec-decisions` agree with the amended
   rows, with your subsystem's line in the design's write-set table, and with the items below.
   Remove from `sec-decisions` anything the design now decides.
4. Write the spec as current-state text: no "previously", no "changed from", no changelog.
5. Run the checker again until it is clean.
6. Hand back at most 120 words: what changed, and anything you could not make agree.

## What changed in the design, by row

- **E1**: `existing` is the homes the project takes off the goal's count: the homes on its lot
  once it has entered construction after the dataset date, 0 otherwise.
- **E2**: both fields stay optional for good; the value is read at the end of the model month
  that holds the calendar month's last day; homes are gross units; a lot no longer free is not
  counted.
- **G4**: `START_BANDS`, `START_STORIES`, `START_REACH_M` (1, 4, 402) are exported from
  `limits.ts` and are the floor once a stop type is bought; `BASE_HANDS` is 48 px, 4,000 ms, no
  auto, and every Hands step in the catalogue is above it; at the ending `presets` also holds
  `observed`; `within` does not read `on`.
- **G5**: `stories` raises every band that was as tall as the innermost; `bands` splits the
  outermost band when there is no room inside `reachM`; a grant whose policy the player removed
  adds it again.
- **G6**: `RUNG_LUMP` and `SIDE_TUNING` (each side goal's target and reward by id) live in
  `src/lib/game/catalogue/tuning.ts`, owned by `tree-catalogue`; `ladder.ts` and `side-goals.ts`
  import them. `LADDER_YEARS` has at most four years; the first is the largest multiple of five
  at least five years before the window's end year; deadlines are clamped; the cheapest node
  shown at rung 0 costs no more than `RUNG_LUMP`; `settle` pays only what it records.
- **G7**: the open game is in phase `'runs'`; `settle` does nothing for a result already settled.
- **M1**: hover picks are off while locked; bounds and the zoom floor are lifted while locked;
  a resize or inset change refits.
- **R1**: `feed.drops` may be replaced during a run and drops are matched by `row`; the layer's
  root carries `data-dropped` and `data-collected`; `onPrefs(fn)` is added to `prefs.ts`; the
  layer's words are in `src/lib/game/run/words.ts`.
- **U1**: `Tally` gains `before`; `Tree` gains `on`, `ontoggle`, `ending`, `onpublish` and loses
  `finished`; `Tree` fills the page below the header; `GamePanel` loads `/` after a switch, a new
  game or deleting the game in play; these parts' words are in `src/lib/game/ui/words.ts`.
- **Contracts**: `catalogue/tuning.ts` is a new stub file; `setRunView` is optional until
  `map-run`; `waiting` and `waitingMoney` stay optional; `state.ts` and `save-shape.ts` import
  other modules as types only; each stub has a colocated spec.
- **Global constraints**: the files the dataset version hashes are `pipeline`,
  `src/lib/config.ts`, `src/lib/{data,generator,timelapse}`, `src/lib/plan/{geometry,types}.ts`,
  `src/lib/sim/finance`.
- **Words**: `src/lib/game/words.ts` (game-core) holds only what the store and the sync use:
  `syncText`, `playedText`, `FULL_TEXT`, `STORAGE_TEXT` and the default save names, under those
  names. Every other word is in its unit's own file.

- **G1, G6, G7 (after the re-sync round)**: `parseGameSave` checks the shape only and keeps a
  node, level, side goal or rung the catalogue lacks; `fitGame(s, nodes?, goals?)` in
  `ladder.ts` (G6, game-core) drops or lowers them; the browser store passes every save it reads
  through the parser and then `fitGame`; the server stores what the parser returns.
- **Write sets (after the re-sync round)**: money-wait also owns the `before` helper of
  `src/lib/sim/world/host.edit.spec.ts` and of `src/lib/sim/timeline-client.host.spec.ts`.

## By spec

- **contracts**: add `catalogue/tuning.ts` (`RUNG_LUMP = { home: 2000 }`, `SIDE_TUNING = {}`) and
  move `RUNG_LUMP` out of `ladder.ts`; add `START_*` to `limits.ts` and `onPrefs` to `prefs.ts`;
  `Tree`'s and `Tally`'s props are not stubbed but any type they name must exist; keep
  `setRunView` optional and `waiting`/`waitingMoney` optional; list the colocated stub specs in
  `sec-files`.
- **game-core**: import `RUNG_LUMP` and each side goal's target and reward from
  `catalogue/tuning.ts` (keep the goals' definitions, ids, labels, rings and `read` functions;
  list the starting targets and rewards as the starting content of `tuning.ts` for
  `tree-catalogue` to hold); `words.ts` holds only the store's and the sync's words named above,
  and every word you wrote for the tally, the tree, the headline, the opening card, the panel and
  the run goes out of your spec (the UI specs hold their own); add `words.spec.ts` to
  `sec-files`; `state.ts` and `save-shape.ts` import `$lib` modules as types only; export
  `START_*` from `limits.ts`; `observed` joins `presets` at the ending.
- **tree-catalogue**: own `catalogue/tuning.ts` with the starting values `game-core` lists
  (read its spec: `docs/superpowers/specs/2026-11-24-game-core-design.html`), and have the
  balance script report against and tune them; import `START_*` from `limits.ts` instead of
  exporting `ZONING_BASE`; every Hands step above `BASE_HANDS` (48 px, 4,000 ms): start the
  radius steps at 64 px and the linger steps at 5 s; the ladder rule as G6 now states it
  (provisional `LADDER_YEARS` `[2060, 2055, 2050, 2045]`, at most four years, so rings map onto
  at most five rungs); the cheapest node shown at rung 0 priced at or under `RUNG_LUMP` (2,000),
  held by a test; the G5 rules as amended.
- **city-net**: E1's meaning now matches your reading; your `sec-files` may take the seven files
  you reported (they are in your write set now); the accessor stays
  `ActivityIndex.markers(): CityMarkerRow[]`.
- **money-wait**: the two fields stay optional for good: remove "makes them required" and the
  four lines in files outside your unit (`host.edit.spec.ts`, `timeline-client.host.spec.ts`,
  `src/lib/timeline/test/fixtures.ts`, `SimDetails.svelte.spec.ts`); your tests assert the value
  where your own fixtures have money; `funding/columns.ts`, `funding/system.ts` and
  `docs/dev/world-funding.md` are in your write set now.
- **map-run**: M1 now states what you decided; the two handle stubs are in your write set; say
  that `setRunView` is optional in the type until this unit makes it required.
- **run-play**: `feed.drops` may be replaced during a run: match by `row`, keep shown and
  collected drops, count none twice, and say what happens to a drop whose row disappears; add
  `onPrefs` and apply a change of "Collect for me" or mute mid-run; your words (`runOverText`,
  `dropCountText` and any other) are in your own `src/lib/game/run/words.ts`; `data-dropped` and
  `data-collected` are in the row now.
- **tally-tree**: U1 now has `before`, `on`, `ontoggle`, `ending`, `onpublish`; `finished` is
  gone (use `ending !== null`); all your words are in your own `src/lib/game/ui/words.ts`, in
  your write set (list every key and its text in the spec); "Collect for me" and the sound switch
  call the `write*` functions of R1, which notify through `onPrefs`; `GamePanel` loads `/` after
  a switch, a new game or deleting the game in play; `GameCell` carries
  `data-header-keep-open`; keep your split (parts that need the store build after `game-save`);
  `AccountOffer.svelte` is unchanged except for one import line that `game-save` edits.
- **game-save**: `syncText`, `playedText`, `FULL_TEXT`, `STORAGE_TEXT` and the default names are
  imported from `src/lib/game/words.ts` (game-core) under the same names; `AccountOffer.svelte`
  (the import line) and its spec, `src/lib/game/test/StoreHost.svelte`,
  `src/lib/server/auth/better-auth.spec.ts` and `src/lib/server/user-store/deletion.spec.ts` are
  in your write set now; add `seedRunMs(page, ms)` to `e2e/helpers/game.ts`, which sets
  `sfhousing:e2e:run-ms` (the key `game-sim` reads).
- **game-sim**: the tree fills the page below the header (not the bottom pane): say what is
  mounted and hidden in the tree state accordingly; pass `Tree` its `on` map (from the policy
  document: the policy each bought node's grant made, by its preset or `GAME_TRANSIT_ID`) and
  wire `ontoggle` to the document's `setOn` with an undo label, keeping the Inspector's switch
  too; `ending` and `onpublish`; `Tally`'s `before`; build R1's `Marker`s from city-net's
  `ActivityIndex.markers(): CityMarkerRow[]` (`{row, lngLat, completed, homes, existing}`; read
  `docs/superpowers/specs/2026-11-24-city-net-design.html`); `feed.drops` may be replaced as the
  feed updates; the `/sim` redirect is `game-shell`'s: drop `src/routes/sim/+server.ts`, delete
  the old page files' tests from `src/routes/sim` and move them under `src/lib/sim-page`, and
  leave `src/routes/sim/+page.svelte` and `+page.ts` to `game-shell`; accept an `initialFrame`
  prop on `SimRoute`, `SimPage` and `TimelineMode` and pass it to the map (game-shell carries the
  opening's camera across); during a run the map's `moveend` reports citywide bounds: say what
  the view follower does with it (read `docs/superpowers/specs/2026-11-24-map-run-design.html`);
  on `/s/[id]` remove Remix and pass `SharedBanner` the props `game-shell`'s spec gives it
  (read `docs/superpowers/specs/2026-11-24-game-shell-design.html`), leaving the page title's
  name to `game-shell`; read the goal amount seam on the runs side (`goalAt(asOf, rung,
  goalAmount)`); `WinCard.svelte.spec.ts` is deleted with `WinCard.svelte`; `observed` and
  custom timing at the ending as G4 now states.
- **game-shell**: your write set is as the design's table now gives it (`BrushEditor.svelte`,
  the specs and hosts of `/`, `src/routes/sim/+page.svelte` and `+page.ts` for the redirect,
  `src/routes/s/[id]/+page.svelte` for the name after `game-sim`, `src/routes/about/+page.svelte`,
  `schema.spec.ts`; not `config.ts`, not `+layout.svelte`); the redirect is yours: state the file
  and that `game-sim` deletes the old page's tests; add the six `tally-tree` components to
  `THEMED_FILES` in `src/lib/shell/accent.spec.ts`; add the run's keys (arrow keys move the
  collecting ring, Shift moves it further) to About's shortcut list; `GameCell`'s
  `data-header-keep-open` is `tally-tree`'s; confirm what the header shows in the opening and for
  the open game.
- **closing**: the other eleven specs exist now: read them and replace every assumption with
  what they say; the run's counts are read from `data-dropped` and `data-collected` on the run
  layer, not a window hook; `seedRunMs` is in `e2e/helpers/game.ts` (`game-save`); at `/` the
  open game shows the simulation and Paint's specs seed a new visitor; your write set now holds
  the reach check's rename to `scripts/reach-check.ts`, `docs/dev/pipeline.md` and every
  `docs/dev` file no other unit writes; fix `docs/dev/map-perf.md`'s instruction to kill port
  4173; keep the owner action about the Google Auth Platform console.
