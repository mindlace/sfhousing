# Question game-sim-1 — from incremental-game-game-sim
## Question
Removing the Remix hand-off from `/sim` (required by game-sim) turns a component test outside game-sim's write set red: `src/routes/s/[id]/page.view.svelte.spec.ts` case "after Remix, /sim shows the remixed document over the earlier v2 autosave". Who changes it, and is it allowed to be red between the game-sim and game-shell merges?

## What the package says
- game-sim spec line 661 (§sec-design-other): `/sim` takes no Remix hand-off; `restoreSim4` shows no Remix toast. Lines 719–721 (§sec-write-set-files) remove the hand-off from `session4.ts` and `SimPage.svelte.spec.ts`.
- game-sim spec line 815 (§sec-tests-existing): only the e2e remix tests in `e2e/{share-states,share-roundtrip,share-notices,sim-share,chrome-dark}.spec.ts` are named as red between the game-sim and game-shell merges ("nobody runs e2e until closing"). The Vitest component test is not named.
- game-sim spec line 861: Remix on `/s/<id>` and `/p/<id>` belongs to `game-shell`.

## What I found
- verified-at `src/routes/s/[id]/page.view.svelte.spec.ts:215-230`: the case clicks Remix, mounts `SimRoutePage` with the history state, and asserts `SIM.remixedToast('SD permits')` at `:229` and the remixed policy reaching `openTimeline` at `:228`. Both depend on the hand-off game-sim removes.
- Unlike e2e, `npm run test:unit` is run by every task; this case will fail on game-sim's branch from the task that removes the hand-off (plan Task 6) until game-shell rewrites it.
- Related, same class (unverified beyond the line): `src/app.d.ts:30` declares the `sfhSimRemix` page-state type, which nothing on `/sim` reads afterwards; outside game-sim's write set (closing's sweep covers unused types).
- Minor departure, noted for the record: `e2e/game-sim.spec.ts` needs "a seeded published policy" (spec line 807). The existing seeder `POST /api/e2e/plans` sits under `src/routes/api/e2e/**`, written by `remove-multiuser`; the plan publishes the policies through the page in a second browser context instead.

## Options I see
1. Add `src/routes/s/[id]/page.view.svelte.spec.ts` (that case only) to game-sim's write set: delete the case, since the hand-off it tests no longer exists; game-shell writes its own Remix-to-saved-game test.
2. Leave it red on game-sim's branch until game-shell merges (extend line 815's red list to it); reviewers and the conductor's merge accept that one failing unit case.
3. Give the case to game-shell now and order game-sim's merge after game-shell's rewrite.

I lean to 1: it keeps every unit's branch green under `test:unit`.

## Blocking
Plan Task 6 (No Remix hand-off on /sim) — its verification step runs the unit suite. Tasks 1–5 and 7–9 are not blocked.
