# Question game-core-2 — from incremental-game-game-core
## Question
During construction, what does the store do when a write is refused in steps 4–7 (rebuilding from a bad index, moving a bad save aside, making a new current game, rewriting the index)?

## What the package says
- game-core spec §sec-design-store-construct (`docs/superpowers/specs/2026-11-22-game-core-design.html:638-645`): step 1 covers a throwing first `getItem` (memory mode); step 3 covers "When the first game's writes are refused" (memory mode keeping the plan and policy it read). Steps 4–7 write (corrupt copies, `removeItem`, a new save, the index) but say nothing about a refused write.
- §sec-design-store-change (`:655`) gives the rollback rule ("puts back every key it had already written ... answers `{ ok: false, reason: 'storage' }`") for *changes*, not construction.

## What I found
Nothing in the spec or contracts rows (G2) decides it; the constructor returns no `StoreChange`, so the change-rollback answer has nowhere to go.

## Options I see
1. Treat it like step 3: put back what construction wrote (ignoring throws), and go to memory mode holding the current game as read/made. Recommended.
2. Keep going with whatever was written, stay in storage mode, and let later changes fail individually.
3. Memory mode without rollback.

## Blocking
Task 5 of `docs/superpowers/plans/2026-11-22-game-core.html` (one construction case).
