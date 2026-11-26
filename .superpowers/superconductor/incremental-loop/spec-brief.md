# Brief for spec writers: the incremental-loop package

You are writing ONE spec of a twelve-spec package. An implementer who never saw the design
conversation will plan and build from your spec alone, so it must decide everything inside its
scope.

Repository: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel` (a git
worktree). Work only there, by absolute path.

## Hard rules

- Write exactly one file: your spec, at
  `docs/superpowers/specs/2026-11-24-<slug>-design.html`. Edit nothing else. Do not commit.
- Do not start servers, run the test suites, or run git commands that change state.
- Never compound shell commands with `cd ... && ...`. Run everything in the foreground. Do not
  spawn further agents.
- No Claude attribution anywhere.

## Read first, in this order

1. The design: `docs/superpowers/design/2026-11-24-2120-incremental-loop.html`, all of it. It is
   the authority. Its interface rows are contracts: copy them, never restate or improve them.
2. The format: `/Users/mindlace/.claude/plugins/cache/super/supersonic/0.5.0/skills/supercomposer/spec-format.md`.
   Follow it exactly, including "Writing for a reader".
3. The source model the design came from: `docs/superpowers/specs/2026-11-24-incremental-feel-design.html`.
4. The survey reports named in your assignment, under
   `.superpowers/superconductor/incremental-loop/surveys/`. They say what the code is today, with
   file:line. Treat a claim marked I (inferred) as unverified.
5. The code your subsystem touches. Read it at primary source before you bind a decision to it. A
   doc and the code may disagree: the code is the evidence.
6. For form only, one spec of the earlier package, such as
   `docs/superpowers/specs/2026-11-22-game-sim-design.html`.

## What the spec holds

An HTML fragment with a single `<article>` root, with these sections (ids as given):

- `header`: the `h1` and a one-line summary.
- `sec-purpose`: what the subsystem is for, in the design's terms, and which rulings it carries.
- `sec-interfaces`: the rows it **produces** and the rows it **needs**. Copy from the design, with
  no change: the `tbl-interfaces` table's header and the lines of your rows (keep the table id
  `tbl-interfaces` and its caption "Interface table"), and each row's whole `sec-if-<row>`
  section. A row you only need is copied too, so the implementer has its contract in hand.
- `sec-global-constraints`: the design's section of that id, copied with no change.
- `sec-found`: what the code is today in your scope, each statement with a file:line you read.
- `sec-design`: the behaviour, decided. Subsections as needed. One rule per list item. Every type,
  signature, message, schema, constant or command in a code block with `data-lang`. Exact user-facing
  words where the subsystem shows any, exact test ids where it adds any, exact constants.
- `sec-files`: the files it writes, creates and deletes. Stay inside the design's write set for
  your subsystem (`tbl-write-sets`). If you find you need a file outside it, do not take it:
  report it.
- `sec-tests`: what must be proven, as a list of behaviours, and at which layer (unit, component,
  e2e). Vitest runs with `expect.requireAssertions`; tests are colocated.
- `sec-decisions`: every decision you made that the design did not settle, each with its reason
  in a sentence.
- `sec-out-of-scope`: what an implementer might assume is theirs and is not, naming the subsystem
  that has it.

## How to decide

- The design's "Composer calls" and "Global constraints" bind you.
- Decide every behaviour whose effect is visible outside your module: do not leave it to the
  implementer. "The implementer chooses X" is a defect unless X is invisible outside the file.
- No placeholders: no "TBD", "e.g. something like", "as appropriate". A number is a number.
  Where a number can only come from a measurement, say which measurement sets it, give the
  starting value to use until then, and say who runs the measurement.
- Stay within what the code has. Do not invent a lever, a value or a source.
- Page text is short and plain. No "it is not X" disclaimers.
- If the design is wrong about the code, or two parts of the design conflict in your scope, do
  not resolve it silently: write the spec to the reading you think is right, and report the
  conflict.

## Before you finish

Run the checker and fix what it reports until every list it prints is empty and `h1` is 1:

    python3 /Users/mindlace/Projects/sfhousing/.claude/worktrees/incremental-feel/.superpowers/superconductor/incremental-loop/check_spec.py <your spec path>

## Hand-back

Reply with at most 250 words: the spec's path; the decisions you made that the design did not
settle; every conflict you found between the design and the code, or inside the design; and any
file you needed outside your write set.
