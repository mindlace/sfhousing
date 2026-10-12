# Testing

## Vitest

`npm run test:unit` runs two projects (`vite.config.ts`):

- **server** (Node): `src/**/*.{test,spec}.ts` and `scripts/**/*.spec.ts`, excluding `*.svelte.{test,spec}.ts`.
- **client** (browser via Playwright, `vite.config.client-test.ts`): component tests named `*.svelte.spec.ts`, importing `page` from `vitest/browser`. Positive roof GPU files run in the separately required gate below; the software project explicitly tests missing-capability fallback.

Test files are colocated with the code. `expect.requireAssertions` is on: every test must call `expect` (wrap `fc.assert` in `expect(() => ...).not.toThrow()`).

The client project needs the Playwright chromium browser: run `npx playwright install chromium` once (the one download beyond npm; `test:e2e` needs it too).

In the client project, `$app/state` and `$app/navigation` are aliased to small stubs in `src/test-stubs/app/` (kept outside `$lib`) so route component specs (e.g. `src/routes/page.svelte.spec.ts`) can render pages: specs set `page.state` and read `replaceStateCalls`. Other `$app/*` modules and `$env/*` have no alias and still need `vi.mock(...)`. `src/lib/sharing/**` must not import `$app/*` at all; an ESLint `no-restricted-imports` rule enforces it so the stubs can't hide such an import.

Single test: `npx vitest --run --project server path/to/file.spec.ts` (or `--project client`).

## FakeR2Bucket

`src/lib/server/test/fake-r2.ts` is an in-memory `R2Bucket` subset (`get` with `range`/`onlyIf` as `Headers`, `head`, `put`) for route tests. Options model both known R2 behaviours:

- `unsatisfiable: 'throw' | 'whole'`: past-the-end range throws (documented R2) or returns the whole object (local workerd).
- `suffixShape: 'resolved' | 'suffix'`: suffix ranges reported as `{offset, length}` (workerd) or `{suffix}`.

It is not a general R2 emulator. The Playwright e2e against workerd is the source of truth for R2 semantics; when they disagree, fix the fake.

## Playwright

`npm run test:e2e` (`playwright.config.ts`, `e2e/`): projects `chromium` (desktop) and `mobile` (375x812, touch). The `webServer` runs `npm run data:fixture && npm run db:migrate && npm run preview -- --var PUBLIC_DATASET_VERSION:fixture-0` on port 4173. It never reuses an existing server (a stale build from another worktree would silently test the wrong code), so Playwright fails if port 4173 is busy: free it first.

The `VITE_E2E=1` build adds the brush hook `window.__sfhBrush` (`src/lib/brush/debug.ts`: `ops`, `lastStats`, `ready`, `chunks`, and `load(plan)`, which loads through the editor `+page.svelte` received via BrushEditor's `oneditor`) beside map-view's `window.__sfhMap`, and the `sfh-brush-commit` performance measure (pointer-up to commit applied). In that build the sim worker retries a failed chunk after 50/100/200 ms instead of 1/4/16 s, so `e2e/brush.spec.ts` sees the Retry chip within seconds. The 500-parcel and whole-city budgets are not e2e: `src/lib/sim/host.bench.spec.ts` (server project, part of `test:unit`) fails above 100 ms for a ≈500-parcel commit diff and 5,000 ms for a whole-city load.

CI runs `npm run test:e2e -- --project=chromium --project=mobile`. Single spec: `npx playwright test e2e/data-route.spec.ts --project=chromium`.

## Required roof GPU gate

`npm run test:roofs:gpu` is required alongside `test:unit` and `test:e2e`. It runs:

- `npm run test:roofs:gpu:unit`: real indexed-layer rendering/picking, asynchronous program ownership, cancellation, source identity, cold fresh-source 50 ms task budget, cache/controller and SimMap integration (`vite.config.roof-gpu.ts`).
- `npm run test:roofs:gpu:e2e`: the original `e2e/roofs.spec.ts`, including held-first-mesh activation with the observer starting after MapLibre idle, the unchanged 50 ms ceiling, picking, zoom-out, artifact failures, saved plans, scoring and brush behavior (`playwright.roof-gpu.config.ts`). Runs desktop and mobile serially.

Both configurations hard-fail unless their queried context has `KHR_parallel_shader_compile` and reports a hardware renderer. They never skip unsupported hosts. On macOS the configurations select ANGLE Metal using Chromium's `--use-angle=metal` flag; elsewhere they use the browser default and still require the capability check. Set `ROOF_GPU_HEADED=1` for headed native verification. The fresh-source test requires real pending completion polls as well as successful drawing and no task over 50 ms, so a cached generic-program pass alone cannot satisfy the gate. These are correctness/cold-activation tests; Task 10's pan benchmark still requires headed hardware.

Default headless Chromium currently uses SwiftShader without this extension. `roof-fallback.svelte.spec.ts` explicitly asserts that absence and checks no roof shader/program/buffer allocation, no readiness, zero ownership and once-only finalization. `e2e/roof-fallback.spec.ts` verifies actual delivered meshes leave visible editable footprints, scores and saved plans unchanged, with zero final roof ownership. Positive roof tests are selected by the GPU configs instead of silently skipping them in software. If a browser update changes default capabilities, update this explicit matrix rather than weakening either assertion.

Hosted Ubuntu CI supplies software feedback only; a green software job does **not** prove supported roof activation. The required `local-ci/signoff` gate includes `test:roofs:gpu` after the ordinary suites and cannot post success when that gate fails or the host lacks the capability. Run signoff on a supported hardware host; a software-only runner leaves this acceptance pending. Use the individual test commands for local checks; plain signoff also merges/pushes/posts status.

## Fixture dataset

`e2e/fixtures/data/fixture-0/` is the one dataset every subsystem's e2e tests use; `npm run data:fixture` loads it into local R2. It is generated by `npm run pipeline -- fixture` (see [pipeline.md](pipeline.md)); do not edit it by hand. Its `README.md` is skipped by the loader.

## Accessibility

See [accessibility.md](accessibility.md).

`npm run signoff -- --verify-only` runs the full local gate (`check`, `lint`, `test:unit`, `test:e2e`, `test:roofs:gpu`) without merging, pushing or posting a status. Plain `npm run signoff` runs the same suite and then signs off the PR (see [deploy.md](deploy.md)).
