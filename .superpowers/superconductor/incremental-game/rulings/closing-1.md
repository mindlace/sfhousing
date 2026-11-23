# Ruling closing-1
Package commit: fc506543
Changes design: yes
Changes contract: no
## Ruling
Option A. closing rewrites comments that name removed things in every file, and that includes existing test files, test helpers and e2e specs. These comment rewrites are the only edits closing makes to an existing test file. No existing test is deleted, and no test's code or assertions change. The comment-only hits Task 1 found go in Task 5: header-actions.svelte.spec.ts, ProjectCardPanel.svelte.spec.ts, timeline/copy.spec.ts, routes/sim/page.spec.ts, the scenario engine and scenario-host specs, and e2e/fzp-sim.spec.ts and e2e/fzp.spec.ts. Task 1's comment edits in src/lib/sim/scenario/test/host-harness.ts and test/sim-map-stub.ts stand. A comment on the compatibility code the sweep allows stays as it is. A hit that is outside a comment, in code or test code, is still reported to its owner unit and left alone. Where a rewritten comment sits under a path in PATHS, the fixture rule of § sec-design-finish applies.
## Re-read
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-design-leftovers
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-design-sweep
- docs/superpowers/specs/2026-11-22-closing-design.html § sec-tests-verify
## Affected units
- closing: clarification
## Build graph
- closing
