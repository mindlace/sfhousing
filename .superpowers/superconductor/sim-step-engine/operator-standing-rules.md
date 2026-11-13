# Standing rules for step-engine operators (from the partner; apply to you and every leaf you brief)

- Run every leaf agent and every shell command in the FOREGROUND with long timeouts (at most 600000 ms; split longer work). Never end your turn while anything you started is still running.
- Never compound `cd <dir> && <command>`; issue `cd` on its own, then the command.
- No Claude attribution anywhere: no `Co-Authored-By` trailers, no "generated with" notes, in commits, code, docs or comments.
- Conventional Commits. For multi-line commit messages write the message to a temp file and use `git commit -F`, no heredocs.
- "Most capable model" roles (plan drafting, final branch review, fix-loop escalation) run on Opus 5.5 (`model: "opus"`), not Fable; use the agent types `plan-drafter`, `implementer`, `task-reviewer`, `branch-reviewer`, `investigator` where they fit, with the model named explicitly on every dispatch.
- Your worktree already exists (path in your assignment), nested inside the conductor's worktree because the harness pins you there. Do NOT create another worktree and do NOT write in, or switch the branch of, the conductor's checkout `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine` itself. Work with absolute paths; `cd` into your worktree (on its own line) for git and npm; give every leaf that absolute path as its working directory.
- Do not push, do not open a PR, do not run `npm run signoff`: the conductor integrates.
- Read the project's `CLAUDE.md` and `docs/dev/testing.md` first. In your worktree: `npm install`, then the setup steps in CLAUDE.md as your tests need them. The current production dataset is 2026-11-10-6ee5a23d; `npm run data:local -- 2026-11-10-6ee5a23d` fetches it for live-city tests and measurements (read-only use). Say in every report which dataset a number came from.
- No file under the hashed folders (`pipeline`, `src/lib/data`, `src/lib/generator`, `src/lib/timelapse`, `src/lib/plan/{geometry,types}.ts`, `src/lib/sim/{scenario,levers,finance}`, `src/lib/scoreboard`) is added, changed or removed. A builder who finds a change there necessary stops and reports.
- Do not edit another spec's files. Under `src/lib/sim/world/`: `types.ts`, `world.ts`, `due.ts`, `columns.ts`, `months.ts`, `statics.ts` and the rest of the top level belong to world-core; `policy/` belongs to policy-timeline; `funding/` to world-funding; `score/` to world-score; `map-stream.ts` to map-stream. A needed change in a file that is not yours is a request to `main`.
- Do not duplicate effort (partner, 2026-11-13: "duplicating effort is worse than gaining concurrency"). If a task needs something another running spec is building, do not hand-build a stand-in: order your plan so that task comes last, and when you reach it message `main`, who merges the other spec's progress into `superconductor/sim-step-engine` and tells you the sha to merge into your branch.
- Docs: write your own `docs/dev/<your-slug>.md` with your own CLAUDE.md scoped-doc line (wherever your spec says to add a section to `docs/dev/step-engine.md` or `docs/dev/sim-timeline.md`, write it in your own file instead); the conductor unions the CLAUDE.md list at the merge.

## The measurement lock (several operators share one machine, which is otherwise idle)

Wall-clock numbers are only good when nobody else is loading the box. The lock is the directory
`/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-step-engine/.superpowers/sdd/measure.lock`.

- To take a timing (any bench, `test:perf`, or measurement task): `mkdir` that directory (it fails if someone holds it; then `sleep 60` in the foreground and retry, up to 30 minutes, then message `main`). On success write your slug into `owner` inside it, wait 30 seconds for others' commands to drain, run your timings, then remove the directory at once (`rm -r`). Hold it for at most 15 minutes at a time. Mark the numbers "quiet (lock held)".
- Before starting any heavy command that is not a timing (a test suite, `npm run check`, a build, `npm install`, dispatching an implementer or reviewer leaf): check the directory. If it exists and the owner is not you, wait (`sleep 60`, foreground, retry) until it is gone. Tell every leaf the same rule.
- Never put a timing assertion in a test that signoff runs; every timing bar lives in `test:perf`.
- If the lock looks stale (same owner for over 30 minutes), message `main`; do not remove someone else's lock.
