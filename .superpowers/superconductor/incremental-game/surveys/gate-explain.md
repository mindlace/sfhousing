# Gate: the system the package describes

From the package alone (design doc, build graph, 13 specs of 2026-11-22).

## What the game is

The SF Housing Simulator becomes a game with one goal: reach 82,069 homes inside the 40-year window. A player starts weak and gets stronger, one unlock per level. Five levels are built now; levels 6 to 9 (designing funding rules, market rules, purchase and rental affordability targets) and the less-cars unlocks (transit, highway removal) are named but not built.

## The levels

| Level | Where | What the player can change | Wins when | Levelling up unlocks |
|---|---|---|---|---|
| 1 | Paint (`/`) | Zoning heights, with the brush | Painted capacity is at least the goal amount | The simulation |
| 2 | `/sim` | Nothing | Current law reaches the goal (any month inside the window) | Permitting |
| 3 | `/sim` | Permitting | Goal reached in an earlier calendar month than the level 2 result | Zoning |
| 4 | `/sim` | Permitting, zoning | Earlier than the result banked on leaving level 3 | Public money (given measures) |
| 5 | `/sim` | Permitting, zoning, the given money measures | Earlier than the result banked on leaving level 4 | Nothing: the round is complete |

At level 1, `/sim` is a locked page ("Paint room for 82,069 homes to unlock the simulation." and a "Go to Paint" link), and the header's "2 Simulate" step is plain text, not a link. Paint stays open at every level, but its plan never enters the simulation, and Paint can only be won at level 1.

On `/sim`, a locked kind keeps its row on the timeline. Its lane reads "Unlocks when you level up" for the next kind and "Unlocks at level N" for later ones; it has no "+", and its policies are dimmed and cannot be selected. At level 5 the Public money "+" lists only the funding presets offered today (housing bond, General Fund set-aside, revolving fund, public bank, state switch-off, state doubled, federal support, federal credits withdrawn). "Your own pool", "City funding scale" and "Market terms" are kept in the code for level 6. A given measure's dates, on switch, order and Remove can be edited, but what it pays is shown as read-only text. A money policy that is not a given measure, including every money policy saved before this build, is shown as "Unlocks in a later round" and does not run.

## Winning a level

A result is "seen" when the playhead reaches the month the goal is met, or the window's end, while the numbers are current for the policy on screen. Any edit clears the seen result. At level 2 any reached result wins. From level 3 on, a result wins only if it reaches the goal in an earlier calendar month than the bar. A tie never wins, and a missed goal never wins.

When a seen result wins, playback pauses and a non-modal win card opens over the map. It shows "Goal reached in Mar 2049" (on Paint, "Room for 82,069 homes"), says what levelling up unlocks, and has two buttons, "Level up" and "Keep playing", plus the account offer. Levelling up is the player's choice. "Keep playing" closes the card; the header's level cell keeps offering "Level up" while the current policy's seen result still wins. If the player edits after a win, the offer goes away until a new result is seen and wins again.

When a seen result does not win, the goal notice names the bar: "Goal reached in Mar 2058. Beat Jun 2057 to level up." or "Goal missed by 3,313 homes. Reach it before Jun 2057 to level up." (at level 2: "Goal missed by 3,313 homes.").

Levelling up banks the winning month as the next level's bar, raises the level, returns the clock to today, clears the result, and opens the new kind's row. Every policy the player made stays in force and stays editable. A Paint win moves the player to `/sim` at level 2. The bar shows in three places: the level cell ("Level 3"; its panel says "Beat Jun 2057" and what comes next), a "To beat" flag on the ruler (merged into one "Goal · To beat" flag when the bar is within 30 months of the deadline), and a "To beat: Jun 2057" line in Details. When level 5 is won and banked, the level cell reads "Round complete" and names what is coming next.

The design says current law always reaches the goal inside the window (D1), so every level can be won. A bar is stored with the dataset it was earned on, and a data update never moves it. About explains this.

## Saved games

A saved game is a name, a level, its bars, a Paint plan and a `/sim` policy. A player can have up to 12. One is current; Paint and `/sim` edit its plan and policy through the existing autosave records. The level cell's panel lists the saved games by name, level and last played ("Today", "Yesterday", "4 Mar"). From the panel a player can switch games (a full page load to Paint at level 1, or to `/sim` above it), rename a game in place, delete a game (asked once; deleting the current game makes the most recently played other game current, or creates a new game when none is left), or start a new game at level 1. Nothing is ever reset in place. Default names are "Game, 22 Nov", "Remix of {title}" and "{name} (this device)", with " (2)" added when a name is taken. A plan or policy saved in the browser before this build becomes the first saved game, at level 1.

## Accounts and sync

