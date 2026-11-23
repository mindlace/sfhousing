# Question remove-multiuser-4 — from incremental-game-remove-multiuser
## Question
My branch carries game-shell's commits 9285d15c ("docs(about): levels, months to beat and saved games") and a95cc8de ("docs(game-shell): implementation plan"). They came in when I merged the integration branch at 82bc19d4, which was later taken off integration by the 19:20 `git reset --hard 7473edeb`. 9285d15c makes `src/routes/about/page.svelte.spec.ts:17` fail (game-shell's own fix round). How should my branch lose them? My allowed git commands cannot rewrite history (no reset, revert, checkout or cherry-pick).

## What the package says
- Operator briefing: merge the integration branch with `git merge --no-ff --no-edit`, never a rebase; the conductor reads my first-parent line as my own commits.
- The conductor's message: a row report must name a commit where `npm run check`, `lint`, `test:unit` and `test:e2e` all pass.

## What I found
- `git branch --contains 82bc19d4` lists only incremental-game-remove-lesscars and incremental-game-remove-multiuser. The integration branch no longer contains it (verified in my worktree).
- Ledger line 535: "all four taken back out with `git reset --hard 7473edeb`". Line 536: game-shell-1's fix round is that same /about unit failure.
- `git log --no-merges superconductor/incremental-game..HEAD` on my branch: my eleven commits (af1e4602, d4ef8992, cbd11881, a7d00320, 61504ea2, 7208dcdf, a56ce80b, 83d474b3, 5d85d571; the plan) plus the foreign 9285d15c and a95cc8de.
- At HEAD 5d85d571: `npm run check` 0 errors; `npm run lint` 0 errors; `test:unit` 8883 passed with 1 failure, that /about case (9285d15c's). The full e2e suite has not run yet: port 4173 is held by another session's server.
- The sibling incremental-game-remove-lesscars branch also contains 82bc19d4.

## Options I see
1. The conductor rebuilds my branch: a fresh branch from the current integration tip with my first-parent commits merged or cherry-picked in (the conductor's git can). Clean history. Recommended.
2. I add a hand-made revert commit that restores the five 9285d15c files and the plan file to the integration tip's content. Hazard: once game-shell's 9285d15c re-lands, merging the two lines lets the revert remove game-shell's /about work, or keeps it removed.
3. Merge my branch as is, after game-shell's fix lands on integration. The conflict then resolves in game-shell's favour, but my branch drags game-shell's unreviewed-for-merge commit in early.

## Blocking
The row I1 re-report and `complete`. All six tasks and the final review are done; the branch is otherwise ready.
