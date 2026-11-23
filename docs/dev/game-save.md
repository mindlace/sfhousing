# Game save

Saved games leave the browser for the player's account through `/api/game` (types in
`src/lib/game/save-api.ts`), stored in the `game_save` table, one row per saved game with a rev
that every write checks. The browser side is the save sync (`src/lib/game/save-sync.svelte.ts`),
which the root layout makes once and the store calls after each change, and which keeps both
versions when two devices changed the same game. The account offer on the win card is
`src/lib/game/AccountOffer.svelte`.
