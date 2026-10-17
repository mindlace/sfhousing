# Spec-derivation brief (shared by all fzp-timelapse spec agents)

Source of truth: `docs/superpowers/design/2026-10-16-1903-fzp-timelapse.md` (approved with partner rulings). Read it fully first, including the Rulings and Traceability sections. Also read `docs/superpowers/research/2026-10-16-fzp-calibration-literature.md` and `docs/superpowers/research/2026-10-16-sf-stage-datasets.md`, and `CLAUDE.md` plus the `docs/dev/*.md` files relevant to your area. The previous composition's design (`docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md`) and specs (`docs/superpowers/specs/2026-10-1*-*.md`) describe the code that exists. **The code is ground truth**: where a doc and the code disagree, trust the code and report the contradiction under "Interface concerns".

Worktree: `/Users/mindlace/Projects/sfhousing/.claude/worktrees/fzp-timelapse`. Write one spec at `docs/superpowers/specs/2026-10-16-<slug>-design.md`. Do NOT commit, and do NOT write product code. Never compound `cd` with other commands.

Each spec MUST contain, in this order:

1. **Scope.** The subsystem paragraph from the design, then a precise in/out list.
2. **Interfaces.** Copy every interface-table row (T-numbers, plus any I-row) that this subsystem owns or consumes **verbatim**: signature text identical, MC/DC mark included. Put any new internal type in a separate "Internal types" list; it must not alter a T- or I-row. If a row seems wrong or insufficient, do NOT change it. Add it to "Interface concerns" for the orchestrator.
3. **Global constraints.** Copy the design's Global constraints section and its Evidence hierarchy section verbatim.
4. **Behaviour.** Decide every behaviour whose consequences are visible outside the module:
   - numbers shown and file formats;
   - URLs and timings;
   - UI states and error states;
   - edge cases.

   Never write "implementer decides" for anything externally visible. Internal-only choices may be left open but must be labelled internal. **Every numeric parameter you introduce carries its evidence tier (0–4) and source.** A tier-4 number must be named as such and kept to a minimum.
5. **Seams.** For the deferred items that touch this subsystem (policy levers T9, addenda sub-stages, DA phasing, renderings), state exactly what this spec does now to keep the seam open, and nothing more.
6. **Testing.** A concrete test list (unit/property/golden/e2e) with named fixtures:
   - Vitest server project for pure TS;
   - Vitest client project (Playwright browser) for DOM;
   - Playwright e2e for cross-layer seams;
   - `npm run test:pipeline` for pipeline code;
   - the axe gate on pages.

   Every test must call `expect`.
7. **Acceptance criteria.** Checkable statements.
8. **Open questions.** Only things the design genuinely leaves open, each with a recommended answer.

Read the code you will extend before specifying against it, and cite `file:line`. Mark every factual claim about an external library or dataset as verified (file:line or a URL you fetched or queried) or inferred. Datasets can be queried live with `curl` against `https://data.sf.gov/resource/<id>.json?$select=...`. Keep each spec tight: aim for 2,000–4,000 words.

Return a ≤200-word summary listing:
- the file written;
- every interface concern;
- every open question;
- any tier-3/4 parameter you had to introduce.
