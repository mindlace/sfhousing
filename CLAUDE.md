# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## What This Is

SF Housing Simulator: a free, open-source web tool for painting zoning and building changes onto a map of San Francisco and seeing the theoretical maximum buildout against housing targets. SvelteKit 2 + Svelte 5 (runes) + Tailwind 4 on a single Cloudflare Worker. Code is MIT; the data is open (ODbL / PDDL).

## Setup

```bash
nvm use                 # Node 24 (.nvmrc); engines require node >=22 <26, npm >=11.3.0
npm install             # also runs `wrangler types --strict-vars=false` and `svelte-kit sync` via prepare
npx playwright install chromium   # browser for client tests and e2e (the one download beyond npm)
echo 'PUBLIC_DATASET_VERSION=fixture-0' > .dev.vars   # dev override; the build computes the real dataset version
npm run data:fixture    # load the fixture dataset (fixture-0) into local R2
# npm run data:transit  # optional: live transit (Muni/BART/Caltrain GTFS) into the local dataset; fixture-0 already has a mini network
npm run db:migrate      # apply D1 migrations to the local database
npm run dev
```

If you see type errors about `worker-configuration`, run `npm run types`.

`.npmrc` sets `legacy-peer-deps=true` (the drizzle release candidates declare an optional `effect` peer). The lockfile pins `drizzle-orm` 1.0.0-rc.4-5d5b77c and `drizzle-kit` 1.0.0-rc.4-ca0f029 while `package.json` keeps caret ranges: do not run a blind `npm update` on drizzle.

## Scoped reference docs

Fetch the file when working in the relevant area:

