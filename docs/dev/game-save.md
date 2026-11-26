# Game save

Saved games leave the browser for the player's account through `/api/game` (types in
`src/lib/game/save-api.ts`), stored in the `game_save` table, one row per saved game with a rev
that every write checks. The browser side is the save sync (`src/lib/game/save-sync.svelte.ts`),
which the root layout makes once and the store calls after each change, and which keeps both
versions when two devices changed the same game. The account offer on the opening card is
`src/lib/game/AccountOffer.svelte`.

The saved game itself (`GameSave`, `parseGameSave`) belongs to `src/lib/game/save-shape.ts`, the
keys and the cap (`SAVES_KEY`, `saveKey(id)`, `MAX_SAVES` of 12) to `saves.ts`, `defaultSaveName` to
`words.ts` and the store (`GameStore`) to `store.svelte.ts`. This page covers what leaves the
browser.

## The table

`game_save` (`src/lib/server/db/schema/gameSave.ts`), primary key `(identity_id, id)`:

| Column        | Holds                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| `identity_id` | A survivor identity id: `locals.user.id`, or the user the mint returned |
| `id`          | The saved game's id (`newId()` of `$lib/ids/base58`)                    |
| `rev`         | 1 on the first store, one more on every stored change                   |
| `name`        | A copy of `save.name`                                                   |
| `phase`       | A copy of `save.state.phase`                                            |
| `rung`        | A copy of `save.state.rung`                                             |
| `body`        | The `GameSave` as JSON; `''` once removed                               |
| `saved_at`    | The save's own `savedAt`                                                |
| `removed_at`  | Set when removed; null while live                                       |

- Two generated migrations define `phase` and `rung`.
- A removal clears `body`, sets `removed_at` and keeps the rev. The row stays so other devices
  learn of the removal; removed rows are deleted only with their account.
- The server never reads inside `plan` or `policy`.

## The server module

`src/lib/server/game/store.ts` holds every query on the table. The routes and the two hooks (join,
deletion) call it; nothing else touches `game_save`. It parses a stored body only to answer it back
(`readGame`, a conflict) and rewrites only the body's top-level `id` (`moveGames`).

- `accountLine(db, user)`: `{ handle, handleClaimed }`. `handleClaimed` is true when a
  `handle_tombstone` row has `released_by` equal to the identity: the handle was changed at least
  once.
- `listGames(db, identityId, now)`: the live rows, newest `saved_at` first, as
  `{ id, name, nameIsDefault, savedAt, phase, rung, rev }` (`nameIsDefault` read with `json_extract`);
  `removed` is the ids removed within `REMOVED_LIST_DAYS` (90) of `now`.
- `readGame(db, identityId, id)`: `live` with rev and save, `removed`, or null.
- `putGame(db, identityId, save, baseRev)`:
  - An id the account never held is stored at rev 1, whatever `baseRev` says, while the account
    has fewer than 12 live rows; a 13th new id is `too_many`.
  - A live row whose rev equals `baseRev` is stored at rev + 1. Any other `baseRev`, `null`
    included, is `conflict` with the stored rev and save, and changes nothing.
  - A removed row is `removed`.
  - The guards sit in the write's `WHERE`, so a request that lost a race answers `conflict` with
    the row as it now is.
- `removeGame(db, identityId, id, now)`: a live row gets `body` `''` and `removed_at` `now`; a
  removed or unknown id is left as it is.
- `moveGames(db, survivorId, absorbedId)` and `deleteGamesOf(db, identityIds)`: below.

## The routes

`/api/game` is a session route prefix (`SESSION_ROUTE_PREFIXES`, see [auth.md](auth.md)).

### `GET /api/game`

1. No `locals.user`: 401, empty body.
2. 200 `{ handle, handleClaimed, saves, removed }`.

### `GET /api/game/[id]`

1. No `locals.user`: 401, empty body.
2. No row: 404. A removed row: 410. Both with an empty body.
3. 200 `{ rev, save }`.

### `PUT /api/game/[id]`

The body is `{ baseRev, save }`: `baseRev` is the rev this browser last saw, null when it has
never sent the save.

1. `refuseUnlessSameOriginJson`: 415 `{ error: AUTH_COPY.jsonRequired }` or 403
   `{ error: AUTH_COPY.crossOrigin }`.
