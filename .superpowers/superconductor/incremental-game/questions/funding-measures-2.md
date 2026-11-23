# Question funding-measures-2 — from incremental-game-funding-measures
## Question
game-sim's client test `src/lib/timeline/Inspector.svelte.spec.ts:526` ("Inspector under what the level allows > a given measure at level 5") asserts that a given measure's What section contains "No transit layers". funding-measures' money-only summary (spec §sec-design-summary) removes that line for a money-only policy, so the test fails on my branch. The file is outside my write set. Who changes it, and to what?

## What the package says
- funding-measures spec §sec-design-summary: a money-only policy's read-only summary lists only what it pays and when (the money-only rule). Spec line ~203 (§sec-today, describing the code before this build): "PolicySummary always renders five sections, so a money span's summary also says 'No transit layers', 'No painted areas', 'None' …" — the behaviour this unit replaces.
- funding-measures §sec-tests-e2e test 8 (as built in e2e/sim-funding.spec.ts): the published view's editor for a given measure holds the "Public money" region and no heading "Transit layers".
- game-sim spec: no mention of "transit layers" (grep of docs/superpowers/specs/2026-11-22-game-sim-design.html, verified 2026-11-23); the assertion is incidental to its intent ("What is the summary: no funding editor", Inspector.svelte.spec.ts:520).

## What I found
- Full test:unit at be38634b (my branch with integration 3b98a944 merged): 9243 passed, 1 failed — exactly this assertion: `expected 'What  Public money Affordable homes: … Housing bond: $410 million in October 2027; …' to contain 'No transit layers'` (Inspector.svelte.spec.ts:526).
- The other assertions of that test (switch, Move, Remove, From year edit reaching the store, no [data-funding-editor], "Public money" present) pass.
- Money-only summary built in Task 7 (commit 15d7d161, src/lib/sim-page/PolicySummary.svelte, funding-view.ts moneyOnly), reviewed and approved against §sec-design-summary.

## Options I see
A. (Recommended) Rule that Inspector.svelte.spec.ts:526 becomes `expect(whatSection.textContent).not.toContain('No transit layers');` (or is deleted), and let funding-measures make that one-line edit in this branch; whichever unit merges second keeps it.
B. game-sim changes the line on the integration branch; I merge it.
C. Revert the money-only rule (contradicts §sec-design-summary and e2e test 8).

## Blocking
Only the `complete` message (the conductor asked for complete at a commit where the full suite passes). All nine plan tasks have passed review; the final whole-branch review is running.
