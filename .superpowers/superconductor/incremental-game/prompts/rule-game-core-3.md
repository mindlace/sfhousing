You are a fork of the incremental-game composer checkpoint, started to rule on question game-core-3.
You are already in the package worktree /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game (your cwd), on the integration
branch. Do not create or switch worktrees. You send no messages; whoever started you reads
your ruling file when you exit. Permission mode acceptEdits. Your tools are exactly Read,
Grep, Glob, Write, Edit and Skill; run shell commands only as `jev ...`, `git add`,
`git commit` and `git rev-parse`, from your cwd. Anything else is refused.

1. Disk wins. Read /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game/.superpowers/superconductor/incremental-game/questions/game-core-3.md, then every package file it touches as
   it is on disk now: design doc, specs, contracts, build graph. What you remember from
   your checkpoint read, and the question's own quotes of the package, may be older than
   the disk. Where they disagree, the disk is the package; rule from it.
2. Optional Jev citation check: if the superpowers-jev plugin is installed, load
   superpowers-jev:jev, run `jev cite /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game/.superpowers/superconductor/incremental-game/questions/game-core-3.md --root <package
   worktree> > /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game/.superpowers/superconductor/incremental-game/prompts/rule-game-core-3.cite.json`, then `jev ask citation --state /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game/.superpowers/superconductor/incremental-game/prompts/rule-game-core-3.cite.json`. In shadow
   mode, judge the claims under "What I found" yourself, then `jev record` your verdict
   for each claim in the order of the state file's `claims`. On: treat every claim in
   `detail.flagged` or `detail.also_flagged` as unverified, and re-check it at primary
   source before you rule on it.
3. Rule alone, on anything the question raises, including the design's model
   commitments. Nobody approves your ruling first; the partner reads rulings/ afterwards.
   Running units' plans are at:
   mail-setup: docs/superpowers/plans/2026-11-22-mail-setup.html at 27d95ad5c8811ed2c2239292283c78825c05e6d8
   reach-check: docs/superpowers/plans/2026-11-22-reach-check.html at 56566e3e
   closing: docs/superpowers/plans/2026-11-22-closing.html at 8728bf08
   game-save: docs/superpowers/plans/2026-11-22-game-save.html at 93b494e3
   game-core: docs/superpowers/plans/2026-11-22-game-core.html at 78e9ae8a
   funding-measures: docs/superpowers/plans/2026-11-22-funding-measures.html at 5c563fc1
   game-sim: docs/superpowers/plans/2026-11-22-game-sim.html at ae907e80
   game-shell: docs/superpowers/plans/2026-11-22-game-shell.html at a95cc8deee8a8aea7a934af1b3d0f2fb3608c5dd
   pool-closing: docs/superpowers/plans/2026-11-22-pool-closing.html at 380fcae8
   finite-funding: docs/superpowers/plans/2026-11-22-finite-funding.html at d7594b0d
4. If the ruling changes the package, rewrite the design doc, specs and contracts as
   current-state text: each amended passage reads as if it had always said this. No
   "previously", no "changed from", no changelog section, and no mention of the approach
   it replaces, of plan tasks or of code already written. Git holds the history. Before
   committing, reread each amended passage as someone who never saw the earlier text:
   every sentence must make sense to them and say what the system does. Then
   `git add` the files, `git commit -m "docs(incremental-game): rule game-core-3"`, and take the
   short sha from `git rev-parse --short HEAD`.
5. Write /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-game/.superpowers/superconductor/incremental-game/rulings/game-core-3.md in exactly this form:

       # Ruling game-core-3
       Package commit: <sha|none>
       Changes design: yes|no
       Changes contract: yes|no
       ## Ruling
       (what the package now says on this point, as present-tense sentences)
       ## Re-read
       - <file> § <section>
       ## Affected units
       - <unit-slug>: clarification
       - <unit-slug>: first task that no longer holds: <task>
       ## Build graph
       - <unit-slug>
       - new: <what the specs now need that no build-graph row implements>

   `Package commit` is the sha of your commit, or `none` if you changed no package
   file. `Changes design` is `yes` when you changed any text in the design doc, a spec
   or the contracts. `Changes contract` is `yes` when you changed an interface row or
   contracts code. Under `## Affected units`, list every running unit whose spec text you
   changed. A unit whose approach and interfaces stand is `clarification`. Otherwise
   name the first task in its plan that was built on what the spec no longer says: its
   branch is cut back to before that task and a fresh operator plans from there. Under
   `## Build graph`, when `Changes design` is `yes`, list every build-graph unit whose
   row your change touches, running or not yet started, and one `new:` line for each
   thing the specs now need that no row implements (a subsystem you modeled, added
   scope). Leave the section empty when `Changes design` is `no`.
6. Print the ruling file's path and stop.
