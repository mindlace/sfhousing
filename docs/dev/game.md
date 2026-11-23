# The game

The incremental game's rules and saved games live in `src/lib/game/`: levels and results
(`levels.ts`), progress and banking (`progress.ts`), saved games and their default names
(`saves.ts`), the store (`store.svelte.ts`), what each level allows and the playable document
(`allowed.ts`), the player's standing (`standing.ts`), the game's words (`copy.ts`), page loads
(`navigate.ts`), the win card (`WinCard.svelte`) and the level panel (`LevelPanel.svelte`). Syncing
saved games to an account is [game-save.md](game-save.md). For the current game the plan and policy
records under `sfhousing:plan:v1` and `sfhousing:sim:v2` are the truth.

## The ladder

`Level` is 1 to 5; `LAST_LEVEL` is 5 (`levels.ts`).

- `allowedAt(level)` is what a level runs: `kinds` (the policy kinds that run and can be edited)
  and `money` (`'given'` or `'all'`). Levels 1 and 2 run no kind; 3 permitting; 4 permitting and
  zoning; 5 all three, money `'given'`. `ALL_ALLOWED` runs every kind with money `'all'`.
- `unlocksAt(kind)` is the level that opens a kind: permitting 3, zoning 4, money 5.
- `unlockText(next)` is what a level up unlocks, in words: 1 Paint, 2 The simulation, 3
  Permitting, 4 Zoning, 5 Public money, 6 The end of the round.
- `simLocked(p)` is true at level 1. `lockedLane(kind, level)` words a locked kind.
- No component compares a level to a number. It calls one of these.

## Results and bars

- `beats(seen, bar)` compares calendar months (UTC year, then month). The day does not matter. A tie
  never beats, and a missed result never beats.
- `paintWon(net, amount)` is `net >= amount`.
- A bar is the day of a banked result (`barOf` in `progress.ts`: `banked[level - 1].on` at levels 3
  to 5, null below and when the entry is missing). `Banked` stores the `datasetVersion` it was
  earned on, so a bar does not move after a data update.
- `levelUp(p, banked)` (pure) returns a new `Progress`, or `p` when nothing changes. Level 1 goes
  to 2 with nothing banked. Levels 2 to 4 bank the result under the level left and add one. Level 5
  banks under 5 and stays; then `roundComplete(p)` is true and the function returns `p`. A null
  `banked` changes nothing above level 1.
- `standing(level, bar, seen)` is `playing`, `short` or `won`. Level 1 and a null `seen` are
  `playing`. Level 2 wins on any reached result; levels 3 to 5 win when `beats(seen, bar)`, or
  on any reached result when the bar is null. It does not know the round is complete: after level
  5 is banked a result that beats `banked[4]` is still `won`.

## The playable document and `levelNeeded`

- `isGiven(p)` is true for a money policy made from a funding preset: `preset` is a string and
  `where.tag` is `fund`, `baseline` or `terms`. A permitting policy with a timing preset's id is
  not given.
- `runs(kind, p, a)` is `a.kinds.has(kind)` and, for money, `a.money === 'all'` or `isGiven(p)`.
  It does not read `on` or `spans`.
- `playable(doc, a)` keeps the policies that run, in order. It returns `doc` itself when nothing
  goes; otherwise a new document whose unchanged kinds keep their arrays.
- `levelNeeded(doc)` is the lowest level at which `playable` removes nothing: 2 for no policy, 3
  for permitting, 4 for zoning, 5 for given money, 6 for any money policy that is not given.
- `needsHigher(doc, p)` is `levelNeeded(doc)` when it is above `p.level`, else null.

## Saved games

`GameSave` holds `id`, `name`, `nameIsDefault`, `progress`, the text of the plan and policy records
(`plan`, `policy`, or null) and `savedAt`. `parseGameSave` returns a new save of the known fields,
or null. `saves.ts` imports only by relative path, because `e2e/helpers/game.ts` loads it under
Playwright. `MAX_SAVES` is 12 and `SAVE_NAME_MAX` is 60 code points. `defaultSaveName(from, taken)`
names a game: "Game, 22 Nov" for a new one, "Remix of {title}" (or "Remix") for a remix,
"{name} (this device)" for a conflict; the first candidate not in `taken`, with " (2)", " (3)" and
so on, cut to fit 60 code points.

