# The game

## The game

The game is one map. Paint rooms for homes until the goal is met; after Start the page is the
simulation tool for the rest of the game: the map with its tilted camera and buildings, the
timeline, Play and Pause, held to the policies the rounds offer so far. Twelve real policies come
three a round over four rounds (`catalogue/rounds.ts`); round 0 is current law. The saved state is
version 3: the round, the month to beat, the policies the player can edit and the wins. The rules
and saved games live in `src/lib/game/`:

| File                                 | Holds                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `state.ts`                           | `GameState`, `Win`, `NEW_GAME`                                                             |
| `upgrade.ts`                         | `upgradeV2`, `V2_LADDER_YEARS`, `V2_KEYS`: a version 2 game read as version 3              |
| `save-shape.ts`                      | `GameSave`, `SaveEntry`, `parseGameSave`, `parseGameState`                                 |
| `rounds.ts`                          | `judge`, `Verdict`, `monthsBetween`, `spanText`, `fitState`, `takeWin`                     |
| `offer.ts`                           | `addEntry`, `offerThrough`, `catalogueDoc`, `onKeys`                                       |
| `limits.ts`                          | `Limits`, `limitsOf`, `within`, `runnable`, `isGiven`, `isFixed`, `whatFixed`, `canRemove` |
| `words.ts`                           | The store's and the sync's words                                                           |
| `catalogue/rounds.ts`                | The twelve policies (`CATALOGUE`, `POLICY_KEYS`, `ROUNDS`, `keyOf`)                        |
| `ui/`                                | The screens and header parts                                                               |
| `store.svelte.ts`, `saves.ts`        | The store, `MAX_SAVES`, storage keys                                                       |
| `save-sync.svelte.ts`, `save-api.ts` | The browser's sync with an account                                                         |
| `e2e.ts`                             | The e2e seam's readers                                                                     |

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
key, project cards and the tooltip, held to what the game offers ([Limits](#limits)). When the
document loads in a game, `SimPage`'s `load` adds every catalogue policy of rounds 1 to the
current round, and every editable key, that the document lacks, off (`offerThrough`), as the
store's reset (no undo step).

The header has no steps; the site name is the way home. In the opening it shows the name, the save
state, the pinned room score, Publish and the Menu button. After it: the name, the save state (or
"Updating"), the pinned goal (`GoalHeadline`: pending, win or late) and the actions: Undo and Redo while a pointer is
coarse, Publish and the Menu button. The Menu holds the saved games (`GamePanel`), the account entry
and About. In the open game the Menu has no game part. Below sm the pinned item leads the bar
and grows to the Menu button, the status cell between them.

In a game the goal is `defaultGoal(asOf)` with the target as its deadline (the legal deadline,
`defaultGoal(asOf).deadline`, while there is none) and the e2e amount when one is set.

## The game's state

`GameState` (`state.ts`), version 3:

| Field        | Holds                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------- |
| `phase`      | `'opening'` or `'runs'`                                                                     |
| `firstWinAt` | ISO time of the first room goal met, or null                                                |
| `round`      | Rounds offered so far, 0 (current law) to `ROUNDS` (4)                                      |
| `target`     | The first day of the month to beat, or null (none yet: the legal deadline stands)           |
| `editable`   | Catalogue keys the player can edit, sorted                                                  |
| `wins`       | `Win[]`: `round`, `goalMonth`, `beat` (the target it beat, or null), `at`, `datasetVersion` |
| `finished`   | The last round was won: every policy but painted zoning                                     |
| `own`        | Upgraded from version 2 with a run played: transit rules outside the catalogue run          |

`NEW_GAME` is the frozen new game: phase `'opening'`, round 0, no target, nothing editable, no
wins, not finished, not own. Nothing is reset in place: a new game is a new save made from
`NEW_GAME` (`structuredClone`).

`firstWinAt` is set once, by `game.won()`, at the first room goal met. That is also when the
account is made: the sync mints an anonymous account at the first win ([auth.md](auth.md)). A
refused write leaves `firstWinAt` null, so the next win tries again.

`takeWin(state, { goalMonth, on, datasetVersion, at })` (`rounds.ts`) is what a win does: the
target becomes `goalMonth` (kept when null), a `Win` is added with the old target as `beat`, every
key in `on` that is offered becomes editable, and the round goes up by one; a win in the last round
sets `finished` with every key editable; a win once finished changes only the target and the wins.
`fitState(state)` fits a state to this build: unknown and duplicate editable keys dropped (sorted),
the round held to `ROUNDS`; it returns the same object when nothing changes.

## Version 2 games

A game the points build saved (units, the tree's purchases, the ladder of deadlines, side goals and
the last run) is upgraded wherever it is parsed, in the browser and by `PUT /api/game`, and never
moved aside or deleted. `upgradeV2` (`upgrade.ts`) reads it leniently: only `phase`, `firstWinAt`,
`bought`, `rung`, `met` and `runs` are checked; anything else (units, side goals, the last run, a
field no build knew) is ignored.

- An opening is `NEW_GAME` with its `firstWinAt`.
- No run played: round 0 and nothing else.
- Otherwise: round `min(rung + 1, 4)`; the target is the first day of December of
  `V2_LADDER_YEARS[top - 1]` (2060, 2055, 2045, 2040) for the highest rung met above 0, else null;
  `editable` the bought node ids among the nine permitting and money keys (the version 2 node ids
  are the catalogue keys); one `Win` per met rung (`goalMonth` the first day of its `reachedOn`
  month, `beat` that rung's month, null for rung 0); `finished` when rung 4 was met (round 4 then);
  `own` true.

`own` keeps a version 2 game's own transit rule (`game-transit`) running at whatever reach and
height it holds, even above today's maxima. Its plan and policy text pass through unchanged.

## Limits

`limitsOf(state)` (`limits.ts`) is what the game offers:

| Field      | Holds                                                               |
| ---------- | ------------------------------------------------------------------- |
| `open`     | False: a game                                                       |
| `whole`    | `finished`: every lever but painted zoning                          |
| `own`      | The state's `own`                                                   |
| `offered`  | The keys of rounds 1 to `round`, plus `editable`                    |
| `editable` | `editable` (only known keys); every key when whole                  |
| `stops`    | The offered transit entries' stop types; every stop type when whole |
| `money`    | Any money entry offered: the free measures run and "+" offers them  |

`OPEN_LIMITS` is open, whole and own with every key offered and editable, every stop type and
money: the open game and a page with no game.

`within(kind, policy, limits)` says whether one policy runs: everything when open; the selector
must fit the kind; a catalogue policy (`keyOf`) runs when its key is offered, whatever its values;
otherwise painted zoning never runs in a game, a protection runs once a stop type is offered, a
transit rule outside the catalogue runs when whole or own, other timings when whole, and money
outside the catalogue when whole, or when it is a `FREE_MEASURES` preset (`state-off`,
`federal-credits-off`, `isGiven`) and money is offered. `runnable(doc, limits)` keeps the policies
that do, and returns `doc` itself when none goes. The workshop shows the whole document, and the
worker runs and Publish sends the runnable one.

`isFixed(policy, limits)`: a catalogue policy the player cannot edit yet (not open, not whole, its
key not editable); only its switch, order and When work, and its What is the summary.
`whatFixed(policy, limits)` is what the Inspector reads: `isFixed`, or, in a game before the end, a
given measure outside the catalogue (the free measures, which run at any values). `canRemove(policy,
limits)`: no game, a finished game, or a policy outside the catalogue.

## The screens and header parts

All in `src/lib/game/ui/`; none renders for the open game.

- **`OpeningCard`** (`opening-card`, `opening-start`): the room goal met; Start has focus.
- **`GoalHeadline`** (`goal-headline` with `data-state`, `goal-box`, `goal-headline-button`,
  `goal-line1`, `goal-phone`, `goal-bar`, `goal-line2`, `goal-gift`, `goal-live`): the pinned goal,
  the round's result state (P19). Props `{ state, words, fill, ongift?, panel? }`: `state` is
  `'pending'`, `'win'` or `'late'`; `words` from `pinnedWords(verdict, ctx)` (`ui/round-words.ts`),
  drawn from sm as line 1, the bar (`fill`, 0 to 1: the homes at the playhead's month over the
  amount) and line 2. Below sm it is one line, `goal-phone` (count, " homes" in pending, a space,
  the rest), from the bar's left up to the Menu with the bar under it; the line is an inline-size
  container: at 17rem or less "homes" hides, at 13rem or less the short count ("82k") replaces the
  full one, and the rest ("by Mar 2058 · 2 yr 3 mo early") always shows. A win reads "early" in
  words and adds an accent border; with `ongift` it carries the gift, a 24 px button named by
  `words.gift` that jiggles once every `JIGGLE_MS` (4 s; a `JIGGLE_TURN_MS` 600 ms turn,
  `ui/motion.ts`) and is still under reduced motion. Win and late arriving after mount put
  `words.live` in the polite `goal-live` region; the state at mount says nothing. With `panel` the
  lines are a button (`aria-expanded`, `aria-controls`) that opens it under the goal; without, they
  are plain text and no control. The status cell is never inside it. `TimelineMode` gives it the
  shown verdict ([timeline-ui.md](timeline-ui.md), "In a game"): a policy change resets the
  timeline and clears a held win or late; the round panel and taking the win come with the page.
- **`GamePanel`** (`game-panel`, `game-stage`, `game-sync`, `save-row`, `game-error`): rendered in
  place inside the header Menu's panel (`SiteHeader`, after mount, never for the open game; its root
  carries `data-header-keep-open`, so a press on its buttons leaves the Menu open). The current
  game's name and stage (`entryStage(phase, round)`: "Painting" in the opening, else
  `roundName(round, false)`), the sync line and the saved games (switch, rename in place,
  delete after one question, "New game"). A change that loads another game calls `reloadGame()`
  (`ui/reload.ts`), a full page load of `/`. At `MAX_SAVES` "New game" is `aria-disabled`; a
  refused change shows `FULL_TEXT` or `STORAGE_TEXT`.

The words are in `ui/words.ts` and `ui/round-words.ts`.

## The store

`GameStore` (`store.svelte.ts`) holds every saved game in memory and writes through to storage.

Reactive getters: `state`, `limits` (`OPEN_LIMITS` for the open game, else `limitsOf(state)`),
`saves` (`SaveEntry[]`, latest first, ties by id), `currentId`. Plain: `open`, `sync`.

| Method             | Does                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| `won()`            | Sets `firstWinAt` once                                                       |
| `startRuns()`      | Sets `phase` `'runs'`; refused (`storage`) while `firstWinAt` is null        |
| `takeWin(w)`       | `takeWin` of `rounds.ts` at the store's clock, written                       |
| `touched()`        | The page's autosave wrote a record key: the save's records and time update   |
| `newGame()`        | A new game becomes current                                                   |
| `switchTo(id)`     | Another game becomes current                                                 |
| `rename(id, name)` | Trims, keeps 60 code points, ignores an empty name; a duplicate is allowed   |
| `remove(id)`       | Removes a game; removing the current one makes the latest other game current |
| `read(id)`         | A copy of the save; the current one with its record keys as they are         |
| `adopt(saves)`     | Takes saves from the account                                                 |
| `rekey(id, newId)` | Gives a save a new id                                                        |
| `beforeLeave(fn)`  | Registers `fn`; returns its remover                                          |

Every write is one sequence: it puts back the keys it wrote and keeps memory as it was when one
throws, and answers `{ ok: false, reason: 'storage' }`; `full` and `changed` are the other
refusals. Each accepted write calls `sync.changed(id)`, or `sync.removed(id)` for a removed game;
`newGame` calls `changed` for the game left and the game made, `switchTo` for the game left.
`rekey` and `adopt` call neither. In memory mode `won`, `startRuns`, `takeWin`, `touched` and
`rename` change memory and call the sync, writing nothing; `switchTo` of the current id answers `ok`;
the others answer `storage`. The open game's `takeWin` answers `ok` and changes nothing.

Every save the store reads, from storage or from the account, goes through `parseGameSave` (which
upgrades a version 2 state) and then `fitState` on its state.

`beforeLeave`: a page that autosaves a record key registers its autosave's `flush()` when it
mounts and removes it on unmount. `newGame`, `switchTo` of another game, `remove` of the current
game and `adopt` of saves holding the current id call every function in order, once their checks
pass and before they read or write a record key; one that throws is skipped. `adopt` of the
current id answers `changed` and writes nothing when a function moved the game's played time.
After one of these changes answers `ok`, `touched()` does nothing: the caller loads a page in full
next. Two tabs share one storage, each keeps its own memory, and the last write wins.

## Saved games and storage

`GameSave` (`save-shape.ts`) is the envelope, still version 2 (only the state inside moved to
version 3): `id`, `name`, `nameIsDefault`, `state`, `plan` and `policy` (the text of the two record
keys, or null) and `savedAt`. `parseGameSave` returns a new save of the known fields, or null;
`parseGameState` takes a version 3 state strictly (each field's type, `round` a whole number,
`target` null or a whole number, `editable` non-empty strings, each `Win` valid, and the phase
agreeing: an opening has round 0, no target, no wins, nothing editable and is not finished; the
runs have a `firstWinAt`) and a version 2 state through `upgradeV2`. `MAX_SAVES` is 12 and
`SAVE_NAME_MAX` is 60 code points. `defaultSaveName(from, taken)` (`words.ts`) names a game: "Game,
22 Nov", or "{name} (this device)" for a conflict; the first candidate not in `taken`, with " (2)",
" (3)" and so on, cut to 60 code points. `saves.ts`, `save-shape.ts`, `state.ts` and `upgrade.ts`
import values only by relative path, because `e2e/helpers/game.ts` loads them under Playwright.

| Key                                     | Holds                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| `sfhousing:saves:v1`                    | The index `{ v: 2, current, saves: SaveEntry[] }`, latest first     |
| `sfhousing:save:<id>`                   | One `GameSave` as JSON                                              |
| `sfhousing:save:corrupt:<ISO>`          | The raw text of a save or index that would not parse                |
| `sfhousing:sim:corrupt:<ISO>`           | The v1 policy text, copied aside when `sfhousing:sim:v2` was absent |
| `sfhousing:plan:v1`, `sfhousing:sim:v2` | The current game's records, as the pages write them                 |

A `SaveEntry` carries `phase` and `round`. An index the points build wrote has `rung` in its
entries: it is read as the round and the index is rewritten with `round`. A version 2 save stays as
it was stored until the game's next write, which stores it as version 3. Loading removes
`sfhousing:run:collect` and `sfhousing:run:muted`, the old run's switches, which nothing reads.

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

`openGame()` is a store in memory mode with one game "Game": phase `'runs'`, `firstWinAt`
`1970-01-01T00:00:00.000Z`, the last round, finished, every key editable and `own` (a state that
passes its own parser), `limits` equal to `OPEN_LIMITS`, `open` true and a sync that does nothing
(`state` `'local'`, no account). It is the whole tool: `SimRoute` hands the page no game for it, so
there is no goal headline and nothing is locked. `open` is true only for this store and never
changes; pages read `open`. Its writes do nothing.

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
phase, the round, the saved games, a game-only control) keeps its own `mounted` flag, set in
`onMount`, and renders no game part until then. `+page.svelte` renders its empty frame until
mount; `SiteHeader` renders `GamePanel` only after mount. Scripts, effects and `onMount` may read
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

