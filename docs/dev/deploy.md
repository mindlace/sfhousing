# Deployment

| Environment | Worker              | Host                             | D1 database         | wrangler selection |
| ----------- | ------------------- | -------------------------------- | ------------------- | ------------------ |
| production  | `sfhousing`         | `sfhousing.mindlace.net`         | `sfhousing`         | no `--env`         |
| staging     | `sfhousing-staging` | `sfhousing-staging.mindlace.net` | `sfhousing-staging` | `--env staging`    |

Both environments share one R2 bucket, `sfhousing`, so a dataset version uploaded once is visible to both. Each has its own D1 database and its own `PUBLISH_RL` namespace. Production is the top-level config in `wrangler.jsonc`: omitting `--env` selects it. Staging uses `--env staging`.

## Release flow

- Push to `main` runs `.github/workflows/deploy-staging.yml`: build, apply D1 migrations to `sfhousing-staging`, deploy `--env staging`.
- The same push runs `release-please.yml`, which maintains a release PR. Merging the release PR creates the release and, in the same workflow (releases made with `GITHUB_TOKEN` do not trigger other workflows), the `deploy-prod` job builds the tag, applies migrations to `sfhousing` and deploys production.
- Pull requests run `ci.yml`: lint, check, unit tests, fixture load, migrate, Playwright (chromium and mobile projects), plus actionlint.
- Release-please PRs are opened with `GITHUB_TOKEN`, and events from `GITHUB_TOKEN` do not trigger other workflows, so `ci.yml` never runs on the release PR. If `ci` is a required check, the release PR deadlocks. Workarounds: run `ci.yml` by `workflow_dispatch` on the `release-please--*` branch (the check attaches to the branch head commit), or merge with an admin bypass. A durable fix is to give release-please a GitHub App token or PAT.

`PUBLIC_APP_RELEASE` is set at deploy time to the commit SHA (staging) or tag (production).

## Promoting a datasetVersion

1. Upload the version to R2 once (the data-pipeline upload command; `manifest.json` goes last).
2. Bump `PUBLIC_DATASET_VERSION` under `env.staging.vars` in `wrangler.jsonc`, merge, let staging deploy, and verify `/attribution` and the map.
3. Bump the top-level `PUBLIC_DATASET_VERSION` (production) in a later PR and release.

Versions are immutable and retained indefinitely.

## Secrets and variables

- `CLOUDFLARE_API_TOKEN`: repository secret.
- `CLOUDFLARE_ACCOUNT_ID`: repository variable.

Nothing else.

## One-time bootstrap

1. `npx wrangler d1 create sfhousing` and `npx wrangler d1 create sfhousing-staging`; paste each `database_id` over the placeholder (`TODO(bootstrap)`) in `wrangler.jsonc`.
2. `npx wrangler r2 bucket create sfhousing`.
3. Add the `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ACCOUNT_ID` variable in the GitHub repository settings; create the `staging` and `production` GitHub environments.
4. Attach the custom domains (declared as `custom_domain` routes in `wrangler.jsonc`; the zone must be on the Cloudflare account).
5. Decide the release-PR CI strategy (dispatch / admin bypass / GitHub App token); see Release flow.
6. Push to `main` to trigger the first staging deploy.