## Storage layout

| Key                                     | Holds                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| `sfhousing:saves:v1`                    | The index: `{ v: 1, current, saves: SaveEntry[] }`, latest first    |
| `sfhousing:save:<id>`                   | One `GameSave` as JSON                                              |
| `sfhousing:save:corrupt:<ISO>`          | The raw text of a save or index that would not parse                |
| `sfhousing:sim:corrupt:<ISO>`           | The v1 policy text, copied aside when `sfhousing:sim:v2` was absent |
| `sfhousing:plan:v1`, `sfhousing:sim:v2` | The current game's records, as the plan and `/sim` pages write them |

A corrupt key that is taken uses the next millisecond, until free. Each index entry repeats its
save's `id`, `name`, `nameIsDefault`, `savedAt` and level. Where they differ, the save wins and the
index is rewritten.

A game's played time is the latest of its save's `savedAt` and, for the current game, the
`savedAt` of each record that parses with a finite one.

## Construction

`new GameStore({ storage, sync, now? })` reads storage once, keeps every saved game in memory, and
writes through after that. It reads the two record keys whenever it copies out or reports the
current game.

1. `storage` null, or any read throwing during construction: memory mode. One game at `NEW_GAME`,
   new id, default new name, null plan and policy. Keys that construction already set or removed
   are put back first, so storage holds what it held. Nothing is written afterwards; a later load
   tries again.
2. No index: the first game, from the two record keys (null where absent), level 1. The save is
   written, then the index. The record keys and `sfhousing:sim:v1` are not touched.
3. First game's writes refused: memory mode with that game.
4. Invalid index: the raw index goes to a corrupt key and the store rebuilds from every
   `sfhousing:save:` key that is not a corrupt key. A save is taken only when it parses and its
   `id` equals its key's suffix; every other value is moved aside as in 5. Then a new game from the
   records (step 2, found names taken) becomes current. The list may exceed `MAX_SAVES`.
5. Valid index: each entry's `saveKey(id)` is read. An absent save, one that will not parse, or one
   with another `id` is left out; its raw text goes to a corrupt key and its key is removed.
6. The current game left out, or `current` naming no entry: a new game from the records becomes
   current.
7. Anything left out, added or corrected: the index is rewritten.
8. A write in steps 4 to 7 refused: every key construction set or removed is put back, and the
   store is in memory mode with the games it read and made, the current one as chosen.

A level 1 game made from earlier records keeps them as its plan and policy. The offer is null
after construction.

## Changes

A change is one sequence of writes. The store remembers each key's old value. When a write
throws, it puts back the keys already written, keeps memory as it was, calls no sync method, and
answers `{ ok: false, reason: 'storage' }`. `full` is the other refusal.

"Copy out" writes the current game's save with `plan` and `policy` read from the record keys and
`savedAt` its played time. `remove` of the current game does not copy it out: its save is removed
in the same change.

| Change                            | Writes                                                                             | Sync                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `won()`, `firstWinAt` null        | Current save with the records copied in; the index                                 | `changed(current)`                                      |
| `won()`, `firstWinAt` set         | None                                                                               | None                                                    |
| `setOffer(offer)`                 | None                                                                               | None                                                    |
| `levelUp()` that changes progress | Current save with the records copied in; the index                                 | `changed(current)`                                      |
| `touched()`                       | Current save with the records copied in; the index                                 | `changed(current)`                                      |
| `newGame()`                       | Copy out; the new save; its records; the index                                     | `changed(old)`, `changed(new)`                          |
| `switchTo(other)`                 | Copy out; the other game's records; the index                                      | `changed(old)`                                          |
| `remix(doc)`                      | Copy out; the new save; its records; the index                                     | `changed(old)`, `changed(new)`                          |
| `rename` that changes the save    | That save (the current one with records); the index                                | `changed(id)`                                           |
| `rekey(id, newId)`                | Save under the new key; remove the old key; the index                              | None                                                    |
| `remove(other)`                   | Remove its save; the index                                                         | `removed(other)`                                        |
| `remove(current)`                 | Remove its save; the next game's records, or a new save and its records; the index | `removed(old)`, and `changed(new)` when a game was made |
| `adopt(saves)`                    | Each save; the current game's records when it is among them; the index             | None                                                    |

