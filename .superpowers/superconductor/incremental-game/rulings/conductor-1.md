# Ruling conductor-1
Package commit: 7fbb5e32
Changes design: yes
Changes contract: no
## Ruling
The package stands. The two passages now say it outright.

- A plan or policy saved in this browser before the game existed becomes the first saved game, at level 1. The store gives it no other level and banks nothing for it.
- Its policy is kept whole. Every policy in it stays in the document. Each shows as locked until its kind unlocks and runs from the level that unlocks it, as in a remix (G3, R6).
- A money policy saved before this build has `preset` null. It is not a given measure, so it stays locked in this round (G3, D4).
- At level 1, `/sim` is the locked page, as `game-sim` already says.

No spec disagrees with another on this point. The design doc § sec-model-saves, G2's construction rule, and `game-core` § sec-design-store-construct all give level 1. `game-sim`'s locked page and playable document apply it.

Why this does not go against the owner's words:
- **D5 is about published policies.** The owner wrote: "Playback of a shared sim should preserve all its settings and behavior, so it serves as an argument for certain policies; only remix-ing should shift to only-unlocked." The full-playback rule covers `/s/<id>`, and the package keeps it there. The owner's reason is the argument a published policy makes. A browser autosave is not a published policy. It is the player's own game.
- **The request and R0 want a game that starts weak.** The request: "you start 'weak' and gradually become more powerful", with one unlock per win. Starting a returning visitor's own game at the level its document needs would skip that.
  - It would also bank no bars. G2 requires bars at levels 3 to 5 (`parseGameSave` requires `banked` keys 2 to level − 1), so the save would not parse unless G2 itself changed.
- **Nothing is lost.**
  - The policy stays in storage and in the game's document, and it returns as each kind unlocks (R6).
  - Anyone can still play any published policy in full at `/s/<id>`.
- **The IDR line is not the owner's.** "A saved or shared policy that already uses a kind keeps it usable" (`2026-11-17-information-design-review-design.html#q-progress`) sits under "Questions for the owner". It was an earlier composer proposal that the owner never ruled on. The owner's later rulings (D5, D6, D14) decide this matter.

For the partner to read afterwards: a returning visitor with a pre-game autosave meets the locked `/sim` until Paint is won. Their zoning comes back at level 4. Their own-pool money stays locked until level 6. If you want that visitor to keep their policy runnable, the change goes into G2 (a migrated save at its needed level, with bars), and this ruling does not make it.

## Re-read
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-model-saves
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-store-construct
## Affected units
- game-core: clarification
## Build graph
- game-core
