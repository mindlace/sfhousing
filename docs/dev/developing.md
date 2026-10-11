# Developing

## Setup

```bash
nvm use                 # Node 24
npm install             # prepare: husky, `wrangler types --strict-vars=false`, `svelte-kit sync`
npm run data:fixture
npm run db:migrate
npm run dev
```

- `wrangler types --strict-vars=false` makes `wrangler.jsonc` vars type as `string` (not string literals), so `PUBLIC_DATASET_VERSION` can be overridden. `worker-configuration.d.ts` is generated and gitignored; `npm run types` regenerates it.
- `.npmrc` sets `legacy-peer-deps=true` because the drizzle release candidates declare an optional `effect` peer. The lockfile pins `drizzle-orm` 1.0.0-rc.4-5d5b77c and `drizzle-kit` 1.0.0-rc.4-ca0f029 (the versions planafoot resolves) while `package.json` keeps caret ranges. Do not run a blind `npm update` on drizzle; bump both deliberately and re-run `npm run db:generate` to check.
- `@types/node` is a devDependency so the `scripts/*.ts` files (run with `tsx`) type-check.

## `.dev.vars`

`.dev.vars` is gitignored and read by the local worker. Use it to point local dev at a different dataset version than the one in `wrangler.jsonc`:

```
PUBLIC_DATASET_VERSION=2026-10-10-0123abcd
```

The version must exist in local R2 (see below). e2e builds set `PUBLIC_DATASET_VERSION=fixture-0` on the command line instead.

## Local data

- `npm run data:fixture` loads `e2e/fixtures/data/fixture-0/` into local R2 under `data/fixture-0/`. Today this is a platform placeholder; the data-pipeline's `pipeline fixture` command will overwrite it under the same version name.
- `npm run data:local -- <version> [--from <origin>]` fetches `<origin>/data/<version>/manifest.json` (default origin `https://sfhousing.mindlace.net`), then every URL the manifest names, and writes each into local R2. Glyphs are not fetched (the manifest names a template, not files). Needs no credentials.

Both write to the Miniflare R2 state in `.wrangler/`; delete that directory to reset local state.

## Migrations

1. Edit `src/lib/server/db/schema/` (the index re-exports tables).
2. `npm run db:generate` (generate → classify → flatten into `migrations/d1`).
3. `npm run db:migrate`.

Never hand-edit files in `migrations/`. CI applies migrations to remote D1 before each deploy.

## Header actions

The header has a right-aligned slot pages can fill. The root layout calls `provideHeaderActions()` once; a page calls `useHeaderActions(snippet)` (both from `$lib/shell/header-actions.svelte`) during component init. The snippet is shown while the page is mounted and cleared on destroy.
