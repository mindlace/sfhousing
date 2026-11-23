# Question closing-1 — from incremental-game-closing
## Question
May `closing` rewrite comments (only comments) inside existing test files that name removed things, or are those files untouchable so the hits are reported to their owner units?

## What the package says
- Closing spec #sec-design-leftovers, Comments: "A comment in any file that names a removed module, route, table, binding, component or doc is rewritten to the code as it is ... Only the comment changes; code is never edited for this."
- Closing spec #sec-design-sweep: "Any other hit in a comment, in any file, is fixed by rewriting the comment"; "A hit in code or test code anywhere else is a defect of the unit that removed the name: it is reported ... and left alone."
- Closing spec #sec-tests-verify, last line: "No existing test is deleted or changed by this unit."
- My assignment's write set: "comments in any file that name removed things, except on the compatibility code the sweep allows".

The first two say "any file"; the third says no existing test is changed. A comment edit inside a test file is both.

## What I found
Task 1's implementer (report `.superpowers/sdd/2026-11-22-closing.html/task-1-report.md:46-47` in the closing worktree, unverified by me line by line) found comment-only hits in existing tests and left them:
- src/lib/shell/header-actions.svelte.spec.ts:24 (FzpMode); src/lib/fzp/ProjectCardPanel.svelte.spec.ts:558 (FzpMode)
- src/lib/timeline/copy.spec.ts:1 (/lesscars); src/routes/sim/page.spec.ts:1 (/fzp)
- src/lib/sim/scenario/engine-regimes.spec.ts:1, engine-switch.spec.ts:1, types.spec.ts:66,87 (lesscars plan)
- scenario-host.{gross,heights,levers,load}.spec.ts (/fzp meaning "no levers")
- e2e/fzp-sim.spec.ts:22; e2e/fzp.spec.ts:1,129 (/fzp redirect)
It edited comments in non-test files and in `src/lib/sim/scenario/test/host-harness.ts` and `test/sim-map-stub.ts` (test helpers, not test files) — the reviewer is checking those.

## Options I see
A. Comment-only edits in test files are allowed ("No existing test is changed" means no assertion/behaviour change); Task 5 rewrites them, and the sweep comes out clean apart from code hits.
B. Test files are untouchable; each hit is reported to its owner unit (remove-lesscars, game-sim, remove-multiuser) in the handback, and the sweep's "nothing outside the allowed places" fails on those lines.
C. As B, but the test-helper comment edits Task 1 made are also reverted.

## Blocking
Task 5 (the final sweep), for these test-file comment hits only. Tasks 2, 3, 4 and the rest of 5 proceed.
