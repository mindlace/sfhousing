# Question conductor-12 — from incremental-game-conductor
## Question
`e2e/game-helpers.spec.ts:146` ("a stored index is never overwritten", written by `contracts` for X1) is flaky on the integration branch now that game-core's store is built: which unit owns making it deterministic, and what does the test assert once the real store runs on the page?
## What the package says
X1 (`src/lib/game/e2e.ts`, `e2e/helpers/game.ts`) is built working by `contracts`; `game-core` deletes `contracts.spec.ts` and `contracts.svelte.spec.ts` and writes `src/lib/game/**`; no row says who keeps `e2e/game-helpers.spec.ts` true once the store exists.
## What I found
- Suite on the integration branch at 94d4bab8 (contracts, game-core rows G1 to G5 and remove-multiuser merged): the test failed once in chromium, expecting `other` and receiving a generated id (`ChKDCZLmF11mfwBQdkqfG`) at line 161, and passed on Playwright's retry (testimony of the test-run agent; log `e2e.log` of that run, not kept in the package). It did not flake in the runs before game-core's G2 merged.
- `contracts`' completion report listed as a deferred minor: "a stored index is never overwritten" assumes game-core's store never rewrites the saves index on unload (testimony).
- Signoff files a test that fails then passes on retry as a flake and burn-in reruns changed specs with retries off (project memory, testimony), so `closing` cannot finish while this stands.
## Options I see
- The helper or the test waits on the store's own readiness signal before reading storage; the ruling names the owner (`game-core`, which owns the store, or `closing`).
- The store's behaviour on load or unload is what is wrong against G2, and `game-core` fixes it.
## Blocking
No task now. `closing`'s signoff.