2. A `content-length` over `MAX_SAVE_BYTES` (600,000): 413, empty body, before reading.
3. The body as text over `MAX_SAVE_BYTES` bytes of UTF-8: 413, empty body.
4. Not JSON, not an object, a `baseRev` that is neither null nor a positive integer, a `save`
   that `parseGameSave` refuses, or a `save.id` other than the path's id: 422
   `{ error: 'invalid' }`.
5. No `locals.user` and the `sfh_known` cookie: 401 `{ error: 'sign_in' }`.
6. No `locals.user` and `save.state.firstWinAt` null: 422 `{ error: 'no_win' }`.
7. No `locals.user`: `mintPseudonymousSession(event)` makes the anonymous account and sets its
   session cookie on this response. Refused at 429: 429, empty body; at 500: 500
   `{ error: message }`.
8. `enforceRate(MUTATION_REGISTERED_RL, 'game_write:<identityId>', env)`, not critical. Refused:
   429, empty body.
9. `putGame`. `stored`: 200 `{ handle, handleClaimed, rev }`. `conflict`: 409 `{ rev, save }`.
   `removed`: 410, empty body. `too_many`: 422 `{ error: 'too_many' }`.

A refusal at steps 1 to 6 makes no account and sets no cookie. A mint followed by a refusal at step
8 or 9 keeps the account and its cookie, and the browser's next send uses the session. This `PUT`
is the only caller of the mint: an account is made at the first win, never before.

### `DELETE /api/game/[id]`

1. `refuseUnlessSameOriginJson`: 415 or 403. The browser sends `content-type: application/json`
   and the body `{}`.
2. No `locals.user`: 401, empty body.
3. `MUTATION_REGISTERED_RL` as for `PUT`. Refused: 429, empty body.
4. `removeGame`, then 204. An unknown or already removed id is 204 too.

## A join of two accounts

`onLinkAccountFor` in `src/lib/server/auth/better-auth.ts` passes
`onFuse: (survivorId, absorbedId) => moveGames(db, survivorId, absorbedId)` to
`handleAccountLink`. An upgrade (a pseudonymous account adding a new email or Google account)
fuses nothing and moves nothing: the identity survives with its rows.

`moveGames` moves every row of the absorbed identity, live and removed, to the survivor in one
batch. Nothing is merged:

- An absorbed live row whose id the survivor also holds arrives under a fresh `newId()`, with its
  body's top-level `id` set to it; its name, rev and the rest of the body are kept.
- An absorbed removed row whose id the survivor also holds is dropped.
- The cap of 12 is not applied. Above 12, the account's existing ids still save, and a `PUT` of a
  new id answers `too_many` until it is below 12.

## Account deletion

`closeAccountRows` (`src/lib/server/user-store/deletion.ts`) calls `deleteGamesOf(db, idUnion)`
after hashing earlier versions and before purging credentials. It deletes every `game_save` row,
live and removed, of the survivor and of every identity fused into it. Published plans and policies
stay: the `plan` table has no owner.

## The browser's sync

The root layout (`game-core`) calls `createSaveSync({ storage, fetchFn, signedIn })` once, gives the
result to `new GameStore`, and calls `sync.attach(store)`; `signedIn` is whether the layout's
`user` is set. Components reach the sync as `useGame().sync`. Under the open game (`e2eOpen`) there
is no sync. On the server (`typeof window === 'undefined'`) `createSaveSync` returns a sync that
does nothing: state `local`, no listeners, no requests.

### The record

`SAVE_REVS_KEY` (`sfhousing:saves:revs`) holds the `SyncRecord`, what this browser last agreed
with the account:

- `seen[id]`: the rev and the `savedAt` of the version last sent or adopted. A save is _unchanged
  here_ when its `savedAt` equals `seen[id].savedAt`.
- `deleting`: ids deleted here whose `DELETE` has not been answered with 204.

A value that does not parse is replaced by an empty record. With `storage: null` the record lives
in memory.

### Session

The browser _has a session_ while `signedIn()` is true, and from the moment a `PUT` answers 200
until `signedIn()` next turns from true to false. `signedIn()` is read in an `$effect` under
`$effect.root`: turning true (a sign-in) clears `sign-in` and pulls; turning false (a sign-out)
ends the session.

### Attach

- `changed` and `removed` calls made before `attach` are kept and acted on at attach.
- With no session, every saved game with `state.firstWinAt` set and no `seen` entry, or a
  `savedAt` other than `seen`'s, is marked waiting: a first win whose send never went still makes
  the account.
- With `signedIn()` true, it pulls.
- It pulls when the page becomes visible while it has a session, and sends every waiting save on
  the window's `online` event.