- Every change that is not `ok` leaves memory and storage as they were.
- `newGame` and `remix` answer `full` at `MAX_SAVES` games; `adopt` when it would take the list past.
- `newGame`, `switchTo` of another id, `remix`, `rekey`, `remove` and `adopt` answer `storage` in
  memory mode. `won`, `setOffer`, `levelUp`, `touched` and `rename` change memory and call the sync
  there, and write nothing. `switchTo` of the current id is `ok` and changes nothing; of an id not
  in the list it answers `storage`. `remove` of an unknown id is `ok`.
- `remove` of the current game makes current the other game with the latest `savedAt`, or a new
  game when it was the last.
- `rename` trims, keeps the first 60 code points, and ignores an empty result. A duplicate name is
  allowed. The same name does nothing when `nameIsDefault` is already false. `switchTo` leaves the other game's `savedAt` as it was.
- `remix` copies the current progress; its `doc.record` goes byte for byte to the plan or the
  policy, and the other half is the current game's record. The store never parses it.
- `rekey` keeps everything but the id. It answers `storage` for an unknown id, a taken new id, the
  same id or an invalid one. The save sync is its caller.
- `adopt` skips saves `parseGameSave` refuses. Adopting the current id replaces its progress and
  writes its records; the current id stays.
- `saves` is reactive and holds one entry per game, latest first, ties by id. The current game's
  entry carries its played time as `savedAt`; the stored index keeps each save's own. `read(id)` of
  the current game returns the record keys' text now (the stored copy when a read throws) and its
  played time; of another game, a copy as stored.

### The offer

`setOffer({ on, datasetVersion })` holds the win "Level up" would bank, in memory only. It is
cleared by `levelUp()`, `setOffer(null)`, and by a new, switched-to, remixed or removed current
game and an adopted current id, each when `ok`.

`levelUp()` builds `banked` (null when `offer.on` is null, else `{ on, datasetVersion, at }`) and
calls the pure `levelUp`. The offer is cleared when the write is accepted, or when progress did not
change (then nothing is written and no sync method is called). A refused write keeps the offer.

| Level                 | offer              | Afterwards                                           |
| --------------------- | ------------------ | ---------------------------------------------------- |
| Any                   | null               | Nothing changes                                      |
| 1                     | `on` null or a day | Level 2, nothing banked, offer null                  |
| 2, 3 or 4             | `on` a day         | `banked[level]` holds it; level plus one; offer null |
| 2, 3 or 4             | `on` null          | Progress unchanged; offer null                       |
| 5, round not complete | `on` a day         | `banked[5]` holds it; round complete; offer null     |
| 5, round complete     | Anything           | Progress unchanged; offer null                       |

## The `sfhousing:sim:v1` rule

Whenever a change writes the two record keys (a game that becomes current through `newGame`,
`switchTo`, `remix` or `remove` of the current game, and `adopt` of the current id) and
`sfhousing:sim:v1` holds a value, the same change removes it. When `sfhousing:sim:v2` was absent
before the change, the v1 text is first copied to `sfhousing:sim:corrupt:<ISO>`. Without this,
`/sim` would carry the old schema 3 policy into every new game.

## Memory mode and the open game

Memory mode is a store with `storage` null or one that gave up (construction steps 1, 3 and 8).
It keeps its games and writes nothing.

`openGame()` is a store in memory mode with one game "Game" at level 5, nothing banked,
`allowed` equal to `ALL_ALLOWED`, `open` true and a do-nothing sync (`state` `'local'`, no
account). `open` is true only for it, and never changes. No page shows a game part while `open` is
true; pages read `open`, none compares `allowed` with `ALL_ALLOWED`. Its `levelUp()` with an offer
completes the round. The public constructor always gives a level from storage or `NEW_GAME`.

`provideGame(store)` sets the store in context; `useGame()` returns it, or a new `openGame()`
outside a provider.

Two tabs share one storage. Each keeps its own memory, and the last write wins.

## The root layout and mounting

