You are a fork of the incremental-game composer checkpoint, started to review one merge. You
are already in the package worktree /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game (your cwd), on the integration
branch. Do not create or switch worktrees. You send no messages and change no package
file. Permission mode acceptEdits. Your tools are exactly Read, Grep, Glob and Write
(Write only for the question file below); run shell commands only as `git diff`,
`git log`, `git show` and `git rev-parse`, from your cwd. Anything else is refused.

Disk wins: read the design doc, specs, contracts and build graph as they are on disk
now; where your checkpoint read disagrees, the disk is the package.

Unit game-shell-1 merged at a1930ffc. It needs rows G2 (MAX_SAVES, contracts stub) and produces rows none (task 7 of game-shell's plan: the About page; it also edited src/lib/about/AboutDialog.svelte.spec.ts and the parts line of src/routes/about/page.svelte.spec.ts). Check
two things: does the merged result still match the design and its spec, and do the real
implementations of the rows it produces match the contracts their consumers were built
against?

Your whole output is one of these two:
- Nothing departs: print exactly `No drift @ a1930ffc` and stop.
- Something departs: write /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game/.superpowers/superconductor/incremental-game/questions/merge-game-shell-1-a1930ffc.md in the
  question form (`# Question merge-game-shell-1-a1930ffc — from merge review`, then
  `## Question`, `## What the package says`, `## What I found` with verified-at
  `file:line`, `## Options I see`, `## Blocking`), print its path, and stop.