### Sending

- `changed(id)` marks the save waiting and starts a 2-second timer for it, replacing any running
  one. The store calls it after every change, and after each autosave write through `touched()`.
- With no session, `changed(id)` of a save whose `firstWinAt` is null marks nothing, and at most
  one `PUT` is in flight (two could make two accounts).
- When the timer fires, the save is read with `store.read(id)` and sent:
  `PUT /api/game/<id>` with `{ baseRev: seen[id]?.rev ?? null, save }`. A save the store no longer
  has is dropped.
- One request per saved game is in flight at a time; a `changed` during it starts the timer again
  when it ends. No send starts while a pull runs: saves that became due go when it ends.

Answers:

| Answer                                  | What the sync does                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 200                                     | `seen[id]` takes the rev and the sent `savedAt`; `account` takes the line                                    |
| 200 with no session                     | The `PUT` made the account: the browser has a session, and every other saved game is marked waiting and sent |
| 409                                     | Keep both (below)                                                                                            |
| 410                                     | Removed elsewhere (below)                                                                                    |
| 401                                     | State `sign-in`, no session; nothing is sent until `signedIn()` turns true                                   |
| 422 `too_many`                          | State `full`; the save stays waiting                                                                         |
| 422 `no_win`                            | The save stays unsent until its next `changed`                                                               |
| 413, 422 `invalid`, 403, 415, any other | Dropped from the waiting set; `console.error` names the id and the status: a defect, never a player's act    |
| Network failure, 5xx, 429               | State `offline`; the save stays waiting                                                                      |

Retry is driven by events (`changed`, `removed`, `online`, visibility), never by a timer of its
own: the only timer is the debounce. A `changed` while `offline` sends every waiting save.

The sync never invalidates or reloads page data, except the one reload after a pull adopts the
current game (`syncReload.reload()`, a seam a test spies on). After the `PUT` that made the
account, the header and the account offer show the handle from `account`.

### Keep both

A 409 to the send of save `A` carries the account's version, `theirs`. In order:

1. `B = newId()`, and `name = defaultSaveName({ kind: 'conflict', name }, names)`:
   "{name} (this device)".
2. `store.rekey(A, B)`: the browser's version keeps everything under `B`. When `A` was current,
   `B` is current and no page loads. A `storage` answer sets `offline` and
   stops, with `A` waiting.
3. `store.rename(B, name)`.
4. `store.adopt([theirs])` under `A`; `seen[A]` takes the answered rev and `theirs.savedAt`. A
   `full` answer sets `full` and drops `seen[A]`, so a later pull adopts it.
5. `B` is sent with `baseRev: null`.

The player sees two saved games: "{name} (this device)" holds what they had; the old name holds
the other device's version.

### Removal

- A 410 keeps the save, current or not: the sync only sends a save that changed here (D8).
  `store.rekey(id, newId())` keeps it with its name (and, for the current game, no page
  load); `seen[id]` is dropped and it is sent under the new id with `baseRev: null`.
- `removed(id)` of a save in `seen` adds the id to `deleting` and, with a session, sends
  `DELETE /api/game/<id>`. A 204 drops it from `deleting` and `seen`. A 401 sets `sign-in`. Any
  other answer, or none, sets `offline` and leaves it in `deleting`, sent again with the waiting
  saves and by the next pull.
- `removed(id)` of a save not in `seen` sends nothing: the account never had it.
- A `removed` call clears `full` and sends every waiting save.
- The store's `changed` and `removed` calls made while the sync itself calls the store (its adopts,
  rekeys, renames and removes) are ignored, so they are never echoed back as sends.

### Pull

`pull()` runs at attach while signed in, when `signedIn()` turns true, when the page becomes
visible with a session, and after the account offer saves a handle. A second call while one runs
gets the running one.

1. Wait for in-flight sends, then `GET /api/game`. A 401 sets `sign-in` and stops. A network
   failure, 5xx or 429 sets `offline` and stops. Any other answer, or a list that does not read,
   ends the pull silently. `account` takes the answer's line.
2. `DELETE` every id in `deleting`.
3. Each listed save, most recent first:
   - Absent here and not in `deleting`: `GET /api/game/<id>` and adopt it; `seen[id]` takes its rev
     and `savedAt`. A 404 or 410 skips it.
   - Present, unchanged, listed rev above `seen[id].rev`: fetch and adopt it the same way.
   - Present and changed here: send it now with `baseRev: seen[id]?.rev ?? null`.
   - Present, unchanged, same rev: nothing.
