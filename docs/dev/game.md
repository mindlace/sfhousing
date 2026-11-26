# The game

## The game

The game is one map. Paint rooms for homes until the goal is met; after Start the page is the
simulation tool for the rest of the game: the map with its tilted camera and buildings, the
timeline, Play and Pause, held to the policies the game allows. The saved state is still version
2: it keeps units, the tree's purchases, the ladder and the last run, but no screen earns or
spends units, buys a node or settles a run now. The rules and saved games live in
`src/lib/game/`:

| File                                 | Holds                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `state.ts`                           | `GameState`, `MetRung`, `NEW_GAME`, `UNIT_KINDS`                                                |
| `save-shape.ts`                      | `GameSave`, `SaveEntry`, `parseGameSave`, `parseGameState`, `parseRunResult`                    |
| `units.ts`                           | `credit`, `affords`, `spend`, `shortBy`, `total`                                                |
| `tree.ts`                            | `TreeNode`, `Grant`, `treeView`, `buy`                                                          |
| `limits.ts`                          | `Limits`, `limitsOf`, `within`, `runnable`, `isGiven`, `OPEN_LIMITS`                            |
| `grant.ts`                           | `applyGrant`, `GAME_TRANSIT_ID`                                                                 |
| `ladder.ts`                          | `RUNGS`, `ladder`, `goalAt`, `finished`, `takeNext`, `fitGame`                                  |
| `run-result.ts`                      | `readRun`, `resultOf`, `settle`, `RunResult`                                                    |
| `side-goals.ts`                      | `SIDE_GOALS`, `sideShown`, `SideInput`                                                          |
| `words.ts`                           | The store's and the sync's words                                                                |
| `catalogue/`                         | `nodes.ts` (the nodes), `tuning.ts` (numbers), `ladder-years.ts` (years), `play.ts` (code play) |
| `ui/`                                | The screens and header parts                                                                    |
| `store.svelte.ts`, `saves.ts`        | The store, `MAX_SAVES`, storage keys                                                            |
| `save-sync.svelte.ts`, `save-api.ts` | The browser's sync with an account                                                              |
| `e2e.ts`                             | The e2e seam's readers                                                                          |

Syncing saved games to an account is [game-save.md](game-save.md). The page's shell, autosave and
workshop are [sim-page.md](sim-page.md); the timeline and its worker messages are
[timeline-ui.md](timeline-ui.md); the map's interfaces are [map-interfaces.md](map-interfaces.md).

## The page

The game has one address, `/`. `/sim` is a 308 to `/` (`src/routes/sim/+page.ts`), query dropped.

`src/routes/+page.svelte` picks the body: nothing until mount, then the editor of the open game,
the simulation when the game's `phase` is `'runs'`, else the opening. The opening
(`src/lib/shell/PaintOpening.svelte`) is the brush editor on the map with the plan's autosave. When
the latest complete score meets the goal and no pointer is held, `game.won()` runs and the opening
card shows (`OpeningCard`, `opening-start`). Start reads the map's camera and calls
`game.startRuns()`; a refused write keeps the opening and says so. The simulation (`SimRoute`,
then `SimPage`) mounts with that camera as `initialFrame`, so the map remounts once at Start and
keeps its view.