`src/routes/+layout.svelte`'s script makes the store in `makeGame()` and calls
`provideGame(makeGame())` once, at init. On the server it provides `openGame()`. In the browser it
builds the real store before any page script runs: `getStorage()`, `e2eOpen(storage)` (then
`openGame()`), else `createSaveSync`, `new GameStore({ storage, sync })` and `sync.attach(store)`.
The layout is never remounted by a client navigation, so each is called once per document.

Until mounted: the server's store is the open game and the browser's may be at any level, so
the first client render must match the server's. A component whose markup depends on the game (the
level, the bar, an offer, the saved games, a lock, a game-only control, the win card) keeps its own
`mounted` flag, set in `onMount`, and renders no game part until then. Scripts, effects and
`onMount` may read the store at any time. `WinCard` and `LevelPanel` are mounted only by
components that follow this, so they keep no flag.

## The win card

`WinCard` is a non-modal dialog (`role="dialog"`, `aria-modal="false"`, `data-testid="win-card"`).
The page that mounts it places it. Props:

- `title`: the heading, "Room for 82,069 homes" or "Goal reached in Mar 2049".
- `unlocks`: what a level up unlocks, in words (`unlockText`), shown as "Unlocks: …"; null shows
  "Round complete" and no "Level up" button.
- `onlevelup`, `onkeep`: the buttons' callbacks. The card calls nothing on the store; the page
  passes `() => game.levelUp()`.

On mount focus goes to "Level up", or to "Keep playing" when there is none. Escape inside the card
calls `onkeep`, prevents the default and stops the event. `AccountOffer` sits under the buttons.
With `game.open` the card renders nothing.

## The level panel

`LevelPanel` has no props. It is the content of the header's level cell, and renders nothing when
`game.open`. It shows the level (`levelText`), the aim (`aimText`), the next line (`nextText`),
"Level up" while `game.offer` is set and the round is not complete, the sync line (`syncText`; a
sign-in link when the state is `sign-in`), the saved games in `game.saves` order and "New game".
A row switches (name), renames in place (Enter or blur commits, Escape cancels) or asks once to
delete. Switching, a new game and deleting the current game load the new current game's page with
`loadPage(gamePath(level))`. At `MAX_SAVES` games "New game" is `aria-disabled` and the full line
shows. A refused change shows `FULL_TEXT` or `STORAGE_TEXT` in an alert that is mounted empty and
cleared at the start of the next action. While a rename field is open, a press on another control
keeps focus in the field, and the action commits the rename first.

## Words and navigation

`copy.ts` holds every word the game shows: `levelText`, `aimText`, `nextText`, `barText` ("Beat
Jun 2057"), `unlockText`, `lockedLane`, `syncText`, `playedText(savedAt, now)` ("Today",
"Yesterday", "4 Mar", "4 Mar 2025"), `FULL_TEXT` and `STORAGE_TEXT`. A page that shows a full list,
a refused write or the sync's state imports these; none writes its own wording.

`navigate.ts`: `gamePath(level)` is `'/'` at level 1 and `'/sim'` above it; `remixPath(kind)` is
`'/'` for a plan and `'/sim'` for a policy; `loadPage(path)` is `window.location.assign(path)`, a
full load even when the path is on screen, so the page reads the new records.

## The e2e seam

On a `VITE_E2E=1` build, `e2eOpen` is true when the `sfhousing:e2e:game` key is absent, storage is
null, or reading the key throws: the layout provides the open game (every control, no game parts, nothing stored). Without `VITE_E2E=1`,
`e2eOpen` is false and `e2eGoalAmount` null whatever storage holds. Helpers in
`e2e/helpers/game.ts`, called before the page loads:

- `seedGame(page, level)` sets the key and stores a game at that level whose bars (`SEED_BAR_DAY`,
  the first day of the month holding the window's last day) any reached result beats. It writes
  its save and index directly, only when `sfhousing:saves:v1` is absent, and needs no store.
- `newVisitor(page)` sets the key with nothing stored: the real store makes the first game.
- `seedGoalAmount(page, amount)` sets `sfhousing:e2e:goal`. `e2eGoalAmount(storage)` returns that
  amount (a whole number of at least 1) for pages to read when they build the goal. The fixture city is too small for the real goal, so a spec that plays a level to a
  win calls it first. Changing the amount on a loaded page, before a client navigation, is a
  `page.evaluate` write of the key.
