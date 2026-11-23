# Ruling pool-closing-1
Package commit: → lint-staged could not find any staged files matching configured tasks.
0af26e4b
Changes design: yes
Changes contract: no
## Ruling
`src/lib/fzp/MoneyResults.svelte.spec.ts` runs in the Vitest client project, where `expectNoA11yViolations` (which takes a Playwright `Page`, `e2e/helpers/a11y.ts`) cannot run. Its accessibility check runs axe-core directly: `axe.run` on the rendered money block, with the tags `expectNoA11yViolations` uses (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`), once in light and once in dark, with the colour scheme set through `Emulation.setEmulatedMedia` as `src/lib/map/key/MapKeyControl.svelte.spec.ts` does, and it expects no violation. The "ran out" lines are plain text, not controls. The global constraint on new controls is about controls, so no e2e check is added for them, and the unit's write set does not change.
## Re-read
- docs/superpowers/specs/2026-11-22-pool-closing-design.html § sec-tests-money
## Affected units
- pool-closing: clarification
## Build graph
- pool-closing
