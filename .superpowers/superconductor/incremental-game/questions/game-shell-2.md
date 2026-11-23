# Question game-shell-2 — from incremental-game-game-shell

## Question
Spec G2 says the page sets the offer to null "on any edit"; the amended § sec-design-paint says an incomplete score leaves the won state (and so the offer) as it is. Which governs for Paint: does a stroke (an edit) clear the offer, or does the offer stay until a complete score falls below the goal?

## What the package says
- `2026-11-22-game-shell-design.html` (package worktree) line 197, in § sec-interfaces G2: "The page calls `setOffer` with the win while its seen result wins the level, and with null on any edit and when it unmounts."
- Same file, § sec-design-paint (as amended by game-shell-1, at 0b187d7c): a score that is not complete leaves the won state as it is; Paint stops being won only when a complete score falls below the goal, the page unmounts, or the simulation unlocks, "and only then is the offer cleared".

## What I found
- The two texts conflict for Paint: every stroke is an edit, so G2 would clear the offer mid-stroke (the header's "Level up" flickers off and on), which the amended Paint section rules out.
- The rewritten plan Task 4 (commit 3b86f3e4 on incremental-game-game-shell) follows § sec-design-paint. Unverified whether `/sim`'s use of setOffer (game-sim's unit) relies on the G2 "any edit" wording.

## Options I see
A. § sec-design-paint governs for Paint; G2's line is amended to say the page clears the offer when its seen result stops winning (for Paint, a complete score below the goal) and when it unmounts. (Recommended.)
B. G2 governs: clear the offer on any edit, re-set on the next complete win (reverses part of game-shell-1).

## Blocking
Plan Task 4 (Paint's win) only.
