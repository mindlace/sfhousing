# Question pool-closing-1 — from incremental-game-pool-closing
## Question
The spec's Details test asks a Vitest component spec to pass `expectNoA11yViolations` in light and dark, but that helper takes a Playwright `Page` and cannot run in the Vitest client project. Which accessibility check does `src/lib/fzp/MoneyResults.svelte.spec.ts` run?

## What the package says
`docs/superpowers/specs/2026-11-22-pool-closing-design.html` §sec-tests-money: "`src/lib/fzp/MoneyResults.svelte.spec.ts` (new): ... light and dark pass `expectNoA11yViolations`." Global constraints: "every new control ... passes `expectNoA11yViolations` in light and dark." The write set names only the Vitest spec file for this UI (no e2e file).

## What I found
- `expectNoA11yViolations` takes a Playwright `Page` — verified-at `e2e/helpers/a11y.ts:48` (plan drafter's reading; I have not re-opened it).
- An existing Vitest client spec runs axe-core directly with the AA tags and emulates light/dark through CDP — `src/lib/map/key/MapKeyControl.svelte.spec.ts:18-22, 443-458` (drafter's reading, unverified by me).
- The new lines are plain `p` elements, not controls.

## Options I see
A. Run axe-core in the Vitest spec with the same WCAG 2.0/2.1/2.2 A+AA tags as `expectNoA11yViolations`, light and dark via `Emulation.setEmulatedMedia`, as `MapKeyControl.svelte.spec.ts` does. (Recommended; stays in the write set.)
B. Add an e2e check with the real helper — needs an e2e file outside this unit's write set and a page state with a closed pool.
C. Drop the a11y assertion for these lines (they are text, not controls).

## Blocking
Plan `docs/superpowers/plans/2026-11-22-pool-closing.html` Task 6, step t6-s2 only. Every other task proceeds.