Everything is stored in localStorage first, and the game works with no network. Nothing leaves the browser before the player's first win. At that point the browser sends its saved games; with no session, the server creates an anonymous account and sets its cookie on the same response. After that, every change to a saved game is sent, debounced by 2 seconds. A browser that has signed in before but is signed out now is told "Sign in to save" and creates nothing.

Every win card shows the account offer. While the handle has never been chosen, it is a "Save as @…" field. Once chosen, it is "@handle" linking to `/account`, plus "Add an email to play on another device" while the account has no email. On `/account` a player can add an email (magic link), a password, a passkey or Google. All four methods are switched on in both environments. Google appears only once its two secrets are set, and magic link only while mail can be sent. Sign-in mail goes through Amazon SES from `sfhousing.mindlace.net`, and a real mail on staging and then production proves it.

A second device that signs in gets the account's games and sends its own; nothing is merged. When two devices change one game, the second to save keeps its version as "{name} (this device)" and adopts the account's under the old name. Deletes propagate at the next sync. Joining two accounts moves the absorbed one's games to the survivor. Deleting an account deletes its games; published plans and policies stay. "Start fresh without an account" goes from `/signin`.

## What is removed

- Shared sims, invitations, members, roles, the per-sim Durable Object (deleted by a wrangler delete migration), the sim log/store/sync, `/sims`, `/invite`, their APIs, the operator takedown and the capability ledger. Tables dropped, accounts kept, URLs 404.
- `/fzp` (no redirect) and `/lesscars`, with their modules, playback worker mode, pipeline steps, V35, dataset files and tests. The freeway-land catalog stays (lot eligibility unchanged), as does `docs/lesscars/plan-v1.md`. Older datasets still load.

## Public money

Every baseline source gets an evidence bound: an end date (Housing Trust Fund, 2043-06-30), a remaining total paid in yearly lumps (City bonds, $260.3M), nothing left (Redevelopment, the Housing Stability Fund), or no end where law sets none (OCOH, General Fund; state and impact fees unless the builder reads an end or balance in a primary). Provenance states each, cited. Federal tax credits get a yearly ceiling ($564.5M, the best award year). No pool can always pay.

A pool that has had its last money and cannot pay a waiting project closes from the next month, exactly as if switched off: its share leaves every bundle, waiting projects are re-made on the rest at lower odds or lapse; a new arrival reopens it. Details says "{label}: ran out Mar 2030". The older engine (the referee) does not close.

Every preset ends (General Fund set-aside 30 years, federal support 10 payments, state doubled 10 years). A given measure's money is dated from its span's start; the span's end cuts later payments. Funding editors run to the window's last month and never offer "no end". A pool whose inflows all end has a bar that drains from its lifetime total and never refills. Yearly lumps stay.

## Sharing and remix

Publishing to `/p` and `/s` works as today. Publish sends the playable document, the policies that ran, so a published policy plays for everyone as it did for its author. `/s/<id>` runs the whole document for any viewer at any level, with no game parts. Remix never replaces anything; it makes a new saved game. Remix on `/s` needs the current game at level 2 or higher ("Unlock the simulation to remix" at level 1). It copies the current game's level, bars and plan, takes the published policy, and opens `/sim`. Policies above the game's level show as locked, and a note names the level that runs all of it. Remix on `/p` works at any level: it copies level, bars and policy, takes the plan, and opens Paint. At 12 games, Remix and New game ask the player to delete one first.

## The reach check

`scripts/level2-check.ts` runs the empty document over the window on a built dataset and exits 1 when current law misses the goal. It runs once on an integration-branch dataset after the money units merge, and again in closing on the dataset that is about to be uploaded. On a miss, nothing is uploaded and the owner chooses the remedy. The design warns the margin is thin: 15 to 31 months, and only with pool closing.

## Build order

`contracts`, `remove-lesscars`, `remove-multiuser`, `mail-setup` first; then `game-core`, `finite-funding`; then `game-save`, `game-shell`, `game-sim`, `funding-measures`, `pool-closing`; then `reach-check`; last `closing` (docs, journey e2e, build, check, upload, signoff). Longest chain: → finite-funding → pool-closing → reach-check → closing.

## Could not tell

1. Level 5 after the round is complete: game-core says a further level up does nothing; game-sim says it banks the new result. No button offers it either way.
2. Whether the state and impact-fee sources end: the builder decides from primaries, and D1 rides on it.
3. A bar earned on older data that new data makes unbeatable: D9 freezes it; the only escape is a new game.
4. A won result does not survive a reload (the offer is memory only); the player replays to see it again.
5. Owner of `level2-check.ts`: finite-funding, pool-closing, game-core and game-sim call it closing's; the build graph and reach-check give it to reach-check.