After Start the page is one screen, the simulation tool, at every load: the map (never locked or
flattened), the timeline with its Playhead, chart and rows, Play and Pause (Space too), the map
key, project cards and the tooltip, held to what is bought ([Limits](#limits)).

The header has no steps; the site name is the way home. In the opening it shows the name, the unit
count, the save state, the pinned room score and Publish. After it: the name, the unit count, the
save state (or "Updating"), the pinned goal (`GoalHeadline`, whose homes are the view on show's at
the playhead's month) and the actions: Undo and Redo while a pointer is coarse, and Publish. In the
open game there is no unit count and no game part.

## The game's state

`GameState` (`state.ts`), version 2:

| Field        | Holds                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| `phase`      | `'opening'` or `'runs'`                                                     |
| `firstWinAt` | ISO time of the first room goal met, or null                                |
| `bought`     | Node id to the level bought, 1 or more                                      |
| `units`      | What the player holds, by `UnitKind`                                        |
| `rung`       | The deadline in play                                                        |
| `met`        | `MetRung[]`: `rung`, `reachedOn`, `datasetVersion`, `at`; ascending by rung |
| `side`       | Side goal id to the ISO time it was met                                     |
| `runs`       | Runs settled                                                                |
| `last`       | The last `RunResult`, or null                                               |

`NEW_GAME` is the frozen new game: phase `'opening'`, nothing bought, no units, rung 0, no runs.
Nothing is reset in place: a new game is a new save made from `NEW_GAME` (`structuredClone`).

`firstWinAt` is set once, by `game.won()`, at the first room goal met. That is also when the
account is made: the sync mints an anonymous account at the first win ([auth.md](auth.md)). A
refused write leaves `firstWinAt` null, so the next win tries again.

## Units

`UnitKind` is `'home'`, the only kind (`UNIT_KINDS`). `Units` is a partial record of whole
numbers by kind. `credit(a, b)` adds, `affords(have, price)` compares kind by kind, `spend`
subtracts and throws `RangeError` when it does not afford, `shortBy` is what is missing (only
kinds that are short), `total` sums every kind. Every sum goes through `UNIT_KINDS`, so a second
kind is one new entry there; a price or reward in it needs no other change. Giving kinds different
worth is a table `total` would read; none exists yet.

## The tree

`TreeNode` (`tree.ts`): `id`, `branch` (`permitting`, `zoning`, `money` or `hands`), `label`,
`line`, `after` (nodes, any one bought opens it), `ring` (the first rung that shows it), `levels`
(`NodeLevel`: `price`, `grant`, `step`) and `source` (text and link, or null).

- `levelOf(s, node)` is the level bought, never above the node's last.
- `isShown(s, node)`: `s.rung >= node.ring` and `after` is empty or one of them is bought.
- `treeView(s)` is a `NodeView` for each shown node: `level`, and `state` `'ready'` (the next
  level is affordable), `'short'` (with `short`, what is missing) or `'done'`.
- `buy(s, id)` is pure: `{ ok: true, state, grant }` with the price spent and the level raised, or
  `{ ok: false, reason }` with `'unknown'`, `'hidden'`, `'done'` or `'short'`.

A `Grant` is `preset` (a permitting timing), `measure` (a funding preset), `stop` (a stop type),
`bands`, `stories`, `reach` (the zoning rule's limits) or `hands` (the ring's `radius`, `linger`
or `auto`).

`catalogue/nodes.ts` lists the catalogue: each entry names its branch, `after` and a `stage` 0 to 4. `NODES` gives each entry its `ring` (`ringOf(stage)` on this build's ladder) and its prices
from `PRICES` in `tuning.ts`; a node with no price per level throws at load. Every permitting and
money node names its source from the preset's own provenance; zoning and hands nodes have none.

No screen shows the tree now; its nodes still set the limits and the code play below. A new branch
is a `Branch` value, catalogue entries and their prices, and a `Grant` tag with its case in
`limitsOf` and `applyGrant`.

## Tuning

`catalogue/tuning.ts` holds `RUNG_LUMP`, `SIDE_TUNING` and `PRICES`. No script plays the tree any
more (`scripts/tree-balance.ts` is gone with the points game's tuning): people edit the numbers,
and the reach check's report ([The reach check](#the-reach-check)) is the instrument that shows
what each policy and each round does to the goal.

## Grants and the policy document

The store does not hold the policy document. No page buys now; `applyGrant(doc, grant, { cal,
limits })` is what a purchase does to the document, and the code play and the reach check use it.

`applyGrant` (`grant.ts`) uses the editor's own functions:

- `preset` and `measure` add the policy from that preset, on from month 1 (`addPolicy`), or switch
  an existing one of that preset on. A preset the dataset does not offer changes nothing.
- `stop`, `bands`, `stories` and `reach` edit one zoning rule, `GAME_TRANSIT_ID`
  (`'game-transit'`, labelled "Transit rule"), made when the first of them arrives: every stop type
  bought, one band at the limits, from month 1.
- `hands` changes no policy.

The Inspector's own On switch turns a policy off and on. `src/lib/sim-page/game-levers.ts`, which
made the tree's switch and restore documents, has no page user now.

`catalogue/play.ts` plays the tree in code: `buyAndApply(played, id, cal)` is `buy` then
`applyGrant`; `fullTree(cal)` buys every level of every node in catalogue order at no cost, at the
last rung with the last rung unmet, and returns the state and its runnable document. The scripts
and `scripts/reach-check.ts` use them.

## Limits

`limitsOf(state)` (`limits.ts`) is what the bought nodes allow:

- `presets` and `measures`: the permitting presets and funding presets granted.
- `stops`: the stop types granted. Once one is, the transit rule's floor is `START_BANDS` 1 band,
  `START_STORIES` 4 stories and `START_REACH_M` 402 m; `bands`, `stories` and `reachM` then rise
  with the nodes that grant them, to the editor's own maxima. With no stop type all three are 0.
- `hands`: `radiusPx`, `lingerMs` and `auto`, from `BASE_HANDS` (48 px, 4,000 ms, off) raised by
  the nodes; nothing reads them now that the run's ring is gone.
- `custom`: whether custom timings run.
- `open`: false.

`finished(state)` (the last rung met) lifts the rest: every stop type, the observed preset, the
editor's maxima for bands, stories and reach, and custom timings. `OPEN_LIMITS` is every limit
open, used by the open game and by a page with no game.

`within(kind, policy, limits)` says whether one policy runs; `runnable(doc, limits)` keeps the
policies that do, and returns `doc` itself when none goes. What never runs in a game: painted
zoning, a category policy with no stop type bought, money that is not made from a funding preset
(`isGiven`: a string `preset` and `where.tag` `fund`, `baseline` or `terms`), a funding preset not
granted, and custom timings before the end. `FREE_MEASURES` (`state-off`, `federal-credits-off`)
run as soon as any measure is bought. The workshop shows the whole document, and the worker runs
and Publish sends the runnable one.

## The ladder

`LADDER_YEARS` (`catalogue/ladder-years.ts`) are the earlier deadline years, the rungs after rung 0 (the window's end), latest
first, at most four. People set them (no script writes them now), from the largest multiple of
five at least five years before the window's end year down to the first multiple of five at or
after the year the reach check's "Every policy" line reaches the goal (the first and last kept,
with two between, when more than four fit). The document names the rule, not the years. `RUNGS` is `LADDER_YEARS.length + 1`.

- `ladder(asOf)` is each rung's `deadline` and its short month-year `label`. Rung 0 is
  `defaultGoal(asOf).deadline`; rung k is the last day of December of `LADDER_YEARS[k - 1]`, never
  after the rung before it and never before the dataset date's month.
- `goalAt(asOf, rung, amount?)` is `defaultGoal(asOf)` with that deadline and, when given, that
  amount. It throws `RangeError` for a rung outside `0` to `RUNGS - 1`.
- `takeNext(state)` moves to the next rung when the rung in play is met and one follows.
- `finished(state)` is true once the last rung is in `met`.
- `fitGame(state)` fits a state to this build: it drops `bought` entries for nodes the catalogue
  lacks, lowers a level above a node's last, drops `side` entries for goals `SIDE_GOALS` lacks and
  lowers `rung` and drops `met` entries at `RUNGS` or above. It returns the same object when
  nothing changes.

A met deadline stays met after a data update: `settle` never removes a `met` entry, and a
`MetRung` keeps the `datasetVersion` it was earned on.

## Side goals

`side-goals.ts` defines small goals a run can meet beside its deadline. `SIDE_GOALS` is each
goal's definition with its target and reward from `SIDE_TUNING` by id; a goal with no
`SIDE_TUNING` entry is not offered; on the production dataset all eleven have one. A goal has a
`ring` (the first rung that shows it), a `label` and `read(input)`, which returns the value against
the target or null when the view lacks what it reads.

`SideInput` is `{ view, index, take, inForce }`: the forecast's view, the deadline's month in it,
the run's take, and whether any policy of the runnable document is in force. Each goal reads what
the page already has: `planEffect` (homes the plan adds over current law), the take, the money
pools the player added, homes under construction. A goal that reads `planEffect` reads 0 while
`inForce` is false, since the view's twin is then the old zoning, not current law.

`sideShown(state)` is the first `SIDE_SHOWN` (3) goals whose ring is open and not yet met. The
goal headline reads them with the last run's take on the rung in play (none without one).

## Run results

`run-result.ts` still reads and settles a `RunResult` (`readRun`, `resultOf`, `settle`), and
`GameState.last` holds the last one; no page runs or settles a run now. The run's clock, drops,
ring, sound and their prefs are gone, and so are the tally and the tree's screen.

## The screens and header parts

All in `src/lib/game/ui/`; none renders for the open game.

- **`OpeningCard`** (`opening-card`, `opening-start`): the room goal met; Start has focus.
- **`GoalHeadline`** (`goal-headline`, `goal-headline-button`, `goal-line2`, `side-goals`,
  `side-goal`, `goal-side-mark`, `goal-live`): the pinned goal. Line 1 is the homes of the amount by
  the deadline (a rolling count) and a bar; line 2 is what the goal unlocks and the side goals met.
  The button opens the side goals pop-over.
- **`GameCell`** (`header-units`, `header-game-panel`): the unit count, rolling to each total. From
  lg it sits in the bar with the panel as a pop-over; in the Menu the panel opens in place.
- **`GamePanel`** (`game-panel`, `game-stage`, `game-sync`, `save-row`, `game-error`): the
  current game's name and stage, the sync line and the saved games (switch, rename in place,
  delete after one question, "New game"). A change that loads another game calls `reloadGame()`
  (`ui/reload.ts`), a full page load of `/`. At `MAX_SAVES` "New game" is `aria-disabled`; a
  refused change shows `FULL_TEXT` or `STORAGE_TEXT`.

The words are in `ui/words.ts`.

## The store

`GameStore` (`store.svelte.ts`) holds every saved game in memory and writes through to storage.

Reactive getters: `state`, `limits` (`OPEN_LIMITS` for the open game, else `limitsOf(state)`),
`saves` (`SaveEntry[]`, latest first, ties by id), `currentId`. Plain: `open`, `sync`.

| Method             | Does                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| `won()`            | Sets `firstWinAt` once                                                               |
| `startRuns()`      | Sets `phase` `'runs'`; refused (`storage`) while `firstWinAt` is null                |
| `buy(id)`          | `buy` of the tree, written; a refused write answers `{ ok: false, reason: 'short' }` |
| `settle(result)`   | `settle` of a run, written; the same result again writes nothing                     |
| `takeNext()`       | `takeNext` of the ladder, written when the rung moves                                |
| `touched()`        | The page's autosave wrote a record key: the save's records and time update           |
| `newGame()`        | A new game becomes current                                                           |
| `switchTo(id)`     | Another game becomes current                                                         |
| `rename(id, name)` | Trims, keeps 60 code points, ignores an empty name; a duplicate is allowed           |
| `remove(id)`       | Removes a game; removing the current one makes the latest other game current         |
| `read(id)`         | A copy of the save; the current one with its record keys as they are                 |
| `adopt(saves)`     | Takes saves from the account                                                         |
| `rekey(id, newId)` | Gives a save a new id                                                                |
| `beforeLeave(fn)`  | Registers `fn`; returns its remover                                                  |

Every write is one sequence: it puts back the keys it wrote and keeps memory as it was when one
throws, and answers `{ ok: false, reason: 'storage' }`; `full` and `changed` are the other
refusals. Each accepted write calls `sync.changed(id)`, or `sync.removed(id)` for a removed game;
`newGame` calls `changed` for the game left and the game made, `switchTo` for the game left.
`rekey` and `adopt` call neither. In memory mode `won`, `startRuns`, `buy`, `settle`, `takeNext`, `touched` and
`rename` change memory and call the sync, writing nothing; `switchTo` of the current id answers `ok`;
the others answer `storage`.

Every save the store reads, from storage or from the account, goes through `parseGameSave` and
then `fitGame` on its state.

`beforeLeave`: a page that autosaves a record key registers its autosave's `flush()` when it
mounts and removes it on unmount. `newGame`, `switchTo` of another game, `remove` of the current
game and `adopt` of saves holding the current id call every function in order, once their checks
pass and before they read or write a record key; one that throws is skipped. `adopt` of the
current id answers `changed` and writes nothing when a function moved the game's played time.
After one of these changes answers `ok`, `touched()` does nothing: the caller loads a page in full
next. Two tabs share one storage, each keeps its own memory, and the last write wins.

## Saved games and storage

`GameSave` (`save-shape.ts`) is version 2: `id`, `name`, `nameIsDefault`, `state`, `plan` and
`policy` (the text of the two record keys, or null) and `savedAt`. `parseGameSave` returns a new
save of the known fields, or null; it checks the whole `GameState` (`parseGameState`) including
that the phase agrees with the rest. `MAX_SAVES` is 12 and `SAVE_NAME_MAX` is 60 code points.
`defaultSaveName(from, taken)` (`words.ts`) names a game: "Game, 22 Nov", or "{name} (this
device)" for a conflict; the first candidate not in `taken`, with " (2)", " (3)" and so on, cut to
60 code points. `saves.ts` imports only by relative path, because `e2e/helpers/game.ts` loads it
under Playwright.

| Key                                     | Holds                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| `sfhousing:saves:v1`                    | The index `{ v: 2, current, saves: SaveEntry[] }`, latest first     |
| `sfhousing:save:<id>`                   | One `GameSave` as JSON                                              |
| `sfhousing:save:corrupt:<ISO>`          | The raw text of a save or index that would not parse                |
| `sfhousing:sim:corrupt:<ISO>`           | The v1 policy text, copied aside when `sfhousing:sim:v2` was absent |
| `sfhousing:plan:v1`, `sfhousing:sim:v2` | The current game's records, as the pages write them                 |

The store reads storage once, at construction:

1. Storage null or a read throwing: memory mode, one new game; what construction set is put back.
2. No index: the first game, made from the two record keys, is saved, then the index.
3. An invalid index: it goes to a corrupt key and the store rebuilds from every `sfhousing:save:`
   key that parses and whose `id` matches its key; the rest go aside.
4. A valid index: each entry's save is read; an absent or unparsable save is left out and its text
   goes aside. When the current game is left out, a new game from the records is current.
5. Anything left out, added or corrected rewrites the index; a refused write puts everything back
   and leaves memory mode with the games read.

A record (`sfhousing:plan:v1`, `sfhousing:sim:v2`) belongs to the current game; a change that makes
another game current copies the old one out first, and writes the new game's records. Whenever a
change writes them and `sfhousing:sim:v1` holds a value, it removes it (copied aside first when
`sfhousing:sim:v2` was absent).

A five-level record (a save or index with `v` 1) is deleted at load, unread. Any other text that
is not a save moves aside. The server side is [game-save.md](game-save.md).

## The open game and memory mode

Memory mode is a store with no usable storage: it keeps its games and writes nothing.

`openGame()` is a store in memory mode with one game "Game": phase `'runs'`, every node bought at
its last level, every rung met, no units, `limits` equal to `OPEN_LIMITS`, `open` true and a sync
that does nothing (`state` `'local'`, no account). It is the whole tool: `SimRoute` hands the page
no game for it, so there is no goal headline and nothing is locked. `open` is true only for
this store and never changes; pages read `open`. Its writes do nothing.

The server renders the open game: the layout provides `openGame()` when not in the browser, and
`/` renders an empty frame until it mounts. `/s/<id>` shows a published policy read-only: the page
in view mode with no game and no autosave. `useGame()` returns the provided store, or a new
`openGame()` outside a provider.

## The root layout and mounting

`src/routes/+layout.svelte` calls `provideGame(makeGame())` once, at init. On the server
`makeGame()` gives `openGame()`. In the browser it builds the real store before any page script
runs: `getStorage()`, then `e2eOpen(storage)` (then `openGame()`), else `createSaveSync`,
`new GameStore({ storage, sync })` and `sync.attach(store)`. The layout is not remounted by a
client navigation, so this runs once per document.

Until mounted, the server's store is the open game and the browser's may be at any phase, so the
first client render must match the server's. A component whose markup depends on the game (the
phase, the units, the saved games, a game-only control) keeps its own `mounted` flag, set in
`onMount`, and renders no game part until then. `+page.svelte` renders its empty frame until
mount; `SiteHeader` renders `GameCell` only after mount. Scripts, effects and `onMount` may read
the store at any time.

## Publishing

Publish sends the plan in the opening and the runnable document after it: `SimPage`'s `publishDoc`
is the document with `run` (`runnable(doc, limits)`) as its policy, so a game publishes what runs
and never a locked policy. The header's Publish opens nothing while the document is empty. There
is no Remix.

## The e2e seams

On a `VITE_E2E=1` build (`src/lib/game/e2e.ts`):

- `sfhousing:e2e:game`: `e2eOpen(storage)` is true when the key is absent, storage is null, or
  reading throws: the layout provides the open game. Without `VITE_E2E=1` it is false.
- `sfhousing:e2e:goal`: `e2eGoalAmount(storage)` is that amount (a whole number of 1 or more), else
  null. Paint and the simulation read it once for the goal's amount. The fixture city is too small
  for the real goal, so the journeys use amount 1.

A spec knows the page is the simulation tool when its dock (`tl-dock`) shows.

`e2e/helpers/game.ts` (before the page loads): `seedGame(page, state?)` stores a version 2 game
over `NEW_GAME` and switches the real game on (a phase `'runs'` state gets a `firstWinAt`);
`newVisitor(page)` switches it on with nothing stored; `seedGoalAmount(page, amount)`. Each page
takes one of `seedGame` or `newVisitor`.

`e2e/helpers/sharing.ts`: `gotoEditor(page)` calls `newVisitor` the first time it is called for a
page and goes to `/`; a spec that seeds its own game and wants `/` calls `gotoHydrated(page, '/')`.

`e2e/helpers/play.ts` plays the game; every wait is a state in the page or in storage:

| Helper                   | Does                                                               |
| ------------------------ | ------------------------------------------------------------------ |
| `seedRuns(page, state?)` | Amount 1 and a seeded game (default: one run settled)              |
| `savedGame(page)`        | The current game as storage holds it                               |
| `waitSaved(page, ok)`    | Polls `savedGame` every 50 ms until `ok` holds                     |
| `waitSim(page)`          | Waits for the simulation tool: `tl-dock` visible                   |
| `tabTo(page, target)`    | Tab, at most 80 presses, until `target` has focus                  |
| `openGamePanel(page)`    | Opens the game panel from the unit count (the Menu first below lg) |

`e2e/helpers/header-text.ts` has `widestGameHeader(page)`, which writes the widest unit count and
goal line into the header for the width checks.

`e2e/game-a11y.spec.ts` runs the accessibility checklist on each state.

## The reach check

```
npx tsx scripts/reach-check.ts <datasetDir> [--amount <homes>] [--cars on|off]
npx tsx scripts/reach-check.ts --version <datasetVersion> [--from <origin>] [--amount <homes>] [--cars on|off]
```

`--cars off` runs the worlds without the car system (default `on`, [cars.md](cars.md)). Two
sources: a built dataset directory, or a published version fetched from an origin (`--from`,
default production). Amount 82,069 homes unless `--amount` gives another.

**The rule.** Every policy of the catalogue on at its fixed values (`catalogueDoc` with all twelve
keys, `src/lib/game/catalogue/rounds.ts`) must reach the goal inside the window. It is the only
gate: exit 0 when it does (`Report.all.reachedOn` is not null), 1 when it does not.

**The report.** Beside the rule the check asks the engine for current law, every policy alone
against current law, every policy over the rounds before its own (round 1 policies read as alone),
and rounds 1 to 4 all on: 30 views at most, one at a time, a repeated list of keys read once
(`measure`). Each reading (`readReading`) is the first month the goal's amount is met and the homes
by the window's last month. Lines on stdout, in this order:

```
Dataset <datasetVersion>
Goal: <amount> homes
Every policy: reached <Mon YYYY>            (or: not by <Mon YYYY>, the window's last month)
Current law: reached <Mon YYYY>
Alone, against current law:
  <label>: <Mon YYYY>, <n> months earlier, +<homes> homes by <Mon YYYY>
In its round, against the rounds before:
  <label>: ...                              (one line per policy, catalogue order)
Rounds, all on:
  <k>: <Mon YYYY>, <n> months earlier, <homes> homes by <Mon YYYY>   (against the row above)
To judge: nothing                           (or "To judge:" and the lines below)
Filled in <s> s (cars on|off)
```

A policy line reads `no change` for 0 months, `<n> months later` when later, and `n/a` for the
months with `not by <Mon YYYY>` for the month when it misses (or when what it is compared with
misses). "To judge" lists `Round k gains nothing` for a round that is not earlier than the row
above (current law for round 1) or misses, and `<label> alone: <n> fewer homes` or
`<label> in its round: <n> fewer homes` for a policy that builds fewer homes than what it is
compared with. The last line is the opening fill's wall-clock time (`Engine.fillMs`) and the car
switch. Nothing in the report gates; it is for the person reading it.

Exit 2 when the check could not run, with one stderr line, `reach-check: <reason>`, and nothing on
stdout (no source, both a directory and `--version`, an unknown flag, `--from` without
`--version`, an `--amount` that is not a whole number above 0, a `--cars` that is not `on` or
`off`, or the engine failing).

It is run before every dataset upload, on the directory that is then uploaded, and must exit 0
([pipeline.md](pipeline.md)). Its test is `scripts/reach-check.spec.ts`, on a stub engine with
synthetic numbers and the fixture dataset at an amount of 1; no test holds a figure measured on the
production dataset.

Result of 2026-11-26 on dataset `2026-11-25-76c90397`, cars on, at a 1-minute load of about 6
(the fill time is ballpark):

```
Dataset 2026-11-25-76c90397
Goal: 82,069 homes
Every policy: reached Feb 2048
Current law: reached Oct 2061
Alone, against current law:
  Taller near BART and Caltrain: May 2059, 29 months earlier, +4,724 homes by Oct 2066
  SB 423 clock: Oct 2061, no change, +277 homes by Oct 2066
  Housing bond: Mar 2061, 7 months earlier, +465 homes by Oct 2066
  Taller near Muni Metro: Sep 2057, 49 months earlier, +8,805 homes by Oct 2066
  Benchmark permits: Mar 2061, 7 months earlier, +1,135 homes by Oct 2066
  General revenue: Jun 2059, 28 months earlier, +2,468 homes by Oct 2066
  Taller near bus: Mar 2059, 31 months earlier, +3,852 homes by Oct 2066
  Revolving fund: Oct 2061, no change, +9 homes by Oct 2066
  Federal support: May 2060, 17 months earlier, +1,697 homes by Oct 2066
  No discretionary review: Mar 2060, 19 months earlier, +2,510 homes by Oct 2066
  Public bank: Oct 2061, no change, +0 homes by Oct 2066
  State money doubled: Oct 2061, no change, +0 homes by Oct 2066
In its round, against the rounds before:
  Taller near BART and Caltrain: May 2059, 29 months earlier, +4,724 homes by Oct 2066
  SB 423 clock: Oct 2061, no change, +277 homes by Oct 2066
  Housing bond: Mar 2061, 7 months earlier, +465 homes by Oct 2066
  Taller near Muni Metro: Apr 2057, 50 months earlier, +5,164 homes by Oct 2066
  Benchmark permits: Oct 2060, 8 months earlier, +600 homes by Oct 2066
  General revenue: Sep 2057, 45 months earlier, +6,834 homes by Oct 2066
  Taller near bus: Dec 2050, 20 months earlier, +4,414 homes by Oct 2066
  Revolving fund: Aug 2052, no change, +4 homes by Oct 2066
  Federal support: Mar 2052, 5 months earlier, +1,099 homes by Oct 2066
  No discretionary review: Apr 2048, 22 months earlier, +3,560 homes by Oct 2066
  Public bank: Feb 2050, no change, +0 homes by Oct 2066
  State money doubled: Feb 2050, no change, +1 homes by Oct 2066
Rounds, all on:
  1: Jun 2061, 4 months earlier, 88,462 homes by Oct 2066
  2: Aug 2052, 106 months earlier, 103,514 homes by Oct 2066
  3: Feb 2050, 30 months earlier, 108,899 homes by Oct 2066
  4: Feb 2048, 24 months earlier, 112,496 homes by Oct 2066
To judge: nothing
Filled in 3.0 s (cars on)
```

## Words

`src/lib/game/words.ts` holds the store's and the sync's words: `syncText`, `playedText(savedAt,
now)` ("Today", "Yesterday", "4 Mar", "4 Mar 2025"), `defaultSaveName`, `FULL_TEXT` and
`STORAGE_TEXT`. `ui/words.ts` holds the screens' words and `src/lib/timeline/game-copy.ts` the
simulation page's (the locked lane and what a goal unlocks). A page that shows a full list, a
refused write or the sync's state imports these; none writes its own wording.
