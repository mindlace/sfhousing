# The game

## The game

The game is one loop on one map. Paint rooms for homes until the goal is met, then run the forecast
to a deadline, collect homes as they complete, spend them in the tree on policies and money, and
run again; each deadline met opens the next, earlier one. The rules and saved games live in
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
| `run/`                               | Drops, the run layer, the ring, sound, prefs                                                    |
| `ui/`                                | The screens and header parts                                                                    |
| `store.svelte.ts`, `saves.ts`        | The store, `MAX_SAVES`, storage keys                                                            |
| `save-sync.svelte.ts`, `save-api.ts` | The browser's sync with an account                                                              |
| `e2e.ts`                             | The e2e seam's readers                                                                          |

Syncing saved games to an account is [game-save.md](game-save.md). The page's shell, autosave and
workshop are [sim-page.md](sim-page.md); the timeline and its worker messages are
[timeline-ui.md](timeline-ui.md); the map's interfaces are [map-interfaces.md](map-interfaces.md).

## The page and its phases

The game has one address, `/`. `/sim` is a 308 to `/` (`src/routes/sim/+page.ts`), query dropped.

`src/routes/+page.svelte` picks the body: nothing until mount, then the editor of the open game,
the simulation when the game's `phase` is `'runs'`, else the opening. The opening
(`src/lib/shell/PaintOpening.svelte`) is the brush editor on the map with the plan's autosave. When
the latest complete score meets the goal and no pointer is held, `game.won()` runs and the opening
card shows (`OpeningCard`, `opening-start`). Start reads the map's camera and calls
`game.startRuns()`; a refused write keeps the opening and says so. The simulation (`SimRoute`,
then `SimPage`) mounts with that camera as `initialFrame`, so the map remounts once at Start and
keeps its view.

After Start the page is in a phase (`src/lib/sim-page/game-phase.ts`; `tl-mode` carries it as
`data-phase`):

| Phase      | What shows                                       | Left by                                   |
| ---------- | ------------------------------------------------ | ----------------------------------------- |
| `starting` | The map in its run view while the forecast fills | `ready` to `run`; `abort` to `tree`       |
| `run`      | Drops appear and the clock plays to the deadline | `settled` to `tally`; `abort` to `tree`   |
| `tally`    | The result of the run                            | `continue` to `tree`                      |
| `tree`     | The tree over the map                            | `run` to `starting`; `edit` to `workshop` |
| `workshop` | The forecasting tool, held to what is bought     | `back` to `tree`                          |