`e2e/helpers/game.ts` (before the page loads): `seedGame(page, state?)` stores a game over
`NEW_GAME` and switches the real game on (a phase `'runs'` state gets a `firstWinAt`);
`seedV2Game(page, v2, policy?)` stores a raw version 2 save as the points build wrote it (its index
entry with `rung`), with `policy` as its policy record when given, for the upgrade journey;
`newVisitor(page)` switches it on with nothing stored; `seedGoalAmount(page, amount)`. Each page
takes one of `seedGame`, `seedV2Game` or `newVisitor`.

`e2e/helpers/sharing.ts`: `gotoEditor(page)` calls `newVisitor` the first time it is called for a
page and goes to `/`; a spec that seeds its own game and wants `/` calls `gotoHydrated(page, '/')`.

`e2e/helpers/play.ts` plays the game; every wait is a state in the page or in storage:

| Helper                   | Does                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `seedRuns(page, state?)` | Amount 1 and a seeded game (default: in the runs, round 1) |
| `savedGame(page)`        | The current game as storage holds it                       |
| `waitSaved(page, ok)`    | Polls `savedGame` every 50 ms until `ok` holds             |
| `waitSim(page)`          | Waits for the simulation tool: `tl-dock` visible           |
| `tabTo(page, target)`    | Tab, at most 80 presses, until `target` has focus          |
| `openGamePanel(page)`    | Opens the header Menu, which holds the game panel          |

`e2e/helpers/header-text.ts` has `widestGameHeader(page)`, which writes the pinned goal's widest
words (`WIDEST_PINNED`) into its two lines for the width checks.

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
`STORAGE_TEXT`. `ui/words.ts` and `ui/round-words.ts` hold the screens' words, and
`src/lib/timeline/copy.ts` the simulation page's (`NOT_IN_GAME`, under a policy that does not run
in the game). A page that shows a full list, a refused write or the sync's state imports these;
none writes its own wording.
