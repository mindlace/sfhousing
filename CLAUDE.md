# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## What This Is

SF Housing Simulator: a free, open-source web tool for painting zoning and building changes onto a map of San Francisco and seeing the theoretical maximum buildout against housing targets. SvelteKit 2 + Svelte 5 (runes) + Tailwind 4 on a single Cloudflare Worker. Code is MIT; the data is open (ODbL / PDDL).

## Setup

```bash
nvm use                 # Node 24 (.nvmrc); engines require node >=22 <26, npm >=11.3.0
npm install             # also runs `wrangler types --strict-vars=false` and `svelte-kit sync` via prepare
npx playwright install chromium   # browser for client tests and e2e (the one download beyond npm)
npm run data:fixture    # load the fixture dataset (fixture-0) into local R2
npm run db:migrate      # apply D1 migrations to the local database
npm run dev
```

If you see type errors about `worker-configuration`, run `npm run types`.

`.npmrc` sets `legacy-peer-deps=true` (the drizzle release candidates declare an optional `effect` peer). The lockfile pins `drizzle-orm` 1.0.0-rc.4-5d5b77c and `drizzle-kit` 1.0.0-rc.4-ca0f029 while `package.json` keeps caret ranges: do not run a blind `npm update` on drizzle.

## Scoped reference docs

Fetch the file when working in the relevant area:

- **Developer workflow (setup, `.dev.vars`, `data:fixture`/`data:local`, migrations, header actions)** — [docs/dev/developing.md](docs/dev/developing.md)
- **Deployment (environments, release flow, promoting a datasetVersion, bootstrap checklist)** — [docs/dev/deploy.md](docs/dev/deploy.md)
- **Data serving (`/data/<version>/*` route contract, key layout, caching, path rules)** — [docs/dev/data-serving.md](docs/dev/data-serving.md)
- **Testing (Vitest projects, `FakeR2Bucket`, Playwright, fixture dataset)** — [docs/dev/testing.md](docs/dev/testing.md)
- **Accessibility (WCAG 2.2 AA, `expectNoA11yViolations`, per-page checklist)** — [docs/dev/accessibility.md](docs/dev/accessibility.md)
- **Design, specs and plans** — `docs/superpowers/design/`, `docs/superpowers/specs/`, `docs/superpowers/plans/`

Subsystems add their own docs here (`plan-sharing.md`, `pipeline.md`) and link them from this list.

## Commands

| Command                                             | Purpose                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`                                       | Vite dev server (local D1/R2 via adapter-cloudflare's platform proxy)             |
| `npm run build`                                     | Production build                                                                  |
| `npm run preview`                                   | Build, then `wrangler dev` on port 4173 with `ENVIRONMENT=development`            |
| `npm run check`                                     | `svelte-kit sync` + `svelte-check`                                                |
| `npm run lint`                                      | `prettier --check .` + `eslint .`                                                 |
| `npm run lint:workflows`                            | `actionlint` on `.github/workflows/*.yml` (needs actionlint installed)            |
| `npm run format`                                    | `prettier --write .`                                                              |
| `npm test`                                          | `test:unit` then `test:e2e`                                                       |
| `npm run test:unit`                                 | Vitest, server and client projects                                                |
| `npm run test:e2e`                                  | Playwright (starts the preview server, loads the fixture, migrates)               |
| `npm run db:generate`                               | Generate + classify + flatten a migration from the Drizzle schema                 |
| `npm run db:migrate`                                | Apply migrations to the local D1                                                  |
| `npm run db:migrate:staging` / `db:migrate:prod`    | Apply migrations to remote staging / production D1 (normally done by CI)          |
| `npm run data:fixture`                              | Load `e2e/fixtures/data/fixture-0` into local R2                                  |
| `npm run data:local -- <version> [--from <origin>]` | Copy a published dataset version into local R2 (default origin production)        |
| `npm run signoff`                                   | Merge `origin/main`, run the full suite, push, post `local-ci/signoff`            |
| `npm run branch-protection` / `:dry`                | Apply (or preview with `:dry`) `main` branch protection; run once by a maintainer |
| `npm run types`                                     | Regenerate `worker-configuration.d.ts` (`wrangler types --strict-vars=false`)     |

## Architecture

One Cloudflare Worker (SvelteKit via `@sveltejs/adapter-cloudflare`) with bindings `DB` (D1), `BUCKET` (R2, bucket `sfhousing`, shared by both environments) and `PUBLISH_RL` (rate limit), plus `ASSETS`. The worker does no geo computation at runtime. All geographic data is static and versioned on R2 at key `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` by `src/routes/data/[version]/[...path]/+server.ts`. The var `PUBLIC_DATASET_VERSION` (in `wrangler.jsonc`, per environment) names the current dataset; it is passed to the client as data from the root layout load, never read as a global. Published versions are immutable.

Shell: the root layout renders the skip link, header, `<main>` and footer. Pages put actions in the header with `useHeaderActions(snippet)` from `src/lib/shell/header-actions.svelte.ts`; only the root layout calls `provideHeaderActions()`.

## Conventions

- All work happens in git worktrees under `.claude/worktrees/`.
- Conventional Commits.
- PRs merge only with the `local-ci/signoff` commit status. Run `npm run signoff` (full local suite, then it pushes and posts the status); do not `git push` first. `ci.yml` is contributor feedback, not the gate.
- Schema change: edit `src/lib/server/db/schema/` → `npm run db:generate` → `npm run db:migrate`. Never hand-edit migrations.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns (Prettier + ESLint).
- CSP (`kit.csp` in `svelte.config.js`) changes are interface changes: raise them with the owning subsystem rather than widening ad hoc. Map glyphs and sprites are self-hosted under `/data/<version>/`.
- Runtime dependencies that ship in the bundle get a credit in the `SOFTWARE` list in `src/lib/attribution.ts` (rendered at `/attribution`).
- Route tests that need R2 use `FakeR2Bucket` (`src/lib/server/test/fake-r2.ts`); Playwright against workerd is the source of truth for real R2 behaviour.
- Vitest runs with `expect.requireAssertions`: every test must call `expect`.