4. Each id under `removed` that is here: unchanged and not current, remove it here; unchanged and
   current, keep it under a new id as for a 410; changed here, send it, which answers 410 and is
   kept under a new id.
5. Every save here that is neither listed nor under `removed` drops its `seen` entry and is sent
   with `baseRev: null`.
6. The current game, when step 3 fetched it to adopt: its adopt waits until every other step is
   done and its sends have answered. Just before the call the sync checks again that it is
   unchanged here; changed, it is sent instead with `baseRev: seen[id].rev`.

Adopts go one at a time; the first `full` answer stops further adopts and sets `full`, while sends
go on. An adopt of the current game runs the page's `beforeLeave` flushes (G2); when one wrote an
edit that was still waiting, the store answers `changed` and the sync sends the game the same way,
so the 409 keeps both. An adopt of the current game that answers `ok` sets `seen[id]` and reloads
the page at once: the pull makes no request after it, and saves that came due during the pull stay
waiting for the reloaded page's pull, which finds them changed here or unlisted. That pull finds
the same rev and does not reload.

### State

The first rule that holds:

1. `sign-in`: a 401 stopped sending and the browser has not signed in since.
2. `full`: a `too_many` answer or a `full` store answer, with no `removed` call since.
3. `offline`: the last request failed by network, 5xx or 429, and a save or a `DELETE` is waiting.
4. `saving`: a timer runs, a request is in flight or a pull runs.
5. `saved`: the browser has a session.
6. `local`: otherwise.

The games are in `localStorage` first in every state; no state blocks play or buying.

## The account offer

`AccountOffer.svelte` takes no props. It reads `page.data.user` through `currentUser.overlay`, and
`useGame().sync` with its `account`; the account is the user when there is one, else
`sync.account`. It renders nothing under the open game. One of four states:

| State               | When                                                         | Shows                                                                                            |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Sign in             | Sync state `sign-in`                                         | A link `syncText('sign-in')` to `/signin?returnTo=<path>`                                        |
| No account          | No user, `sync.account` null                                 | `syncText('local')`                                                                              |
| Handle never chosen | `sync.account.handleClaimed` false                           | "Save as", "@" (hidden from assistive technology), an input with the handle as placeholder, Save |
| Handle chosen       | `handleClaimed` true, or a user while `sync.account` is null | "@handle" linking `/account`; "Add an email to play on another device" while it has no email     |

- The account has an email when a user is present and is not `pseudonymous`. A password or a
  passkey keeps an account pseudonymous.
- Save is disabled while the trimmed input is empty or a request is in flight (`aria-busy`). It
  sends `PATCH /api/account/profile` with `{ handle }` only.
- 200: `currentUser.apply` when a user is present, then `sync.pull()`, whose list answer sets the
  claimed handle. Until then the offer holds the saved handle and shows the chosen state; a live
  region says "Saved."
- 400 or 429: the body's `error`, under the input, associated with it and focused. 401: "Sign in
  first." Any other status: "Couldn't save. Try again." A thrown fetch: "Couldn't reach the server.
  Check your connection."
- Nothing in the offer blocks Start.

## e2e seams

`e2e/game-save.spec.ts` runs the real path, with no seam of its own:

- `seedGame(page, { phase: 'runs' })` (`e2e/helpers/game.ts`) switches the real game on and stores
  a v2 game in the runs phase, with `firstWinAt` set and never sent, so the sync sends it at attach
  on the first load and the `PUT` mints the account. Rate limits always allow under
  `ENVIRONMENT=development`.
- A spec changes a stored game by writing its `saveKey(id)` value and its `SAVES_KEY` entry with
  `page.evaluate` (a new `name` and `savedAt`), then reloading: the sync finds it changed here.
- A second device: the first context adds an email on `/account` through the `dev-link`; a second
  context calls `newVisitor`, then `loginAs` with that email.
- Specs read what a browser holds from `SAVES_KEY`, and wait on `page.waitForResponse` for the
  `/api/game` requests, set up before the action that causes them; never on time.
- Any spec that seeds a game past the opening sends it 2 seconds after load and makes an
  account, unless the test ends first.

## Five-level records

A v1 save or index in a browser (the five-level game's) is removed at load, unread (P15). Any other
text that is not a save is moved aside under `sfhousing:save:corrupt:<time>`. The server refuses a v1
body: `parseGameSave` answers null and the `PUT` answers 422 `invalid`.
