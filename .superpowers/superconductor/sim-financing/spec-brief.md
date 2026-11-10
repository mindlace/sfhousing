# Spec-derivation brief (shared by all sim-financing spec writers)

You are writing one spec of a seven-spec package. A separate session will execute the package later; your spec is what its builders read. Nobody will be able to ask you what you meant.

## Read first, in this order

1. `docs/superpowers/design/2026-11-09-1911-sim-financing.md`, all of it. It is approved by the project owner. Its rulings (R0 to R10), "The model", the interface table, "Row ownership", the global constraints and the traceability table bind you.
2. `docs/superpowers/research/2026-11-09-financing-evidence.md`. Its markers matter: `[V]` was read in the primary document, `[R]` was reported by a research agent and must be re-read in the primary before your spec rests a constant on it, `[S]` is secondary only. The local PDF copies it lists are readable with the Read tool (`pages` parameter).
3. `CLAUDE.md`, and the `docs/dev/*.md` files for your area.
4. The code you will extend. **The code is ground truth.** Where a document and the code disagree, trust the code and report the contradiction under "Interface concerns".

The source model documents the design derives from are `docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md` and `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md`; read the parts your area touches.

## Where and how

- Worktree: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/sim-financing`. Write exactly one file, `docs/superpowers/specs/2026-11-09-<slug>-design.md`.
- Do **not** commit, do not write product code, do not edit the design or any other file. Never compound `cd` with another command; use absolute paths.
- No attribution to any AI tool anywhere in the file.
- Shell works in the worktree (`grep`, `sed -n`, `ls`, `node`). There is no local dataset build in this worktree; the research digest lists a live calibration, a live projects file and a calibration report you can read.
- Public datasets can be queried with `curl` against `https://data.sf.gov/resource/<id>.json?$select=...&$limit=5`. Keep requests generic; put no personal or project names in any request.

## What the spec must contain, in this order

1. **Scope.** The subsystem's row from the design's Subsystems table, then a precise in and out list, and what it hands to which other subsystem.
2. **Interfaces.** Copy every interface-table row your subsystem owns or consumes (see "Row ownership") **verbatim**, including the M or D mark, one row per table line, exactly as the design prints it. Mark each "owns" or "consumes". Put new internal types in a separate "Internal types" list; they must not alter a row. If a row seems wrong, ambiguous or insufficient, do **not** change it: add it to "Interface concerns" for the orchestrator, with the fix you would make.
3. **Global constraints.** Copy the design's "Global constraints" section verbatim.
4. **Behaviour.** Decide every behaviour whose consequences are visible outside your module: numbers and their rounding, file and field formats, validation and error text, ordering and tie rules, UI states, empty and failure states, edge cases. Never write "the implementer decides" for anything externally visible; decide it and give the reason. Internal-only choices may be left open if labelled internal. **Every number you introduce carries its evidence tier (0 to 4) and its source** (document, URL, page or `file:line`); a tier 4 number is named as such and kept to a minimum. Follow the design's rule: a value that cannot be sourced is `Unsourced` with a reason, and what depends on it is unavailable or runs on a value the user typed, labelled "custom, not sourced".
5. **Seams.** For each deferred item that touches your subsystem (market scenarios and a market control, R7; the pipeline and drop-out, R1 and R8; a rent model, R4), say exactly what this spec does now to keep the seam open, and nothing more.
6. **Testing.** A concrete test list with named fixtures: Vitest server project for pure TypeScript; Vitest client project for components; Playwright e2e for cross-layer behaviour; `npm run test:pipeline` for pipeline code; the accessibility gate (`expectNoA11yViolations`) on pages. Every test calls `expect`. Say which existing goldens and fixtures change and by which documented command, consistent with the design's "Goldens change only at the two releases".
7. **Acceptance criteria.** Checkable statements, each traceable to a design row, ruling or constraint.
8. **Developer documentation.** Which `docs/dev/*.md` file is written or updated, and what it must say; the `CLAUDE.md` link.
9. **Open questions.** Only what the design leaves open for your subsystem, each with a recommended answer the builders follow by default.
10. **Interface concerns.** As described in item 2. Say "none" if there are none.

## Standards

- Cite `file:line` for every claim about existing code. Mark every factual claim about a dataset, a law or a document as verified (with the page or the query) or inferred.
- Plain, complete sentences; no shorthand a reader outside this session could not follow. Define a term before using it.
- Aim for 2,500 to 5,000 words. Longer only where behaviour needs it.
- Stay inside your subsystem. Where you need something another subsystem owns, state the assumption and list it under "Interface concerns" if the rows do not already guarantee it.

## What to send back

A summary of at most 250 words: the file written; every interface concern; every open question; every tier 3 or tier 4 number you had to introduce; anything in the design you could not reconcile with the code.
