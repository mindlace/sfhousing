# Question game-shell-1 — from incremental-game-game-shell

## Question
Does a score that is not yet `complete` (mid-stroke / the worker still filling) make Paint "stop being won"? If yes, "Keep playing" resets on every stroke and the offer is cleared and re-set on every stroke.

## What the package says
Spec `2026-11-22-game-shell-design.html` § sec-design-paint (package worktree, lines 428-436):
- 428: "Paint is won while the simulation is locked, the latest score is `complete`, and `paintWon(net, goal.amount)`."
- 429: "When it stops being won ... it calls `game.setOffer(null)`."
- 430: "'Keep playing' and Escape keep it closed until Paint stops being won."
- 436: "'Keep playing' ... The offer stays, so the level cell keeps 'Level up'."

## What I found
- Read literally, 428 makes every incomplete score "not won". Each stroke produces incomplete scores before the complete one (spec 377 / 433: complete scores "come after a stroke ends"; unverified against `+page.svelte` by me, reported by the pre-flight scan).
- So after "Keep playing", the next stroke (even one that keeps net above the goal) makes Paint stop being won: `kept` resets, then the next complete winning score reopens the card. Also the offer is set to null mid-stroke and re-set after, so the header's "Level up" disappears and reappears during each stroke, against 436's "the offer stays".
- The plan (Task 4) implements the literal reading (plan t4-s4; pre-flight scan finding 4c).

## Options I see
A. Incomplete scores leave the won state unchanged: "won" is judged on the latest complete score only; it changes only when a new complete score arrives. Kept, the card and the offer all hold through a stroke. (My recommendation: matches 430/436's intent and 433's "judged on complete scores".)
B. Literal reading: any incomplete score is "not won" (card returns after every stroke after Keep playing; offer flickers).
C. Incomplete scores clear the offer but do not reset `kept`.

## Blocking
Plan Task 4 (Paint's win) only. Tasks 1, 2, 3, 5, 6 proceed; Task 8 waits for Task 4 anyway.
