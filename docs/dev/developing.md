# Developing

## Setup

```bash
nvm use                 # Node 24
npm install             # prepare: husky, `wrangler types --strict-vars=false`, `svelte-kit sync`
npx playwright install chromium   # needed by `npm run test:unit` (client project) and `test:e2e`; the one download beyond npm
echo 'PUBLIC_DATASET_VERSION=fixture-0' > .dev.vars   # local dev uses the fixture, see below
npm run data:fixture
npm run db:migrate
npm run dev
```

- `wrangler types --strict-vars=false` makes `wrangler.jsonc` vars type as `string` (not string literals), so `PUBLIC_DATASET_VERSION` can be overridden. `worker-configuration.d.ts` is generated and gitignored; `npm run types` regenerates it.
- `.npmrc` sets `legacy-peer-deps=true` because the drizzle release candidates declare an optional `effect` peer. The lockfile pins `drizzle-orm` 1.0.0-rc.4-5d5b77c and `drizzle-kit` 1.0.0-rc.4-ca0f029 (the versions planafoot resolves) while `package.json` keeps caret ranges. Do not run a blind `npm update` on drizzle; bump both deliberately and re-run `npm run db:generate` to check.
- `@types/node` is a devDependency so the `scripts/*.ts` files (run with `tsx`) type-check.

## `.dev.vars`

`.dev.vars` is gitignored and read by the local worker (`wrangler dev` and `vite dev` via the adapter's platform proxy). Both otherwise use the top-level `wrangler.jsonc` vars, and `PUBLIC_DATASET_VERSION` there is the real production dataset, which is not in local R2 unless you copy it (`npm run data:local -- <version>`). For day-to-day local dev on the fixture, create `.dev.vars` with:

```
PUBLIC_DATASET_VERSION=fixture-0
```

and run `npm run data:fixture`. Without it, the app requests the production version from local R2 and the map's data loads 404; there is deliberately no code fallback (a missing or malformed value is a 500). e2e builds set `PUBLIC_DATASET_VERSION=fixture-0` on the command line instead, so they do not depend on `.dev.vars`.

## Local data

- `npm run data:fixture` loads `e2e/fixtures/data/fixture-0/` into local R2 under `data/fixture-0/`. Today this is a platform placeholder; the data-pipeline's `pipeline fixture` command will overwrite it under the same version name.
- `npm run data:local -- <version> [--from <origin>]` fetches `<origin>/data/<version>/manifest.json` (default origin `https://sfhousing.mindlace.net`), then every URL the manifest names, and writes each into local R2. Glyphs are not fetched (the manifest names a template, not files). Needs no credentials.

Both write to the Miniflare R2 state in `.wrangler/`; delete that directory to reset local state.

## Migrations

1. Edit `src/lib/server/db/schema/` (the index re-exports tables).
2. `npm run db:generate` (generate → classify → flatten into `migrations/d1`).
3. `npm run db:migrate`.

Never hand-edit files in `migrations/`. CI applies migrations to remote D1 before each deploy.

## Signoff

`npm run signoff` runs the local gate with chreode: it merges `origin/main`, runs the checks the changes since the last signoff need (`chreode.config.ts`), pushes, and posts the `chreode/signoff` status that branch protection requires; `npm run signoff -- --dry-run` prints the plan without running it. See [deploy.md](deploy.md).

## Header actions

The header has a right-aligned slot pages can fill. The root layout calls `provideHeaderActions()` once; a page calls `useHeaderActions(snippet)` (both from `$lib/shell/header-actions.svelte`) during component init. The snippet is shown while the page is mounted and cleared on destroy. The snippet is registered during page init, so it is not present in SSR HTML: header actions appear after hydration.
