# Question conductor-14 — from incremental-game-conductor
## Question
Two e2e tests in the shared-pages area that `game-shell` changed have each failed once and passed on Playwright's retry on the integration branch. Are they races in the tests or helpers (and who fixes them), or in the pages?
## What the package says
`game-shell` writes `src/routes/s/[id]/**`, `src/routes/p/[id]/**`, `src/lib/sharing/**`, `e2e/game-shell.spec.ts` and the remix tests of `e2e/{share-states,share-roundtrip,share-notices,sim-share,chrome-dark}.spec.ts`. Project rule (CLAUDE.md, docs/dev/testing.md): signoff files a test that fails then passes on retry as a flake, and burn-in reruns changed specs with retries off.
## What I found
Testimony of the test-run agents on the integration branch (logs were in a session scratchpad, not kept in the package); the machine was heavily loaded by other sessions in both runs:
- Suite at c0079aeb (after game-shell @ 7bd6f1cb and game-save @ 67739d50 merged): `e2e/share-states.spec.ts:157` "N6: a share link whose dataset version is gone renders on the current data": `expect(locator).toBeVisible()` failed for `getByRole('button', { name: 'Open with current data' })` inside the 'Shared plan' region; passed on retry.
- Suite at 64413ada (after finite-funding @ df556eab merged): `e2e/game-shell.spec.ts:117` "at level 1 /p/<id>'s Remix opens Paint on the published plan, listed in the level panel": `page.evaluate: TypeError: Cannot read properties of undefined (reading 'ops')` from `ops` at `e2e/helpers/sharing.ts:208`, called at `game-shell.spec.ts:138`; passed on retry.
- Neither test flaked in the suites run before game-shell merged. game-shell's own report: e2e/game-shell.spec.ts 50/50 at --repeat-each=5 on its branch.
## Options I see
- Test races: each case waits on a readiness signal (`html[data-hydrated]`, the page's test hook) before it reads or acts; `game-shell` fixes both in a fix round (it owns `game-shell.spec.ts` and the remix tests; the ruling says who owns `share-states.spec.ts:157` and `e2e/helpers/sharing.ts`).
- A page race (the page shows its controls or exposes its hook later than it should after the game store loads): the ruling names the page behaviour and the owner.
## Blocking
No task now. `closing`'s signoff.
