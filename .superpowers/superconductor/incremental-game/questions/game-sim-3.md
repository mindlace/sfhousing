# Question game-sim-3 — from incremental-game-game-sim
## Question
`e2e/sim-funding.spec.ts` test "8. a published policy lists its public money" finds the bond's bar by the pool's label "Housing bond". The spec now makes a given measure's policy label the preset's label, "A housing bond". The test needs a one-line change in a file outside game-sim's write set. Who makes that change? May game-sim edit `e2e/sim-funding.spec.ts:557` to find the bar by the policy's label (`/, A housing bond, /`)?

## What the package says
- Game-sim spec §sec-design-given (spec line 266): "Every money policy that `addPolicy` makes from a funding preset carries the preset's id in `preset` and the preset's label as its label."
- Spec line 506: `addPolicy` of a money preset sets "`label` to the preset's label (`FundingPreset.label`)".
- Spec line 510 gives the published body example `"label": "A housing bond"`.
- The game-sim write set (§sec-write-set-files) does not include `e2e/sim-funding.spec.ts`.

## What I found
- The housing-bond preset's label is 'A housing bond', and its pool's label is 'Housing bond' (verified-at `src/lib/sim-page/funding-presets.ts:248-252`).
- Task 2 (commit 51a0f276) makes `addPolicy` set the policy label to the preset's label, as the spec requires. Before that commit the bond policy carried the pool's label.
- A span bar's accessible name is built from the policy's label (verified-at `src/lib/timeline/SpanBar.svelte:172`: `barLabel(settingOf(span.what), policyLabel, …)`).
- The test looks for a bar named after the pool's label: `getByRole('button', { name: new RegExp(`, ${esc(pool.label)}, `) }).last()` (verified-at `e2e/sim-funding.spec.ts:556-559`). With the policy label now "A housing bond", the name holds ", A housing bond, ", and the regex ", Housing bond, " (case-sensitive) never matches. That is the reported failure at :559.
- `/s/<id>` behaves as the spec says: the published policy opens, runs, and "Public money" shows its 2 policies. Only the locator misses. Unverified at runtime by me; the conductor's run output is consistent (fixrounds/game-sim-4efdebea.txt lines 13, 41, 69, 97).
- The last change to `e2e/sim-funding.spec.ts` was finite-funding (df556eab).

## Options I see
1. Game-sim edits `e2e/sim-funding.spec.ts:557` to match the policy's label: `/, A housing bond, /`, or the label read from the document. The write set grows by that one line. (Recommended: smallest change, and the spec decides the label.)
2. The owner of `e2e/sim-funding.spec.ts` (finite-funding) makes the same edit.
3. The spec drops the label rule, and the policy keeps the pool's label. That contradicts spec lines 266, 506 and 510.

## Blocking
game-sim's merge, which fails only on this e2e test. Nothing else in the unit waits on it.
