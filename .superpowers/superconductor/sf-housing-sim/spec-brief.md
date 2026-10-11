# Spec-derivation brief (shared by all spec agents)

Source of truth: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md` (approved). Read it fully first.

Write one spec per assigned subsystem at
`docs/superpowers/specs/2026-10-10-<slug>-design.md` in the worktree
`/Users/mindlace/Projects/sfhousing/.claude/worktrees/composition`. Do NOT commit; do NOT write any product code.

Each spec MUST contain, in order:
1. **Scope** — the subsystem row from the design, then a precise in/out list.
2. **Interfaces** — copy every interface-table row (I-numbers) this subsystem owns or consumes **verbatim** (signature text identical, including MC/DC mark). Any new internal type you introduce goes in a separate "Internal types" list and must not alter an I-row. If an I-row seems wrong or insufficient, do NOT change it — add it to an "Interface concerns" section for the orchestrator.
3. **Global constraints** — copy the design's Global constraints section verbatim.
4. **Behaviour** — decide every behaviour whose consequences are visible outside the module (UI states, error states, numbers shown, file formats, URLs, timings, edge cases: empty plan, stroke over ineligible parcels, parcel chunk fails to load, plan from an older datasetVersion, overshoot >100%, etc.). Do not write "implementer decides" for anything externally visible. Internal-only choices may be left open but must be labelled as such.
5. **Seams** — for each deferred subsystem (M2–M5) that touches this one, state exactly what this spec does now so the seam stays open (and nothing more — YAGNI).
6. **Testing** — concrete test list (unit/property/golden/e2e), with fixtures named. Vitest server project for pure TS, client (Playwright browser) for DOM, Playwright e2e for cross-layer seams, axe gate on pages.
7. **Acceptance criteria** — checkable statements.
8. **Open questions** — only things the design genuinely leaves open; each with a recommended answer.

Reference repos (read for conventions where relevant; do not modify):
- `/Users/mindlace/Projects/planafoot` — CLAUDE.md, wrangler.jsonc, docs/dev/*.md, package.json, vitest configs, .github/workflows, packages/drizzle-cf-migrations.
- `/Users/mindlace/Projects/interplanetary` — module web worker pattern (src/lib/simulation/worker.ts), R2 asset route (src/routes/api/maps/[bodyId]/+server.ts).

Mark every factual claim about an external library/dataset/repo as verified (with file:line or URL) or inferred. Keep each spec tight: aim 1,500–3,000 words. Return a ≤200-word summary listing the file(s) written, interface concerns, and open questions.