- **Accounts, sims and invitations (identity model, `AUTH_METHODS` and the method switch, session gate, JSON-route origin check, mail log mode, roles, sim registration (`POST /api/sims`: its answers, ids with a past, the cap and rate), sims with no members, the roster hook, accounts and their deletion, e2e seams)** — [docs/dev/auth.md](docs/dev/auth.md)
- **Developer workflow (setup, `.dev.vars`, `data:fixture`/`data:local`, migrations, header actions)** — [docs/dev/developing.md](docs/dev/developing.md)
- **Deployment (environments, release flow, datasets ship with their code, the operator takedown of a sim, bootstrap checklist)** — [docs/dev/deploy.md](docs/dev/deploy.md)
- **Data serving (`/data/<version>/*` route contract, key layout, caching, path rules)** — [docs/dev/data-serving.md](docs/dev/data-serving.md)
- **Testing (Vitest projects, `FakeR2Bucket`, Playwright, fixture dataset)** — [docs/dev/testing.md](docs/dev/testing.md)
- **Data pipeline (commands, finishing a branch that changes the dataset, lock and `datasetVersion`, fixture, invariants, ODbL, partner actions)** — [docs/dev/pipeline.md](docs/dev/pipeline.md)
- **Accessibility (WCAG 2.2 AA, `expectNoA11yViolations`, per-page checklist)** — [docs/dev/accessibility.md](docs/dev/accessibility.md)
- **Plan and policy sharing (`/p` plans and `/s` `/sim` policies: API contract, rate limit, autosave, manual takedown)** — [docs/dev/plan-sharing.md](docs/dev/plan-sharing.md)
- **Map-view interfaces for page and subsystem consumers (`--map-controls-br-*` CSS vars, the citywide feed (`CityDelta`), merged rings and edge glows, bar modes)** — [docs/dev/map-interfaces.md](docs/dev/map-interfaces.md)
- **Map performance (`npm run bench:map`, pass bar, results, CI note)** — [docs/dev/map-perf.md](docs/dev/map-perf.md)
- **`src/lib/fzp/` after `FzpMode` (`/fzp` redirects to `/sim`; what `/lesscars` and the timeline share: scrubber contract, card and Results pieces, lookups on the map, known gaps)** — [docs/dev/fzp-mode.md](docs/dev/fzp-mode.md)
- **Policy levers engine (`SimLevers`, resolution order, law switch, timer reach, `setLevers` protocol)** — [docs/dev/sim-levers.md](docs/dev/sim-levers.md)
- **Map feed from a stepped world (`MapStream`, events to `TimelineUpdate`, rewind, snapshot, `restore`, the city feed)** — [docs/dev/map-stream.md](docs/dev/map-stream.md)
- **Timeline UI on `/sim` (the timeline, the ruler, the three zones and Play from, the policy document on the page, the worker messages as the page uses them, the session's stale and rejection rules, edits in place on an offer, known limits, measurements)** — [docs/dev/timeline-ui.md](docs/dev/timeline-ui.md)
- **`/sim` page (the page shell, schema 3 recipe the editors project, map overlays, autosave and the read-only view, request flow, dataset requirement)** — [docs/dev/sim-page.md](docs/dev/sim-page.md)
- **Permitting timers on `/sim` (presets, floors, evidence, Save and Revert, route timelines)** — [docs/dev/sim-timers.md](docs/dev/sim-timers.md)
- **Public money on `/sim` (`FinanceLevers`, schema 3 loader, presets and their sources, Funding editors per policy, drafts, Results money and income rows, card line, notices)** — [docs/dev/sim-funding.md](docs/dev/sim-funding.md)
- **`/lesscars` (plan format, checks, dated regimes and reservations, freed land, paired runs, output files, the page)** — [docs/dev/lesscars.md](docs/dev/lesscars.md)
- **Road-like lots (imagery review behind `road-lots.json`, lots beside freed sites, live build measurements)** — [docs/dev/road-lots.md](docs/dev/road-lots.md)
- **Building boxes (LiDAR fetch → `boxes` → `build`, `BOXES` thresholds, `src` values, the `building-boxes` artifact, z14+ tiles, V37, tuning loop)** — [docs/dev/building-boxes.md](docs/dev/building-boxes.md)
- **Policies with dates (schema 4 document, compiling to frames, frame ids, the comparison)** — [docs/dev/policy-timeline.md](docs/dev/policy-timeline.md)
- **Finance model (prototypes, market terms, grant-equivalents, bundles, income tiers, debt and legal limits)** — [docs/dev/finance-model.md](docs/dev/finance-model.md)
- **Today's market (`calibration.market`, the start-odds shift, `market.json`, `SimInput.market` steps, the affordable-cohort flag)** — [docs/dev/market.md](docs/dev/market.md)
- **Finance data (`affordableHomes`, `byTier`, `affordableRoutes`, `baselineFunding`, `funding.json`, the MOHCD source)** — [docs/dev/finance-data.md](docs/dev/finance-data.md)
- **Funded starts, the funding queue and the pools in the engine (`SimInput.finance`, `off`, latents, the line and its order, the award rule, re-pricing and lapse, the ledger protocol, the card's funding fields, `sampleAdvance`, budgets)** — [docs/dev/finance-engine.md](docs/dev/finance-engine.md)
- **Funding levers (`FinanceLevers`, `buildFinance`, `off` spans, the twin, the worker's guard, the finance warm task)** — [docs/dev/finance-levers.md](docs/dev/finance-levers.md)
- **Homes by income tier and public money in the results (`TimelineScore.tiers` and `money`, `tiersOf`, the ledger series and their identities, per added home, limit statements)** — [docs/dev/finance-score.md](docs/dev/finance-score.md)
- **World core (the world, the step and its systems, the due list, the readers, the funding hook)** — [docs/dev/world-core.md](docs/dev/world-core.md)
- **Results from the step engine (WorldSeries, chunks, TimelineView, cardAt)** — [docs/dev/world-score.md](docs/dev/world-score.md)
- **Public money in the step engine (world-funding: the line by month, funded clocks over frames, money events at stage events, shadows, the tolerance referee)** — [docs/dev/world-funding.md](docs/dev/world-funding.md)
- **Ensemble runner (the /sim timeline worker host: openTimeline, setPolicy, filling, copies and refill, lookups)** — [docs/dev/ensemble-runner.md](docs/dev/ensemble-runner.md)
- **Sim log core (commits, changes, item keys, the shape registry, fold, diff, re-apply, undo and redo, the hash chain)** — [docs/dev/sim-log.md](docs/dev/sim-log.md)
- **Sim object (the per-sim Durable Object, its socket and frames, append rules, limits, the sim migration track, the D1 copy, `rereadRoles`, `appendAs` and the rename, `takeDown`)** — [docs/dev/sim-object.md](docs/dev/sim-object.md)
- **Sim sync (registering a sim from the browser, the socket client, tabs and their claims, the save state, the dev rule)** — [docs/dev/sim-sync.md](docs/dev/sim-sync.md)
- **Browser log store (`LocalLog`, `LogStore`, `DocStore`, pending and drafts, the dataset rule, restore commits, IndexedDB)** — [docs/dev/sim-store.md](docs/dev/sim-store.md)
- **Design, specs and plans** — `docs/superpowers/design/`, `docs/superpowers/specs/`, `docs/superpowers/plans/`

Subsystems add their own docs here (`plan-sharing.md`, `pipeline.md`) and link them from this list.

## Commands

| Command                                             | Purpose                                                                                                                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                       | Vite dev server (local D1/R2 via adapter-cloudflare's platform proxy)                                                                                                            |
| `npm run build`                                     | Production build                                                                                                                                                                 |
| `npm run preview`                                   | Build, then `wrangler dev` on port 4173 with `ENVIRONMENT=development`                                                                                                           |
| `npm run check`                                     | `svelte-kit sync` + `svelte-check`                                                                                                                                               |
| `npm run lint`                                      | `prettier --check .` + `eslint .`                                                                                                                                                |
| `npm run lint:workflows`                            | `actionlint` on `.github/workflows/*.yml` (needs actionlint installed)                                                                                                           |
| `npm run format`                                    | `prettier --write .`                                                                                                                                                             |
| `npm test`                                          | `test:unit` then `test:e2e`                                                                                                                                                      |
| `npm run test:unit`                                 | Vitest, server and client projects                                                                                                                                               |
| `npm run test:perf`                                 | Wall-clock budgets (perf, client-perf); idle machine only, not in signoff                                                                                                        |
| `npm run test:e2e`                                  | Playwright (starts the preview server, loads the fixture, migrates)                                                                                                              |
| `npm run bench:map`                                 | Headed GPU map pan benchmark (p50/p95 frame time); see docs/dev/map-perf.md                                                                                                      |
| `npm run db:generate`                               | Generate + classify + flatten a migration from the Drizzle schema                                                                                                                |
| `npm run db:generate:sim`                           | Generate + classify + bundle a migration of the sim object's own SQLite track; append-only                                                                                       |
| `npm run db:migrate`                                | Apply migrations to the local D1                                                                                                                                                 |
| `npm run db:migrate:staging` / `db:migrate:prod`    | Apply migrations to remote staging / production D1 (normally done by CI)                                                                                                         |
| `npm run pipeline -- <cmd>`                         | Data pipeline: `doctor`, `fetch`, `version`, `build`, `check`, `upload`, `verify`, `fixture`, `quality-doc`, `lesscars-cnns`, `lesscars-freeway-land`, `lesscars-basemap`, `all` |
| `npm run test:pipeline`                             | Vitest pipeline project (needs tippecanoe, pmtiles)                                                                                                                              |
| `npm run data:fixture`                              | Load `e2e/fixtures/data/fixture-0` into local R2                                                                                                                                 |
| `npm run data:local -- <version> [--from <origin>]` | Copy a published dataset version into local R2 (default origin production)                                                                                                       |
| `npm run data:transit [-- <version>]`               | Fetch Muni/BART/Caltrain GTFS from the agencies, build transit.json into the local dataset (`.dev.vars` version)                                                                 |
| `npm run signoff`                                   | `chreode signoff`: merge `origin/main`, run the steps the changes need, push, post `chreode/signoff`                                                                             |
| `npm run branch-protection` / `:dry`                | `chreode protect`: require `chreode/signoff` on `main` (`:dry` previews); run once by a maintainer                                                                               |
| `npm run types`                                     | Regenerate `worker-configuration.d.ts` (`wrangler types --strict-vars=false`)                                                                                                    |

## Architecture

One Cloudflare Worker (SvelteKit via `@sveltejs/adapter-cloudflare`) with bindings `DB` (D1), `BUCKET` (R2, bucket `sfhousing`, shared by both environments), seven rate limits (`PUBLISH_RL`, `AUTH_LINK_RL`, `AUTH_PASSWORD_RL`, `PSEUDO_MINT_RL`, `INVITE_RL`, `ACCOUNT_EDIT_RL`, `MUTATION_REGISTERED_RL`; see [docs/dev/auth.md](docs/dev/auth.md)), `ASSETS` and `SIM` (a Durable Object, class `SimObject`, SQLite: the per-sim log, see [docs/dev/sim-object.md](docs/dev/sim-object.md)), the vars `ENVIRONMENT`, `AUTH_METHODS`, `SES_FROM` and `PUBLIC_APP_RELEASE` (`wrangler.jsonc`), and the optional secret `SIM_TAKEDOWN_TOKEN` (unset by default in both environments; it switches on the operator takedown route, see [docs/dev/deploy.md](docs/dev/deploy.md)). All geographic data is static and versioned on R2 at key `data/<datasetVersion>/<path>`, served at `/data/<datasetVersion>/<path>` by `src/routes/data/[version]/[...path]/+server.ts`. The build computes the dataset version from the source tree (`treeDatasetVersion`, injected as `__SFH_DATASET_VERSION__`); `PUBLIC_DATASET_VERSION` is a development-only override. The version reaches the client as data from the root layout load, never as a global. Published versions are immutable. The build wraps the adapter's `_worker.js` so the Worker also exports `SimObject` (`scripts/worker-entry.ts`), and wrangler resolves its `$lib` imports through `alias`.

Shell: the root layout renders the skip link, header and `<main>`, and the footer on document routes only (`isFullHeightRoute` routes, the map pages, have none). Pages put actions in the header with `useHeaderActions(snippet, { pinned?, status? })` from `src/lib/shell/header-actions.svelte.ts` (`null` for none); only the root layout calls `provideHeaderActions()`. The map's layer switches are not header actions: they sit in the map toolbar's Layers panel beside Key (`MapKeyControl`, [docs/dev/map-interfaces.md](docs/dev/map-interfaces.md)). `status` is the page's one status cell on the left (after the steps from lg, after the site name below lg, never in the Menu): the save state on `/` and `/sim`, with nothing visible when saved; on `/sim` "Updating" covers it while the numbers are stale. `pinned` is one item always in the bar (on `/sim` the headline: line 1 the homes from today to the playhead's month, line 2 the effect and the goal; on Paint, `/` and `/p/<id>`, the same two-line box: line 1 "Room for 47,335 homes", line 2 "57% of the goal", undated); below sm, on a page that pins an item, the site name moves into the Menu. The header also carries an account entry after the actions (`@handle` linking `/account`, fed by the root layout's `user`; or `Sign in` while a sign-in method is in effect, `signInAvailable`) and an About entry after it, both in the Menu below lg.

## Conventions

- All work happens in git worktrees under `.claude/worktrees/`.
- Conventional Commits.
- PRs merge only with the `chreode/signoff` commit status. Run `npm run signoff` ([chreode](https://github.com/mindlace/chreode); config in `chreode.config.ts`): it merges `origin/main`, runs only the steps the changes since the last signoff need (a path no rule matches runs everything), pushes, and posts the status; do not `git push` first. `npm run signoff -- --dry-run` prints the plan; `-- --full` runs every step. There is no CI workflow on pull requests; signoff is the only check.
- A branch that changes the dataset version uploads its dataset before signoff: see [docs/dev/pipeline.md](docs/dev/pipeline.md) (Finishing a branch that changes the dataset).
- Schema change: edit `src/lib/server/db/schema/` → `npm run db:generate` → `npm run db:migrate`. Never hand-edit migrations.
- Code style: 2-space indent, single quotes, no trailing commas, 100 columns (Prettier + ESLint).
- CSP (`kit.csp` in `svelte.config.js`) changes are interface changes: raise them with the owning subsystem rather than widening ad hoc. Map glyphs and sprites are self-hosted under `/data/<version>/`.
- Runtime dependencies that ship in the bundle get a credit in the `SOFTWARE` list in `src/lib/attribution.ts` (rendered at `/attribution`).
- Route tests that need R2 use `FakeR2Bucket` (`src/lib/server/test/fake-r2.ts`); Playwright against workerd is the source of truth for real R2 behaviour.
- Vitest runs with `expect.requireAssertions`: every test must call `expect`.
