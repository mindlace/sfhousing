# Ruling conductor-14
Package commit: 004ddfa3
Changes design: yes
Changes contract: no
## Ruling
- Both failures are races in the tests. Neither is in a page, and `game-shell` fixes both in a fix round. It owns the cases: they are remix tests in its write set. `e2e/helpers/sharing.ts` does not change.
- `e2e/share-states.spec.ts` N6 ("a share link whose dataset version is gone renders on the current data") runs on the open game, because it seeds no game. In the open game `/p/<id>`'s Remix state is `null` once the page has mounted, so the banner shows no Remix and no "Open with current data" button (game-shell § sec-design-remix). Until the page mounts, the banner shows Remix as ready. The case passes only when its `toBeVisible` sees the server-rendered button before hydration removes it. The page behaves as the spec says. The case is a remix test (the button follows the Remix state), so it calls `seedGame(page, 3)` before navigating, waits for `html[data-hydrated]`, and then asserts the button.
- `e2e/game-shell.spec.ts:138`, and `share-states`' Remix-over-local-work case (`:154`), poll the brush hook (`ops`) right after `toHaveURL(/\/$/)`. Remix loads `/` in full. The URL matches when the new document commits, before Paint has mounted and set `window.__sfhBrush`. Under load the poll times out on `undefined.ops`. Each case calls `waitForMap(page)` after the URL check, as `share-notices.spec.ts:236` already does.
- The rule, now in game-shell § sec-tests-e2e: each e2e case waits for the page's readiness signal before it reads a game-dependent control or a test hook. A case that reads the banner's Remix state first waits for `html[data-hydrated]`. A case that reads the brush hook after a Remix's full load first calls `waitForMap`. game-shell's write set names its remix tests as every case that asserts the banner's Remix or "Open with current data" button.
- The fix is proved with retries off: `--repeat-each=5 --retries=0` on the changed cases, which matches signoff's burn-in.
## Re-read
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-tests-e2e
- docs/superpowers/specs/2026-11-22-game-shell-design.html § sec-write-set
- docs/superpowers/design/2026-11-22-1216-incremental-game.html § sec-write-sets
## Affected units
- game-shell: clarification
## Build graph
- game-shell
