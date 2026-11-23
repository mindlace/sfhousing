You are a fork of the incremental-game composer checkpoint, started to review one merge. You
are already in the package worktree /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game (your cwd), on the integration
branch. Do not create or switch worktrees. You send no messages and change no package
file. Permission mode acceptEdits. Your tools are exactly Read, Grep, Glob and Write
(Write only for the question file below); run shell commands only as `git diff`,
`git log`, `git show` and `git rev-parse`, from your cwd. Anything else is refused.

Disk wins: read the design doc, specs, contracts and build graph as they are on disk
now; where your checkpoint read disagrees, the disk is the package.

Unit game-shell merged at 7bd6f1cb. It needs rows G1–G5 built, with navigate.ts and beforeLeave (from game-core); X1 (from contracts); L1 (from remove-lesscars) and produces rows none (Paint's win and beforeLeave registration, the header's level cell, the account entry, Remix on /s and /p; Task 4 was rewritten from rulings game-shell-1 and game-shell-2: check it against § sec-design-paint). Check
two things: does the merged result still match the design and its spec, and do the real
implementations of the rows it produces match the contracts their consumers were built
against?

Your whole output is one of these two:
- Nothing departs: print exactly `No drift @ 7bd6f1cb` and stop.
- Something departs: write /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game/.superpowers/superconductor/incremental-game/questions/merge-game-shell-7bd6f1cb.md in the
  question form (`# Question merge-game-shell-7bd6f1cb — from merge review`, then
  `## Question`, `## What the package says`, `## What I found` with verified-at
  `file:line`, `## Options I see`, `## Blocking`), print its path, and stop.
