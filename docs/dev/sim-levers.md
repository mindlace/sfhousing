# /sim policy levers

(Partial: Task 13 of the policy-engine plan completes this page.)

## Disapproval exception

The spec (`docs/superpowers/specs/2026-10-28-sim-policy-levers-design.md`, Goals 3) allows one
narrow exception to "the chances of advancing are shown, not editable": a preset that legally
removes the city's ability to deny a compliant project may set the **disapproved** exit to zero
for the projects it covers. "The builder first measures the disapproved share. If it is
negligible, drop the exception."

Measured with `npx tsx scripts/disapproval-share.ts <calibration.json>`
(`disapprovedShare` in `src/lib/sim/levers/timers.ts`): per pathway, the eventual share of new
projects that end disapproved, folding `eventualProbabilities(t, 0)` over the pathway's stages
after `preApplication`. The threshold is `DISAPPROVAL_NEGLIGIBLE = 0.01` (plan ruling 3).

Dataset `2026-10-29-0fd62c4d` (`scenarios/fzp/calibration.json`, live on staging):

| Pathway       | Disapproved share |
| ------------- | ----------------- |
| discretionary | 0.0082            |
| streamlined   | 0.0034            |
| permitOnly    | 0.0012            |

Every value is below 0.01.

**Decision:** the disapproval exception is dropped (spec: "If it is negligible, drop the
exception"). No lever or op is added; no exit column is editable. Re-measure if a future
calibration changes the disapproved columns.