`nextPhase(phase, event, runs)` is the only move; an event the table lacks leaves the phase. With
no run settled (`runs` 0), `abort` from `starting` or `run` gives `starting` again. `landing(state)`
is where a mount lands: `starting` while `runs` is 0, else `tree`. The map is in its run view in
`starting`, `run` and `tally` (`RUN_VIEW`; the map's root carries `data-run-view="on"`).

The header has no steps; the site name is the way home. In the opening it shows the name, the unit
count, the save state, the pinned room score and Publish. After it: the name, the unit count, the
save state (or "Updating"), the pinned goal (`GoalHeadline`) and the actions: "Back to the tree"
(`game-back`) in the workshop, Undo and Redo while a pointer is coarse and the map is not in its
run view, and Publish. In the open game there is no unit count and no game part.

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

A new branch is a `Branch` value, a `layout.ts` entry (`BRANCH_ORDER`), a name in `BRANCH_NAMES`
(`ui/words.ts`), catalogue entries and their prices, and a `Grant` tag with its case in
`limitsOf` and `applyGrant`.

## Tuning

`catalogue/tuning.ts` holds `RUNG_LUMP`, `SIDE_TUNING` and `PRICES`, the only numbers
`scripts/tree-balance.ts` tunes. The ladder's years are the other measured value, in
`catalogue/ladder-years.ts`. Both files hold the values measured and tuned on the production
dataset; the comment in `ladder-years.ts` names the dataset and the reach. Only people edit them.
Code and tests elsewhere pass their own prices, years and rung counts, and read neither file.

```
npx tsx scripts/tree-balance.ts <datasetDir> [--order <name>] [--amount <homes>] [--json]
npx tsx scripts/tree-balance.ts --version <datasetVersion> [--from <origin>]
```

It plays the tree against the engine in several purchase orders, once by hand (a share of the
drops collected, from the ring's size and linger) and once with "Collect for me". Each play reports
its runs, what was bought, a clock from assumed seconds (`CLOCK`) and five pacing checks
(`TARGETS`): first purchase, early runs per purchase, runs per purchase, the longest gap between
map changes, and purchases between deadlines. A last block reads each side goal against current
law at its rung's deadline and flags a goal that current law already meets
(`at-or-below-current-law`, with the number to raise to) or that no play met (`never-met`).

Exit 0 when every gated play finished and passed its checks and no side goal is flagged; 1
otherwise; 2 when it could not run. Only the hand plays of five orders gate the exit (`GATED`:
`catalogue`, `permitting-first`, `zoning-first`, `hands-first`, `cheapest`). `tuning.ts` is
kept at numbers under which it exits 0 on the production dataset.

## Grants and the policy document

The store does not hold the policy document; the page applies grants. `SimPage`'s `buy(id)` calls
`game.buy(id)` and, when it is accepted, `applyGrant(doc, grant, { cal, limits })` as one undo step
named "Bought: ...", written at once, with `limits` read after the purchase.

`applyGrant` (`grant.ts`) uses the editor's own functions:

- `preset` and `measure` add the policy from that preset, on from month 1 (`addPolicy`), or switch
  an existing one of that preset on. A preset the dataset does not offer changes nothing.
- `stop`, `bands`, `stories` and `reach` edit one zoning rule, `GAME_TRANSIT_ID`
  (`'game-transit'`, labelled "Transit rule"), made when the first of them arrives: every stop type
  bought, one band at the limits, from month 1.
- `hands` changes no policy.

Each node's switch on the tree, and the Inspector's own On switch, turn its policies off and on. A
node switched off keeps what it cost: there is no refund. Edit on a bought node adds its policy
back when the document has none. `src/lib/sim-page/game-levers.ts` makes the switch and restore
documents.

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
  the nodes.
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

`LADDER_YEARS` (`catalogue/ladder-years.ts`) are the deadline years after the window's end, latest
first, at most four. `npx tsx scripts/reach-measure.ts <datasetDir> --write` sets them: it runs the
full tree, reads the month the goal is reached, and writes the years from the largest multiple of
five at least five years before the window's end year down to the first multiple of five at or
after the reached year (the first and last kept, with two between, when more than four fit). The
document names the rule, not the years. `RUNGS` is `LADDER_YEARS.length + 1`.

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
`SIDE_TUNING` entry is not offered. On the production dataset `funded-homes` and
`affordable-homes` have none, so they are not offered. A goal has a `ring` (the first rung that
shows it), a `label` and `read(input)`, which returns the value against the target or null when
the view lacks what it reads.

`SideInput` is `{ view, index, take, inForce }`: the forecast's view, the deadline's month in it,
the run's take, and whether any policy of the runnable document is in force. Each goal reads what
the page already has: `planEffect` (homes the plan adds over current law), the take, the money
pools the player added, homes under construction. A goal that reads `planEffect` reads 0 while
`inForce` is false, since the view's twin is then the old zoning, not current law.

`sideShown(state)` is the first `SIDE_SHOWN` (3) goals whose ring is open and not yet met.

## A run

The run is not the playhead. The workshop's playhead plays a forecast for looking; a run is a
clock in `TimelineMode` from today to the stop day (the goal's deadline, or the window's last day),
of `runMs` wall time: `RUN_MS` (20 s, `src/lib/fzp/playback.ts`), or the e2e seam's. `runRate(asOf,
stop, ms)` gives the days per second.

- **The drops' feed.** `planDrops(markers, asOf, stop)` (`run/drops.ts`) is one drop for each
  city marker completed after today and by the stop day whose worth (`homes - existing`) is above
  0, ascending by day then row; `TimelineMode` plans them from the activity index and plans again
  as the forecast fills, matching drops by `row`. `RunFeed` is `{ drops, day, running, project }`.
- **`feed.running`** holds each value for at least one animation frame: `TimelineMode` counts
  two ticks of its frame seam after each change (`markRunningChange`, `onTick`), starts a run only
  once they have passed and holds an abort that comes sooner, so the run layer always sees a run
  start and end.
- **Settling.** When the clock has stopped at the stop day with current numbers, `readRun(view,
goal)` reads the deadline's month. It returns null until the view is filled through that month,
  read clamped to the view's months (`deadlineIndex`). `resultOf(state, reading, take, input,
meta)` builds the `RunResult`: homes, `reachedOn`, the stages and money waiting, `dropped`,
  `collected`, `lump` (`RUNG_LUMP` when this run first meets its rung) and the side goals met
  (shown, not yet met, value at or above target). `settle(state, result)` credits what was
  collected, the lump and each side reward, records the rung in `met` when `reachedOn` is set and
  the rung is not there, records each side goal, adds 1 to `runs` and sets `last`.
- **What a run pays:** what was collected, plus the lump once per rung, plus each side reward once.
  A result settled twice pays its lump and side rewards once (`settle` pays only what it records),
  and `game.settle` refuses a second settle of one result (same `at` and `rung`).
- **A first run that fails** (the forecast cannot load, or the run halts before one settled)
  starts again: `abort` with `runs` 0 gives `starting`.
- **A bought node** shows in the next run, not before it: a purchase changes the policy document,
  the forecast fills again and Run waits (`aria-busy`, "tree-busy") until it is ready.

## Drops, the ring and sound

`RunLayer` (`run/RunLayer.svelte`) is a canvas over the map with `pointer-events: none`, listening
on the window. Its props: `feed`, `hands`, `collectForMe`, `sound` and `ontake`.

- A drop appears when `feed.day` reaches its day and counts in `dropped` then. A drop whose
  `policy` flag is set pops as a diamond in the policy mark's colour; the rest are circles in the
  accent.
- A drop is collected, once, when its projected point is within `hands.radiusPx` of the ring. It
  leaves the larger of `hands.lingerMs` and 400 ms after it appeared; when the run ends first, 400
  ms after the end (at the end under reduced motion). With `collectForMe` or `hands.auto`, every
  drop is collected as it appears.
- The ring follows the pointer. Arrow keys move it by `RING_KEYS.stepPx` (16 px), Shift by
  `shiftStepPx` (64 px), sweeping the ground between. The map box takes focus in `starting` and
  `run`, so the keys reach the ring.
- `ontake` sends the run's totals as they change and once when `running` turns false. The layer's
  root carries `data-dropped` and `data-collected` (homes) and `data-state` (`running` or `idle`).
- "Collect for me" is a switch in the game panel (`sfhousing:run:collect`); the sound switch is
  `sfhousing:run:muted`. `onPrefs(fn)` calls `fn` after either is written in this page, and a
  change applies to a run in progress. With `hands-auto` bought the switch is on and disabled.
- With reduced motion, drops and counts appear and go without movement. Nothing flashes more than
  three times a second. A screen reader hears the run's totals once, at its end (`run-live`),
  never each drop.
- `createSound(muted)` (`run/sound.ts`) makes `pop`, `collect`, `goal` and `buy` with the Web Audio
  API and loads no file. It is silent while `muted()` is true and before a user gesture.
- Nothing the layer does reaches the worker or the policy document.

The layer's words are in `run/words.ts` (`runOverText`, `dropCountText`).

## The screens and header parts

All in `src/lib/game/ui/`; none renders for the open game.

- **`OpeningCard`** (`opening-card`, `opening-start`): the room goal met; Start has focus.
- **`GoalHeadline`** (`goal-headline`, `goal-headline-button`, `goal-line2`, `side-goals`,
  `side-goal`, `goal-side-mark`, `goal-live`): the pinned goal. Line 1 is the homes of the amount by
  the deadline (a rolling count) and a bar; line 2 is what the goal unlocks and the side goals met.
  The button opens the side goals pop-over.
- **`GameCell`** (`header-units`, `header-game-panel`): the unit count, rolling to each total. From
  lg it sits in the bar with the panel as a pop-over; in the Menu the panel opens in place.
- **`GamePanel`** (`game-panel`, `game-stage`, `game-sync`, `game-sound`, `game-collect`,
  `save-row`, `game-error`): the current game's name and stage, the sync line, the two switches and
  the saved games (switch, rename in place, delete after one question, "New game"). A change that
  loads another game calls `reloadGame()` (`ui/reload.ts`), a full page load of `/`. At `MAX_SAVES`
  "New game" is `aria-disabled`; a refused change shows `FULL_TEXT` or `STORAGE_TEXT`.
- **`Tally`** (`tally`, `tally-homes`, `tally-change`, `tally-bar`, `tally-units`, `tally-lump`,
  `tally-side`, `tally-stage`, `tally-money`, `tally-continue`): the run's result, with the
  `AccountOffer` under Continue. Its counts roll once from mount; Continue
  takes focus; Escape continues.
- **`Tree`** (`tree`, `tree-branch`, `tree-node`, `tree-node-open`, `tree-node-edit`,
  `tree-node-on`, `tree-detail`, `tree-buy`, `tree-source`, `tree-busy`, `tree-next`, `tree-run`,
  `tree-ending`, `tree-publish`, `tree-live`, `tree-root`): fills the page below the header
  (`game-tree-pane` in `TimelineMode`; the map stays mounted under it, inert). It shows current law
  as the root, the branches of node cards, one open node's detail, the balance, "Take the next
  goal" while one is offered, and Run, which has focus on mount. Once the last rung is met it shows
  the ending (`tree-ending`): the month reached, the month the state asks by, the levers bought,
  and Publish.
- The tree's Publish presses the header's Publish ([Publishing](#publishing)).

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
`rename` change memory and call the sync, writing nothing; the others answer `storage`.

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

| Key                                            | Holds                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| `sfhousing:saves:v1`                           | The index `{ v: 2, current, saves: SaveEntry[] }`, latest first     |
| `sfhousing:save:<id>`                          | One `GameSave` as JSON                                              |
| `sfhousing:save:corrupt:<ISO>`                 | The raw text of a save or index that would not parse                |
| `sfhousing:sim:corrupt:<ISO>`                  | The v1 policy text, copied aside when `sfhousing:sim:v2` was absent |
| `sfhousing:plan:v1`, `sfhousing:sim:v2`        | The current game's records, as the pages write them                 |
| `sfhousing:run:collect`, `sfhousing:run:muted` | The run's two switches                                              |

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
that does nothing (`state` `'local'`, no account). It is the whole tool with no runs, tally or
tree: `SimRoute` hands the page no game for it, so the page has no phase. `open` is true only for
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
and never a locked policy. The ending's Publish (`tree-publish`) presses the header's Publish and
opens the same dialog (below lg it opens the Menu first, where the button is). The header's Publish
opens nothing while the document is empty. There is no Remix.

## The e2e seams

On a `VITE_E2E=1` build (`src/lib/game/e2e.ts`, `src/lib/sim-page/e2e-run.ts`):

- `sfhousing:e2e:game`: `e2eOpen(storage)` is true when the key is absent, storage is null, or
  reading throws: the layout provides the open game. Without `VITE_E2E=1` it is false.
- `sfhousing:e2e:goal`: `e2eGoalAmount(storage)` is that amount (a whole number of 1 or more), else
  null. Paint and the simulation read it once for the goal's amount. The fixture city is too small
  for the real goal, so the journeys use amount 1.
- `sfhousing:e2e:run-ms`: `e2eRunMs(storage)` is the run's wall time, 100 to 20,000 ms, else null
  and the run takes `RUN_MS`. The journeys use a short run, 2,000 ms, or 8,000 ms where a player
  has to sweep.

The page marks its state for specs: `data-phase` on `tl-mode`, `data-dropped`, `data-collected`
and `data-state` on `run-layer`, and `data-run-view` on the map's root.

`e2e/helpers/game.ts` (before the page loads): `seedGame(page, state?)` stores a version 2 game
over `NEW_GAME` and switches the real game on (a phase `'runs'` state gets a `firstWinAt`);
`newVisitor(page)` switches it on with nothing stored; `seedGoalAmount(page, amount)`;
`seedRunMs(page, ms)`. Each page takes one of `seedGame` or `newVisitor`.

`e2e/helpers/sharing.ts`: `gotoEditor(page)` calls `newVisitor` the first time it is called for a
page and goes to `/`; a spec that seeds its own game and wants `/` calls `gotoHydrated(page, '/')`.

`e2e/helpers/play.ts` plays the game; every wait is a state in the page or in storage:

| Helper                               | Does                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `seedRuns(page, state?)`             | Amount 1, a 2,000 ms run and a seeded game (default: one run settled)                                              |
| `savedGame(page)`                    | The current game as storage holds it                                                                               |
| `waitSaved(page, ok)`                | Polls `savedGame` every 50 ms until `ok` holds                                                                     |
| `waitPhase(page, p)`                 | Waits for `tl-mode`'s `data-phase`                                                                                 |
| `untilPhase(page, 'run' or 'tally')` | `waitPhase`, bounded by the test's timeout, for a phase after Start, Run or a run's end                            |
| `runTotals(page)`                    | The run layer's dropped and collected                                                                              |
| `tabTo(page, target)`                | Tab, at most 80 presses, until `target` has focus                                                                  |
| `sweepRing(page)`                    | Shift and arrow keys in a spiral out from the centre until a drop is collected or the run ends; at most 3,000 keys |
| `buyNode(page, id, by)`              | Opens a node and presses Buy by pointer or keys; waits for the save                                                |
| `firstReady(page)`                   | The `data-node` of the first ready node                                                                            |
| `openGamePanel(page)`                | Opens the game panel from the unit count (the Menu first below lg)                                                 |
| `playToEnding(page)`                 | Seeds every rung but the last met and stop-rail's price, buys stop-rail, runs once; returns its label              |
| `RUNGS`                              | `LADDER_YEARS.length + 1`                                                                                          |

`e2e/helpers/header-text.ts` has `widestGameHeader(page)`, which writes the widest unit count and
goal line into the header for the width checks.

`e2e/game-journey.spec.ts` has three journeys on fixture-0 at amount 1:

1. **A new visitor by pointer** paints to the room goal, starts, runs, tallies, buys, edits in the
   workshop, runs again, takes the next goal, and finds one saved game on the server.
2. **By keyboard only** (desktop project): the same loop with the ring and `Tab` and `Enter`.
3. **The ending**: every rung but the last met and stop-rail's price in hand, stop-rail bought
   before the run; the tree then shows "Every goal met", the month reached and the month asked by,
   lists that node's label, and its Publish opens the publish dialog.

`e2e/game-a11y.spec.ts` runs the accessibility checklist on each state; the bench is
`e2e/bench/game-run.bench.ts` ([map-perf.md](map-perf.md)).

## The reach check

```
npx tsx scripts/reach-check.ts <datasetDir> [--amount <homes>]
npx tsx scripts/reach-check.ts --version <datasetVersion> [--from <origin>] [--amount <homes>]
```

Two sources: a built dataset directory, or a published version fetched from an origin (`--from`,
default production). Two questions, each reached or missed, at one amount (82,069 homes unless
`--amount` gives another) on the engine of `scripts/reach-measure.ts`:

1. Does current law (the empty policy document) reach the goal by rung 0's deadline?
2. Does the full tree (`fullTree`) reach it by the last rung's deadline?

Four lines on stdout:

```
Dataset <datasetVersion>
Goal: <amount> homes
Current law by <Mon YYYY>: reached <Mon YYYY>, <n> months early
Full tree by <Mon YYYY>: missed, <homes> homes, <short> short
```

Lines 3 and 4 each read "reached <month>, <n> months early" ("1 month early" for 1) or "missed,
<homes> homes, <short> short". The first month on a line is the rung's deadline.

Exit 0 when both are reached; 1 when either is missed; 2 when the check could not run, with one
stderr line, `reach-check: <reason>`, and nothing on stdout (no source, both a directory and
`--version`, an unknown flag, `--from` without `--version`, an `--amount` that is not a whole
number above 0, or the engine failing).

It is run before every dataset upload, on the directory that is then uploaded, and must exit 0
([pipeline.md](pipeline.md)). Its test is `scripts/reach-check.spec.ts`.

## Words

`src/lib/game/words.ts` holds the store's and the sync's words: `syncText`, `playedText(savedAt,
now)` ("Today", "Yesterday", "4 Mar", "4 Mar 2025"), `defaultSaveName`, `FULL_TEXT` and
`STORAGE_TEXT`. `ui/words.ts` holds the screens' words, `run/words.ts` the run layer's, and
`src/lib/timeline/game-copy.ts` the simulation page's (the labels of a purchase and a restore, the
locked lane and "Back to the tree"). A page that shows a full list, a refused write or the sync's
state imports these; none writes its own wording.
