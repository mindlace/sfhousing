# Ruling conductor-12
Package commit: 5b08a7ae
Changes design: yes
Changes contract: no
## Ruling
The store is right and stays as G2 and `game-core` § sec-design-store-construct give it. It reads storage once, in the root layout's init, and when `current` names no entry it makes a new level 1 game current and rewrites the index. The flake is a race in the test. `e2e/game-helpers.spec.ts` "a stored index is never overwritten" loads `/about` and then changes storage at once, without waiting for the page. When that change lands before the root layout's script has run, the store reads the broken index and repairs it on the first load. The next load's probe then sees a generated `current` in place of `'other'`.

- Every e2e case that changes storage after a load first waits for `html[data-hydrated]`. The store has read storage by then, because the layout's init runs before the layout's `onMount` sets the mark. So the case's change is what the next load's probe reads. This holds in `e2e/game-helpers.spec.ts` ("the seed is written once" and "a stored index is never overwritten") and in `e2e/game-core.spec.ts`, which already waits.
- The cases keep their assertions. The probe reads storage before the page's scripts run, and the helper's init script leaves a stored index alone, so after the reload `current` is still `'other'` and the removed save is still absent. The store's repair on that reload happens after the probe and is `game-core`'s own e2e case.
- `game-core` owns `e2e/game-helpers.spec.ts` once `contracts` has written it. It adds the hydration wait to the cases that change storage after a load, in its open fix round, and changes nothing else in the file. X1 and the helpers are unchanged.
## Re-read
- docs/superpowers/specs/2026-11-22-contracts-design.html § sec-tests (e2e/game-helpers.spec.ts)
- docs/superpowers/specs/2026-11-22-game-core-design.html § sec-write-set, sec-tests (E2E)
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets (tbl-write-sets row game-core)
## Affected units
- game-core: clarification
## Build graph
- game-core
