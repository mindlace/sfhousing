# Plan Sharing W6c Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make the e2e plan-row seeding race-free, turn scoreboard's share-link W6 fixme into a real test, and stop the NoticeStack from overlapping map chrome.

**Architecture:** Seed rows through the preview worker's own D1 binding with an e2e-only API route. The route is gated on `VITE_E2E === '1'` AND `ENVIRONMENT === 'development'`, and returns 404 otherwise. This replaces the out-of-process `wrangler d1 execute --local` write, which fights the running preview for the SQLite lock. Fix the NoticeStack against the W6b layout, where the brush bar, score bar and sheet are absolute inside `#map-region`.

**Tech Stack:** SvelteKit 2, Svelte 5, Tailwind 4, Playwright, D1 via Drizzle.

**Spec:** `docs/superpowers/specs/2026-10-10-plan-sharing-design.md` (§4.5 notices, §4.8 copy, §6 e2e). For Task 2: `docs/superpowers/specs/2026-10-10-scoreboard-design.md` §6 E2E item 3 and the "old plan" row (line 165).

## Global Constraints

- Base: integration `superconductor/sf-housing-sim` @ 1bcd6a1 (includes the W6b layout pass). Branch `plan-sharing-w6`.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns. `npm run lint` and `npm run check` must pass.
- Never add `unsafe-eval` to the CSP. No real network: local D1 only, no `--remote`, no deploys.
- Before Playwright, kill any stale :4173 server: `lsof -ti :4173 | xargs kill`. The e2e build sets `VITE_E2E=1` and the preview runs with `ENVIRONMENT=development`. Afterwards leave no wrangler/workerd processes from this worktree running.
- Conventional Commits. No heredoc messages. Never compound `cd … && …`. Never push.
- Cross-owner grant: `e2e/scoreboard.spec.ts` may be edited for the one "recalculated" W6 fixme only, in its own commit. Do not touch map-view's W6 fixmes.
- Below 640 px, popovers and status lines keep 60 px of clearance on the right for map-view's compact attribution button (W6b rule).

## Review Focus

1. The e2e seed route must be unreachable in production: a non-E2E build, or any ENVIRONMENT other than development, returns 404, and the code is dead-code-eliminated when `VITE_E2E !== '1'`.
2. Parallel share specs no longer flake: `--repeat-each=5` on the share specs plus `e2e/layout.spec.ts` passes with no SQLITE_BUSY.
3. Notices never cover the brush toolbar, scoreboard panel top, SimMap chips or the attribution button at 1024×768 and 375×812.

---

### Task 1: e2e-only plan seed route replaces the wrangler subprocess write

**Files:**
- Create: `src/routes/api/e2e/plans/+server.ts`. The logic lives in `src/lib/server/sharing/e2e-seed.ts`, because SvelteKit forbids non-verb exports from `+server.ts`.
- Test: `src/lib/server/sharing/e2e-seed.spec.ts` (server project, using `createTestD1`/`testPlatform`).
- Modify: `e2e/helpers/sharing.ts`. Replace `insertPlanRowLocal(body)` with `async seedPlanRow(request: APIRequestContext, opts: { body: string; datasetVersion?: string }): Promise<string>`, which POSTs to the route. Delete the subprocess helper and its retry (the 6ea27b8 change).
- Modify: the callers in `e2e/share-states.spec.ts`.
- Modify: `docs/dev/plan-sharing.md` testing section (describe the route and why).

**Interfaces:**
- Produces: `POST /api/e2e/plans` with body `{ body: string; datasetVersion?: string }`. It inserts a raw row with no parsePlan, so unparsable bodies are allowed, then returns 201 `{ id }`. Column values:
  - `id`: `newPlanId()`;
  - `content_hash`: `sha256Hex(body)` (unique);
  - `dataset_version`: the given value or `'fixture-0000'`;
  - `schema`: 1;
  - `op_count`: the parsed ops length if parseable, else 0;
  - `byte_size`: UTF-8 length;
  - `created_at`: `Date.UTC(2026, 9, 1)`.
- Gate: `import.meta.env.VITE_E2E !== '1' || platform.env.ENVIRONMENT !== 'development'` → 404 (`shareError(404,'not_found')`). Put the VITE_E2E check first so the rest is dead code in a normal build.
- Produces (e2e): `seedPlanRow(request, { body, datasetVersion? })`.

