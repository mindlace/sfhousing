# Ruling conductor-6
Package commit: none
Changes design: no
Changes contract: no
## Ruling
The package stands as written. The win card shows the result and the unlock; the header keeps the two steps and adds the level cell. Every item that "The loop" in the information design review lists is on screen at the win, in the place the owner's later rulings give it.

- The win card holds its title ("Goal reached in Mar 2049", or "Room for 82,069 homes" on Paint), the "Unlocks: {kind}" line, "Level up", "Keep playing" and the account offer (G5, `game-core` § sec-design-wincard).
- Win timing: from level 3 a level is won by beating the bar, not the deadline (R3, D1, G1). Under D1, current law always reaches the goal inside the window, so "how far ahead of the deadline" says nothing about whether the player won. The bar the result beat is on the ruler ("To beat" flag), in Details ("To beat: Jun 2057") and in the level panel.
- Policy effect: "how much of it came from their policy" is line 2 of the pinned headline on `/sim` ("the effect and the goal"). Playback pauses when the card opens, so the headline reads at the win month. Repeating it on the card would restate a number already on screen; the owner's terse-copy rule ("cut what the reader can infer") applies.
- One card, two buttons: the loop's "one button: Next goal" is replaced by the owner's R5 (levelling up is opt-in, the player can keep playing). The loop table was the composer's proposal under the decision "the loop is the frame, and unlocking is not built now"; its rows were not owner rulings on content. Where the owner later ruled (R0, R3, R5, D1, D2), those rulings decide.
- Header: the steps stay because Paint stays open at every level and its plan never enters the simulation (design § sec-model-level1); the owner's decision "steps only for now" presents Paint and Simulate as steps one and two. The level cell shows the current level ("Level 3"), which implies the levels won. Its panel names the bar and the next unlock by name ("Next: Zoning") and offers "Level up". The headline item stays in the bar, and details sit one tap away, per the owner's compact-UI preference. While the simulation is locked, "2 Simulate" is not a link and says "Unlocks when you level up".

For the partner to read afterwards: the card does not repeat months-to-spare against the deadline or the policy's share. If you want either on the card, the change goes into G5's WinCardProps (a second line) and into `game-sim`'s card props, and this ruling does not make it.
## Re-read
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-design-wincard
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-design-steps, sec-design-cell
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-model-loop, sec-model-bar
## Affected units
## Build graph
