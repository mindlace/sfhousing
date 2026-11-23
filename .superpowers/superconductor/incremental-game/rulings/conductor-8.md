# Ruling conductor-8
Package commit: 0ea5c910
Changes design: yes
Changes contract: no
## Ruling
The package stands: deleting an account deletes its saved games (`deleteGamesOf` in `closeAccountRows`, live and removed rows of the survivor and of every identity fused into it), and published plans and policies stay. The design doc's Accounts and the save section now gives the reason beside the rule.

Why this meets the owner's words:
- The durability preference (`sims-are-public-keep-them`) is about public, shared things: "deletion shouldn't kill any shared links", a deleted person's commits stay in sims others share. Its reason is that a sim "is meant to be shared and remixed". A saved game is none of that: it belongs to one player, sharing one is out of scope, and nothing links to it.
- Once the account is deleted no identity can sign in to the rows, so keeping them would keep nothing a person could open. This is the same reasoning the owner accepted in D10 ("No page ever opened one, so nothing a person could see is lost").
- What others can reach is kept: every published plan and policy, its id and its page. A player who wants a game to outlive the account publishes it.
- The deletion is the player's own deliberate act on /account, behind the handle check, and its text says so: "Deletes your account and the games saved to it. Published plans and policies stay. This cannot be undone."
- `remove-multiuser` dropping the e2e case "keeps both sims" follows from D10 (server-side sims no longer exist), not from this rule.

For the partner to read afterwards: if you want saved games kept after their account is deleted, the change is in S1 ("Deleting an account deletes its game_save rows") and `game-save`'s deletion section; this ruling does not make it.
## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-model-accounts
## Affected units
## Build graph