Steps:
- [ ] Write failing unit tests:
  - inserts a raw unparsable body and returns 201 with an id matching `PLAN_ID_RE`;
  - honours `datasetVersion`;
  - ENVIRONMENT production → 404 with no DB call;
  - `VITE_E2E` unset → 404. Stub it with `vi.stubEnv('VITE_E2E', …)` or an injectable flag; prefer passing `e2eEnabled: boolean` into the handler from the route adapter.
  Run and confirm FAIL.
- [ ] Implement. Run and confirm PASS. Run `npm run check` and `npm run lint`.
- [ ] Switch the e2e helper and callers. Verify a production `npm run build` bundle does not contain the seed logic: grep `.svelte-kit/output/server` for a unique string from `e2e-seed.ts` after a plain `npm run build` with no VITE_E2E, and expect no match. If the route chunk still exists, it must only contain the 404 branch.
- [ ] Prove the fix: kill :4173, then run `npx playwright test e2e/share-states.spec.ts e2e/share-roundtrip.spec.ts e2e/share-a11y.spec.ts e2e/layout.spec.ts --repeat-each=5`. It must be green. Record the counts.
- [ ] Commit: `test(sharing): seed e2e plan rows through the preview's own D1 binding`. The body says this replaces 6ea27b8's retry and why.

### Task 2: scoreboard's "recalculated" share-link test (cross-owner, one test, own commit)

**Files:** Modify `e2e/scoreboard.spec.ts`: only the `test.fixme('W6: needs plan-sharing share links …')`.

Behaviour (scoreboard spec §6 E2E 3):
- Seed a row with `seedPlanRow(request, { body: <small.json with datasetVersion 'fixture-0000'>, datasetVersion: 'fixture-0000' })`. Use `src/lib/sharing/fixtures/plans/old-version.json`.
- Open `/p/<id>` and wait for map ready.
- The scoreboard region footnote shows "plan made on data fixture-0000, recalculated on current data".
- A share link whose plan version exists (`fixture-0`, posted via `POST /api/plans` with small.json) shows no "recalculated" text.
- Use the existing helpers in that file (`region`, `gotoEditor` patterns). On mobile the footnote may be inside the sheet. Keep the test in the describe block it already sits in (desktop) unless the spec requires both.

Steps:
- [ ] Replace the fixme with the real test.
- [ ] Run `npx playwright test e2e/scoreboard.spec.ts` (kill :4173 first) until green.
- [ ] Commit alone: `test(scoreboard): share link with an absent dataset shows "recalculated"`, with body line "Cross-owner edit granted by the conductor (W6c)".

### Task 3: NoticeStack placement against the W6b layout

**Files:**
- Modify: `src/lib/sharing/NoticeStack.svelte` (placement classes and comment only, unless the layout needs a prop).
- Test: new `e2e/share-notices.spec.ts`.

Requirements:
- At 1024×768 (desktop project, viewport override) and 375×812 (mobile project), with N3 showing, the notice box must not intersect:
  - the brush toolbar (`.brush-toolbar`);
  - the scoreboard panel / score bar top;
  - map-view's chips (the failure chips: force one with `page.route` aborting the fixture chunk, as scoreboard.spec does);
  - map-view's attribution button.
- Make N3 show by seeding localStorage `sfhousing:plan:v1` before load (`page.addInitScript`) with a record whose plan datasetVersion is `fixture-0000`, `v:1`, and a small plan. Restore then rebases it and shows N3.
- Assert with bounding-box non-intersection (and/or `elementFromPoint` at the notice's corners returning a node inside the notice). Also cover the remix toast if cheap, since it uses the same stack.
- Placement must be decided from the settled DOM. Read W6b's layout (src/routes/+page.svelte, BrushToolbar.svelte, Scoreboard*.svelte, SimMap chips, attribution button, `docs/dev/accessibility.md`) and pick a slot that is free at every width from 375 to 1440. Keep the always-mounted `role="status"` container and `pointer-events-none` wrapper. Keep 60 px right clearance below 640 px. At 375 px the text must still wrap without horizontal scroll.
- Add a 1440×900 check as well if the slot changes at xl.

Steps:
- [ ] Write the e2e and run it against the current code to show it fails (record which element overlaps).
- [ ] Fix the placement. Run `npx vitest --run --project client src/lib/sharing/NoticeStack.svelte.spec.ts` and the new e2e on both projects, then `npm run check` and `npm run lint`.
- [ ] Commit: `fix(sharing): keep notices clear of map chrome at every width`.

### Final verification (after all tasks)

`npm run check`, `npm run lint`, `npm run test:unit`, `npm run test:pipeline`, full `npm run test:e2e` (kill :4173 first), and the share specs `--repeat-each=5`.
