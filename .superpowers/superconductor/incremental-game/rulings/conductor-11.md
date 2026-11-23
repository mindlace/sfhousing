# Ruling conductor-11
Package commit: f688728b
Changes design: yes
Changes contract: no
## Ruling
The seam stands unchanged. `POST /api/e2e/plans` (`src/routes/api/e2e/plans/+server.ts`, logic in `src/lib/server/sharing/e2e-seed.ts`) and its helper `seedPlanRow` in `e2e/helpers/sharing.ts` already exist and seed published plan and policy rows. Six existing e2e specs use them. `remove-multiuser` owns `src/routes/api/e2e/**`, but it changes only `login` and `mail` there. The plans route, its seed module and the `plan` table it writes stay as they are, under the same gates (`VITE_E2E`, `isE2eEnv`). No unit in this build changes them. `game-shell`'s tests seed their published plans and policies with `seedPlanRow`. This needs no interface row and adds no build-graph edge: the seam is existing code that every unit leaves alone. The `remove-multiuser` spec (§ sec-design-e2e) and the `game-shell` spec (§ sec-tests-e2e) now say so.
## Re-read
- docs/superpowers/specs/2026-11-22-remove-multiuser-design.html § sec-design-e2e
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-tests-e2e
## Affected units
- remove-multiuser: clarification
- game-shell: clarification
## Build graph
- remove-multiuser
- game-shell
