# Testing

## Vitest

`npm run test:unit` runs two projects (`vite.config.ts`):

- **server** (Node): `src/**/*.{test,spec}.ts` and `scripts/**/*.spec.ts`, excluding `*.svelte.{test,spec}.ts`.
- **client** (browser via Playwright, `vite.config.client-test.ts`): component tests named `*.svelte.spec.ts`, importing `page` from `vitest/browser`.

Test files are colocated with the code. `expect.requireAssertions` is on: every test must call `expect` (wrap `fc.assert` in `expect(() => ...).not.toThrow()`).

Single test: `npx vitest --run --project server path/to/file.spec.ts` (or `--project client`).

## FakeR2Bucket

`src/lib/server/test/fake-r2.ts` is an in-memory `R2Bucket` subset (`get` with `range`/`onlyIf` as `Headers`, `head`, `put`) for route tests. Options model both known R2 behaviours:

- `unsatisfiable: 'throw' | 'whole'`: past-the-end range throws (documented R2) or returns the whole object (local workerd).
- `suffixShape: 'resolved' | 'suffix'`: suffix ranges reported as `{offset, length}` (workerd) or `{suffix}`.

It is not a general R2 emulator. The Playwright e2e against workerd is the source of truth for R2 semantics; when they disagree, fix the fake.

## Playwright

`npm run test:e2e` (`playwright.config.ts`, `e2e/`): projects `chromium` (desktop) and `mobile` (375x812, touch). The `webServer` runs `npm run data:fixture && npm run db:migrate && npm run preview -- --var PUBLIC_DATASET_VERSION:fixture-0` on port 4173 and reuses an existing server outside CI. Free port 4173 if a previous run left a server behind.

CI runs `npm run test:e2e -- --project=chromium --project=mobile`. Single spec: `npx playwright test e2e/data-route.spec.ts --project=chromium`.

## Fixture dataset

`e2e/fixtures/data/fixture-0/` is the one dataset every subsystem's e2e tests use; `npm run data:fixture` loads it into local R2. It is currently a platform placeholder; data-pipeline's `pipeline fixture` overwrites it under the same `datasetVersion` (`fixture-0`). Its `README.md` is skipped by the loader.

## Accessibility

See [accessibility.md](accessibility.md).
